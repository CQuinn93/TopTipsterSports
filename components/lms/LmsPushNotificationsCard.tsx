import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Switch,
  ActivityIndicator,
  Platform,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import {
  getActiveWebPushSubscription,
  getPushPermissionAsync,
  getVapidPublicKey,
  isRunningAsInstalledWebApp,
  isWebPushBoundToCurrentUser,
  isWebPushSupported,
  subscribeWebPush,
  unsubscribeWebPush,
} from '@/lib/webPush';

type Status =
  | 'loading'
  | 'unsupported'
  | 'not_configured'
  | 'need_homescreen'
  | 'denied'
  | 'off'
  | 'on';

/** Deadline / competition alerts opt-in (Web Push on PWA, Expo push on native). */
export function LmsPushNotificationsCard() {
  const theme = useTheme();
  const { userId } = useAuth();
  const [status, setStatus] = useState<Status>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    if (!isWebPushSupported()) {
      setStatus('unsupported');
      return;
    }
    if (!getVapidPublicKey()) {
      setStatus('not_configured');
      return;
    }
    if (!isRunningAsInstalledWebApp()) {
      setStatus('need_homescreen');
      return;
    }
    const perm = await getPushPermissionAsync();
    if (perm === 'denied') {
      setStatus('denied');
      return;
    }
    const sub = await getActiveWebPushSubscription();
    if (!sub) {
      setStatus('off');
      return;
    }
    const bound = await isWebPushBoundToCurrentUser();
    setStatus(bound ? 'on' : 'off');
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        card: {
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.md,
          paddingVertical: 12,
          paddingHorizontal: theme.spacing.md,
          backgroundColor: theme.colors.surface,
          gap: 6,
        },
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: theme.spacing.md,
          minHeight: 28,
        },
        title: {
          flex: 1,
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 15,
          color: theme.colors.text,
        },
        hint: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 12,
          color: theme.colors.textMuted,
          lineHeight: 16,
        },
        error: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 12,
          color: theme.colors.error,
        },
        switchWrap: {
          minWidth: 52,
          alignItems: 'flex-end',
          justifyContent: 'center',
        },
      }),
    [theme]
  );

  const onEnable = async () => {
    if (!userId) return;
    setBusy(true);
    setError(null);
    const res = await subscribeWebPush(userId);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      await refresh();
      return;
    }
    await refresh();
  };

  const onDisable = async () => {
    if (!userId) return;
    setBusy(true);
    setError(null);
    const res = await unsubscribeWebPush(userId);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      await refresh();
      return;
    }
    await refresh();
  };

  const onToggle = (value: boolean) => {
    if (busy) return;

    if (status === 'need_homescreen') {
      if (Platform.OS === 'web') {
        router.push('/(auth)/add-to-home-screen');
      } else {
        Alert.alert(
          'Deadline Alerts',
          'Add Top Tipster to your Home Screen, then open it from that icon to enable alerts.'
        );
      }
      return;
    }

    if (status === 'denied') {
      Alert.alert(
        'Deadline Alerts',
        'Notifications are blocked for this app. Enable them in your device settings.'
      );
      return;
    }

    if (status === 'not_configured') {
      Alert.alert('Deadline Alerts', 'Push notifications are not configured on this deployment yet.');
      return;
    }

    if (value) void onEnable();
    else void onDisable();
  };

  if (status === 'loading') {
    return (
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.title}>Deadline Alerts</Text>
          <View style={styles.switchWrap}>
            <ActivityIndicator color={theme.colors.accent} />
          </View>
        </View>
      </View>
    );
  }

  if (status === 'unsupported') {
    return null;
  }

  const enabled = status === 'on';

  let hint: string | null = null;
  if (status === 'need_homescreen') {
    hint = 'Add to Home Screen first, then turn this on.';
  } else if (status === 'denied') {
    hint = 'Notifications are blocked in device settings.';
  } else if (status === 'not_configured') {
    hint = 'Push is not configured on this deployment yet.';
  } else if (enabled) {
    hint =
      Platform.OS === 'web'
        ? 'Uses the same device channel as join-request alerts.'
        : 'Pick deadlines and competition alerts on this device.';
  } else if (Platform.OS !== 'web') {
    hint = 'Get alerts before pick deadlines close.';
  }

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.title}>Deadline Alerts</Text>
        <View style={styles.switchWrap}>
          {busy ? (
            <ActivityIndicator color={theme.colors.accent} />
          ) : (
            <Switch
              value={enabled}
              onValueChange={onToggle}
              disabled={busy}
              trackColor={{
                false: theme.colors.border,
                true: theme.colors.accentDim,
              }}
              thumbColor={enabled ? theme.colors.accent : '#f4f3f4'}
              ios_backgroundColor={theme.colors.border}
              accessibilityLabel="Deadline Alerts"
              accessibilityState={{ checked: enabled, disabled: busy }}
            />
          )}
        </View>
      </View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}
