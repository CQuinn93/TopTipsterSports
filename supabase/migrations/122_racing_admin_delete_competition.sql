-- Dedicated racing delete RPC aligned with LMS / Tipster20:
-- auth.uid() + racing_can_manage_competition (creator or Owner).
-- Keeps tablet-code admin_delete_competition for kiosk flows.

create or replace function public.racing_admin_delete_competition(p_competition_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if auth.uid() is null then
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

  -- Children cascade via FK (participants, join requests, race days, selections, etc.)
  delete from public.competitions where id = p_competition_id;

  return jsonb_build_object('success', true, 'name', v_name);
end;
$$;

revoke all on function public.racing_admin_delete_competition(uuid) from public;
grant execute on function public.racing_admin_delete_competition(uuid) to authenticated;

-- Also relax tablet-path delete: if creator entitlement gate fails but user
-- can manage the competition (e.g. Owner edge cases), allow via manage check.
create or replace function public.admin_delete_competition(p_code text, p_competition_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid;
  v_name text;
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  v_admin := public.tablet_code_admin_user_id(p_code);
  if v_admin is null and not public.racing_can_manage_competition(p_competition_id) then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  if not public.racing_can_manage_competition(p_competition_id) then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select name into v_name from public.competitions where id = p_competition_id;
  if not found then
    return jsonb_build_object('success', false, 'error', 'invalid_competition');
  end if;

  delete from public.competitions where id = p_competition_id;

  return jsonb_build_object('success', true, 'name', v_name);
end;
$$;
