/**
 * Send LMS pick-deadline reminders via Web Push + Expo push.
 *
 * Env:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_KEY
 *   VAPID_PUBLIC_KEY
 *   VAPID_PRIVATE_KEY
 *   VAPID_SUBJECT (mailto: or https: URL) — default mailto:admin@toptipster.ie
 *
 * Run: npx tsx scripts/send-lms-deadline-reminders.ts
 */
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

type ReminderRow = {
  user_id: string;
  competition_id: string;
  competition_name: string;
  gameweek_id: string;
  gameweek_number: number;
  deadline_at: string;
  predicted_team_name: string;
  reminder_window: '2h' | '30m';
  channel: 'web' | 'expo';
  endpoint: string | null;
  p256dh: string | null;
  auth: string | null;
  expo_token: string | null;
};

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function windowLabel(w: string): string {
  if (w === '30m') return 'about 30 minutes';
  return 'about 2 hours';
}

async function sendExpoPush(
  token: string,
  title: string,
  body: string,
  data: Record<string, unknown>
): Promise<'ok' | 'gone' | 'error'> {
  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([
      {
        to: token,
        title,
        body,
        sound: 'default',
        data,
      },
    ]),
  });
  const json = (await res.json().catch(() => null)) as {
    data?: Array<{ status?: string; details?: { error?: string }; message?: string }>;
  } | null;
  const ticket = Array.isArray(json?.data) ? json.data[0] : null;
  if (ticket?.status === 'ok') return 'ok';
  const err = ticket?.details?.error ?? ticket?.message ?? '';
  if (typeof err === 'string' && err.includes('DeviceNotRegistered')) return 'gone';
  return 'error';
}

async function main() {
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const serviceKey = requireEnv('SUPABASE_SERVICE_KEY');
  const vapidPublic = requireEnv('VAPID_PUBLIC_KEY');
  const vapidPrivate = requireEnv('VAPID_PRIVATE_KEY');
  const vapidSubject = process.env.VAPID_SUBJECT?.trim() || 'mailto:admin@toptipster.ie';

  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.rpc('lms_list_deadline_reminders');
  if (error) throw error;

  const rows = (data ?? []) as ReminderRow[];
  console.log(`[lms-reminders] candidates: ${rows.length}`);

  let sent = 0;
  let failed = 0;
  let pruned = 0;
  const marked = new Set<string>();

  for (const row of rows) {
    const when = windowLabel(row.reminder_window);
    const title = 'Pick deadline closing';
    const body = `${row.competition_name} · GW${row.gameweek_number} closes in ${when}. If you don’t pick you’ll be on ${row.predicted_team_name}.`;
    const dataPayload = {
      competitionId: row.competition_id,
      url: `/${row.competition_id}`,
    };

    let ok = false;
    try {
      if (row.channel === 'expo' && row.expo_token) {
        const status = await sendExpoPush(row.expo_token, title, body, dataPayload);
        if (status === 'ok') {
          ok = true;
          sent += 1;
        } else if (status === 'gone') {
          failed += 1;
          const { error: delErr } = await supabase
            .from('expo_push_tokens')
            .delete()
            .eq('token', row.expo_token);
          if (!delErr) pruned += 1;
        } else {
          failed += 1;
        }
      } else if (row.channel === 'web' && row.endpoint && row.p256dh && row.auth) {
        await webpush.sendNotification(
          {
            endpoint: row.endpoint,
            keys: { p256dh: row.p256dh, auth: row.auth },
          },
          JSON.stringify({
            title,
            body,
            icon: '/apple-touch-icon.png',
            badge: '/favicon.png',
            ...dataPayload,
          }),
          { TTL: 60 * 60 }
        );
        ok = true;
        sent += 1;
      } else {
        failed += 1;
      }
    } catch (e: unknown) {
      failed += 1;
      const statusCode =
        e && typeof e === 'object' && 'statusCode' in e
          ? Number((e as { statusCode?: number }).statusCode)
          : undefined;
      const message = e instanceof Error ? e.message : String(e);
      console.warn('[lms-reminders] send failed:', statusCode ?? '', message);

      if (statusCode === 404 || statusCode === 410) {
        if (row.endpoint) {
          const { error: delErr } = await supabase
            .from('web_push_subscriptions')
            .delete()
            .eq('endpoint', row.endpoint);
          if (!delErr) pruned += 1;
        }
      }
    }

    if (ok) {
      const key = `${row.user_id}:${row.competition_id}:${row.gameweek_id}:${row.reminder_window}`;
      if (!marked.has(key)) {
        marked.add(key);
        const { error: markErr } = await supabase.rpc('lms_mark_deadline_reminder_sent', {
          p_user_id: row.user_id,
          p_competition_id: row.competition_id,
          p_gameweek_id: row.gameweek_id,
          p_reminder_window: row.reminder_window,
        });
        if (markErr) {
          console.warn('[lms-reminders] mark sent failed:', markErr.message);
        }
      }
    }
  }

  console.log('[lms-reminders] Done.', { sent, failed, pruned, marked: marked.size });
}

main().catch((e) => {
  console.error('[lms-reminders] Fatal:', e);
  process.exit(1);
});
