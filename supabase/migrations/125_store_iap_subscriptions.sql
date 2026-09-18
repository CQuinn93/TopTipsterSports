-- =============================================================================
-- Store (RevenueCat / IAP) subscription fields + apply RPC for service role /
-- authenticated sync edge function.
-- =============================================================================

alter table public.profiles
  add column if not exists store_product_id text,
  add column if not exists store_subscription_expires_at timestamptz,
  add column if not exists revenuecat_app_user_id text;

comment on column public.profiles.store_product_id is
  'Active App Store / Play product id from RevenueCat (e.g. user_plus_monthly).';
comment on column public.profiles.store_subscription_expires_at is
  'When the current store subscription period ends (null if unknown / lifetime).';
comment on column public.profiles.revenuecat_app_user_id is
  'RevenueCat app user id (normally equals auth.users.id).';

/**
 * Apply store entitlements for a user.
 * Caller must be service_role (webhook) or the same authenticated user via edge fn.
 *
 * p_active = false clears paid store tiers back to free user / no creator.
 * When active, highest creator entitlement wins; else highest participant.
 */
create or replace function public.apply_store_subscription(
  p_user_id uuid,
  p_participant_tier public.participant_tier default null,
  p_creator_tier public.creator_tier default null,
  p_product_id text default null,
  p_expires_at timestamptz default null,
  p_active boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_is_service boolean := (v_caller is null); -- service role JWT often has no auth.uid()
begin
  -- Allow: service role (no uid) OR the user themselves
  if v_caller is not null and v_caller is distinct from p_user_id then
    -- Also allow Owner
    if not exists (
      select 1 from public.profiles pr
      where pr.id = v_caller and pr.role = 'Owner'
    ) then
      return jsonb_build_object('success', false, 'error', 'forbidden');
    end if;
  end if;

  if p_user_id is null then
    return jsonb_build_object('success', false, 'error', 'missing_user');
  end if;

  if not p_active then
    update public.profiles
    set
      participant_tier = 'user',
      creator_tier = null,
      store_product_id = null,
      store_subscription_expires_at = null,
      revenuecat_app_user_id = coalesce(revenuecat_app_user_id, p_user_id::text)
    where id = p_user_id;

    return jsonb_build_object('success', true, 'active', false);
  end if;

  -- Gamemaster is never granted via IAP
  if p_creator_tier is not null and p_creator_tier = 'gamemaster' then
    return jsonb_build_object('success', false, 'error', 'gamemaster_not_iap');
  end if;

  update public.profiles
  set
    participant_tier = coalesce(p_participant_tier, participant_tier, 'user'),
    creator_tier = p_creator_tier,
    store_product_id = nullif(trim(coalesce(p_product_id, '')), ''),
    store_subscription_expires_at = p_expires_at,
    revenuecat_app_user_id = p_user_id::text
  where id = p_user_id;

  return jsonb_build_object(
    'success', true,
    'active', true,
    'participant_tier', coalesce(p_participant_tier::text, 'user'),
    'creator_tier', p_creator_tier::text
  );
end;
$$;

revoke all on function public.apply_store_subscription(
  uuid, public.participant_tier, public.creator_tier, text, timestamptz, boolean
) from public;
grant execute on function public.apply_store_subscription(
  uuid, public.participant_tier, public.creator_tier, text, timestamptz, boolean
) to service_role;
grant execute on function public.apply_store_subscription(
  uuid, public.participant_tier, public.creator_tier, text, timestamptz, boolean
) to authenticated;
