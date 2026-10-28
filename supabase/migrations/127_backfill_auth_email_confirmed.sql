-- One-time backfill: mark existing Auth users as email-confirmed.
-- Run / apply this BEFORE enabling "Confirm email" in Supabase Auth settings,
-- otherwise accounts that signed up with confirmation off may be blocked from signing in.
--
-- Safe to re-run: only rows with null email_confirmed_at are updated.

update auth.users
set
  email_confirmed_at = coalesce(email_confirmed_at, created_at),
  updated_at = now()
where email_confirmed_at is null
  and coalesce(trim(email), '') <> '';
