/**
 * Email LMS pick reminders (~1 hour before kick-off) via Resend.
 * Targets active participants who have not picked for the due gameweek.
 *
 * Env:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_KEY
 *   RESEND_API_KEY
 *   LMS_REMINDER_FROM_EMAIL (optional) — default "Top Tipster <reminder@toptipster.ie>"
 *   LMS_REMINDER_APP_URL (optional) — default https://www.toptipster.ie
 *   LMS_REMINDER_DAILY_CAP (optional) — soft stop; default 90 (leave headroom under Resend 100/day)
 *
 * Run: npx tsx scripts/send-lms-deadline-email-reminders.ts
 */
import { createClient } from '@supabase/supabase-js';

type EmailReminderRow = {
  user_id: string;
  email: string;
  competition_id: string;
  competition_name: string;
  gameweek_id: string;
  gameweek_number: number;
  deadline_at: string;
  predicted_team_name: string;
  reminder_window: string;
};

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function formatDeadline(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-GB', {
      timeZone: 'Europe/Dublin',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function buildEmailHtml(row: EmailReminderRow, appUrl: string): string {
  const deadlineLabel = formatDeadline(row.deadline_at);
  const openUrl = `${appUrl.replace(/\/$/, '')}/${row.competition_id}`;
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 12px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;padding:28px 24px;border:1px solid #e4e4e7;">
          <tr>
            <td>
              <p style="margin:0 0 8px;font-size:13px;letter-spacing:0.04em;text-transform:uppercase;color:#059669;font-weight:600;">Last Man Standing</p>
              <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#18181b;">Pick needed for GW${row.gameweek_number}</h1>
              <p style="margin:0 0 12px;font-size:15px;line-height:1.5;color:#3f3f46;">
                You’re still active in <strong>${escapeHtml(row.competition_name)}</strong>, but you haven’t locked in a team for gameweek ${row.gameweek_number}.
              </p>
              <p style="margin:0 0 12px;font-size:15px;line-height:1.5;color:#3f3f46;">
                The gameweek kicks off in about an hour. Picks close at <strong>${escapeHtml(deadlineLabel)}</strong> (Dublin time).
              </p>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:#3f3f46;">
                If you don’t pick, you’ll be auto-assigned <strong>${escapeHtml(row.predicted_team_name)}</strong>.
              </p>
              <p style="margin:0 0 24px;">
                <a href="${escapeHtml(openUrl)}" style="display:inline-block;background:#059669;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 18px;border-radius:8px;">
                  Make your pick
                </a>
              </p>
              <p style="margin:0;font-size:12px;line-height:1.4;color:#71717a;">
                You’re receiving this because you’re an active player without a pick for this gameweek.
                Open Top Tipster on the web or in the app to choose your team.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildEmailText(row: EmailReminderRow, appUrl: string): string {
  const deadlineLabel = formatDeadline(row.deadline_at);
  const openUrl = `${appUrl.replace(/\/$/, '')}/${row.competition_id}`;
  return [
    `Last Man Standing — pick needed for GW${row.gameweek_number}`,
    '',
    `You're still active in "${row.competition_name}" but haven't locked in a team for gameweek ${row.gameweek_number}.`,
    `The gameweek kicks off in about an hour. Picks close at ${deadlineLabel} (Dublin time).`,
    `If you don't pick, you'll be auto-assigned ${row.predicted_team_name}.`,
    '',
    `Make your pick: ${openUrl}`,
  ].join('\n');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function sendResendEmail(params: {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: params.from,
      to: [params.to],
      subject: params.subject,
      html: params.html,
      text: params.text,
    }),
  });
  const body = await res.text().catch(() => '');
  return { ok: res.ok, status: res.status, body };
}

async function main() {
  const resendApiKey = process.env.RESEND_API_KEY?.trim();
  if (!resendApiKey) {
    console.log('[lms-email-reminders] RESEND_API_KEY not set — skipping.');
    return;
  }

  const supabaseUrl = requireEnv('SUPABASE_URL');
  const serviceKey = requireEnv('SUPABASE_SERVICE_KEY');
  const from =
    process.env.LMS_REMINDER_FROM_EMAIL?.trim() || 'Top Tipster <reminder@toptipster.ie>';
  const appUrl = process.env.LMS_REMINDER_APP_URL?.trim() || 'https://www.toptipster.ie';
  const dailyCap = Math.max(
    1,
    Number.parseInt(process.env.LMS_REMINDER_DAILY_CAP?.trim() || '90', 10) || 90
  );

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.rpc('lms_list_deadline_email_reminders');
  if (error) throw error;

  const rows = (data ?? []) as EmailReminderRow[];
  console.log(`[lms-email-reminders] candidates: ${rows.length} (daily cap ${dailyCap})`);

  let sent = 0;
  let failed = 0;
  let skippedCap = 0;

  for (const row of rows) {
    if (sent >= dailyCap) {
      skippedCap += 1;
      continue;
    }

    const subject = `${row.competition_name}: GW${row.gameweek_number} pick needed (kicks off soon)`;
    const html = buildEmailHtml(row, appUrl);
    const text = buildEmailText(row, appUrl);

    try {
      const result = await sendResendEmail({
        apiKey: resendApiKey,
        from,
        to: row.email,
        subject,
        html,
        text,
      });
      if (!result.ok) {
        failed += 1;
        console.warn(
          '[lms-email-reminders] send failed:',
          result.status,
          row.email,
          result.body.slice(0, 200)
        );
        continue;
      }

      sent += 1;
      const { error: markErr } = await supabase.rpc('lms_mark_deadline_reminder_sent', {
        p_user_id: row.user_id,
        p_competition_id: row.competition_id,
        p_gameweek_id: row.gameweek_id,
        p_reminder_window: row.reminder_window || '1h_email',
      });
      if (markErr) {
        console.warn('[lms-email-reminders] mark sent failed:', markErr.message);
      }
    } catch (e) {
      failed += 1;
      console.warn(
        '[lms-email-reminders] send error:',
        e instanceof Error ? e.message : String(e)
      );
    }
  }

  console.log('[lms-email-reminders] Done.', { sent, failed, skippedCap });
}

main().catch((e) => {
  console.error('[lms-email-reminders] Fatal:', e);
  process.exit(1);
});
