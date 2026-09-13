/**
 * Web Push for LMS deadline reminders (Home Screen / PWA).
 * On web/native, Metro resolves webPush.web.ts / webPush.native.ts for `@/lib/webPush`.
 * This file is a fallback router when platform extensions are not used.
 */
import { Platform } from 'react-native';

const impl =
  Platform.OS === 'web' ? require('./webPush.web') : require('./webPush.native');

export const getVapidPublicKey = impl.getVapidPublicKey as () => string | null;
export const isWebPushSupported = impl.isWebPushSupported as () => boolean;
export const isRunningAsInstalledWebApp = impl.isRunningAsInstalledWebApp as () => boolean;
export const getWebPushPermission = impl.getWebPushPermission as () =>
  | 'default'
  | 'denied'
  | 'granted'
  | 'unsupported';
export const getPushPermissionAsync = impl.getPushPermissionAsync as () => Promise<
  'default' | 'denied' | 'granted' | 'unsupported'
>;
export const ensureServiceWorker = impl.ensureServiceWorker as () => Promise<unknown>;
export const subscribeWebPush = impl.subscribeWebPush as (
  userId: string
) => Promise<{ ok: true } | { ok: false; error: string }>;
export const unsubscribeWebPush = impl.unsubscribeWebPush as (
  userId: string
) => Promise<{ ok: true } | { ok: false; error: string }>;
export const bindWebPushDeviceToCurrentUser = impl.bindWebPushDeviceToCurrentUser as () => Promise<void>;
export const unbindWebPushDevice = impl.unbindWebPushDevice as () => Promise<void>;
export const unbindAllWebPushDevices = impl.unbindAllWebPushDevices as () => Promise<void>;
export const isWebPushBoundToCurrentUser = impl.isWebPushBoundToCurrentUser as () => Promise<boolean>;
export const getActiveWebPushSubscription = impl.getActiveWebPushSubscription as () => Promise<{
  endpoint: string;
} | null>;
