import { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Image,
  Modal,
  ScrollView,
  Platform,
  KeyboardAvoidingView,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { pickClubLogoImage, uploadClubLogo } from '@/lib/clubLogoStorage';
import { gamemasterCompleteSetup } from '@/lib/subscriptionEntitlements';
import { BrandLogo } from '@/components/BrandLogo';
import {
  gamemasterListMyQuotes,
  gamemasterRespondToQuote,
  type GamemasterQuote,
} from '@/lib/gamemasterApi';
import {
  FOOTBALL_MODE_OPTIONS,
  formatEuro,
  LMS_CONTINUATION_OPTIONS,
  TIPSTER20_CONTINUATION_OPTIONS,
} from '@/lib/gamemasterCustomPricing';

type Props = {
  visible: boolean;
  onComplete: () => void;
};

type Step = 'welcome' | 'club' | 'quote' | 'done';

export function GamemasterWelcomeSetupModal({ visible, onComplete }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { userId } = useAuth();
  const styles = useMemo(() => makeStyles(theme, insets), [theme, insets]);

  const [step, setStep] = useState<Step>('welcome');
  const [username, setUsername] = useState('there');
  const [clubName, setClubName] = useState('');
  const [paymentUrl, setPaymentUrl] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [onboardingQuote, setOnboardingQuote] = useState<GamemasterQuote | null>(null);
  const [editNotes, setEditNotes] = useState('');
  const [showEditForm, setShowEditForm] = useState(false);
  const [doneMessage, setDoneMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingQuote, setLoadingQuote] = useState(false);
  const [refreshingStatus, setRefreshingStatus] = useState(false);
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !userId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from('profiles')
          .select('username')
          .eq('id', userId)
          .maybeSingle();
        if (!cancelled) {
          const name = (data as { username?: string | null } | null)?.username?.trim();
          setUsername(name || 'there');
        }
      } catch {
        if (!cancelled) setUsername('there');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, userId]);

  useEffect(() => {
    if (!visible) return;
    setStep('welcome');
    setShowEditForm(false);
    setEditNotes('');
    setError(null);
    setDoneMessage('');
    setPaymentConfirmed(false);
  }, [visible]);

  const loadOnboardingQuote = async () => {
    setLoadingQuote(true);
    setError(null);
    try {
      const list = await gamemasterListMyQuotes();
      const onboarding =
        list.find((q) => q.kind === 'onboarding' && q.status === 'pending_payment') ??
        list.find((q) => q.kind === 'onboarding') ??
        list.find((q) => q.status === 'pending_payment') ??
        null;
      setOnboardingQuote(onboarding);
    } catch {
      setOnboardingQuote(null);
    } finally {
      setLoadingQuote(false);
    }
  };

  const onPickLogo = async () => {
    if (!userId) return;
    setBusy(true);
    setError(null);
    try {
      const picked = await pickClubLogoImage();
      if (!picked) return;
      const url = await uploadClubLogo({
        userId,
        uri: picked.uri,
        mimeType: picked.mimeType,
        fileName: picked.fileName,
      });
      setLogoUrl(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not upload logo');
    } finally {
      setBusy(false);
    }
  };

  const goToClub = () => {
    setError(null);
    setStep('club');
  };

  const goToQuote = async () => {
    if (!clubName.trim()) {
      setError('Enter your club name.');
      return;
    }
    if (!logoUrl) {
      setError('Upload your club logo to continue.');
      return;
    }
    const pay = paymentUrl.trim();
    if (pay && !/^https?:\/\//i.test(pay)) {
      setError('Payment link must start with http:// or https://');
      return;
    }
    setError(null);
    setStep('quote');
    await loadOnboardingQuote();
  };

  const finishClubSetup = async () => {
    const pay = paymentUrl.trim();
    const res = await gamemasterCompleteSetup({
      clubName: clubName.trim(),
      clubLogoUrl: logoUrl,
      clubPaymentUrl: pay || null,
    });
    if (!res.success) {
      throw new Error(
        res.error === 'club_name_required'
          ? 'Club name is required.'
          : res.error === 'club_logo_required'
            ? 'Upload your club logo to continue.'
            : res.error === 'invalid_payment_url'
              ? 'Payment link must be a valid http(s) URL.'
              : res.error ?? 'Could not finish club setup'
      );
    }
  };

  const onAcceptQuote = async () => {
    setBusy(true);
    setError(null);
    try {
      await finishClubSetup();
      if (onboardingQuote?.id) {
        const res = await gamemasterRespondToQuote({
          quoteId: onboardingQuote.id,
          action: 'accept',
        });
        if (!res.success) {
          throw new Error(
            res.error === 'quote_not_awaiting_response'
              ? 'This quote is no longer awaiting a response.'
              : res.error ?? 'Could not accept quote'
          );
        }
      }
      setDoneMessage(
        'Quote accepted. Thanks — payment isn’t handled in the app yet. Once your club owner confirms payment, pull to refresh or tap Check status to unlock competitions.'
      );
      setStep('done');
      setPaymentConfirmed(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not accept quote');
    } finally {
      setBusy(false);
    }
  };

  const onRequestEdit = async () => {
    if (!editNotes.trim()) {
      setError('Tell us what you’d like changed on the quote.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await finishClubSetup();
      if (onboardingQuote?.id) {
        const res = await gamemasterRespondToQuote({
          quoteId: onboardingQuote.id,
          action: 'request_edit',
          notes: editNotes.trim(),
        });
        if (!res.success) {
          throw new Error(
            res.error === 'edit_notes_required'
              ? 'Tell us what you’d like changed.'
              : res.error ?? 'Could not send edit request'
          );
        }
      }
      setDoneMessage(
        'Your edit request has been sent. Club setup is complete — check Quotes for updates once a revised package is ready.'
      );
      setStep('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send edit request');
    } finally {
      setBusy(false);
    }
  };

  const checkPaymentStatus = async () => {
    setRefreshingStatus(true);
    setError(null);
    try {
      const list = await gamemasterListMyQuotes();
      const paid = list.find((q) => q.status === 'paid_active' || q.status === 'paid_complete');
      if (paid) {
        setPaymentConfirmed(true);
        setDoneMessage(
          'Payment confirmed. Your package is active — you can create competitions from the Competitions tab.'
        );
        return;
      }
      setPaymentConfirmed(false);
      setDoneMessage(
        'Still waiting on payment confirmation from your club owner. Pull down to refresh, or tap Check status.'
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not check payment status');
    } finally {
      setRefreshingStatus(false);
    }
  };

  const onCloseDone = () => {
    onComplete();
  };

  const quoteSummaryLines = useMemo(() => {
    if (!onboardingQuote) return [];
    return onboardingQuote.payload.competitions.map((c, i) => {
      const mode =
        FOOTBALL_MODE_OPTIONS.find((m) => m.key === c.footballMode)?.label ?? c.footballMode;
      const cont =
        c.footballMode === 'lms'
          ? LMS_CONTINUATION_OPTIONS.find((o) => o.key === c.lmsContinuation)?.label
          : TIPSTER20_CONTINUATION_OPTIONS.find((o) => o.key === c.tipster20Continuation)?.label;
      return {
        key: c.id || `comp-${i}`,
        title: `${mode} · cap ${c.maxPlayers}`,
        meta: cont ?? '—',
      };
    });
  }, [onboardingQuote]);

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.backdrop}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            bounces={step === 'done'}
            refreshControl={
              step === 'done' && !paymentConfirmed ? (
                <RefreshControl
                  refreshing={refreshingStatus}
                  onRefresh={() => void checkPaymentStatus()}
                  tintColor={theme.colors.accent}
                  colors={[theme.colors.accent]}
                />
              ) : undefined
            }
          >
            <View style={styles.card}>
              {step === 'welcome' ? (
                <>
                  <BrandLogo size={64} style={{ alignSelf: 'center', marginBottom: 4 }} />
                  <Text style={styles.welcomeTitle}>Welcome {username}</Text>
                  <Text style={styles.heroLine}>
                    You have been promoted to{' '}
                    <Text style={styles.heroAccent}>GAMEMASTER</Text>
                  </Text>
                  <Text style={styles.body}>
                    You have received a quote for the game you were looking to create and it can
                    be found in your Quotes. Simply go through this and see if everything you need
                    is included.
                  </Text>
                  <Text style={styles.note}>
                    Note — Additional Competition hubs can be requested later if needed.
                  </Text>
                  <Pressable style={styles.primaryBtn} onPress={goToClub}>
                    <Text style={styles.primaryBtnText}>Continue</Text>
                  </Pressable>
                </>
              ) : null}

              {step === 'club' ? (
                <>
                  <BrandLogo size={40} style={{ alignSelf: 'center' }} />
                  <Text style={styles.formTitle}>Set up your club</Text>
                  <Text style={styles.body}>
                    Add your club name and logo. Payment link is optional — use an external page
                    where your club can accept money. Top Tipster never takes the payment.
                  </Text>

                  <Text style={styles.label}>Club name</Text>
                  <TextInput
                    style={styles.input}
                    value={clubName}
                    onChangeText={setClubName}
                    placeholder="e.g. Riverside FC"
                    placeholderTextColor={theme.colors.textMuted}
                    editable={!busy}
                  />

                  <Text style={styles.label}>Club logo</Text>
                  <View style={styles.logoRow}>
                    {logoUrl ? (
                      <Image source={{ uri: logoUrl }} style={styles.logo} resizeMode="contain" />
                    ) : (
                      <View style={[styles.logo, styles.logoEmpty]}>
                        <Text style={styles.logoEmptyText}>Logo</Text>
                      </View>
                    )}
                    <Pressable
                      style={[styles.secondaryBtn, busy && styles.disabled]}
                      disabled={busy}
                      onPress={() => void onPickLogo()}
                    >
                      <Text style={styles.secondaryBtnText}>
                        {logoUrl ? 'Replace logo' : 'Upload logo'}
                      </Text>
                    </Pressable>
                  </View>

                  <Text style={styles.label}>Payment link (optional)</Text>
                  <TextInput
                    style={styles.input}
                    value={paymentUrl}
                    onChangeText={setPaymentUrl}
                    placeholder="https://…"
                    placeholderTextColor={theme.colors.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    editable={!busy}
                  />

                  {error ? <Text style={styles.error}>{error}</Text> : null}

                  <Pressable
                    style={[styles.primaryBtn, busy && styles.disabled]}
                    disabled={busy}
                    onPress={() => void goToQuote()}
                  >
                    {busy ? (
                      <ActivityIndicator color={theme.colors.white} />
                    ) : (
                      <Text style={styles.primaryBtnText}>Continue</Text>
                    )}
                  </Pressable>
                </>
              ) : null}

              {step === 'quote' ? (
                <>
                  <BrandLogo size={40} style={{ alignSelf: 'center' }} />
                  <Text style={styles.formTitle}>Your onboarding quote</Text>
                  <Text style={styles.body}>
                    Review the package below. Accept it to proceed toward payment, or request an
                    edit if something’s missing.
                  </Text>

                  {loadingQuote ? (
                    <ActivityIndicator color={theme.colors.accent} style={{ marginVertical: 16 }} />
                  ) : onboardingQuote ? (
                    <View style={styles.quoteBox}>
                      {quoteSummaryLines.map((line) => (
                        <View key={line.key} style={styles.quoteLine}>
                          <Text style={styles.quoteLineTitle}>{line.title}</Text>
                          <Text style={styles.quoteLineMeta}>{line.meta}</Text>
                        </View>
                      ))}
                      {onboardingQuote.payload.competitionHubs > 0 ? (
                        <Text style={styles.quoteLineMeta}>
                          Competition hubs: {onboardingQuote.payload.competitionHubs}
                        </Text>
                      ) : null}
                      {onboardingQuote.payload.includeFestivalPass ? (
                        <Text style={styles.quoteLineMeta}>Festival pass included</Text>
                      ) : null}
                      <View style={styles.quoteTotals}>
                        {onboardingQuote.season_total != null ? (
                          <View style={styles.totalRow}>
                            <Text style={styles.totalLabel}>League bill</Text>
                            <Text style={styles.totalValue}>
                              {formatEuro(Number(onboardingQuote.season_total))}
                            </Text>
                          </View>
                        ) : null}
                        {onboardingQuote.due_today != null ? (
                          <View style={styles.totalRow}>
                            <Text style={styles.totalLabelStrong}>Due today</Text>
                            <Text style={styles.totalValueStrong}>
                              {formatEuro(Number(onboardingQuote.due_today))}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                  ) : (
                    <Text style={styles.body}>
                      No onboarding quote was found yet. You can still finish setup and check
                      Quotes later, or request an edit from the owner.
                    </Text>
                  )}

                  {showEditForm ? (
                    <>
                      <Text style={styles.label}>What would you like changed?</Text>
                      <TextInput
                        style={[styles.input, styles.textArea]}
                        value={editNotes}
                        onChangeText={setEditNotes}
                        placeholder="e.g. Add a second LMS with 100-player cap"
                        placeholderTextColor={theme.colors.textMuted}
                        multiline
                        editable={!busy}
                      />
                      {error ? <Text style={styles.error}>{error}</Text> : null}
                      <Pressable
                        style={[styles.primaryBtn, busy && styles.disabled]}
                        disabled={busy}
                        onPress={() => void onRequestEdit()}
                      >
                        {busy ? (
                          <ActivityIndicator color={theme.colors.white} />
                        ) : (
                          <Text style={styles.primaryBtnText}>Send edit request</Text>
                        )}
                      </Pressable>
                      <Pressable
                        style={styles.textBtn}
                        disabled={busy}
                        onPress={() => {
                          setShowEditForm(false);
                          setError(null);
                        }}
                      >
                        <Text style={styles.textBtnLabel}>Back</Text>
                      </Pressable>
                    </>
                  ) : (
                    <>
                      {error ? <Text style={styles.error}>{error}</Text> : null}
                      <Pressable
                        style={[styles.primaryBtn, busy && styles.disabled]}
                        disabled={busy}
                        onPress={() => void onAcceptQuote()}
                      >
                        {busy ? (
                          <ActivityIndicator color={theme.colors.white} />
                        ) : (
                          <Text style={styles.primaryBtnText}>Accept quote</Text>
                        )}
                      </Pressable>
                      <Pressable
                        style={[styles.secondaryBtnWide, busy && styles.disabled]}
                        disabled={busy}
                        onPress={() => {
                          setShowEditForm(true);
                          setError(null);
                        }}
                      >
                        <Text style={styles.secondaryBtnText}>Request to edit</Text>
                      </Pressable>
                    </>
                  )}
                </>
              ) : null}

              {step === 'done' ? (
                <>
                  <BrandLogo size={56} style={{ alignSelf: 'center', marginBottom: 4 }} />
                  <Text style={styles.welcomeTitle}>
                    {paymentConfirmed ? 'You’re ready' : 'You’re set'}
                  </Text>
                  <Text style={styles.body}>{doneMessage}</Text>
                  {error ? <Text style={styles.error}>{error}</Text> : null}
                  {!paymentConfirmed ? (
                    <Pressable
                      style={[styles.secondaryBtn, (busy || refreshingStatus) && styles.disabled]}
                      onPress={() => void checkPaymentStatus()}
                      disabled={busy || refreshingStatus}
                    >
                      {refreshingStatus ? (
                        <ActivityIndicator color={theme.colors.accent} />
                      ) : (
                        <Text style={styles.secondaryBtnText}>Check status</Text>
                      )}
                    </Pressable>
                  ) : null}
                  <Pressable style={styles.primaryBtn} onPress={onCloseDone}>
                    <Text style={styles.primaryBtnText}>
                      {paymentConfirmed ? 'Continue' : 'Close'}
                    </Text>
                  </Pressable>
                </>
              ) : null}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function makeStyles(
  theme: ReturnType<typeof useTheme>,
  insets: { top: number; bottom: number }
) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.72)',
      justifyContent: 'center',
    },
    flex: { flex: 1 },
    scrollContent: {
      flexGrow: 1,
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.lg,
      paddingTop: insets.top + theme.spacing.md,
      paddingBottom: insets.bottom + theme.spacing.md,
    },
    card: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      padding: theme.spacing.lg,
      maxWidth: 460,
      width: '100%',
      alignSelf: 'center',
      gap: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
    },
    brand: {
      fontFamily: theme.fontFamily.baiBold,
      fontSize: 12,
      letterSpacing: 3,
      color: theme.colors.textMuted,
      textAlign: 'center',
      marginBottom: 4,
    },
    welcomeTitle: {
      fontFamily: theme.fontFamily.baiBold,
      fontSize: 26,
      color: theme.colors.text,
      textAlign: 'center',
    },
    heroLine: {
      fontFamily: theme.fontFamily.baiLight,
      fontSize: 16,
      lineHeight: 24,
      color: theme.colors.textSecondary,
      textAlign: 'center',
    },
    heroAccent: {
      fontFamily: theme.fontFamily.baiBold,
      color: theme.colors.accent,
      letterSpacing: 1,
    },
    body: {
      fontFamily: theme.fontFamily.baiLight,
      fontSize: 15,
      lineHeight: 22,
      color: theme.colors.textSecondary,
      textAlign: 'center',
    },
    note: {
      fontFamily: theme.fontFamily.baiSemiBold,
      fontSize: 13,
      lineHeight: 19,
      color: theme.colors.textMuted,
      textAlign: 'center',
      marginTop: 4,
    },
    formTitle: {
      fontFamily: theme.fontFamily.baiBold,
      fontSize: 22,
      color: theme.colors.text,
      textAlign: 'center',
    },
    label: {
      fontFamily: theme.fontFamily.baiSemiBold,
      fontSize: 11,
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      color: theme.colors.textMuted,
      marginTop: 8,
      alignSelf: 'stretch',
    },
    input: {
      alignSelf: 'stretch',
      backgroundColor: theme.colors.background,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.md,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: Platform.OS === 'web' ? 12 : 11,
      fontFamily: theme.fontFamily.input,
      fontSize: 16,
      color: theme.colors.text,
    },
    textArea: {
      minHeight: 88,
      textAlignVertical: 'top',
    },
    logoRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      alignSelf: 'stretch',
    },
    logo: {
      width: 72,
      height: 72,
      borderRadius: 14,
      backgroundColor: theme.colors.background,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
    },
    logoEmpty: { alignItems: 'center', justifyContent: 'center' },
    logoEmptyText: {
      fontFamily: theme.fontFamily.baiLight,
      fontSize: 12,
      color: theme.colors.textMuted,
    },
    quoteBox: {
      alignSelf: 'stretch',
      marginTop: 6,
      padding: 12,
      borderRadius: theme.radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.background,
      gap: 8,
    },
    quoteLine: { gap: 2 },
    quoteLineTitle: {
      fontFamily: theme.fontFamily.baiSemiBold,
      fontSize: 14,
      color: theme.colors.text,
    },
    quoteLineMeta: {
      fontFamily: theme.fontFamily.baiLight,
      fontSize: 12,
      color: theme.colors.textMuted,
    },
    quoteTotals: {
      marginTop: 6,
      paddingTop: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border,
      gap: 4,
    },
    totalRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 12,
    },
    totalLabel: {
      fontFamily: theme.fontFamily.baiLight,
      fontSize: 13,
      color: theme.colors.textSecondary,
    },
    totalValue: {
      fontFamily: theme.fontFamily.baiSemiBold,
      fontSize: 13,
      color: theme.colors.text,
    },
    totalLabelStrong: {
      fontFamily: theme.fontFamily.baiBold,
      fontSize: 15,
      color: theme.colors.text,
    },
    totalValueStrong: {
      fontFamily: theme.fontFamily.baiBold,
      fontSize: 18,
      color: theme.colors.accent,
    },
    primaryBtn: {
      marginTop: 12,
      backgroundColor: theme.colors.accent,
      borderRadius: theme.radius.md,
      paddingVertical: 14,
      alignItems: 'center',
      alignSelf: 'stretch',
    },
    primaryBtnText: {
      fontFamily: theme.fontFamily.baiBold,
      fontSize: 16,
      color: theme.colors.white,
    },
    secondaryBtn: {
      borderRadius: theme.radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      paddingVertical: 12,
      paddingHorizontal: 14,
    },
    secondaryBtnWide: {
      marginTop: 8,
      borderRadius: theme.radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      paddingVertical: 13,
      alignItems: 'center',
      alignSelf: 'stretch',
    },
    secondaryBtnText: {
      fontFamily: theme.fontFamily.baiSemiBold,
      fontSize: 14,
      color: theme.colors.textSecondary,
    },
    textBtn: {
      marginTop: 4,
      paddingVertical: 10,
      alignItems: 'center',
    },
    textBtnLabel: {
      fontFamily: theme.fontFamily.baiSemiBold,
      fontSize: 14,
      color: theme.colors.textMuted,
    },
    disabled: { opacity: 0.55 },
    error: {
      fontFamily: theme.fontFamily.baiSemiBold,
      fontSize: 14,
      color: theme.colors.error,
      alignSelf: 'stretch',
      marginTop: 4,
    },
  });
}
