-- =============================================================================
-- Racing admin parity with LMS/F2T: join codes, entry fee, managers (max 3),
-- join-notify prefs, broadcast authorize, pending join RPCs.
-- =============================================================================

alter table public.competitions
  add column if not exists entry text;

comment on column public.competitions.entry is
  'Optional entry fee / stake label shown on share invite and admin panel.';

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.racing_join_notify_prefs (
  competition_id uuid not null references public.competitions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (competition_id, user_id)
);

create index if not exists racing_join_notify_prefs_user_idx
  on public.racing_join_notify_prefs (user_id);

alter table public.racing_join_notify_prefs enable row level security;

drop policy if exists "racing_join_notify_prefs_select_own" on public.racing_join_notify_prefs;
create policy "racing_join_notify_prefs_select_own"
  on public.racing_join_notify_prefs for select to authenticated
  using (user_id = auth.uid());

comment on table public.racing_join_notify_prefs is
  'Per-user preference for Racing join-request push alerts (creators/managers default ON).';

create table if not exists public.racing_competition_broadcasts (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  sent_by uuid references auth.users(id) on delete set null,
  title text not null,
  body text not null,
  recipient_count int not null default 0,
  sent_at timestamptz not null default now()
);

create index if not exists racing_competition_broadcasts_comp_sent_idx
  on public.racing_competition_broadcasts (competition_id, sent_at desc);

alter table public.racing_competition_broadcasts enable row level security;

comment on table public.racing_competition_broadcasts is
  'Audit log for creator/Owner custom Web Push broadcasts to Racing competition players.';

create table if not exists public.racing_competition_managers (
  competition_id uuid not null references public.competitions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  assigned_by uuid references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (competition_id, user_id)
);

create index if not exists idx_racing_competition_managers_user
  on public.racing_competition_managers (user_id);

alter table public.racing_competition_managers enable row level security;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.racing_is_competition_member(p_competition_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.competition_participants p
    where p.competition_id = p_competition_id and p.user_id = auth.uid()
  );
$$;

create or replace function public.racing_is_competition_manager(p_competition_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.racing_competition_managers m
    where m.competition_id = p_competition_id and m.user_id = auth.uid()
  );
$$;

-- Creator / Owner only (unchanged semantics; keep for manage-only actions).
create or replace function public.racing_can_manage_competition(p_competition_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_owner()
    or exists (
      select 1
      from public.competitions c
      where c.id = p_competition_id
        and c.created_by_user_id = auth.uid()
    );
$$;

create or replace function public.racing_can_handle_joins(p_competition_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.racing_can_manage_competition(p_competition_id)
    or public.racing_is_competition_manager(p_competition_id);
$$;

drop policy if exists "racing_competition_managers_select" on public.racing_competition_managers;
create policy "racing_competition_managers_select" on public.racing_competition_managers
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.racing_is_competition_member(competition_id)
    or public.racing_can_handle_joins(competition_id)
  );

-- ---------------------------------------------------------------------------
-- Join codes (competitions.access_code)
-- ---------------------------------------------------------------------------

create or replace function public.racing_get_competition_join_codes(p_competition_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_join text;
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  if not public.racing_can_handle_joins(p_competition_id) then
    return jsonb_build_object('success', false, 'error', 'forbidden');
  end if;

  select c.access_code into v_join
  from public.competitions c
  where c.id = p_competition_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'invalid_competition');
  end if;

  return jsonb_build_object(
    'success', true,
    'join_code', nullif(trim(coalesce(v_join, '')), '')
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Entry fee
-- ---------------------------------------------------------------------------

create or replace function public.racing_set_competition_entry(
  p_competition_id uuid,
  p_entry text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  if not public.racing_can_manage_competition(p_competition_id) then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  update public.competitions
  set entry = nullif(trim(coalesce(p_entry, '')), '')
  where id = p_competition_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'invalid_competition');
  end if;

  return jsonb_build_object('success', true, 'entry', nullif(trim(coalesce(p_entry, '')), ''));
end;
$$;

-- ---------------------------------------------------------------------------
-- Managers
-- ---------------------------------------------------------------------------

create or replace function public.racing_list_competition_managers(p_competition_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return '[]'::jsonb;
  end if;

  if not (
    public.racing_is_competition_member(p_competition_id)
    or public.racing_can_handle_joins(p_competition_id)
  ) then
    return '[]'::jsonb;
  end if;

  return (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'user_id', m.user_id,
          'username', coalesce(nullif(trim(p.username), ''), nullif(trim(cp.display_name), '')),
          'assigned_at', m.assigned_at
        )
        order by coalesce(nullif(trim(p.username), ''), nullif(trim(cp.display_name), '')) nulls last,
                 m.assigned_at asc
      ),
      '[]'::jsonb
    )
    from public.racing_competition_managers m
    left join public.profiles p on p.id = m.user_id
    left join public.competition_participants cp
      on cp.competition_id = m.competition_id and cp.user_id = m.user_id
    where m.competition_id = p_competition_id
  );
