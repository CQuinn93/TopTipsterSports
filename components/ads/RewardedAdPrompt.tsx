import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  AdEventType,
  RewardedAd,
  RewardedAdEventType,
} from 'react-native-google-mobile-ads';
import { useTheme } from '@/contexts/ThemeContext';
import { rewardedUnitId, type RewardedPlacement } from '@/lib/ads/units';
import { isAdUnlockActive, markAdUnlocked } from '@/lib/ads/sessionUnlock';
import { useShowAds } from '@/lib/ads/useShowAds';
import { initMobileAds } from '@/lib/ads/initAds';

type Props = {
  placement: RewardedPlacement;
  unlockKey: string;
  title?: string;
  body?: string;
  /** Called when the user may proceed (unlocked, skipped ads, or ad failed). */
  onUnlocked: () => void;
  /** Controlled: when true, show the prompt if ads are required. */
  visible: boolean;
  onCancel: () => void;
};

/**
 * Pre-prompt → rewarded ad → unlock for this session.
 * If ads are off or already unlocked, calls onUnlocked immediately when visible.
 */
export function RewardedAdPrompt({
  placement,
  unlockKey,
  title = 'A short ad helps keep Top Tipster running',
  body = 'Continue to view this screen? You’ll only see this once per session.',
  onUnlocked,
  visible,
  onCancel,
}: Props) {
  const theme = useTheme();
  const { showAds, loading: adsLoading } = useShowAds();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rewardedRef = useRef<RewardedAd | null>(null);
  const earnedRef = useRef(false);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        backdrop: {
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.65)',
          justifyContent: 'center',
          padding: 24,
        },
        card: {
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.lg,
          padding: theme.spacing.lg,
          gap: 12,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
        },
        title: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 18,
          color: theme.colors.text,
          textAlign: 'center',
        },
        body: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 15,
          lineHeight: 22,
          color: theme.colors.textSecondary,
          textAlign: 'center',
        },
        error: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 13,
          color: theme.colors.error,
          textAlign: 'center',
        },
        primary: {
          marginTop: 8,
          backgroundColor: theme.colors.accent,
          borderRadius: theme.radius.md,
          paddingVertical: 14,
          alignItems: 'center',
        },
        primaryText: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 16,
          color: theme.colors.white,
        },
        secondary: {
          paddingVertical: 12,
          alignItems: 'center',
        },
        secondaryText: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 14,
          color: theme.colors.textMuted,
        },
        disabled: { opacity: 0.55 },
      }),
    [theme]
  );

  const finishUnlocked = useCallback(() => {
    markAdUnlocked(unlockKey);
    onUnlocked();
  }, [onUnlocked, unlockKey]);

  useEffect(() => {
    if (!visible) return;
    if (adsLoading) return;
    if (!showAds || Platform.OS === 'web' || isAdUnlockActive(unlockKey)) {
      finishUnlocked();
    }
  }, [visible, adsLoading, showAds, unlockKey, finishUnlocked]);

  const showRewarded = async () => {
    if (Platform.OS === 'web') {
      finishUnlocked();
      return;
    }
    setBusy(true);
    setError(null);
    earnedRef.current = false;
    try {
      await initMobileAds();
      const unitId = rewardedUnitId(placement);
      const rewarded = RewardedAd.createForAdRequest(unitId, {
        requestNonPersonalizedAdsOnly: true,
      });
      rewardedRef.current = rewarded;

      const unsubs: Array<() => void> = [];
      const cleanup = () => {
        unsubs.forEach((u) => u());
        rewardedRef.current = null;
      };

      await new Promise<void>((resolve, reject) => {
        unsubs.push(
          rewarded.addAdEventListener(RewardedAdEventType.LOADED, () => {
            void rewarded.show().catch(reject);
          })
        );
        unsubs.push(
          rewarded.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
            earnedRef.current = true;
          })
        );
        unsubs.push(
          rewarded.addAdEventListener(AdEventType.CLOSED, () => {
            cleanup();
            if (earnedRef.current) resolve();
            else reject(new Error('Ad closed before reward'));
          })
        );
        unsubs.push(
          rewarded.addAdEventListener(AdEventType.ERROR, (e) => {
            cleanup();
            reject(e instanceof Error ? e : new Error('Ad failed to load'));
          })
        );
        rewarded.load();
      });

      finishUnlocked();
    } catch (e) {
      // Don't permanently block the product if ads fail — allow through this session.
      console.warn('[ads] rewarded failed', e);
      setError('Ad unavailable — continuing without it.');
      finishUnlocked();
    } finally {
      setBusy(false);
    }
  };

  const needsPrompt =
    visible &&
    !adsLoading &&
    showAds &&
    Platform.OS !== 'web' &&
    !isAdUnlockActive(unlockKey);

  return (
    <Modal visible={needsPrompt} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body}>{body}</Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable
            style={[styles.primary, busy && styles.disabled]}
            disabled={busy}
            onPress={() => void showRewarded()}
          >
            {busy ? (
              <ActivityIndicator color={theme.colors.white} />
            ) : (
              <Text style={styles.primaryText}>Continue</Text>
            )}
          </Pressable>
          <Pressable style={styles.secondary} disabled={busy} onPress={onCancel}>
            <Text style={styles.secondaryText}>Not now</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
