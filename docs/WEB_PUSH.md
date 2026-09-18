# Web Push (LMS deadline + join-request reminders)

Home Screen / PWA users can opt in to alerts. **Native iOS/Android** apps use Expo push tokens (same Deadline Alerts toggle). Deadline reminders include the auto-assign team. Join-request alerts are **per manager** (creator vs Owner prefs are independent).

## One-time setup

### 1. Apply migrations

- `071_lms_web_push_reminders.sql` — subscriptions + deadline reminder RPCs  
- `072_lms_join_notify_prefs.sql` — per-user join notify prefs + recipient RPC  
- `077_lms_competition_managers.sql` — per-competition join managers + notify recipients  
- `124_expo_push_tokens.sql` — native Expo push tokens + join-recipient user_ids + deadline channel union  

### 2. Generate VAPID keys (once)

```bash
npx web-push generate-vapid-keys
```

### 3. GitHub repository secrets

| Secret | Used by |
|--------|---------|
| `VAPID_PUBLIC_KEY` | Web build + deadline sender + Edge Function |
| `VAPID_PRIVATE_KEY` | Deadline sender + Edge Function (never in the client) |
| `VAPID_SUBJECT` | Optional (`mailto:…` or `https://www.toptipster.ie`) |
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` / `SUPABASE_ANON_KEY` | Existing |

Redeploy the web app after adding `VAPID_PUBLIC_KEY`.

Native builds use Expo’s push service (no VAPID on device). After adding `expo-notifications`, rebuild with EAS so APNs/FCM credentials are configured.

### 4. Deadline reminders (cron-job.org)

Every **15 minutes** → workflow `lms-deadline-reminders.yml`  
See [cron-job-org-setup.md](./cron-job-org-setup.md) Job 5.

The sender delivers to **both** `web_push_subscriptions` and `expo_push_tokens`.

### Email reminders (Resend)

Same workflow also runs `scripts/send-lms-deadline-email-reminders.ts` when `RESEND_API_KEY` is set.

- **Who:** active LMS participants with **no pick** for the due gameweek (confirmed signup email).
- **When:** ~1 hour before kick-off (deadline is 20 minutes before kick-off).
- **Migration:** `126_lms_deadline_email_reminders.sql`
- **GitHub secrets:** `RESEND_API_KEY` (already used by pull-races). Optional: `LMS_REMINDER_FROM_EMAIL` (default `Top Tipster <reminder@toptipster.ie>`), `LMS_REMINDER_APP_URL`, `LMS_REMINDER_DAILY_CAP` (default 90).
- **From address:** must be a domain verified in Resend (same as password-reset mail). Do **not** use `onboarding@resend.dev` for player emails.

### 5. Instant join-request alerts (Edge Function)

After a successful join code submit, the **web app** calls `notify-lms-join-request` with the new `join_request_id`. A Database Webhook is optional backup.

#### Deploy

```bash
# Apply migration 074 (returns join_request_id), then:
supabase functions deploy notify-lms-join-request
```

Notification copy:
> **New join request**  
> `<username> has requested to join <competition>. Please visit the admin panel within the app to accept or reject them.`

Managers still need Home Screen + **Deadline Alerts** on (shared subscription). Creators default to join-notify on; Owners default off until they toggle it.

#### Manual test

```bash
curl -X POST "$SUPABASE_URL/functions/v1/notify-lms-join-request" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"join_request_id\":\"YOUR_PENDING_REQUEST_UUID\"}"
```

### 6. Join accepted alerts (Edge Function)

After an admin accepts a request, the app calls `notify-lms-join-accepted` so the **player** gets a push (if they have Deadline Alerts on).

```bash
supabase functions deploy notify-lms-join-accepted
```

Notification copy:
> **Join request accepted**  
> `Your request to join <competition> has been accepted. You can open the competition and start playing.`

- `077_lms_competition_managers.sql` — per-competition managers (join deputies)

### 7. Competition manager assigned (Edge Function)

After a creator/Owner assigns a player as manager, the app calls `notify-lms-manager-assigned`.

```bash
supabase functions deploy notify-lms-manager-assigned
```

Notification copy:
> **Competition manager**  
> `You have been assigned as a manager for <competition>. You can accept join requests and get alerts when players ask to join.`

Assigned managers default to join-notify **on**. They still need Home Screen + Deadline Alerts.

## 8. Competition broadcast (creator/Owner)

Creators/Owners can send a custom push to all players from **Admin → Notify**.

```bash
# Apply migration 082, then:
supabase functions deploy notify-lms-competition-broadcast
```

- Title up to 80 chars, message up to 280 chars  
- Rate limit: one send per competition every 3 minutes (max 20 / 24h)  
- Reaches participants who have Home Screen + **Deadline Alerts** enabled  
- Competition managers cannot send broadcasts  

## 9. Competition rollover

When settle ends a gameweek with **no one still active**, LMS mints a rejoin code and opens the same competition for the next GW. Sync then calls:

```bash
supabase functions deploy notify-lms-rollover
```

- **Title:** `Rollover for <competition name>`  
- **Body:** `Visit the competition for more information.`  
- Audience: all `lms_participants` with Home Screen + Deadline Alerts subscriptions  
- Triggered automatically from `scripts/sync-lms-football.ts` after settle (service role)

Apply migration `104_lms_rollover_ux.sql` so home shows a **Rollover** chip and Standing shows the rejoin code to participants.

Former players tap **Rejoin** on Standing (no code); that creates a pending request and notifies organisers via `notify-lms-join-request` with rejoin copy. Newcomers still use the rejoin code on the Join tab. Admin pending rows show `(new)` vs `(re entry)`.

## Preference behaviour

| Role | Default (no saved pref) | Toggle |
|------|-------------------------|--------|
| Competition **creator** | **On** | Admin → Join requests → “Notify me on join requests” |
| Assigned **manager** | **On** | Same toggle |
| **Owner** (not creator) | **Off** | Same toggle — only changes **their** alerts |

Turning the switch off for yourself does **not** mute the other party.

Recipients still need Home Screen + LMS home **Enable notifications**.

## User flows

**Deadline (player)**  
Enable notifications → miss a pick → push ~2h and ~30m before deadline.

**Join (manager)**  
Creator enables notify (default on) → player requests join → Edge Function pushes within seconds.

**Join accepted (player)**  
Admin accepts → player gets a push if Deadline Alerts is on.

## Files

- Client: `lib/webPush*.ts`, `public/sw.js`, `LmsPushNotificationsCard`, Admin toggle in `[competitionId].tsx`
- Deadline sender: `scripts/send-lms-deadline-reminders.ts` + GitHub Action  
- Join request sender: `supabase/functions/notify-lms-join-request`  
- Join accepted sender: `supabase/functions/notify-lms-join-accepted`  
- Competition broadcast: `supabase/functions/notify-lms-competition-broadcast`  
- SQL: `071_…`, `072_…`, `082_…`
