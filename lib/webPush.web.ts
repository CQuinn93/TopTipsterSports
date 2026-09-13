import { supabase } from '@/lib/supabase';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

type Db = typeof supabase & {
  from: (table: string) => ReturnType<typeof supabase.from>;
};

function db() {
  return supabase as unknown as {
    from: (table: 'web_push_subscriptions') => {
      upsert: (
        row: Record<string, unknown>,
        opts: { onConflict: string }
      ) => Promise<{ error: { message: string } | null }>;
      delete: () => {
        eq: (col: string, val: string) => {
          eq: (col2: string, val2: string) => Promise<{ error: { message: string } | null }>;
          then?: unknown;
        } & PromiseLike<{ error: { message: string } | null }>;
      };
    };
  };
}

export function getVapidPublicKey(): string | null {
  const key = process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  return key || null;
}

export function isRunningAsInstalledWebApp(): boolean {
  if (typeof window === 'undefined') return false;
  const mq = window.matchMedia?.('(display-mode: standalone), (display-mode: fullscreen)');
  if (mq?.matches) return true;
  return Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

export function isWebPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function getWebPushPermission(): NotificationPermission | 'unsupported' {
  if (!isWebPushSupported()) return 'unsupported';
  return Notification.permission;
}

export async function getPushPermissionAsync(): Promise<
  'default' | 'denied' | 'granted' | 'unsupported'
> {
  const p = getWebPushPermission();
  if (p === 'unsupported') return 'unsupported';
  if (p === 'granted') return 'granted';
  if (p === 'denied') return 'denied';
  return 'default';
}

export async function ensureServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isWebPushSupported()) return null;
  const base = (process.env.EXPO_PUBLIC_WEB_BASE_URL ?? '').replace(/\/$/, '');
  const swUrl = `${base || ''}/sw.js`;
  const scope = base ? `${base}/` : '/';
  return navigator.serviceWorker.register(swUrl, { scope });
}

export async function getActiveWebPushSubscription(): Promise<PushSubscription | null> {
  if (!isWebPushSupported()) return null;
  await ensureServiceWorker();
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export async function subscribeWebPush(
  userId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!userId) return { ok: false, error: 'Not signed in.' };
  if (!isWebPushSupported()) {
    return { ok: false, error: 'This browser does not support notifications.' };
  }
  if (!isRunningAsInstalledWebApp()) {
    return {
      ok: false,
      error:
        'Add Top Tipster to your Home Screen, open it from there, then enable notifications.',
    };
  }
  const vapid = getVapidPublicKey();
  if (!vapid) {
    return { ok: false, error: 'Notifications are not configured on this build yet.' };
  }

  try {
    const registered = await ensureServiceWorker();
    if (!registered) return { ok: false, error: 'Could not register the notification service.' };
    const reg = await navigator.serviceWorker.ready;

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return { ok: false, error: 'Notification permission was not granted.' };
    }

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapid) as BufferSource,
      });
    }

    const json = sub.toJSON();
    const endpoint = json.endpoint;
    const p256dh = json.keys?.p256dh;
    const auth = json.keys?.auth;
    if (!endpoint || !p256dh || !auth) {
      return { ok: false, error: 'Invalid push subscription from the browser.' };
    }

    const bound = await bindEndpointToCurrentUser(endpoint, p256dh, auth);
    if (!bound.ok) return bound;
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not enable notifications.';
    return { ok: false, error: msg };
  }
}

async function bindEndpointToCurrentUser(
  endpoint: string,
  p256dh: string,
  auth: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await (supabase as any).rpc('web_push_bind_device', {
    p_endpoint: endpoint,
    p_p256dh: p256dh,
    p_auth: auth,
    p_user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
  });
  if (error) return { ok: false, error: error.message };
  if (data && data.success === false) {
    return { ok: false, error: data.error || 'Could not save this device.' };
  }
  return { ok: true };
}

/** Re-attach this phone's existing OS subscription to whoever is logged in now. */
export async function bindWebPushDeviceToCurrentUser(): Promise<void> {
  if (!isWebPushSupported() || !isRunningAsInstalledWebApp()) return;
  if (getWebPushPermission() !== 'granted') return;
  const sub = await getActiveWebPushSubscription();
  if (!sub) return;
  const json = sub.toJSON();
  const endpoint = json.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!endpoint || !p256dh || !auth) return;
  await bindEndpointToCurrentUser(endpoint, p256dh, auth);
}

/** Stop sending to this phone for the current account; keep OS permission for the next login. */
export async function unbindWebPushDevice(): Promise<void> {
  if (!isWebPushSupported()) return;
  const sub = await getActiveWebPushSubscription();
  if (!sub?.endpoint) return;
  await (supabase as any).rpc('web_push_unbind_device', { p_endpoint: sub.endpoint });
}

/** Drop every saved phone for this account (lost-device / sign out everywhere). */
export async function unbindAllWebPushDevices(): Promise<void> {
  await (supabase as any).rpc('web_push_unbind_all_devices');
  await (supabase as any).rpc('expo_push_unbind_all_devices');
}

export async function isWebPushBoundToCurrentUser(): Promise<boolean> {
  const sub = await getActiveWebPushSubscription();
  if (!sub?.endpoint) return false;
  const { data, error } = await (supabase as any)
    .from('web_push_subscriptions')
    .select('endpoint')
    .eq('endpoint', sub.endpoint)
    .maybeSingle();
  if (error) return false;
  return Boolean(data?.endpoint);
}

export async function unsubscribeWebPush(
  _userId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const sub = await getActiveWebPushSubscription();
    if (sub) {
      const endpoint = sub.endpoint;
      if (endpoint) {
        await (supabase as any).rpc('web_push_unbind_device', { p_endpoint: endpoint });
      }
      await sub.unsubscribe();
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not disable notifications.';
    return { ok: false, error: msg };
  }
}

