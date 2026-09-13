-- =============================================================================
-- Native (iOS/Android) Expo push tokens alongside existing Web Push.
-- =============================================================================

create table if not exists public.expo_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  token text not null,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expo_push_tokens_token_key unique (token)
);

create index if not exists expo_push_tokens_user_id_idx
  on public.expo_push_tokens (user_id);

alter table public.expo_push_tokens enable row level security;

drop policy if exists "expo_push_tokens_select_own" on public.expo_push_tokens;
create policy "expo_push_tokens_select_own"
  on public.expo_push_tokens for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "expo_push_tokens_insert_own" on public.expo_push_tokens;
create policy "expo_push_tokens_insert_own"
  on public.expo_push_tokens for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "expo_push_tokens_update_own" on public.expo_push_tokens;
create policy "expo_push_tokens_update_own"
  on public.expo_push_tokens for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "expo_push_tokens_delete_own" on public.expo_push_tokens;
create policy "expo_push_tokens_delete_own"
  on public.expo_push_tokens for delete to authenticated
  using (user_id = auth.uid());

comment on table public.expo_push_tokens is
  'Expo push tokens for native iOS/Android deadline and competition alerts.';

-- Bind this device token to the current user (one token → one account).
create or replace function public.expo_push_bind_token(
  p_token text,
  p_platform text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_platform text;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;
  if p_token is null or length(trim(p_token)) < 20 then
    return jsonb_build_object('success', false, 'error', 'invalid_token');
  end if;

  v_platform := lower(coalesce(nullif(trim(p_platform), ''), 'ios'));
  if v_platform not in ('ios', 'android') then
    v_platform := 'ios';
  end if;

  insert into public.expo_push_tokens (user_id, token, platform, updated_at)
  values (v_uid, trim(p_token), v_platform, now())
  on conflict (token) do update
    set user_id = excluded.user_id,
        platform = excluded.platform,
        updated_at = now();

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.expo_push_bind_token(text, text) from public;
grant execute on function public.expo_push_bind_token(text, text) to authenticated;

create or replace function public.expo_push_unbind_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;
  if p_token is null or length(trim(p_token)) < 20 then
    return jsonb_build_object('success', false, 'error', 'invalid_token');
  end if;

  delete from public.expo_push_tokens
  where token = trim(p_token)
    and user_id = v_uid;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.expo_push_unbind_token(text) from public;
grant execute on function public.expo_push_unbind_token(text) to authenticated;

create or replace function public.expo_push_unbind_all_devices()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  delete from public.expo_push_tokens
  where user_id = v_uid;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.expo_push_unbind_all_devices() from public;
grant execute on function public.expo_push_unbind_all_devices() to authenticated;

-- Deadline reminders: include both Web Push and Expo token rows.
-- Must drop first: return shape changed (channel + expo_token).
drop function if exists public.lms_list_deadline_reminders();

create or replace function public.lms_list_deadline_reminders()
returns table (
  user_id uuid,
  competition_id uuid,
  competition_name text,
  gameweek_id uuid,
  gameweek_number int,
  deadline_at timestamptz,
  predicted_team_name text,
  reminder_window text,
  channel text,
  endpoint text,
  p256dh text,
  auth text,
  expo_token text
)
language sql
security definer
set search_path = public
stable
as $$
  with windows as (
    select '2h'::text as reminder_window,
           now() + interval '1 hour 45 minutes' as win_start,
           now() + interval '2 hours 15 minutes' as win_end
    union all
    select '30m'::text,
           now() + interval '15 minutes',
           now() + interval '45 minutes'
  ),
  due_gameweeks as (
    select gw.*, w.reminder_window
    from windows w
    join public.lms_gameweeks gw
      on gw.deadline_at >= w.win_start
     and gw.deadline_at < w.win_end
    where gw.status is distinct from 'complete'
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
    cand.competition_id,
    cand.competition_name,
    cand.gameweek_id,
    cand.gameweek_number,
    cand.deadline_at,
    cand.predicted_team_name,
    cand.reminder_window,
    'web'::text as channel,
    sub.endpoint,
    sub.p256dh,
    sub.auth,
    null::text as expo_token
  from candidates cand
  join public.web_push_subscriptions sub on sub.user_id = cand.user_id
  where cand.predicted_team_name is not null

  union all

  select
    cand.user_id,
    cand.competition_id,
    cand.competition_name,
    cand.gameweek_id,
    cand.gameweek_number,
    cand.deadline_at,
    cand.predicted_team_name,
    cand.reminder_window,
    'expo'::text as channel,
    null::text as endpoint,
    null::text as p256dh,
    null::text as auth,
    tok.token as expo_token
  from candidates cand
  join public.expo_push_tokens tok on tok.user_id = cand.user_id
  where cand.predicted_team_name is not null;
$$;

revoke all on function public.lms_list_deadline_reminders() from public;
revoke all on function public.lms_list_deadline_reminders() from authenticated;
grant execute on function public.lms_list_deadline_reminders() to service_role;

-- Join notify recipients: return enabled manager user_ids (devices resolved at send time).
drop function if exists public.lms_list_join_notify_recipients(uuid);
create or replace function public.lms_list_join_notify_recipients(p_competition_id uuid)
returns table (user_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  with managers as (
    select c.created_by_user_id as user_id, true as default_on
    from public.lms_competitions c
    where c.id = p_competition_id
      and c.created_by_user_id is not null
    union
    select p.id as user_id, false as default_on
    from public.profiles p
    where p.role = 'Owner'
    union
    select m.user_id, true as default_on
    from public.lms_competition_managers m
    where m.competition_id = p_competition_id
  ),
  distinct_managers as (
    select
      m.user_id,
      bool_or(m.default_on) as default_on
    from managers m
    where m.user_id is not null
    group by m.user_id
  ),
  with_pref as (
    select
      dm.user_id,
      dm.default_on,
      pref.enabled as pref_enabled
    from distinct_managers dm
    left join public.lms_join_notify_prefs pref
      on pref.competition_id = p_competition_id
     and pref.user_id = dm.user_id
  )
  select wp.user_id
  from with_pref wp
  where coalesce(wp.pref_enabled, wp.default_on) = true;
$$;

revoke all on function public.lms_list_join_notify_recipients(uuid) from public;
revoke all on function public.lms_list_join_notify_recipients(uuid) from authenticated;
grant execute on function public.lms_list_join_notify_recipients(uuid) to service_role;

drop function if exists public.f2t_list_join_notify_recipients(uuid);
create or replace function public.f2t_list_join_notify_recipients(p_competition_id uuid)
returns table (user_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  with managers as (
    select c.created_by_user_id as user_id, true as default_on
    from public.f2t_competitions c
    where c.id = p_competition_id
      and c.created_by_user_id is not null
    union
    select p.id as user_id, false as default_on
    from public.profiles p
    where p.role = 'Owner'
    union
    select m.user_id, true as default_on
    from public.f2t_competition_managers m
    where m.competition_id = p_competition_id
  ),
  distinct_managers as (
    select
      m.user_id,
      bool_or(m.default_on) as default_on
    from managers m
    where m.user_id is not null
    group by m.user_id
  ),
  with_pref as (
    select
      dm.user_id,
      dm.default_on,
      pref.enabled as pref_enabled
    from distinct_managers dm
    left join public.f2t_join_notify_prefs pref
      on pref.competition_id = p_competition_id
     and pref.user_id = dm.user_id
  )
  select wp.user_id
  from with_pref wp
  where coalesce(wp.pref_enabled, wp.default_on) = true;
$$;

revoke all on function public.f2t_list_join_notify_recipients(uuid) from public;
revoke all on function public.f2t_list_join_notify_recipients(uuid) from authenticated;
grant execute on function public.f2t_list_join_notify_recipients(uuid) to service_role;

drop function if exists public.racing_list_join_notify_recipients(uuid);
create or replace function public.racing_list_join_notify_recipients(p_competition_id uuid)
returns table (user_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  with managers as (
    select c.created_by_user_id as user_id, true as default_on
    from public.competitions c
    where c.id = p_competition_id
      and c.created_by_user_id is not null
    union
    select p.id as user_id, false as default_on
    from public.profiles p
    where p.role = 'Owner'
    union
    select m.user_id, true as default_on
    from public.racing_competition_managers m
    where m.competition_id = p_competition_id
  ),
  distinct_managers as (
    select
      m.user_id,
      bool_or(m.default_on) as default_on
    from managers m
    where m.user_id is not null
    group by m.user_id
  ),
  with_pref as (
    select
      dm.user_id,
      dm.default_on,
      pref.enabled as pref_enabled
    from distinct_managers dm
    left join public.racing_join_notify_prefs pref
      on pref.competition_id = p_competition_id
     and pref.user_id = dm.user_id
  )
  select wp.user_id
  from with_pref wp
  where coalesce(wp.pref_enabled, wp.default_on) = true;
$$;

revoke all on function public.racing_list_join_notify_recipients(uuid) from public;
revoke all on function public.racing_list_join_notify_recipients(uuid) from authenticated;
grant execute on function public.racing_list_join_notify_recipients(uuid) to service_role;
