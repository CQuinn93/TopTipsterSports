-- LMS pick reminders by email (Resend), ~1 hour before kick-off.
-- Kick-off is deadline_at + 20 minutes, so "1h before kick-off" ≈ deadline in 40 minutes.
-- Dedupe uses reminder_window = '1h_email' on lms_pick_reminder_sent.

alter table public.lms_pick_reminder_sent
  drop constraint if exists lms_pick_reminder_sent_reminder_window_check;

alter table public.lms_pick_reminder_sent
  add constraint lms_pick_reminder_sent_reminder_window_check
  check (reminder_window in ('2h', '30m', '1h_email'));

comment on table public.lms_pick_reminder_sent is
  'Dedupe log for LMS deadline reminders (push 2h/30m + email 1h_email; service role only).';

create or replace function public.lms_list_deadline_email_reminders()
returns table (
  user_id uuid,
  email text,
  competition_id uuid,
  competition_name text,
  gameweek_id uuid,
  gameweek_number int,
  deadline_at timestamptz,
  predicted_team_name text,
  reminder_window text
)
language sql
security definer
set search_path = public, auth
stable
as $$
  with due_gameweeks as (
    -- Centre window on ~40m before deadline (= ~1h before kick-off), ±15m for 15-min cron.
    select
      gw.*,
      '1h_email'::text as reminder_window
    from public.lms_gameweeks gw
    where gw.status is distinct from 'complete'
      and gw.deadline_at >= now() + interval '25 minutes'
      and gw.deadline_at < now() + interval '55 minutes'
  ),
  candidates as (
    select
      p.user_id,
      p.competition_id,
      c.name as competition_name,
      gw.id as gameweek_id,
      gw.number as gameweek_number,
      gw.deadline_at,
      gw.reminder_window,
      (
        select t.name
        from public.lms_teams t
        where exists (
          select 1 from public.lms_competition_teams ct
          where ct.competition_id = p.competition_id and ct.team_id = t.id
        )
        and exists (
          select 1 from public.lms_fixtures f
          where f.gameweek_id = gw.id
            and coalesce(f.excluded_from_lms, false) = false
            and (f.home_team_id = t.id or f.away_team_id = t.id)
        )
        and not exists (
          select 1 from public.lms_used_teams u
          where u.competition_id = p.competition_id
            and u.user_id = p.user_id
            and u.team_id = t.id
        )
        order by lower(t.name) asc
        limit 1
      ) as predicted_team_name
    from due_gameweeks gw
    join public.lms_participants p on true
    join public.lms_competitions c on c.id = p.competition_id
    left join public.lms_gameweeks sg on sg.id = c.start_gameweek_id
    where p.status = 'active'
      and c.status in ('open', 'active')
      and c.season = gw.season
      and (
        c.start_gameweek_id is null
        or (sg.season = gw.season and sg.number <= gw.number)
      )
      and not exists (
        select 1 from public.lms_picks pk
        where pk.competition_id = p.competition_id
          and pk.user_id = p.user_id
          and pk.gameweek_id = gw.id
      )
      and not exists (
        select 1 from public.lms_pick_reminder_sent s
        where s.user_id = p.user_id
          and s.competition_id = p.competition_id
          and s.gameweek_id = gw.id
          and s.reminder_window = gw.reminder_window
      )
  )
  select
    cand.user_id,
    lower(trim(u.email)) as email,
    cand.competition_id,
    cand.competition_name,
    cand.gameweek_id,
    cand.gameweek_number,
    cand.deadline_at,
    cand.predicted_team_name,
    cand.reminder_window
  from candidates cand
  join auth.users u on u.id = cand.user_id
  where cand.predicted_team_name is not null
    and coalesce(trim(u.email), '') <> ''
    and u.email_confirmed_at is not null;
$$;

revoke all on function public.lms_list_deadline_email_reminders() from public;
revoke all on function public.lms_list_deadline_email_reminders() from authenticated;
grant execute on function public.lms_list_deadline_email_reminders() to service_role;