end;
$$;

create or replace function public.racing_list_assignable_managers(p_competition_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_created_by uuid;
begin
  if auth.uid() is null then
    return '[]'::jsonb;
  end if;

  if not public.racing_can_manage_competition(p_competition_id) then
    return '[]'::jsonb;
  end if;

  select c.created_by_user_id into v_created_by
  from public.competitions c
  where c.id = p_competition_id;

  if not found then
    return '[]'::jsonb;
  end if;

  return (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'user_id', part.user_id,
          'username', coalesce(nullif(trim(p.username), ''), nullif(trim(part.display_name), '')),
          'status', 'active',
          'is_creator', (v_created_by is not null and part.user_id = v_created_by),
          'is_manager', exists (
            select 1
            from public.racing_competition_managers m
            where m.competition_id = part.competition_id
              and m.user_id = part.user_id
          )
        )
        order by
          (v_created_by is not null and part.user_id = v_created_by) desc,
          coalesce(nullif(trim(p.username), ''), nullif(trim(part.display_name), '')) nulls last,
          part.joined_at asc
      ),
      '[]'::jsonb
    )
    from public.competition_participants part
    left join public.profiles p on p.id = part.user_id
    where part.competition_id = p_competition_id
  );
end;
$$;

create or replace function public.racing_set_competition_manager(
  p_competition_id uuid,
  p_user_id uuid,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_created_by uuid;
  v_count int;
  v_max int := 3;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  if not public.racing_can_manage_competition(p_competition_id) then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  if p_user_id is null then
    return jsonb_build_object('success', false, 'error', 'user_required');
  end if;

  select c.created_by_user_id into v_created_by
  from public.competitions c
  where c.id = p_competition_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'invalid_competition');
  end if;

  if v_created_by is not null and p_user_id = v_created_by then
    return jsonb_build_object('success', false, 'error', 'already_creator');
  end if;

  if not exists (
    select 1 from public.competition_participants part
    where part.competition_id = p_competition_id
      and part.user_id = p_user_id
  ) then
    return jsonb_build_object('success', false, 'error', 'not_a_participant');
  end if;

  if coalesce(p_enabled, false) then
    select count(*)::int into v_count
    from public.racing_competition_managers m
    where m.competition_id = p_competition_id
      and m.user_id <> p_user_id;

    if v_count >= v_max then
      return jsonb_build_object('success', false, 'error', 'manager_limit', 'max', v_max);
    end if;

    insert into public.racing_competition_managers (
      competition_id, user_id, assigned_by, assigned_at
    )
    values (p_competition_id, p_user_id, v_uid, now())
    on conflict (competition_id, user_id) do update
      set assigned_by = excluded.assigned_by,
          assigned_at = now();

    insert into public.racing_join_notify_prefs (competition_id, user_id, enabled, updated_at)
    values (p_competition_id, p_user_id, true, now())
    on conflict (competition_id, user_id) do nothing;

    return jsonb_build_object('success', true, 'enabled', true);
  end if;

  delete from public.racing_competition_managers
  where competition_id = p_competition_id
    and user_id = p_user_id;

  return jsonb_build_object('success', true, 'enabled', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Join notify prefs
-- ---------------------------------------------------------------------------

create or replace function public.racing_get_join_notify_pref(p_competition_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_created_by uuid;
  v_enabled boolean;
  v_is_creator boolean;
  v_is_owner boolean;
  v_is_manager boolean;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  if not public.racing_can_handle_joins(p_competition_id) then
    return jsonb_build_object('success', false, 'error', 'forbidden');
  end if;

  select c.created_by_user_id into v_created_by
  from public.competitions c
  where c.id = p_competition_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'invalid_competition');
  end if;

  v_is_creator := (v_created_by is not null and v_created_by = v_uid);
  v_is_owner := public.is_owner();
  v_is_manager := public.racing_is_competition_manager(p_competition_id);

  select p.enabled into v_enabled
  from public.racing_join_notify_prefs p
  where p.competition_id = p_competition_id and p.user_id = v_uid;

  if not found then
    v_enabled := v_is_creator or v_is_manager;
  end if;

  return jsonb_build_object(
    'success', true,
    'enabled', v_enabled,
    'is_creator', v_is_creator,
    'is_owner', v_is_owner,
    'is_manager', v_is_manager,
    'has_explicit_pref', exists (
      select 1 from public.racing_join_notify_prefs p
      where p.competition_id = p_competition_id and p.user_id = v_uid
    )
  );
end;
$$;

create or replace function public.racing_set_join_notify_pref(
  p_competition_id uuid,
  p_enabled boolean
)
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

  if not public.racing_can_handle_joins(p_competition_id) then
    return jsonb_build_object('success', false, 'error', 'forbidden');
  end if;

  if not exists (select 1 from public.competitions c where c.id = p_competition_id) then
    return jsonb_build_object('success', false, 'error', 'invalid_competition');
  end if;

  insert into public.racing_join_notify_prefs (competition_id, user_id, enabled, updated_at)
  values (p_competition_id, v_uid, coalesce(p_enabled, true), now())
  on conflict (competition_id, user_id) do update
    set enabled = excluded.enabled,
        updated_at = now();

  return jsonb_build_object('success', true, 'enabled', coalesce(p_enabled, true));
end;
$$;

create or replace function public.racing_list_join_notify_recipients(p_competition_id uuid)
returns table (
  user_id uuid,
  endpoint text,
  p256dh text,
  auth text
)
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
  ),
  enabled_users as (
    select wp.user_id
    from with_pref wp
    where coalesce(wp.pref_enabled, wp.default_on) = true
  )
  select
    s.user_id,
    s.endpoint,
    s.p256dh,
    s.auth
  from enabled_users eu
  join public.web_push_subscriptions s on s.user_id = eu.user_id;
