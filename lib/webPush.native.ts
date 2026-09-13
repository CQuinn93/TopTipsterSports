/**
 * Native push via Expo Notifications (iOS / Android).
 * Same public API surface as webPush.web.ts so LMS toggle + AuthContext work unchanged.
 */
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { supabase } from '@/lib/supabase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const ANDROID_CHANNEL_ID = 'competition-alerts';

let cachedToken: string | null | undefined;

function projectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return (
    extra?.eas?.projectId ??
    (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId ??
    null
  );
}

export function getVapidPublicKey(): string | null {
  // Native uses Expo push; treat as "configured" when project id exists.
  return projectId();
}

export function isWebPushSupported(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

export function isRunningAsInstalledWebApp(): boolean {
  // Native apps are always "installed".
  return true;
}

export function getWebPushPermission():
  | 'default'
  | 'denied'
  | 'granted'
  | 'unsupported' {
  if (!isWebPushSupported()) return 'unsupported';
  return 'default';
}

/** Async permission for UI refresh (native needs this; web mirrors Notification.permission). */
export async function getPushPermissionAsync(): Promise<
  'default' | 'denied' | 'granted' | 'unsupported'
> {
  if (!isWebPushSupported()) return 'unsupported';
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status === 'granted') return 'granted';
    if (status === 'denied') return 'denied';
    return 'default';
  } catch {
    return 'default';
  }
}


export async function ensureServiceWorker(): Promise<null> {
  return null;
}

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'Competition alerts',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#059669',
  });
}

async function getExpoPushTokenString(): Promise<string | null> {
  if (cachedToken) return cachedToken;
  if (!Device.isDevice) return null;

  const pid = projectId();
  if (!pid) return null;

  await ensureAndroidChannel();
  const tokenRes = await Notifications.getExpoPushTokenAsync({ projectId: pid });
  cachedToken = tokenRes.data;
  return cachedToken;
}

export async function getActiveWebPushSubscription(): Promise<{ endpoint: string } | null> {
  try {
    const token = await getExpoPushTokenString();
    if (!token) return null;
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return null;
    return { endpoint: token };
  } catch {
    return null;
  }
}

async function bindTokenToCurrentUser(
  token: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const platform = Platform.OS === 'android' ? 'android' : 'ios';
  const { data, error } = await (supabase as any).rpc('expo_push_bind_token', {
    p_token: token,
    p_platform: platform,
  });
  if (error) return { ok: false, error: error.message };
  if (data && data.success === false) {
    return { ok: false, error: data.error || 'Could not save this device.' };
  }
  return { ok: true };
}

export async function subscribeWebPush(
  userId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!userId) return { ok: false, error: 'Not signed in.' };
  if (!isWebPushSupported()) {
    return { ok: false, error: 'Notifications are not supported on this device.' };
  }
  if (!Device.isDevice) {
    return {
      ok: false,
      error: 'Push notifications require a physical device (not a simulator).',
    };
  }
  if (!projectId()) {
    return { ok: false, error: 'Notifications are not configured on this build yet.' };
  }

  try {
    await ensureAndroidChannel();
    const current = await Notifications.getPermissionsAsync();
    let status = current.status;
    if (status !== 'granted') {
      const asked = await Notifications.requestPermissionsAsync();
      status = asked.status;
    }
    if (status !== 'granted') {
      return { ok: false, error: 'Notification permission was not granted.' };
    }

    const token = await getExpoPushTokenString();
    if (!token) {
      return { ok: false, error: 'Could not get a push token for this device.' };
    }

    return bindTokenToCurrentUser(token);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not enable notifications.';
    return { ok: false, error: msg };
  }
}

export async function bindWebPushDeviceToCurrentUser(): Promise<void> {
  if (!isWebPushSupported() || !Device.isDevice) return;
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;
    const token = await getExpoPushTokenString();
    if (!token) return;
    await bindTokenToCurrentUser(token);
  } catch {
    // ignore — login should not fail if push bind fails
  }
}

export async function unbindWebPushDevice(): Promise<void> {
  try {
    const token = cachedToken ?? (await getExpoPushTokenString());
    if (!token) return;
    await (supabase as any).rpc('expo_push_unbind_token', { p_token: token });
  } catch {
    // ignore
  }
}

export async function unbindAllWebPushDevices(): Promise<void> {
  await (supabase as any).rpc('expo_push_unbind_all_devices');
  // Also clear any leftover web rows if present (no-op when empty).
  await (supabase as any).rpc('web_push_unbind_all_devices');
}

export async function isWebPushBoundToCurrentUser(): Promise<boolean> {
  const sub = await getActiveWebPushSubscription();
  if (!sub?.endpoint) return false;
  const { data, error } = await (supabase as any)
    .from('expo_push_tokens')
    .select('token')
    .eq('token', sub.endpoint)
    .maybeSingle();
  if (error) return false;
  return Boolean(data?.token);
}

export async function unsubscribeWebPush(
  _userId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const token = cachedToken ?? (await getExpoPushTokenString());
    if (token) {
      await (supabase as any).rpc('expo_push_unbind_token', { p_token: token });
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not disable notifications.';
    return { ok: false, error: msg };
  }
}
