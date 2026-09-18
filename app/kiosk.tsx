import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
  Linking,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { kioskRequestJoin, kioskSetJoinPaymentMethod } from '@/lib/kioskApi';
import {
  clearKioskDeviceConfig,
  getKioskDeviceConfig,
  sportLabel,
  verifyKioskExitPin,
  type KioskDeviceConfig,
} from '@/lib/kioskSession';
import { KioskLmsPickPanel } from '@/components/kiosk/KioskLmsPickPanel';
import { KioskCompetitionDashboard } from '@/components/kiosk/KioskCompetitionDashboard';
import { KioskHubHeader } from '@/components/kiosk/KioskHubHeader';
import { lmsGetMyParticipant, lmsJoinErrorMessage } from '@/lib/lms/api';
import { f2tJoinErrorMessage } from '@/lib/f2t/api';
import { invalidJoinCodeMessage } from '@/lib/joinCodeMessages';

type Phase =
  | 'loading'
  | 'idle'
  | 'auth'
  | 'payment'
  | 'pick'
  | 'done'
  | 'exit'
  | 'missing';

const IDLE_RETURN_MS = 45_000;

export default function KioskScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { userId, signOut, isLoading: authLoading } = useAuth();
  const [config, setConfig] = useState<KioskDeviceConfig | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [joinRequestId, setJoinRequestId] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'online' | null>(null);
  const [patronUserId, setPatronUserId] = useState<string | null>(null);
  const [exitPin, setExitPin] = useState('');
  const [exitError, setExitError] = useState<string | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const styles = useMemo(() => makeStyles(theme, insets), [theme, insets]);

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const returnToIdle = useCallback(async () => {
    clearIdleTimer();
    setMessage(null);
    setEmail('');
    setPassword('');
    setUsername('');
    setDisplayName('');
    setJoinRequestId(null);
    setPaymentMethod(null);
    setPatronUserId(null);
    setAuthMode('signin');
    setBusy(false);
    if (userId) {
      try {
        await signOut();
      } catch {
        /* ignore */
      }
    }
    setPhase('idle');
  }, [clearIdleTimer, signOut, userId]);

  const scheduleIdleReturn = useCallback(() => {
    clearIdleTimer();
    idleTimerRef.current = setTimeout(() => {
      void returnToIdle();
    }, IDLE_RETURN_MS);
  }, [clearIdleTimer, returnToIdle]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cfg = await getKioskDeviceConfig();
      if (cancelled) return;
      if (!cfg) {
        setConfig(null);
        setPhase('missing');
        return;
      }
      setConfig(cfg);
      setPhase('idle');
    })();
    return () => {
      cancelled = true;
      clearIdleTimer();
    };
  }, [clearIdleTimer]);

  useEffect(() => {
    if (phase === 'done' || phase === 'pick') scheduleIdleReturn();
    return () => clearIdleTimer();
  }, [phase, scheduleIdleReturn, clearIdleTimer]);

  const onPatronAuth = async () => {
    if (!config) return;
    if (!email.trim() || !password) {
      setMessage('Enter email and password.');
      return;
    }
    if (authMode === 'signup') {
      const trimmedUsername = username.trim().toLowerCase().replace(/\s+/g, '');
      if (trimmedUsername.length < 2) {
        setMessage('Choose a username of at least 2 characters.');
        return;
      }
    }
    if (config.sport === 'racing' && authMode === 'signup' && !displayName.trim()) {
      setDisplayName(username.trim() || email.trim().split('@')[0] || 'Player');
    }

    setBusy(true);
    setMessage(null);
    try {
      let activeUserId = userId;
      if (authMode === 'signup') {
        const trimmedUsername = username.trim().toLowerCase().replace(/\s+/g, '');
        const { data: signUpData, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        if (signUpData.user) {
          activeUserId = signUpData.user.id;
          const { error: profileError } = await supabase.from('profiles').insert({
            id: signUpData.user.id,
            username: trimmedUsername,
            updated_at: new Date().toISOString(),
          } as any);
          if (profileError) {
            if (profileError.code === '23505') {
              setMessage('That username is already taken. Try another.');
              return;
            }
            throw profileError;
          }
        }
        // Ensure session for join (email confirm may be off)
        if (!signUpData.session) {
          const { error: signInErr } = await supabase.auth.signInWithPassword({
            email: email.trim(),
            password,
          });
          if (signInErr) throw signInErr;
          const { data: sess } = await supabase.auth.getSession();
          activeUserId = sess.session?.user?.id ?? activeUserId;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        const { data: banned } = await (supabase as any).rpc('is_profile_banned');
        if (banned) {
          await supabase.auth.signOut();
          setMessage('This account is banned and cannot join.');
          return;
        }
        const { data: sess } = await supabase.auth.getSession();
        activeUserId = sess.session?.user?.id ?? null;
      }

      if (!activeUserId) {
        setMessage('Could not start a session. Try signing in again.');
        return;
      }

      // Existing members (incl. eliminated) must not hit the join-code path —
      // after kickoff that returns entries_closed instead of already_in.
      if (config.sport === 'lms') {
        const me = await lmsGetMyParticipant(config.competitionId, activeUserId);
        if (me) {
          setPatronUserId(activeUserId);
          setMessage(null);
          setPhase('pick');
          return;
        }
      }

      const joinRes = await kioskRequestJoin({
        sport: config.sport,
        joinCode: config.joinCode,
        userId: activeUserId,
        displayName:
          displayName.trim() ||
          username.trim() ||
          email.trim().split('@')[0] ||
          'Player',
      });

      if (joinRes.already_in) {
        setPatronUserId(activeUserId);
        setMessage(null);
        setPhase('pick');
        return;
      }

      if (!joinRes.success) {
        const raw = joinRes.error ?? 'Could not submit join request.';
        setMessage(
          config.sport === 'lms'
            ? lmsJoinErrorMessage(raw)
            : config.sport === 'f2t'
              ? f2tJoinErrorMessage(raw)
              : raw === 'invalid_code'
                ? invalidJoinCodeMessage('racing')
                : raw
        );
        return;
      }

      if (!joinRes.join_request_id) {
        setMessage('Join request sent, but payment could not be attached. Ask staff to check the admin panel.');
        setPhase('done');
        return;
      }

      setJoinRequestId(joinRes.join_request_id);
      setPhase('payment');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const onChoosePayment = async (method: 'cash' | 'online') => {
    if (!config || !joinRequestId) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await kioskSetJoinPaymentMethod(joinRequestId, config.sport, method);
      if (!res.success) {
        setMessage(res.error ?? 'Could not save payment choice.');
        return;
      }
      setPaymentMethod(method);
      setPhase('done');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not save payment choice.');
    } finally {
      setBusy(false);
    }
  };

  const onExitConfirm = async () => {
    setExitError(null);
    const ok = await verifyKioskExitPin(exitPin);
    if (!ok) {
      setExitError('Incorrect PIN');
      return;
    }
    await clearKioskDeviceConfig();
    setConfig(null);
    setExitPin('');
    if (userId) await signOut();
    router.replace('/(auth)/login');
  };

  if (phase === 'loading' || authLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={theme.colors.accent} size="large" />
      </View>
    );
  }

  if (phase === 'missing' || !config) {
    return (
      <View style={styles.centered}>
        <Text style={styles.missingTitle}>Hub mode not set up</Text>
        <Text style={styles.missingBody}>
          Use Hub login on the sign-in screen (Gamemaster / Owner) to lock this tablet to a
          competition.
        </Text>
        <Pressable style={styles.primaryBtn} onPress={() => router.replace('/(auth)/login')}>
          <Text style={styles.primaryBtnText}>Go to login</Text>
        </Pressable>
      </View>
    );
  }

  const showDashboard = phase === 'idle';

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.shell, showDashboard ? styles.shellWide : styles.shellNarrow]}>
        {showDashboard ? (
          <KioskHubHeader
            clubName={config.clubName}
            clubLogoUrl={config.clubLogoUrl}
            competitionName={config.competitionName}
            sport={config.sport}
            onStaffExit={() => {
              setExitPin('');
              setExitError(null);
              setPhase('exit');
            }}
          />
        ) : (
          <View style={styles.topBar}>
            <View>
              <Text style={styles.eyebrow}>Competition Hub</Text>
              <Text style={styles.compName}>{config.competitionName}</Text>
              <Text style={styles.compMeta}>{sportLabel(config.sport)}</Text>
            </View>
            {phase !== 'exit' ? (
              <Pressable onPress={() => void returnToIdle()} hitSlop={12}>
                <Text style={styles.cancelLink}>Cancel</Text>
              </Pressable>
            ) : null}
          </View>
        )}

        {config.entryNote && !showDashboard ? (
          <View style={styles.entryBanner}>
            <Text style={styles.entryLabel}>Entry</Text>
            <Text style={styles.entryValue}>{config.entryNote}</Text>
          </View>
        ) : null}

        {showDashboard ? (
          <View style={styles.dashboardWrap}>
            <KioskCompetitionDashboard
              competitionId={config.competitionId}
              sport={config.sport}
              clubName={config.clubName}
              clubLogoUrl={config.clubLogoUrl}
              onClubBranding={(clubName, clubLogoUrl) => {
                setConfig((prev) =>
                  prev
                    ? {
                        ...prev,
                        clubName: clubName ?? prev.clubName,
                        clubLogoUrl: clubLogoUrl ?? prev.clubLogoUrl,
                      }
                    : prev
                );
              }}
              onGetStarted={() => setPhase('auth')}
            />
          </View>
        ) : (
          <ScrollView
            style={styles.formScroll}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            {phase === 'idle' ? (
              <View style={styles.idleBlock}>
                <Text style={styles.idleTitle}>Join or make your pick</Text>
                <Text style={styles.idleBody}>
                  New players: create an account to request a place (staff confirm once payment
                  is sorted). Already in? Sign in to see or lock in your next selection.
                </Text>
                <Pressable style={styles.primaryBtn} onPress={() => setPhase('auth')}>
                  <Text style={styles.primaryBtnText}>Get started</Text>
                </Pressable>
              </View>
            ) : null}

            {phase === 'auth' ? (
              <View style={styles.formBlock}>
                <View style={styles.modeRow}>
                  <Pressable
                    style={[styles.modeChip, authMode === 'signin' && styles.modeChipActive]}
                    onPress={() => setAuthMode('signin')}
                  >
                    <Text
                      style={[
                        styles.modeChipText,
                        authMode === 'signin' && styles.modeChipTextActive,
                      ]}
                    >
                      Sign in
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[styles.modeChip, authMode === 'signup' && styles.modeChipActive]}
                    onPress={() => setAuthMode('signup')}
                  >
                    <Text
                      style={[
                        styles.modeChipText,
                        authMode === 'signup' && styles.modeChipTextActive,
                      ]}
                    >
                      Sign up
                    </Text>
                  </Pressable>
                </View>

                <TextInput
                  style={styles.input}
                  placeholder="Email"
                  placeholderTextColor={theme.colors.textMuted}
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  editable={!busy}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Password"
                  placeholderTextColor={theme.colors.textMuted}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  editable={!busy}
                />
                {authMode === 'signup' ? (
                  <TextInput
                    style={styles.input}
                    placeholder="Username"
                    placeholderTextColor={theme.colors.textMuted}
                    value={username}
                    onChangeText={setUsername}
                    autoCapitalize="none"
                    editable={!busy}
                  />
                ) : null}
                {config.sport === 'racing' ? (
                  <TextInput
                    style={styles.input}
                    placeholder="Display name (leaderboard)"
                    placeholderTextColor={theme.colors.textMuted}
                    value={displayName}
                    onChangeText={setDisplayName}
                    editable={!busy}
                  />
                ) : null}

                {message && phase === 'auth' ? (
                  <Text style={styles.errorText}>{message}</Text>
                ) : null}

                <Pressable
                  style={[styles.primaryBtn, busy && styles.primaryBtnDisabled]}
                  disabled={busy}
                  onPress={() => void onPatronAuth()}
                >
                  {busy ? (
                    <ActivityIndicator color={theme.colors.white} />
                  ) : (
                    <Text style={styles.primaryBtnText}>
                      {authMode === 'signup' ? 'Create account & join' : 'Sign in'}
                    </Text>
                  )}
                </Pressable>
              </View>
            ) : null}

            {phase === 'pick' && patronUserId && config.sport === 'lms' ? (
              <KioskLmsPickPanel
                competitionId={config.competitionId}
                userId={patronUserId}
                onActivity={scheduleIdleReturn}
                onFinished={() => void returnToIdle()}
              />
            ) : null}

            {phase === 'pick' && patronUserId && config.sport !== 'lms' ? (
              <View style={styles.formBlock}>
                <View style={styles.doneIcon}>
                  <Ionicons name="checkmark-circle" size={48} color={theme.colors.accent} />
                </View>
                <Text style={styles.idleTitle}>You&apos;re already in</Text>
                <Text style={styles.idleBody}>
                  You&apos;re in {config.competitionName}. Hub pick entry for{' '}
                  {sportLabel(config.sport)} is coming soon — use your own phone or ask staff to
                  open the competition for you.
                </Text>
                <Pressable style={styles.secondaryBtn} onPress={() => void returnToIdle()}>
                  <Text style={styles.secondaryBtnText}>Done</Text>
                </Pressable>
              </View>
            ) : null}

            {phase === 'payment' ? (
              <View style={styles.formBlock}>
                <Text style={styles.idleTitle}>How are you paying?</Text>
                <Text style={styles.idleBody}>
                  Top Tipster does not take the entry fee. Choose how you will pay the club or
                  venue, then wait for staff to confirm you in.
                </Text>

                <Pressable
                  style={[styles.payCard, busy && styles.primaryBtnDisabled]}
                  disabled={busy}
                  onPress={() => void onChoosePayment('cash')}
                >
                  <Text style={styles.payTitle}>Cash at collection point</Text>
                  <Text style={styles.payBody}>
                    Hand the entry to the bar or club person in charge. They will approve your
                    request in the app once paid.
                  </Text>
                </Pressable>

                <Pressable
                  style={[styles.payCard, busy && styles.primaryBtnDisabled]}
                  disabled={busy}
                  onPress={() => void onChoosePayment('online')}
                >
                  <Text style={styles.payTitle}>Pay online</Text>
                  <Text style={styles.payBody}>
                    Open the club payment / charity page, pay there, then come back. Staff will
                    confirm once they see the payment.
                  </Text>
                </Pressable>

                {config.fundraiserPaymentUrl ? (
                  <Pressable
                    style={styles.linkBtn}
                    onPress={() => void Linking.openURL(config.fundraiserPaymentUrl!)}
                  >
                    <Text style={styles.linkBtnText}>Open payment page</Text>
                  </Pressable>
                ) : (
                  <Text style={styles.muted}>
                    No online payment link is set for this competition — ask staff for the QR or
                    link.
                  </Text>
                )}

                {message ? <Text style={styles.errorText}>{message}</Text> : null}
              </View>
            ) : null}

            {phase === 'done' ? (
              <View style={styles.formBlock}>
                <View style={styles.doneIcon}>
                  <Ionicons name="checkmark-circle" size={48} color={theme.colors.accent} />
                </View>
                <Text style={styles.idleTitle}>You&apos;re on the list</Text>
                {paymentMethod === 'cash' ? (
                  <Text style={styles.idleBody}>
                    Next: pay cash at the collection point. Once staff confirm payment, you will
                    be accepted into {config.competitionName}.
                  </Text>
                ) : paymentMethod === 'online' ? (
                  <Text style={styles.idleBody}>
                    Next: complete payment on the club page if you have not already. Staff will
                    approve your entry when payment is confirmed.
                  </Text>
                ) : (
                  <Text style={styles.idleBody}>
                    Your request is with the organiser. This screen returns to the home page
                    shortly.
                  </Text>
                )}
                {message ? <Text style={styles.muted}>{message}</Text> : null}
                <Pressable style={styles.secondaryBtn} onPress={() => void returnToIdle()}>
                  <Text style={styles.secondaryBtnText}>Done</Text>
                </Pressable>
              </View>
            ) : null}

            {phase === 'exit' ? (
              <View style={styles.formBlock}>
                <Text style={styles.idleTitle}>Staff exit</Text>
                <Text style={styles.idleBody}>Enter the 4-digit PIN to leave hub mode.</Text>
                <TextInput
                  style={styles.input}
                  value={exitPin}
                  onChangeText={(t) => setExitPin(t.replace(/\D/g, '').slice(0, 4))}
                  placeholder="••••"
                  placeholderTextColor={theme.colors.textMuted}
                  keyboardType="number-pad"
                  secureTextEntry
                  maxLength={4}
                />
                {exitError ? <Text style={styles.errorText}>{exitError}</Text> : null}
                <Pressable style={styles.primaryBtn} onPress={() => void onExitConfirm()}>
                  <Text style={styles.primaryBtnText}>Exit hub mode</Text>
                </Pressable>
                <Pressable style={styles.secondaryBtn} onPress={() => setPhase('idle')}>
                  <Text style={styles.secondaryBtnText}>Cancel</Text>
                </Pressable>
              </View>
            ) : null}
          </ScrollView>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

function makeStyles(
  theme: ReturnType<typeof useTheme>,
  insets: { top: number; bottom: number }
) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    shell: {
      flex: 1,
      width: '100%',
      alignSelf: 'center',
    },
    shellNarrow: {
      paddingHorizontal: theme.spacing.lg,
      paddingTop: insets.top + theme.spacing.md,
      paddingBottom: insets.bottom + theme.spacing.md,
      gap: theme.spacing.sm,
      maxWidth: 720,
    },
    shellWide: {
      paddingHorizontal: 12,
      paddingTop: insets.top + 8,
      paddingBottom: insets.bottom + 8,
      gap: 8,
      maxWidth: 9999,
    },
    dashboardWrap: {
      flex: 1,
      minHeight: 0,
      width: '100%',
    },
    formScroll: {
      flex: 1,
    },
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.background,
      padding: theme.spacing.lg,
      gap: theme.spacing.md,
    },
    content: {
      gap: theme.spacing.md,
      flexGrow: 1,
      paddingBottom: theme.spacing.lg,
    },
    topBar: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: theme.spacing.md,
    },
    eyebrow: {
      fontFamily: theme.fontFamily.baiSemiBold,
      fontSize: 13,
      letterSpacing: 1,
      textTransform: 'uppercase',
      color: theme.colors.accent,
    },
    compName: {
      fontFamily: theme.fontFamily.baiBold,
      fontSize: 28,
      color: theme.colors.text,
      marginTop: 2,
    },
    compMeta: {
      fontFamily: theme.fontFamily.baiLight,
      fontSize: 15,
      color: theme.colors.textMuted,
      marginTop: 2,
    },
    cancelLink: {
      fontFamily: theme.fontFamily.baiSemiBold,
      fontSize: 14,
      color: theme.colors.textMuted,
    },
    entryBanner: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      padding: theme.spacing.md,
      gap: 4,
    },
    entryLabel: {
      fontFamily: theme.fontFamily.baiSemiBold,
      fontSize: 11,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      color: theme.colors.textMuted,
    },
    entryValue: {
      fontFamily: theme.fontFamily.baiSemiBold,
      fontSize: 16,
      color: theme.colors.text,
    },
    idleBlock: {
      marginTop: theme.spacing.xl,
      gap: theme.spacing.md,
      flexGrow: 1,
      justifyContent: 'center',
    },
    idleTitle: {
      fontFamily: theme.fontFamily.baiBold,
      fontSize: 24,
      color: theme.colors.text,
    },
    idleBody: {
      fontFamily: theme.fontFamily.baiLight,
      fontSize: 16,
      lineHeight: 24,
      color: theme.colors.textSecondary,
    },
    formBlock: {
      gap: theme.spacing.sm,
      marginTop: theme.spacing.md,
    },
    modeRow: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 8,
    },
    modeChip: {
      paddingVertical: 8,
      paddingHorizontal: 14,
      borderRadius: theme.radius.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
    },
    modeChipActive: {
      borderColor: theme.colors.accent,
      backgroundColor: theme.colors.accentMuted,
    },
    modeChipText: {
      fontFamily: theme.fontFamily.baiSemiBold,
      fontSize: 14,
      color: theme.colors.textMuted,
    },
    modeChipTextActive: {
      color: theme.colors.accent,
    },
    input: {
      backgroundColor: theme.colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.md,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: Platform.OS === 'web' ? 14 : 12,
      fontFamily: theme.fontFamily.input,
      fontSize: 17,
      color: theme.colors.text,
    },
    primaryBtn: {
      marginTop: theme.spacing.sm,
      backgroundColor: theme.colors.accent,
      borderRadius: theme.radius.md,
      paddingVertical: 16,
      alignItems: 'center',
    },
    primaryBtnDisabled: {
      opacity: 0.55,
    },
    primaryBtnText: {
      fontFamily: theme.fontFamily.baiBold,
      fontSize: 17,
      color: theme.colors.white,
    },
    secondaryBtn: {
      marginTop: 8,
      borderRadius: theme.radius.md,
      paddingVertical: 14,
      alignItems: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
    },
    secondaryBtnText: {
      fontFamily: theme.fontFamily.baiSemiBold,
      fontSize: 15,
      color: theme.colors.textSecondary,
    },
    payCard: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      padding: theme.spacing.md,
      gap: 6,
      marginTop: 4,
    },
    payTitle: {
      fontFamily: theme.fontFamily.baiBold,
      fontSize: 17,
      color: theme.colors.text,
    },
    payBody: {
      fontFamily: theme.fontFamily.baiLight,
      fontSize: 14,
      lineHeight: 20,
      color: theme.colors.textSecondary,
    },
    linkBtn: {
      alignSelf: 'flex-start',
      paddingVertical: 10,
    },
    linkBtnText: {
      fontFamily: theme.fontFamily.baiSemiBold,
      fontSize: 15,
      color: theme.colors.accent,
      textDecorationLine: 'underline',
    },
    muted: {
      fontFamily: theme.fontFamily.baiLight,
      fontSize: 13,
      color: theme.colors.textMuted,
      lineHeight: 18,
    },
    errorText: {
      fontFamily: theme.fontFamily.baiSemiBold,
      fontSize: 14,
      color: theme.colors.error,
    },
    doneIcon: {
      alignItems: 'center',
      marginBottom: 4,
    },
    missingTitle: {
      fontFamily: theme.fontFamily.baiBold,
      fontSize: 22,
      color: theme.colors.text,
      textAlign: 'center',
    },
    missingBody: {
      fontFamily: theme.fontFamily.baiLight,
      fontSize: 15,
      color: theme.colors.textSecondary,
      textAlign: 'center',
      lineHeight: 22,
      maxWidth: 420,
    },
  });
}