$$;

-- ---------------------------------------------------------------------------
-- Broadcast authorize
-- ---------------------------------------------------------------------------

create or replace function public.racing_admin_authorize_broadcast(
  p_competition_id uuid,
  p_title text,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_title text := trim(coalesce(p_title, ''));
  v_body text := trim(coalesce(p_body, ''));
  v_name text;
  v_broadcast_id uuid;
  v_user_ids uuid[];
  v_recent int;
  v_day_count int;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  if not public.racing_can_manage_competition(p_competition_id) then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select c.name into v_name
  from public.competitions c
  where c.id = p_competition_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'invalid_competition');
  end if;

  if length(v_title) < 1 or length(v_title) > 80 then
    return jsonb_build_object('success', false, 'error', 'invalid_title');
  end if;

  if length(v_body) < 1 or length(v_body) > 280 then
    return jsonb_build_object('success', false, 'error', 'invalid_body');
  end if;

  select count(*)::int into v_recent
  from public.racing_competition_broadcasts b
  where b.competition_id = p_competition_id
    and b.sent_at > now() - interval '3 minutes';

  if v_recent > 0 then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;

  select count(*)::int into v_day_count
  from public.racing_competition_broadcasts b
  where b.competition_id = p_competition_id
    and b.sent_at > now() - interval '24 hours';

  if v_day_count >= 20 then
    return jsonb_build_object('success', false, 'error', 'daily_limit');
  end if;

  select coalesce(array_agg(part.user_id), '{}'::uuid[])
  into v_user_ids
  from public.competition_participants part
  where part.competition_id = p_competition_id;

  insert into public.racing_competition_broadcasts (
    competition_id, sent_by, title, body, recipient_count
  )
  values (
    p_competition_id, v_uid, v_title, v_body, coalesce(cardinality(v_user_ids), 0)
  )
  returning id into v_broadcast_id;

  return jsonb_build_object(
    'success', true,
    'broadcast_id', v_broadcast_id,
    'competition_id', p_competition_id,
    'competition_name', v_name,
    'title', v_title,
    'body', v_body,
    'user_ids', to_jsonb(coalesce(v_user_ids, '{}'::uuid[])),
    'recipient_count', coalesce(cardinality(v_user_ids), 0)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin context (hub / share)
-- ---------------------------------------------------------------------------

create or replace function public.racing_get_admin_context(p_competition_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.competitions%rowtype;
  v_created_by uuid;
begin
  if v_uid is null then
    return jsonb_build_object(
      'success', false,
      'error', 'not_authenticated',
      'can_manage', false,
      'can_handle_joins', false,
      'is_manager', false,
      'is_creator', false
    );
  end if;

  select * into v_row from public.competitions c where c.id = p_competition_id;
  if not found then
    return jsonb_build_object('success', false, 'error', 'invalid_competition');
  end if;

  v_created_by := v_row.created_by_user_id;

  return jsonb_build_object(
    'success', true,
    'name', v_row.name,
    'entry', v_row.entry,
    'join_code', case
      when public.racing_can_handle_joins(p_competition_id)
        then nullif(trim(coalesce(v_row.access_code, '')), '')
      else null
    end,
    'access_code', case
      when public.racing_can_handle_joins(p_competition_id)
        then nullif(trim(coalesce(v_row.access_code, '')), '')
      else null
    end,
    'festival_start_date', v_row.festival_start_date,
    'festival_end_date', v_row.festival_end_date,
    'can_manage', public.racing_can_manage_competition(p_competition_id),
    'can_handle_joins', public.racing_can_handle_joins(p_competition_id),
    'is_manager', public.racing_is_competition_manager(p_competition_id),
    'is_creator', (v_created_by is not null and v_created_by = v_uid),
    'created_by_user_id', v_created_by
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Pending joins + approve / reject (auth.uid, no tablet gate)
-- ---------------------------------------------------------------------------

create or replace function public.racing_admin_list_pending_for_competition(p_competition_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.racing_can_handle_joins(p_competition_id) then
    return '[]'::jsonb;
  end if;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id,
      'competition_id', r.competition_id,
      'competition_name', c.name,
      'user_id', r.user_id,
      'display_name', r.display_name,
      'username', coalesce(nullif(trim(pr.username), ''), nullif(trim(r.display_name), '')),
      'created_at', r.created_at,
      'payment_method', r.payment_method,
      'payment_note', r.payment_note
    ) order by r.created_at asc), '[]'::jsonb)
    from public.competition_join_requests r
    join public.competitions c on c.id = r.competition_id
    left join public.profiles pr on pr.id = r.user_id
    where r.competition_id = p_competition_id
      and r.status = 'pending'
  );
