/**
 * Send competition alerts to Web Push subscriptions and Expo push tokens.
 * Shared by notify-* Edge Functions.
 */
// @ts-nocheck

export type PushSendResult = {
  sent: number;
  failed: number;
  pruned: number;
  devices: number;
  users_notified: number;
};

type AdminClient = {
  from: (table: string) => {
    select: (cols: string) => {
      in: (
        col: string,
        vals: string[]
      ) => Promise<{ data: unknown; error: { message: string } | null }>;
    };
    delete: () => {
      eq: (
        col: string,
        val: string
      ) => Promise<{ error: { message: string } | null }>;
    };
  };
};

type WebRow = {
  endpoint: string;
  p256dh: string;
  auth: string;
  user_id: string;
};

type ExpoRow = {
  token: string;
  user_id: string;
};

async function sendExpoPushMessages(
  messages: Array<{
    to: string;
    title: string;
    body: string;
    data?: Record<string, unknown>;
    sound?: string;
  }>
): Promise<{ okTokens: Set<string>; badTokens: Set<string> }> {
  const okTokens = new Set<string>();
  const badTokens = new Set<string>();
  if (messages.length === 0) return { okTokens, badTokens };

  // Expo accepts batches of up to 100
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(chunk),
    });
    const json = (await res.json().catch(() => null)) as {
      data?: Array<{
        status?: string;
        message?: string;
        details?: { error?: string };
      }>;
    } | null;
    const results = Array.isArray(json?.data) ? json.data : [];
    results.forEach((ticket, idx) => {
      const token = chunk[idx]?.to;
      if (!token) return;
      if (ticket?.status === 'ok') {
        okTokens.add(token);
        return;
      }
      const err = ticket?.details?.error ?? ticket?.message ?? '';
      if (
        typeof err === 'string' &&
        (err.includes('DeviceNotRegistered') ||
          err.includes('InvalidCredentials') ||
          err === 'DeviceNotRegistered')
      ) {
        badTokens.add(token);
      }
    });
  }
  return { okTokens, badTokens };
}

/**
 * Send title/body to every Web Push + Expo device for the given user IDs.
 * webpush must already have VAPID details configured by the caller.
 */
export async function sendPushToUserIds(opts: {
  admin: AdminClient;
  webpush: {
    sendNotification: (
      sub: { endpoint: string; keys: { p256dh: string; auth: string } },
      payload: string,
      options?: { TTL?: number }
    ) => Promise<unknown>;
  };
  userIds: string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
  ttlSeconds?: number;
}): Promise<PushSendResult> {
  const {
    admin,
    webpush,
    userIds,
    title,
    body,
    data = {},
    ttlSeconds = 60 * 60 * 24,
  } = opts;

  const empty: PushSendResult = {
    sent: 0,
    failed: 0,
    pruned: 0,
    devices: 0,
    users_notified: 0,
  };
  if (!userIds.length) return empty;

  const [{ data: webData, error: webErr }, { data: expoData, error: expoErr }] =
    await Promise.all([
      admin
        .from('web_push_subscriptions')
        .select('endpoint, p256dh, auth, user_id')
        .in('user_id', userIds),
      admin.from('expo_push_tokens').select('token, user_id').in('user_id', userIds),
    ]);
  if (webErr) throw webErr;
  if (expoErr) throw expoErr;

  const webRows = (webData ?? []) as WebRow[];
  const expoRows = (expoData ?? []) as ExpoRow[];
  const devices = webRows.length + expoRows.length;
  if (devices === 0) return empty;

  const webPayload = JSON.stringify({
    title,
    body,
    icon: '/apple-touch-icon.png',
    badge: '/favicon.png',
    ...data,
  });

  let sent = 0;
  let failed = 0;
  let pruned = 0;
  const notifiedUsers = new Set<string>();

  for (const row of webRows) {
    try {
      await webpush.sendNotification(
        {
          endpoint: row.endpoint,
          keys: { p256dh: row.p256dh, auth: row.auth },
        },
        webPayload,
        { TTL: ttlSeconds }
      );
      sent += 1;
      notifiedUsers.add(row.user_id);
    } catch (e: unknown) {
      failed += 1;
      const statusCode =
        e && typeof e === 'object' && 'statusCode' in e
          ? Number((e as { statusCode?: number }).statusCode)
          : undefined;
      if (statusCode === 404 || statusCode === 410) {
        await admin.from('web_push_subscriptions').delete().eq('endpoint', row.endpoint);
        pruned += 1;
      }
    }
  }

  const expoMessages = expoRows.map((row) => ({
    to: row.token,
    title,
    body,
    sound: 'default',
    data,
  }));
  const { okTokens, badTokens } = await sendExpoPushMessages(expoMessages);
  for (const row of expoRows) {
    if (okTokens.has(row.token)) {
      sent += 1;
      notifiedUsers.add(row.user_id);
    } else if (badTokens.has(row.token)) {
      failed += 1;
      await admin.from('expo_push_tokens').delete().eq('token', row.token);
      pruned += 1;
    } else if (expoMessages.length > 0) {
      // Ticket missing/error without DeviceNotRegistered
      failed += 1;
    }
  }

  return {
    sent,
    failed,
    pruned,
    devices,
    users_notified: notifiedUsers.size,
  };
}
