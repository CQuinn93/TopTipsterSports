import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  Alert,
  ActivityIndicator,
  Share,
  useWindowDimensions,
  ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';
import {
  racingGetAdminContext,
  racingGetCompetitionJoinCodes,
} from '@/lib/racingAdminApi';

function formatFestivalRange(start?: string | null, end?: string | null): string {
  if (!start && !end) return 'Set by the organiser';
  const fmt = (d: string) => {
    try {
      return new Date(`${d}T12:00:00`).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
      });
    } catch {
      return d;
    }
  };
  if (start && end && start !== end) return `${fmt(start)} – ${fmt(end)}`;
  return fmt(start || end || '');
}

export default function RacingShareInviteScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isCompact = width < 420 || height < 680;
  const params = useLocalSearchParams<{ competitionId: string }>();
  const competitionId = String(params.competitionId ?? '');

  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [name, setName] = useState('');
  const [joinCode, setJoinCode] = useState<string | null>(null);
  const [entry, setEntry] = useState<string | null>(null);
  const [festivalLabel, setFestivalLabel] = useState('Set by the organiser');
  const [busy, setBusy] = useState(false);

  const loginBg = ['#0a0a0a', '#111111', '#0a0a0a'] as const;
  const entryLabel = entry?.trim() || 'Set by the organiser';

  const shareText = useMemo(() => {
    const lines = [
      `Join ${name || 'Top Tipster Racing'} on Top Tipster`,
      joinCode ? `Join code: ${joinCode}` : null,
      `Festival: ${festivalLabel}`,
      `Entry: ${entryLabel}`,
      'Pick winners each race day. Climb the leaderboard.',
    ];
    return lines.filter(Boolean).join('\n');
  }, [name, joinCode, festivalLabel, entryLabel]);

  const load = useCallback(async () => {
    if (!competitionId) {
      setForbidden(true);
      setLoading(false);
      return;
    }
    try {
      const data = await racingGetAdminContext(competitionId);
      if (!data.success || !data.can_handle_joins) {
        setForbidden(true);
        return;
      }
      setName(data.name ?? '');
      setEntry(data.entry ?? null);
      setFestivalLabel(formatFestivalRange(data.festival_start_date, data.festival_end_date));
      const fromCtx =
        typeof data.join_code === 'string'
          ? data.join_code.trim()
          : typeof data.access_code === 'string'
            ? data.access_code.trim()
            : null;
      setJoinCode(fromCtx || null);
      try {
        const codes = await racingGetCompetitionJoinCodes(competitionId);
        if (codes.join_code) setJoinCode(codes.join_code);
      } catch {
        /* keep join_code from admin context */
      }
    } catch {
      setForbidden(true);
    } finally {
      setLoading(false);
    }
  }, [competitionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const showCopied = (msg: string) => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') window.alert(msg);
    else Alert.alert('Copied', msg);
  };

  const copyJoinCode = async () => {
    if (!joinCode) {
      Alert.alert('No join code', 'This competition does not have a join code yet.');
      return;
    }
    try {
      await Clipboard.setStringAsync(joinCode);
      showCopied(`Join code ${joinCode} copied.`);
    } catch {
      Alert.alert('Copy failed', 'Could not copy the join code.');
    }
  };

  const copyDetails = async () => {
    setBusy(true);
    try {
      await Clipboard.setStringAsync(shareText);
      showCopied('Invite details copied.');
    } catch {
      Alert.alert('Copy failed', 'Could not copy the invite details.');
    } finally {
      setBusy(false);
    }
  };

  const onShare = async () => {
    setBusy(true);
    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({
          title: `Top Tipster Racing — ${name}`,
          text: shareText,
        });
        return;
      }
      await Share.share({ message: shareText, title: `Top Tipster Racing — ${name}` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (/abort|cancel/i.test(msg)) return;
      await copyDetails();
    } finally {
      setBusy(false);
    }
  };

  const styles = useMemo(
    () =>
      StyleSheet.create({
        bg: { flex: 1, backgroundColor: '#0a0a0a' },
        bgGradient: { ...StyleSheet.absoluteFillObject },
        close: {
          position: 'absolute',
          top: Math.max(theme.spacing.md, insets.top + 6),
          left: theme.spacing.lg,
          zIndex: 2,
          width: 40,
          height: 40,
          alignItems: 'center',
          justifyContent: 'center',
        },
        scroll: {
          flexGrow: 1,
          padding: theme.spacing.lg,
          paddingTop: Math.max(theme.spacing.xl, insets.top + 48),
          paddingBottom: Math.max(theme.spacing.lg, insets.bottom + theme.spacing.sm),
        },
        content: {
          flexGrow: 1,
          maxWidth: 400,
          width: '100%',
          alignSelf: 'center',
          justifyContent: 'center',
        },
        wordmarkTop: {
          fontFamily: theme.fontFamily.swish,
          fontSize: isCompact ? 32 : Platform.OS === 'web' ? 36 : 42,
          color: '#fafafa',
          textAlign: 'center',
          marginBottom: theme.spacing.xs,
        },
        wordmarkSub: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 14,
          color: theme.colors.accent,
          textAlign: 'center',
          marginTop: 8,
          letterSpacing: 4,
          textTransform: 'uppercase',
        },
        compName: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 20,
          color: '#fafafa',
          textAlign: 'center',
          marginVertical: theme.spacing.lg,
        },
        codeBlock: { alignItems: 'center', marginBottom: theme.spacing.lg, gap: 6 },
        codeLabel: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 12,
          color: '#a3a3a3',
          textTransform: 'uppercase',
          letterSpacing: 1.2,
        },
        codeValue: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 32,
          letterSpacing: 6,
          color: '#fafafa',
        },
        codeHint: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 12,
          color: '#737373',
        },
        rules: { gap: 10, marginBottom: theme.spacing.lg },
        ruleRow: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          gap: 12,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: '#2a2a2a',
          paddingBottom: 8,
        },
        ruleLabel: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 13,
          color: '#a3a3a3',
        },
        ruleValue: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 13,
          color: '#fafafa',
          flexShrink: 1,
          textAlign: 'right',
        },
        actions: { gap: 10 },
        button: {
          backgroundColor: theme.colors.accent,
          borderRadius: theme.radius.md,
          paddingVertical: theme.spacing.md,
          alignItems: 'center',
          flexDirection: 'row',
          justifyContent: 'center',
          gap: 8,
        },
        buttonText: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 16,
          color: theme.colors.white,
        },
        secondaryBtn: { alignItems: 'center', paddingVertical: 8 },
        secondaryText: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 14,
          color: theme.colors.accent,
        },
        muted: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 14,
          color: '#a3a3a3',
          textAlign: 'center',
        },
      }),
    [theme, insets, isCompact]
  );

  return (
    <View style={styles.bg}>
      <LinearGradient
        colors={[...loginBg]}
        locations={[0, 0.45, 1]}
        style={styles.bgGradient}
        pointerEvents="none"
      />
      <Pressable style={styles.close} onPress={() => router.back()}>
        <Ionicons name="close" size={24} color="#fafafa" />
      </Pressable>
      <ScrollView contentContainerStyle={styles.scroll}>
        {loading ? (
          <ActivityIndicator color={theme.colors.accent} style={{ marginTop: 80 }} />
        ) : forbidden ? (
          <Text style={styles.muted}>You do not have access to share this competition.</Text>
        ) : (
          <View style={styles.content}>
            <Text style={styles.wordmarkTop}>Top Tipster</Text>
            <Text style={styles.wordmarkSub}>Racing</Text>
            <Text style={styles.compName}>{name}</Text>
            <Pressable style={styles.codeBlock} onPress={() => void copyJoinCode()}>
              <Text style={styles.codeLabel}>Join code</Text>
              <Text style={styles.codeValue}>{joinCode ?? '————'}</Text>
              <Text style={styles.codeHint}>Tap to copy</Text>
            </Pressable>
            <View style={styles.rules}>
              <View style={styles.ruleRow}>
                <Text style={styles.ruleLabel}>Festival</Text>
                <Text style={styles.ruleValue}>{festivalLabel}</Text>
              </View>
              <View style={styles.ruleRow}>
                <Text style={styles.ruleLabel}>Entry</Text>
                <Text style={styles.ruleValue}>{entryLabel}</Text>
              </View>
            </View>
            <View style={styles.actions}>
              <Pressable style={styles.button} disabled={busy} onPress={() => void onShare()}>
                {busy ? (
                  <ActivityIndicator color={theme.colors.white} />
                ) : (
                  <>
                    <Ionicons name="share-outline" size={18} color={theme.colors.white} />
                    <Text style={styles.buttonText}>Share invite</Text>
                  </>
                )}
              </Pressable>
              <Pressable style={styles.secondaryBtn} onPress={() => void copyDetails()}>
                <Text style={styles.secondaryText}>Copy details</Text>
              </Pressable>
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