end;
$$;

create or replace function public.racing_admin_approve_join(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_req public.competition_join_requests%rowtype;
  v_join_check jsonb;
  v_cap jsonb;
  v_agg jsonb;
  v_creator uuid;
begin
  if v_admin is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  select * into v_req
  from public.competition_join_requests
  where id = p_request_id and status = 'pending';

  if not found then
    return jsonb_build_object('success', false, 'error', 'request_not_found');
  end if;

  if not public.racing_can_handle_joins(v_req.competition_id) then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  v_join_check := public.subscription_check_user_join_limit(v_req.user_id);
  if not (v_join_check->>'ok')::boolean then
    return jsonb_build_object('success', false, 'error', v_join_check->>'error');
  end if;

  v_cap := public.subscription_check_competition_capacity('racing', v_req.competition_id);
  if not (v_cap->>'ok')::boolean then
    return jsonb_build_object('success', false, 'error', v_cap->>'error');
  end if;

  select created_by_user_id into v_creator from public.competitions where id = v_req.competition_id;
  v_agg := public.subscription_check_creator_aggregate(v_creator, 1);
  if not (v_agg->>'ok')::boolean then
    return jsonb_build_object('success', false, 'error', v_agg->>'error');
  end if;

  insert into public.competition_participants (competition_id, user_id, display_name)
  values (v_req.competition_id, v_req.user_id, v_req.display_name)
  on conflict (competition_id, user_id) do update set display_name = excluded.display_name;

  update public.competition_join_requests
  set status = 'approved', reviewed_at = now()
  where id = p_request_id;

  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.racing_admin_reject_join(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_req public.competition_join_requests%rowtype;
begin
  if v_admin is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  select * into v_req
  from public.competition_join_requests
  where id = p_request_id and status = 'pending';

  if not found then
    return jsonb_build_object('success', false, 'error', 'request_not_found');
  end if;

  if not public.racing_can_handle_joins(v_req.competition_id) then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  update public.competition_join_requests
  set status = 'rejected', reviewed_at = now()
  where id = p_request_id;

  return jsonb_build_object('success', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- racing_request_join: return join_request_id (for notify edge function)
-- ---------------------------------------------------------------------------

create or replace function public.racing_request_join(
  p_access_code text,
  p_display_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_comp record;
  v_norm text := upper(trim(p_access_code));
  v_join_check jsonb;
  v_request_id uuid;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  if public.is_profile_banned(v_uid) then
    return jsonb_build_object('success', false, 'error', 'account_banned');
  end if;

  if trim(coalesce(p_display_name, '')) = '' then
    return jsonb_build_object('success', false, 'error', 'display_name_required');
  end if;

  v_join_check := public.subscription_check_user_join_limit(v_uid);
  if not (v_join_check->>'ok')::boolean then
    return jsonb_build_object(
      'success', false,
      'error', v_join_check->>'error',
      'max_joins', v_join_check->'max_joins',
      'current_joins', v_join_check->'current_joins'
    );
  end if;

  select id, name into v_comp
  from public.competitions
  where access_code = v_norm;

  if not found then
    return jsonb_build_object('success', false, 'error', 'invalid_code');
  end if;

  if exists (
    select 1 from public.competition_participants
    where competition_id = v_comp.id and user_id = v_uid
  ) then
    return jsonb_build_object('success', false, 'error', 'already_in', 'competition_name', v_comp.name);
  end if;

  insert into public.competition_join_requests (competition_id, user_id, display_name, status)
  values (v_comp.id, v_uid, trim(p_display_name), 'pending')
  on conflict (competition_id, user_id) do update
    set display_name = excluded.display_name,
        status = 'pending',
        created_at = now(),
        reviewed_at = null
  returning id into v_request_id;

  return jsonb_build_object(
    'success', true,
    'status', 'pending',
    'competition_name', v_comp.name,
    'competition_id', v_comp.id,
    'join_request_id', v_request_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Legacy admin_* RPCs: allow managers via racing_can_handle_joins
-- (tablet_code may be null when caller is a competition manager)
-- ---------------------------------------------------------------------------

create or replace function public.admin_list_pending_for_competition(p_code text, p_competition_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.tablet_code_admin_user_id(p_code) is null
     and not public.racing_can_handle_joins(p_competition_id) then
    return '[]'::jsonb;
  end if;

  if not public.racing_can_handle_joins(p_competition_id) then
    return '[]'::jsonb;
  end if;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id,
      'competition_id', r.competition_id,
      'competition_name', c.name,
      'user_id', r.user_id,
      'display_name', r.display_name,
      'username', coalesce(nullif(trim(pr.username), ''), nullif(trim(r.display_name), '')),
      'created_at', r.created_at,
      'payment_method', r.payment_method,
      'payment_note', r.payment_note
    ) order by r.created_at desc), '[]'::jsonb)
    from public.competition_join_requests r
    join public.competitions c on c.id = r.competition_id
    left join public.profiles pr on pr.id = r.user_id
    where r.competition_id = p_competition_id
      and r.status = 'pending'
  );
end;
$$;

create or replace function public.admin_approve_request(p_code text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.competition_join_requests%rowtype;
  v_join_check jsonb;
  v_cap jsonb;
  v_agg jsonb;
  v_creator uuid;
begin
  select * into v_req from public.competition_join_requests where id = p_request_id and status = 'pending';
  if v_req.id is null then
    return jsonb_build_object('success', false, 'error', 'request_not_found');
  end if;

  if public.tablet_code_admin_user_id(p_code) is null
     and not public.racing_can_handle_joins(v_req.competition_id) then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  if not public.racing_can_handle_joins(v_req.competition_id) then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  v_join_check := public.subscription_check_user_join_limit(v_req.user_id);
  if not (v_join_check->>'ok')::boolean then
    return jsonb_build_object('success', false, 'error', v_join_check->>'error');
  end if;

  v_cap := public.subscription_check_competition_capacity('racing', v_req.competition_id);
  if not (v_cap->>'ok')::boolean then
    return jsonb_build_object('success', false, 'error', v_cap->>'error');
  end if;

  select created_by_user_id into v_creator from public.competitions where id = v_req.competition_id;
  v_agg := public.subscription_check_creator_aggregate(v_creator, 1);
  if not (v_agg->>'ok')::boolean then
    return jsonb_build_object('success', false, 'error', v_agg->>'error');
  end if;

  insert into public.competition_participants (competition_id, user_id, display_name)
  values (v_req.competition_id, v_req.user_id, v_req.display_name)
  on conflict (competition_id, user_id) do update set display_name = excluded.display_name;

  update public.competition_join_requests set status = 'approved', reviewed_at = now() where id = p_request_id;
  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.admin_reject_request(p_code text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.competition_join_requests%rowtype;
begin
  select * into v_req from public.competition_join_requests where id = p_request_id and status = 'pending';
  if v_req.id is null then
    return jsonb_build_object('success', false, 'error', 'request_not_found');
  end if;

  if public.tablet_code_admin_user_id(p_code) is null
     and not public.racing_can_handle_joins(v_req.competition_id) then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  if not public.racing_can_handle_joins(v_req.competition_id) then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  update public.competition_join_requests
  set status = 'rejected', reviewed_at = now()
  where id = p_request_id;

  return jsonb_build_object('success', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.racing_is_competition_member(uuid) from public;
revoke all on function public.racing_is_competition_manager(uuid) from public;
revoke all on function public.racing_can_handle_joins(uuid) from public;
revoke all on function public.racing_get_competition_join_codes(uuid) from public;
revoke all on function public.racing_set_competition_entry(uuid, text) from public;
revoke all on function public.racing_list_competition_managers(uuid) from public;
revoke all on function public.racing_list_assignable_managers(uuid) from public;
revoke all on function public.racing_set_competition_manager(uuid, uuid, boolean) from public;
revoke all on function public.racing_get_join_notify_pref(uuid) from public;
revoke all on function public.racing_set_join_notify_pref(uuid, boolean) from public;
revoke all on function public.racing_list_join_notify_recipients(uuid) from public;
revoke all on function public.racing_admin_authorize_broadcast(uuid, text, text) from public;
revoke all on function public.racing_get_admin_context(uuid) from public;
revoke all on function public.racing_admin_list_pending_for_competition(uuid) from public;
revoke all on function public.racing_admin_approve_join(uuid) from public;
revoke all on function public.racing_admin_reject_join(uuid) from public;
revoke all on function public.racing_request_join(text, text) from public;

grant execute on function public.racing_is_competition_member(uuid) to authenticated;
grant execute on function public.racing_is_competition_manager(uuid) to authenticated;
grant execute on function public.racing_can_handle_joins(uuid) to authenticated;
grant execute on function public.racing_can_manage_competition(uuid) to authenticated;
grant execute on function public.racing_get_competition_join_codes(uuid) to authenticated;
grant execute on function public.racing_set_competition_entry(uuid, text) to authenticated;
grant execute on function public.racing_list_competition_managers(uuid) to authenticated;
grant execute on function public.racing_list_assignable_managers(uuid) to authenticated;
grant execute on function public.racing_set_competition_manager(uuid, uuid, boolean) to authenticated;
grant execute on function public.racing_get_join_notify_pref(uuid) to authenticated;
grant execute on function public.racing_set_join_notify_pref(uuid, boolean) to authenticated;
grant execute on function public.racing_admin_authorize_broadcast(uuid, text, text) to authenticated;
grant execute on function public.racing_get_admin_context(uuid) to authenticated;
grant execute on function public.racing_admin_list_pending_for_competition(uuid) to authenticated;
grant execute on function public.racing_admin_approve_join(uuid) to authenticated;
grant execute on function public.racing_admin_reject_join(uuid) to authenticated;
grant execute on function public.racing_request_join(text, text) to authenticated;

revoke all on function public.racing_list_join_notify_recipients(uuid) from authenticated;
grant execute on function public.racing_list_join_notify_recipients(uuid) to service_role;
