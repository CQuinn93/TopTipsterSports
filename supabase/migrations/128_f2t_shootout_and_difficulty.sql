-- Tipster20: private shootout picks (ranks 1–3) + frozen Team Difficulty (1–5)
-- Winner ladder when 2+ hit 20: shootout knockout → highest difficulty_sum → split pot.

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

alter table public.f2t_participants
  add column if not exists difficulty_sum int;

comment on column public.f2t_participants.difficulty_sum is
  'Sum of locked 1–5 difficulty ranks for the original 20 at selection lock. Higher = harder squad.';

alter table public.f2t_selections
  add column if not exists locked_difficulty_rank smallint
    check (locked_difficulty_rank is null or locked_difficulty_rank between 1 and 5);

comment on column public.f2t_selections.locked_difficulty_rank is
  'Scoring-likelihood rank 1–5 frozen at selection submit/lock for this slot.';

create table if not exists public.f2t_shootout_selections (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.f2t_competitions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  shootout_rank smallint not null check (shootout_rank between 1 and 3),
  player_id uuid not null references public.football_players(id) on delete restrict,
  scored_at timestamptz,
  scored_gameweek_id uuid references public.lms_gameweeks(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (competition_id, user_id, shootout_rank),
  unique (competition_id, user_id, player_id)
);

create index if not exists idx_f2t_shootout_comp_user
  on public.f2t_shootout_selections(competition_id, user_id);
create index if not exists idx_f2t_shootout_player
  on public.f2t_shootout_selections(player_id);

alter table public.f2t_shootout_selections enable row level security;

drop policy if exists f2t_shootout_select_own on public.f2t_shootout_selections;
create policy f2t_shootout_select_own
  on public.f2t_shootout_selections for select to authenticated
  using (user_id = auth.uid());

drop policy if exists f2t_shootout_insert_own on public.f2t_shootout_selections;
create policy f2t_shootout_insert_own
  on public.f2t_shootout_selections for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists f2t_shootout_update_own on public.f2t_shootout_selections;
create policy f2t_shootout_update_own
  on public.f2t_shootout_selections for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists f2t_shootout_delete_own on public.f2t_shootout_selections;
create policy f2t_shootout_delete_own
  on public.f2t_shootout_selections for delete to authenticated
  using (user_id = auth.uid());

comment on table public.f2t_shootout_selections is
  'Private Tipster20 shootout picks (ranks 1–3). Visible only to the owning user; used for post-F2T knockout.';

-- ---------------------------------------------------------------------------
-- Difficulty rank helper (FPL picker_stats at lock)
-- ---------------------------------------------------------------------------

create or replace function public.f2t_difficulty_rank_from_stats(
  p_stats jsonb,
  p_position text
)
returns int
language plpgsql
immutable
as $$
declare
  v_stats jsonb := coalesce(p_stats, '{}'::jsonb);
  v_xg numeric;
  v_goals numeric;
  v_signal numeric;
  v_minutes numeric;
  v_pos text := upper(trim(coalesce(p_position, '')));
  v_floor int;
begin
  begin
    v_xg := nullif(trim(v_stats->>'expected_goals'), '')::numeric;
  exception when others then
    v_xg := null;
  end;
  begin
    v_goals := nullif(trim(v_stats->>'season_goals'), '')::numeric;
  exception when others then
    v_goals := null;
  end;
  begin
    v_minutes := nullif(trim(v_stats->>'minutes'), '')::numeric;
  exception when others then
    v_minutes := null;
  end;

  v_signal := coalesce(v_xg, v_goals, 0);

  v_floor := case
    when v_pos in ('GK', 'GKP', '1') then 5
    when v_pos in ('DEF', '2') then 4
    when v_pos in ('MID', '3') then 3
    when v_pos in ('FWD', '4') then 2
    else 3
  end;

  -- Sparse minutes: do not trust a thin sample unless signal is clearly established.
  if coalesce(v_minutes, 0) < 180 and v_signal < 2 then
    return v_floor;
  end if;

  if v_signal >= 8 then
    return 1;
  elsif v_signal >= 4 then
    return 2;
  elsif v_signal >= 2 then
    return 3;
  elsif v_signal >= 0.5 then
    return 4;
  else
    return 5;
  end if;
end;
$$;

create or replace function public.f2t_player_difficulty_rank(p_player_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select public.f2t_difficulty_rank_from_stats(fp.picker_stats, fp.position)
  from public.football_players fp
  where fp.id = p_player_id;
$$;

revoke all on function public.f2t_difficulty_rank_from_stats(jsonb, text) from public;
grant execute on function public.f2t_difficulty_rank_from_stats(jsonb, text) to authenticated;
grant execute on function public.f2t_difficulty_rank_from_stats(jsonb, text) to service_role;

revoke all on function public.f2t_player_difficulty_rank(uuid) from public;
grant execute on function public.f2t_player_difficulty_rank(uuid) to authenticated;
grant execute on function public.f2t_player_difficulty_rank(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Submit selections: 20 main + 3 shootout (ranks 1–3 in array order)
-- ---------------------------------------------------------------------------

drop function if exists public.f2t_submit_selections(uuid, uuid[]);

create or replace function public.f2t_submit_selections(
  p_competition_id uuid,
  p_player_ids uuid[],
  p_shootout_player_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_comp public.f2t_competitions%rowtype;
  v_sg public.lms_gameweeks%rowtype;
  v_pid uuid;
  v_slot int := 0;
  v_rank int;
  v_diff int;
  v_sum int := 0;
  v_all uuid[];
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  select * into v_comp from public.f2t_competitions where id = p_competition_id;
  if not found then
    return jsonb_build_object('success', false, 'error', 'invalid_competition');
  end if;

  if not exists (
    select 1 from public.f2t_participants
    where competition_id = p_competition_id and user_id = v_uid and status = 'active'
  ) then
    return jsonb_build_object('success', false, 'error', 'not_participant');
  end if;

  select * into v_sg from public.lms_gameweeks where id = v_comp.start_gameweek_id;

  if now() >= v_sg.deadline_at then
    return jsonb_build_object('success', false, 'error', 'deadline_passed');
  end if;

  if coalesce(array_length(p_player_ids, 1), 0) <> 20 then
    return jsonb_build_object('success', false, 'error', 'invalid_count');
  end if;

  if coalesce(array_length(p_shootout_player_ids, 1), 0) <> 3 then
    return jsonb_build_object('success', false, 'error', 'invalid_shootout_count');
  end if;

  if exists (
    select pid from unnest(p_player_ids) as pid
    group by pid having count(*) > 1
  ) then
    return jsonb_build_object('success', false, 'error', 'duplicate_player');
  end if;

  if exists (
    select pid from unnest(p_shootout_player_ids) as pid
    group by pid having count(*) > 1
  ) then
    return jsonb_build_object('success', false, 'error', 'duplicate_shootout_player');
  end if;

  v_all := p_player_ids || p_shootout_player_ids;
  if exists (
    select pid from unnest(v_all) as pid
    group by pid having count(*) > 1
  ) then
    return jsonb_build_object('success', false, 'error', 'shootout_overlaps_main');
  end if;

  foreach v_pid in array v_all loop
    if not public.f2t_player_selectable(v_pid) then
      return jsonb_build_object('success', false, 'error', 'player_not_selectable');
    end if;
    if public.f2t_player_scored_since_start(p_competition_id, v_pid) then
      return jsonb_build_object('success', false, 'error', 'player_already_scored');
    end if;
  end loop;

  delete from public.f2t_selections
  where competition_id = p_competition_id and user_id = v_uid;

  delete from public.f2t_shootout_selections
  where competition_id = p_competition_id and user_id = v_uid;

  v_sum := 0;
  foreach v_pid in array p_player_ids loop
    v_slot := v_slot + 1;
    v_diff := coalesce(public.f2t_player_difficulty_rank(v_pid), 3);
    v_sum := v_sum + v_diff;
    insert into public.f2t_selections (
      competition_id, user_id, slot, player_id, locked_difficulty_rank
    ) values (p_competition_id, v_uid, v_slot, v_pid, v_diff);
  end loop;

  for v_rank in 1..3 loop
    v_pid := p_shootout_player_ids[v_rank];
    insert into public.f2t_shootout_selections (
      competition_id, user_id, shootout_rank, player_id
    ) values (p_competition_id, v_uid, v_rank, v_pid);
  end loop;

  update public.f2t_participants
  set difficulty_sum = v_sum
  where competition_id = p_competition_id and user_id = v_uid;

  return jsonb_build_object('success', true, 'difficulty_sum', v_sum);
end;
$$;

revoke all on function public.f2t_submit_selections(uuid, uuid[], uuid[]) from public;
grant execute on function public.f2t_submit_selections(uuid, uuid[], uuid[]) to authenticated;
grant execute on function public.f2t_submit_selections(uuid, uuid[], uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- Substitution: main 20 unchanged; shootout = owner_flag only
-- ---------------------------------------------------------------------------

create or replace function public.f2t_use_substitution(
  p_competition_id uuid,
  p_out_player_id uuid,
  p_in_player_id uuid,
  p_type text default 'regular'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_part public.f2t_participants%rowtype;
  v_comp public.f2t_competitions%rowtype;
  v_sg public.lms_gameweeks%rowtype;
  v_out_sel public.f2t_selections%rowtype;
  v_out_so public.f2t_shootout_selections%rowtype;
  v_is_shootout boolean := false;
  v_unscored int;
  v_completed_gws int;
  v_current_gw uuid;
  v_sub_type text := lower(trim(coalesce(p_type, 'regular')));
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  if v_sub_type not in ('regular', 'owner_flag') then
    return jsonb_build_object('success', false, 'error', 'invalid_type');
  end if;

  select * into v_comp from public.f2t_competitions where id = p_competition_id;
  select * into v_part
  from public.f2t_participants
  where competition_id = p_competition_id and user_id = v_uid;

  if not found or v_part.status <> 'active' then
    return jsonb_build_object('success', false, 'error', 'not_active');
  end if;

  select * into v_out_sel
  from public.f2t_selections
  where competition_id = p_competition_id
    and user_id = v_uid
    and player_id = p_out_player_id;

  if found then
    if v_out_sel.scored_at is not null then
      return jsonb_build_object('success', false, 'error', 'out_player_invalid');
    end if;
  else
    select * into v_out_so
    from public.f2t_shootout_selections
    where competition_id = p_competition_id
      and user_id = v_uid
      and player_id = p_out_player_id;

    if not found or v_out_so.scored_at is not null then
      return jsonb_build_object('success', false, 'error', 'out_player_invalid');
    end if;
    v_is_shootout := true;
  end if;

  -- Shootout picks can only be replaced via owner_flag free sub.
  if v_is_shootout and v_sub_type <> 'owner_flag' then
    return jsonb_build_object('success', false, 'error', 'shootout_requires_flag');
  end if;

  if not public.f2t_player_selectable(p_in_player_id) then
    return jsonb_build_object('success', false, 'error', 'in_player_not_selectable');
  end if;

  if public.f2t_player_scored_since_start(p_competition_id, p_in_player_id) then
    return jsonb_build_object('success', false, 'error', 'in_player_already_scored');
  end if;

  if exists (
    select 1 from public.f2t_selections
    where competition_id = p_competition_id
      and user_id = v_uid
      and player_id = p_in_player_id
  ) or exists (
    select 1 from public.f2t_shootout_selections
    where competition_id = p_competition_id
      and user_id = v_uid
      and player_id = p_in_player_id
  ) then
    return jsonb_build_object('success', false, 'error', 'in_player_already_selected');
  end if;

  select * into v_sg from public.lms_gameweeks where id = v_comp.start_gameweek_id;

  if v_sub_type = 'owner_flag' then
    if not exists (
      select 1 from public.football_players
      where id = p_out_player_id and owner_flagged = true
    ) then
      return jsonb_build_object('success', false, 'error', 'out_not_owner_flagged');
    end if;
  else
    if v_part.regular_sub_used then
      return jsonb_build_object('success', false, 'error', 'regular_sub_used');
    end if;

    select count(*)::int into v_unscored
    from public.f2t_selections
    where competition_id = p_competition_id and user_id = v_uid and scored_at is null;

    select count(*)::int into v_completed_gws
    from public.lms_gameweeks gw
    where gw.season = v_comp.season
      and gw.number >= coalesce(v_sg.number, 1)
      and gw.status = 'complete';

    if v_completed_gws < 3 or v_unscored <= 3 then
      return jsonb_build_object('success', false, 'error', 'regular_sub_not_allowed');
    end if;
  end if;

  select gw.id into v_current_gw
  from public.lms_gameweeks gw
  where gw.season = v_comp.season
    and gw.status in ('upcoming', 'live')
    and gw.number >= coalesce(v_sg.number, 1)
  order by gw.number asc
  limit 1;

  if v_current_gw is null then
    select gw.id into v_current_gw
    from public.lms_gameweeks gw
    where gw.season = v_comp.season
    order by gw.number desc
    limit 1;
  end if;

  if v_is_shootout then
    update public.f2t_shootout_selections
    set player_id = p_in_player_id
    where id = v_out_so.id;
  else
    update public.f2t_selections
    set player_id = p_in_player_id
    where id = v_out_sel.id;
  end if;

  insert into public.f2t_substitutions (
    competition_id, user_id, out_player_id, in_player_id, gameweek_id, type
  ) values (
    p_competition_id, v_uid, p_out_player_id, p_in_player_id, v_current_gw, v_sub_type
  );

  if v_sub_type = 'regular' then
    update public.f2t_participants
    set regular_sub_used = true
    where competition_id = p_competition_id and user_id = v_uid;
  end if;

  return jsonb_build_object('success', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Apply goals + winner resolution ladder
-- ---------------------------------------------------------------------------

create or replace function public.f2t_apply_gameweek_goals(p_gameweek_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gw public.lms_gameweeks%rowtype;
  v_updated int := 0;
  v_so_updated int := 0;
  v_winner_set int := 0;
  v_comp_id uuid;
  v_remaining uuid[];
  v_next uuid[];
  v_uid uuid;
  v_rank int;
  v_any_scored boolean;
  v_any_unscored boolean;
  v_best_sum int;
  v_best_count int;
begin
  select * into v_gw from public.lms_gameweeks where id = p_gameweek_id;
  if not found then
    return jsonb_build_object('success', false, 'error', 'invalid_gameweek');
  end if;

  with scored as (
    select s.id as selection_id, g.gameweek_id
    from public.f2t_selections s
    join public.f2t_competitions c on c.id = s.competition_id
    join public.lms_gameweeks sg on sg.id = c.start_gameweek_id
    join public.football_player_gameweek_goals g on g.player_id = s.player_id
    join public.lms_gameweeks gw on gw.id = g.gameweek_id
    where s.scored_at is null
      and c.status <> 'completed'
      and gw.season = c.season
      and gw.number >= sg.number
      and g.gameweek_id = p_gameweek_id
  ),
  upd as (
    update public.f2t_selections sel
    set scored_at = now(),
        scored_gameweek_id = scored.gameweek_id
    from scored
    where sel.id = scored.selection_id
    returning sel.id
  )
  select count(*)::int into v_updated from upd;

  with scored_so as (
    select so.id as selection_id, g.gameweek_id
    from public.f2t_shootout_selections so
    join public.f2t_competitions c on c.id = so.competition_id
    join public.lms_gameweeks sg on sg.id = c.start_gameweek_id
    join public.football_player_gameweek_goals g on g.player_id = so.player_id
    join public.lms_gameweeks gw on gw.id = g.gameweek_id
    where so.scored_at is null
      and c.status <> 'completed'
      and gw.season = c.season
      and gw.number >= sg.number
      and g.gameweek_id = p_gameweek_id
  ),
  upd_so as (
    update public.f2t_shootout_selections sel
    set scored_at = now(),
        scored_gameweek_id = scored_so.gameweek_id
    from scored_so
    where sel.id = scored_so.selection_id
    returning sel.id
  )
  select count(*)::int into v_so_updated from upd_so;

  for v_comp_id in
    select distinct c.id
    from public.f2t_competitions c
    where c.status in ('open', 'active')
      and not exists (
        select 1 from public.f2t_participants w
        where w.competition_id = c.id and w.status = 'winner'
      )
      and exists (
        select 1
        from public.f2t_participants p
        where p.competition_id = c.id
          and p.status = 'active'
          and (
            select count(*) from public.f2t_selections s
            where s.competition_id = p.competition_id
              and s.user_id = p.user_id
              and s.scored_at is not null
          ) >= 20
      )
  loop
    select coalesce(array_agg(p.user_id), '{}'::uuid[])
    into v_remaining
    from public.f2t_participants p
    where p.competition_id = v_comp_id
      and p.status = 'active'
      and (
        select count(*) from public.f2t_selections s
        where s.competition_id = p.competition_id
          and s.user_id = p.user_id
          and s.scored_at is not null
      ) >= 20;

    if coalesce(array_length(v_remaining, 1), 0) = 0 then
      continue;
    end if;

    if array_length(v_remaining, 1) > 1 then
      -- Only run shootout if every remaining player has a full shootout set.
      if (
        select count(*)::int
        from public.f2t_participants p
        where p.competition_id = v_comp_id
          and p.user_id = any (v_remaining)
          and (
            select count(*) from public.f2t_shootout_selections so
            where so.competition_id = v_comp_id and so.user_id = p.user_id
          ) = 3
      ) = array_length(v_remaining, 1) then
        for v_rank in 1..3 loop
          if coalesce(array_length(v_remaining, 1), 0) <= 1 then
            exit;
          end if;

          v_any_scored := false;
          v_any_unscored := false;
          foreach v_uid in array v_remaining loop
            if exists (
              select 1 from public.f2t_shootout_selections so
              where so.competition_id = v_comp_id
                and so.user_id = v_uid
                and so.shootout_rank = v_rank
                and so.scored_at is not null
            ) then
              v_any_scored := true;
            else
              v_any_unscored := true;
            end if;
          end loop;

          if v_any_scored and v_any_unscored then
            select coalesce(array_agg(u), '{}'::uuid[])
            into v_next
            from unnest(v_remaining) as u
            where exists (
              select 1 from public.f2t_shootout_selections so
              where so.competition_id = v_comp_id
                and so.user_id = u
                and so.shootout_rank = v_rank
                and so.scored_at is not null
            );
            v_remaining := v_next;
          end if;
        end loop;
      end if;
    end if;

    if coalesce(array_length(v_remaining, 1), 0) > 1 then
      select max(coalesce(p.difficulty_sum, 0))
      into v_best_sum
      from public.f2t_participants p
      where p.competition_id = v_comp_id
        and p.user_id = any (v_remaining);

      select count(*)::int
      into v_best_count
      from public.f2t_participants p
      where p.competition_id = v_comp_id
        and p.user_id = any (v_remaining)
        and coalesce(p.difficulty_sum, 0) = v_best_sum;

      if v_best_count = 1 then
        select array_agg(p.user_id)
        into v_remaining
        from public.f2t_participants p
        where p.competition_id = v_comp_id
          and p.user_id = any (v_remaining)
          and coalesce(p.difficulty_sum, 0) = v_best_sum;
      end if;
      -- else leave all remaining → split pot
    end if;

    update public.f2t_participants p
    set status = 'winner',
        completed_at = coalesce(p.completed_at, now())
    where p.competition_id = v_comp_id
      and p.user_id = any (v_remaining)
      and p.status = 'active';

    get diagnostics v_best_count = row_count;
    v_winner_set := v_winner_set + coalesce(v_best_count, 0);

    update public.f2t_competitions c
    set status = 'completed', updated_at = now()
    where c.id = v_comp_id
      and c.status <> 'completed';
  end loop;

  return jsonb_build_object(
    'success', true,
    'selections_updated', v_updated,
    'shootout_updated', v_so_updated,
    'winners_set', v_winner_set,
    'gameweek_number', v_gw.number
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- f2t_get_competition: include own shootouts + difficulty_sum
-- ---------------------------------------------------------------------------

create or replace function public.f2t_get_competition(p_competition_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_comp public.f2t_competitions%rowtype;
  v_part public.f2t_participants%rowtype;
  v_sg public.lms_gameweeks%rowtype;
  v_selections jsonb;
  v_shootouts jsonb;
  v_leaderboard jsonb;
  v_unscored int := 0;
  v_completed_gws int := 0;
  v_sub_eligible_regular boolean := false;
  v_join_open boolean;
  v_has_part boolean := false;
  v_can_handle_joins boolean := false;
  v_join_code text := null;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  select * into v_comp from public.f2t_competitions where id = p_competition_id;
  if not found then
    return jsonb_build_object('success', false, 'error', 'invalid_competition');
  end if;

  v_can_handle_joins := public.f2t_can_handle_joins(p_competition_id);

  if not (
    public.f2t_is_competition_member(p_competition_id)
    or v_can_handle_joins
  ) then
    return jsonb_build_object('success', false, 'error', 'forbidden');
  end if;

  select * into v_part
  from public.f2t_participants
  where competition_id = p_competition_id and user_id = v_uid;
  v_has_part := found;

  select * into v_sg from public.lms_gameweeks where id = v_comp.start_gameweek_id;

  if v_can_handle_joins then
    select trim(ac.code) into v_join_code
    from public.f2t_access_codes ac
    where ac.competition_id = p_competition_id
      and ac.type = 'join'
      and ac.is_active = true
    order by ac.created_at asc
    limit 1;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'slot', s.slot,
        'player_id', s.player_id,
        'display_name', fp.display_name,
        'team_id', fp.team_id,
        'team_name', t.name,
        'team_short_name', t.short_name,
        'team_slug', t.slug,
        'scored_at', s.scored_at,
        'scored_gameweek_id', s.scored_gameweek_id,
        'scored_gameweek_number', scored_gw.number,
        'owner_flagged', fp.owner_flagged,
        'locked_difficulty_rank', s.locked_difficulty_rank,
        'next_match', (
          select jsonb_build_object(
            'kickoff_at', f.kickoff_at,
            'is_home', (f.home_team_id = fp.team_id),
            'opponent_short_name', ot.short_name,
            'opponent_name', ot.name,
            'opponent_slug', ot.slug,
            'gameweek_number', fx_gw.number
          )
          from public.lms_fixtures f
          join public.lms_gameweeks fx_gw on fx_gw.id = f.gameweek_id
          join public.lms_teams ot
            on ot.id = case
              when f.home_team_id = fp.team_id then f.away_team_id
              else f.home_team_id
            end
          where (f.home_team_id = fp.team_id or f.away_team_id = fp.team_id)
            and fx_gw.season = v_comp.season
            and f.status in ('scheduled', 'live')
            and f.kickoff_at >= (now() - interval '3 hours')
          order by f.kickoff_at asc
          limit 1
        )
      )
      order by s.slot
    ),
    '[]'::jsonb
  )
  into v_selections
  from public.f2t_selections s
  join public.football_players fp on fp.id = s.player_id
  join public.lms_teams t on t.id = fp.team_id
  left join public.lms_gameweeks scored_gw on scored_gw.id = s.scored_gameweek_id
  where s.competition_id = p_competition_id and s.user_id = v_uid;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'shootout_rank', so.shootout_rank,
        'player_id', so.player_id,
        'display_name', fp.display_name,
        'team_id', fp.team_id,
        'team_name', t.name,
        'team_short_name', t.short_name,
        'team_slug', t.slug,
        'scored_at', so.scored_at,
        'scored_gameweek_id', so.scored_gameweek_id,
        'scored_gameweek_number', scored_gw.number,
        'owner_flagged', fp.owner_flagged
      )
      order by so.shootout_rank
    ),
    '[]'::jsonb
  )
  into v_shootouts
  from public.f2t_shootout_selections so
  join public.football_players fp on fp.id = so.player_id
  join public.lms_teams t on t.id = fp.team_id
  left join public.lms_gameweeks scored_gw on scored_gw.id = so.scored_gameweek_id
  where so.competition_id = p_competition_id and so.user_id = v_uid;

  select count(*)::int into v_unscored
  from public.f2t_selections s
  where s.competition_id = p_competition_id
    and s.user_id = v_uid
    and s.scored_at is null;

  select count(*)::int into v_completed_gws
  from public.lms_gameweeks gw
  where gw.season = v_comp.season
    and gw.number >= coalesce(v_sg.number, 1)
    and gw.status = 'complete';

  v_sub_eligible_regular := (
    v_has_part
    and v_part.status = 'active'
    and not coalesce(v_part.regular_sub_used, false)
    and v_completed_gws >= 3
    and v_unscored > 3
  );

  v_join_open := public.f2t_competition_join_open(p_competition_id);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'user_id', p.user_id,
        'username', pr.username,
        'status', p.status,
        'scored_count', (
          select count(*)::int
          from public.f2t_selections s
          where s.competition_id = p.competition_id
            and s.user_id = p.user_id
            and s.scored_at is not null
        ),
        'completed_at', p.completed_at
      )
      order by
        case when p.status = 'winner' then 0 else 1 end,
        (
          select count(*)::int
          from public.f2t_selections s
          where s.competition_id = p.competition_id
            and s.user_id = p.user_id
            and s.scored_at is not null
        ) desc,
        p.completed_at nulls last
    ),
    '[]'::jsonb
  )
  into v_leaderboard
  from public.f2t_participants p
  left join public.profiles pr on pr.id = p.user_id
  where p.competition_id = p_competition_id;

  return jsonb_build_object(
    'success', true,
    'competition', jsonb_build_object(
      'id', v_comp.id,
      'name', v_comp.name,
      'season', v_comp.season,
      'status', v_comp.status,
      'entry', v_comp.entry,
      'start_gameweek_id', v_comp.start_gameweek_id,
      'start_gameweek_number', v_sg.number,
      'start_gameweek_deadline', v_sg.deadline_at,
      'join_open', v_join_open,
      'join_code', v_join_code
    ),
    'participant', case
      when v_has_part then jsonb_build_object(
        'status', v_part.status,
        'regular_sub_used', v_part.regular_sub_used,
        'completed_at', v_part.completed_at,
        'difficulty_sum', v_part.difficulty_sum,
        'scored_count', (
          select count(*)::int
          from public.f2t_selections s
          where s.competition_id = p_competition_id
            and s.user_id = v_uid
            and s.scored_at is not null
        ),
        'unscored_count', v_unscored,
        'selection_count', jsonb_array_length(v_selections),
        'sub_eligible_regular', v_sub_eligible_regular
      )
      else null
    end,
    'selections', v_selections,
    'shootouts', v_shootouts,
    'leaderboard', v_leaderboard,
    'permissions', public.f2t_can_manage_competition_rpc(p_competition_id)
  );
end;
$$;
