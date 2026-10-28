import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { FundraiserForClub } from '@/components/FundraiserForClub';
import {
  fetchCompetitionsFundraiserBranding,
  fundraiserKey,
  type FundraiserBranding,
} from '@/lib/fundraiserBranding';
import {
  fetchMyEntitlements,
  fetchCompetitionCapacity,
  isGamemasterAccount,
} from '@/lib/subscriptionEntitlements';
import { useSidebar } from '@/contexts/SidebarContext';
import { PlayerProgressGrid } from '@/components/f2t/PlayerProgressGrid';
import { F2tPlayerPicker } from '@/components/f2t/F2tPlayerPicker';
import { F2tWelcomeModal } from '@/components/f2t/F2tWelcomeModal';
import { F2tAdminPanel } from '@/components/f2t/F2tAdminPanel';
import { AdBanner } from '@/components/ads/AdBanner';
import {
  f2tGetCompetition,
  f2tListSelectablePlayers,
  f2tSubmitSelections,
  f2tUseSubstitution,
  type F2tSelectablePlayer,
  type F2tSelectionRow,
  type F2tShootoutRow,
} from '@/lib/f2t/api';
import {
  f2tSessionGetPlayers,
  f2tSessionInvalidatePlayers,
  f2tSessionSetPlayers,
} from '@/lib/f2t/sessionCache';

function f2tWelcomeStorageKey(userId: string, competitionId: string) {
  return `f2t_welcome_seen:${userId}:${competitionId}`;
}

type TabKey = 'team' | 'leaderboard' | 'admin';

export default function F2tCompetitionScreen() {
  const theme = useTheme();
  const { openSidebar } = useSidebar();
  const insets = useSafeAreaInsets();
  const { userId } = useAuth();
  const params = useLocalSearchParams<{ competitionId: string }>();
  const competitionId = String(params.competitionId ?? '');

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<TabKey>('team');
  const [name, setName] = useState('');
  const [fundraiser, setFundraiser] = useState<FundraiserBranding | null>(null);
  const [status, setStatus] = useState('');
  const [startGw, setStartGw] = useState<number | null>(null);
  const [deadlineAt, setDeadlineAt] = useState<string | null>(null);
  const [selections, setSelections] = useState<F2tSelectionRow[]>([]);
  const [shootouts, setShootouts] = useState<F2tShootoutRow[]>([]);
  const [difficultySum, setDifficultySum] = useState<number | null>(null);
  const [scoredCount, setScoredCount] = useState(0);
  const [unscoredCount, setUnscoredCount] = useState(0);
  const [selectionCount, setSelectionCount] = useState(0);
  const [selectionsLocked, setSelectionsLocked] = useState(false);
  const [participantStatus, setParticipantStatus] = useState<string | null>(null);
  const [subEligible, setSubEligible] = useState(false);
  const [regularSubUsed, setRegularSubUsed] = useState(false);
  const [subFromShootout, setSubFromShootout] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [leaderboard, setLeaderboard] = useState<
    Array<{
      user_id: string;
      username: string | null;
      status: string;
      scored_count: number;
      completed_at: string | null;
    }>
  >([]);
  const [canManage, setCanManage] = useState(false);
  const [canHandleJoins, setCanHandleJoins] = useState(false);
  const [isGamemasterAdmin, setIsGamemasterAdmin] = useState(false);
  const [signedUpCount, setSignedUpCount] = useState(0);
  const [quotaMax, setQuotaMax] = useState<number | null>(null);
  const [isCompManager, setIsCompManager] = useState(false);
  const [entry, setEntry] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [players, setPlayers] = useState<F2tSelectablePlayer[]>([]);
  const [playersLoading, setPlayersLoading] = useState(false);
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [subMode, setSubMode] = useState(false);
  const [subOutId, setSubOutId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!competitionId) return;
    try {
      const data = await f2tGetCompetition(competitionId);
      if (!data.success || !data.competition) {
        Alert.alert('Error', data.error ?? 'Competition not found');
        router.replace('/(f2t)' as any);
        return;
      }
      setName(data.competition.name);
      try {
        const branding = await fetchCompetitionsFundraiserBranding([
          { sport: 'f2t', competition_id: competitionId },
        ]);
        setFundraiser(branding[fundraiserKey('f2t', competitionId)] ?? null);
      } catch {
        setFundraiser(null);
      }
      setStatus(data.competition.status);
      setStartGw(data.competition.start_gameweek_number);
      setDeadlineAt(data.competition.start_gameweek_deadline ?? null);
      setSelections(data.selections ?? []);
      setShootouts(data.shootouts ?? []);
      setDifficultySum(
        typeof data.participant?.difficulty_sum === 'number'
          ? data.participant.difficulty_sum
          : null
      );
      setScoredCount(data.participant?.scored_count ?? 0);
      setUnscoredCount(
        data.participant?.unscored_count ??
          (data.selections ?? []).filter((s) => !s.scored_at).length
      );
      setSelectionCount(data.participant?.selection_count ?? 0);
      setParticipantStatus(data.participant?.status ?? null);
      // Match submit RPC: active participant can pick while competition is open/active
      // and before the start-GW deadline (count of 20 does not lock edits early).
      const partActive = data.participant?.status === 'active';
      const compDone = data.competition.status === 'completed';
      const deadlinePassed = data.competition.start_gameweek_deadline
        ? Date.now() >= new Date(data.competition.start_gameweek_deadline).getTime()
        : false;
      setSelectionsLocked(!partActive || compDone || deadlinePassed);
      setSubEligible(data.participant?.sub_eligible_regular ?? false);
      setRegularSubUsed(data.participant?.regular_sub_used ?? false);
      setLeaderboard(data.leaderboard ?? []);
      setCanManage(data.permissions?.can_manage ?? false);
      setCanHandleJoins(data.permissions?.can_handle_joins ?? false);
      setIsCompManager(data.permissions?.is_manager ?? false);
      const ent = await fetchMyEntitlements().catch(() => null);
      const gmAdmin = isGamemasterAccount(ent) && !!(data.permissions?.can_handle_joins);
      setIsGamemasterAdmin(gmAdmin);
      if (gmAdmin) {
        setTab('admin');
        try {
          const cap = await fetchCompetitionCapacity('f2t', competitionId);
          setSignedUpCount(cap.currentParticipants);
          setQuotaMax(cap.maxParticipants);
        } catch {
          setSignedUpCount((data.leaderboard ?? []).length);
          setQuotaMax(null);
        }
      } else {
        setIsGamemasterAdmin(false);
      }
      setEntry(data.competition.entry ?? null);
      const code =
        typeof data.competition.join_code === 'string'
          ? data.competition.join_code.trim()
          : null;
      setJoinCode(code || null);
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [competitionId]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load])
  );

  const loadPlayers = useCallback(async () => {
    if (!competitionId) return;
    setPlayersLoading(true);
    try {
      const cached = f2tSessionGetPlayers(competitionId);
      if (cached) {
        setPlayers(cached);
        return;
      }
      const list = await f2tListSelectablePlayers(competitionId);
      f2tSessionSetPlayers(competitionId, list);
      setPlayers(list);
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to load players');
      setPlayers([]);
    } finally {
      setPlayersLoading(false);
    }
  }, [competitionId]);

  useEffect(() => {
    if (pickerOpen) void loadPlayers();
  }, [pickerOpen, loadPlayers]);

  const openPicker = () => {
    const existing = selections.map((s) => s.player_id);
    setPickedIds(existing);
    setSubMode(false);
    setSubFromShootout(false);
    setSubOutId(null);
    setPickerOpen(true);
  };

  const openSubPicker = (outId: string, fromShootout = false) => {
    setSubMode(true);
    setSubFromShootout(fromShootout);
    setSubOutId(outId);
    setPickedIds([]);
    setPickerOpen(true);
  };

  const allSquadPlayerIds = useMemo(
    () => [...selections.map((s) => s.player_id), ...shootouts.map((s) => s.player_id)],
    [selections, shootouts]
  );

  const submitPicks = useCallback(
    async (pickedIds: string[], shootoutIds?: string[]) => {
      if (!competitionId) return;
      setSubmitting(true);
      try {
        if (subMode && subOutId) {
          const inId = pickedIds[0];
          if (!inId) {
            Alert.alert('Substitution', 'Choose a replacement player.');
            return;
          }
          const flaggedOut = subFromShootout
            ? shootouts.find((s) => s.player_id === subOutId)?.owner_flagged
            : selections.find((s) => s.player_id === subOutId)?.owner_flagged;
          if (subFromShootout && !flaggedOut) {
            Alert.alert(
              'Substitution',
              'Shootout players can only be replaced when they are flagged.'
            );
            return;
          }
          const type = flaggedOut || subFromShootout ? 'owner_flag' : 'regular';
          const res = await f2tUseSubstitution(competitionId, subOutId, inId, type);
          if (!res.success) {
            const err = res.error ?? 'Could not substitute';
            Alert.alert(
              'Substitution failed',
              err === 'in_player_already_selected'
                ? 'That player is already in your squad. Choose someone else.'
                : err === 'shootout_requires_flag'
                  ? 'Shootout players can only be replaced when flagged.'
                  : err
            );
            return;
          }
        } else {
          if (pickedIds.length !== 20) {
            Alert.alert('Selections', 'Pick exactly 20 players.');
            return;
          }
          if (!shootoutIds || shootoutIds.length !== 3) {
            Alert.alert('Shootout', 'Choose exactly 3 shootout players (ranks 1, 2 and 3).');
            return;
          }
          const res = await f2tSubmitSelections(competitionId, pickedIds, shootoutIds);
          if (!res.success) {
            Alert.alert('Submit failed', res.error ?? 'Could not save selections');
            return;
          }
        }
        setPickerOpen(false);
        f2tSessionInvalidatePlayers(competitionId);
        await load();
      } catch (e) {
        Alert.alert('Error', e instanceof Error ? e.message : 'Save failed');
      } finally {
        setSubmitting(false);
      }
    },
    [competitionId, subMode, subOutId, subFromShootout, selections, shootouts, load]
  );

  const canPick = !selectionsLocked;
  const canRegularSub = subEligible && !regularSubUsed;
  const deadlinePassed = deadlineAt
    ? Date.now() >= new Date(deadlineAt).getTime()
    : false;
  const competitionStarted = deadlinePassed || status === 'active' || status === 'completed';
  const playersRemaining =
    participantStatus != null ? Math.max(0, unscoredCount) : null;
  const freeTransferPlayers = [
    ...selections.filter((s) => s.owner_flagged && !s.scored_at),
    ...shootouts.filter((s) => s.owner_flagged && !s.scored_at),
  ];
  const freeTransfersLeft = freeTransferPlayers.length;
  const regularSubsLeft = regularSubUsed ? 0 : 1;
  // Regular sub unlocks after 3 completed GWs from start GW inclusive → after GW (start+2).
  const subOpensAfterGw = startGw != null ? startGw + 2 : null;

  const statusLabel = (s: string | null) => {
    if (!s) return 'Observing';
    if (s === 'active') return 'In play';
    if (s === 'winner') return 'Champion';
    if (s === 'eliminated') return 'Eliminated';
    return s;
  };

  const statusColor = (s: string | null) => {
    if (s === 'active' || s === 'winner') return theme.colors.accent;
    if (s === 'eliminated') return theme.colors.error;
    return theme.colors.textMuted;
  };

  const bannerMeta = (() => {
    if (status === 'completed') return 'Competition completed';
    if (!deadlinePassed && deadlineAt) {
      const label = new Date(deadlineAt).toLocaleString(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
      return startGw != null ? `Starts GW${startGw} · picks until ${label}` : `Picks until ${label}`;
    }
    if (startGw != null) return `Started GW${startGw}`;
    return status || 'Competition';
  })();

  const onPressRegularSubCard = () => {
    if (!canRegularSub) {
      if (regularSubUsed) {
        Alert.alert('Substitution', 'You have already used your regular substitution.');
      } else if (subOpensAfterGw != null) {
        Alert.alert(
          'Substitution',
          `Regular substitutions open after GW${subOpensAfterGw} is complete (and you must have more than 3 unscored players).`
        );
      }
      return;
    }
    Alert.alert(
      'Make substitution',
      'Choose an unscored player on your squad below, then pick a replacement.'
    );
  };

  const onPressFreeTransferCard = () => {
    if (freeTransfersLeft <= 0) {
      Alert.alert(
        'Free transfers',
        'Free transfers appear when a selected player is flagged injured or unavailable by the organiser.'
      );
      return;
    }
    if (freeTransferPlayers.length === 1) {
      const only = freeTransferPlayers[0];
      const fromSo = shootouts.some((s) => s.player_id === only.player_id);
      openSubPicker(only.player_id, fromSo);
      return;
    }
    Alert.alert(
      'Free transfers',
      'Tap Free substitute on a flagged player card below to choose a replacement.'
    );
  };

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: { flex: 1, backgroundColor: theme.colors.background },
        header: {
          paddingTop: insets.top + theme.spacing.sm,
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: theme.spacing.sm,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.md,
        },
        backBtn: { padding: 4 },
        titleBlock: { flex: 1 },
        title: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 18,
          color: theme.colors.text,
        },
        subtitle: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 12,
          color: theme.colors.textMuted,
        },
        survivalBanner: {
          marginHorizontal: theme.spacing.lg,
          marginBottom: theme.spacing.md,
          paddingVertical: theme.spacing.md,
          paddingHorizontal: theme.spacing.lg,
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: theme.spacing.md,
        },
        survivalLeft: { flex: 1, gap: 4 },
        survivalStatus: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 16,
        },
        survivalMeta: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 12,
          color: theme.colors.textMuted,
        },
        survivalStat: { alignItems: 'flex-end' },
        survivalStatValue: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 22,
          color: theme.colors.text,
        },
        survivalStatLabel: {
          fontFamily: theme.fontFamily.baiExtraLight,
          fontSize: 11,
          color: theme.colors.textMuted,
          textTransform: 'uppercase',
          letterSpacing: 0.8,
        },
        tabs: {
          flexDirection: 'row',
          marginHorizontal: theme.spacing.lg,
          marginBottom: theme.spacing.md,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.border,
        },
        tab: {
          flex: 1,
          paddingVertical: 12,
          alignItems: 'center',
          borderBottomWidth: 2,
          borderBottomColor: 'transparent',
        },
        tabActive: {
          borderBottomColor: theme.colors.accent,
        },
        tabText: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: canHandleJoins ? 12 : 13,
          color: theme.colors.textMuted,
        },
        tabTextActive: {
          color: theme.colors.accent,
        },
        content: {
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: insets.bottom + theme.spacing.xl,
          gap: theme.spacing.md,
        },
        primaryBtn: {
          backgroundColor: theme.colors.accent,
          borderRadius: theme.radius.md,
          paddingVertical: 12,
          alignItems: 'center',
        },
        primaryBtnText: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 14,
          color: theme.colors.white,
        },
        lockedNote: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 13,
          color: theme.colors.textMuted,
          lineHeight: 18,
        },
        actionRow: {
          flexDirection: 'row',
          gap: theme.spacing.sm,
        },
        actionCard: {
          flex: 1,
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          paddingVertical: theme.spacing.md,
          paddingHorizontal: theme.spacing.md,
          gap: 6,
          minHeight: 112,
        },
        actionCardActive: {
          borderColor: theme.colors.accent,
          backgroundColor: theme.colors.accentMuted,
        },
        actionCardLocked: {
          opacity: 0.48,
        },
        actionCardHeader: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        },
        actionCardTitle: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 13,
          color: theme.colors.text,
          flex: 1,
        },
        actionCardValue: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 22,
          color: theme.colors.text,
        },
        actionCardValueAccent: {
          color: theme.colors.accent,
        },
        actionCardMeta: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 11,
          color: theme.colors.textMuted,
          lineHeight: 15,
        },
        sectionLabel: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 11,
          letterSpacing: 0.8,
          textTransform: 'uppercase',
          color: theme.colors.textMuted,
          marginTop: theme.spacing.xs,
        },
        shootoutHint: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 12,
          color: theme.colors.textMuted,
          lineHeight: 17,
        },
        shootoutEmpty: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 13,
          color: theme.colors.textMuted,
        },
        shootoutList: { gap: theme.spacing.sm },
        shootoutCard: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.sm,
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          paddingVertical: theme.spacing.sm,
          paddingHorizontal: theme.spacing.md,
        },
        shootoutCardScored: {
          borderColor: theme.colors.accent,
          backgroundColor: theme.colors.accentMuted,
        },
        shootoutMain: { flex: 1, minWidth: 0, gap: 2 },
        shootoutRank: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 10,
          letterSpacing: 0.3,
          textTransform: 'uppercase',
          color: theme.colors.accent,
        },
        shootoutName: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 14,
          color: theme.colors.text,
        },
        shootoutMeta: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 11,
          color: theme.colors.textMuted,
        },
        shootoutSubBtn: {
          flexShrink: 0,
          paddingVertical: 4,
          paddingHorizontal: 8,
          borderRadius: theme.radius.sm,
          borderWidth: 1,
          borderColor: theme.colors.accent,
        },
        shootoutSubBtnText: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 11,
          color: theme.colors.accent,
        },
        lbRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.sm,
          paddingVertical: 10,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.border,
        },
        lbRank: {
          width: 28,
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 14,
          color: theme.colors.textMuted,
        },
        lbName: {
          flex: 1,
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 15,
          color: theme.colors.text,
        },
        lbScore: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 14,
          color: theme.colors.accent,
        },
      }),
    [theme, insets, canHandleJoins]
  );

  const tabItems = (
    isGamemasterAdmin
      ? ([{ key: 'admin' as const, label: 'Admin' }] as { key: TabKey; label: string }[])
      : ([
          { key: 'team' as const, label: 'Team' },
          { key: 'leaderboard' as const, label: 'Standings' },
          ...(canHandleJoins ? [{ key: 'admin' as const, label: 'Admin' }] : []),
        ] as { key: TabKey; label: string }[])
  );

  useEffect(() => {
    if (isGamemasterAdmin && tab !== 'admin') setTab('admin');
  }, [isGamemasterAdmin, tab]);

  useEffect(() => {
    if (loading || !userId || !competitionId) return;
    // Welcome players who have joined; skip pure organiser/admin-only views.
    if (!participantStatus) return;
    if (isGamemasterAdmin) return;

    let cancelled = false;
    void (async () => {
      try {
        const key = f2tWelcomeStorageKey(userId, competitionId);
        const seen = await AsyncStorage.getItem(key);
        if (!cancelled && !seen) setWelcomeOpen(true);
      } catch {
        // Ignore storage failures — don't block the competition screen.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, userId, competitionId, participantStatus, isGamemasterAdmin]);

  const dismissWelcome = useCallback(async () => {
    setWelcomeOpen(false);
    if (!userId || !competitionId) return;
    try {
      await AsyncStorage.setItem(f2tWelcomeStorageKey(userId, competitionId), '1');
    } catch {
      // ignore
    }
  }, [userId, competitionId]);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.text} />
        </Pressable>
        <View style={styles.titleBlock}>
          <Text style={styles.title} numberOfLines={1}>{name}</Text>
        </View>
        <Pressable onPress={openSidebar} hitSlop={12}>
          <Ionicons name="menu" size={24} color={theme.colors.text} />
        </Pressable>
      </View>

      {fundraiser ? (
        <View style={{ paddingHorizontal: theme.spacing.md, paddingBottom: 8 }}>
          <FundraiserForClub
            clubName={fundraiser.club_name}
            clubLogoUrl={fundraiser.club_logo_url}
            size="header"
          />
        </View>
      ) : null}

      {!loading ? (
        <View style={styles.survivalBanner}>
          <View style={styles.survivalLeft}>
            <Text
              style={[
                styles.survivalStatus,
                { color: isGamemasterAdmin ? theme.colors.accent : statusColor(participantStatus) },
              ]}
            >
              {isGamemasterAdmin ? 'Admin' : statusLabel(participantStatus)}
            </Text>
            <Text style={styles.survivalMeta}>
              {isGamemasterAdmin ? 'Club competition management' : bannerMeta}
            </Text>
          </View>
          <View style={styles.survivalStat}>
            <Text style={styles.survivalStatValue}>
              {isGamemasterAdmin
                ? quotaMax != null
                  ? `${signedUpCount}/${quotaMax}`
                  : `${signedUpCount}`
                : playersRemaining != null
                  ? playersRemaining
                  : '—'}
            </Text>
            <Text style={styles.survivalStatLabel}>
              {isGamemasterAdmin ? 'Signed up' : 'Remaining Goalscorers'}
            </Text>
          </View>
        </View>
      ) : null}

      {!isGamemasterAdmin ? (
        <View style={styles.tabs}>
          {tabItems.map((t) => (
            <Pressable
              key={t.key}
              style={[styles.tab, tab === t.key && styles.tabActive]}
              onPress={() => setTab(t.key)}
            >
              <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>
                {t.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={theme.colors.accent} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load();
              }}
              tintColor={theme.colors.accent}
            />
          }
        >
          {tab === 'team' ? (
            <>
              {canPick ? (
                <Pressable style={styles.primaryBtn} onPress={openPicker}>
                  <Text style={styles.primaryBtnText}>
                    {selectionCount > 0 ? 'Edit selections' : 'Pick 20 players'}
                  </Text>
                </Pressable>
              ) : (
                <Text style={styles.lockedNote}>
                  {selectionCount >= 20
                    ? competitionStarted
                      ? 'Selections are locked. Use Substitution or Free Transfers below when available.'
                      : 'Your 20 players are locked in.'
                    : competitionStarted
                      ? 'Selections are closed for this league.'
                      : 'Selections are not available for this league.'}
                </Text>
              )}
              {canPick && selectionCount > 0 && selectionCount < 20 ? (
                <Text style={styles.subtitle}>
                  {selectionCount}/20 selected — choose {20 - selectionCount} more to submit.
                </Text>
              ) : null}

              <View style={styles.actionRow}>
                <Pressable
                  style={[
                    styles.actionCard,
                    canRegularSub && styles.actionCardActive,
                    !canRegularSub && styles.actionCardLocked,
                  ]}
                  onPress={onPressRegularSubCard}
                >
                  <View style={styles.actionCardHeader}>
                    <Text style={styles.actionCardTitle}>Substitution</Text>
                    <Ionicons
                      name="swap-horizontal"
                      size={18}
                      color={canRegularSub ? theme.colors.accent : theme.colors.textMuted}
                    />
                  </View>
                  <Text
                    style={[
                      styles.actionCardValue,
                      canRegularSub && styles.actionCardValueAccent,
                    ]}
                  >
                    {regularSubsLeft}
                  </Text>
                  <Text style={styles.actionCardMeta}>
                    {regularSubUsed
                      ? 'Used for this competition'
                      : canRegularSub
                        ? 'Available — pick a player below'
                        : subOpensAfterGw != null
                          ? `Opens after GW${subOpensAfterGw}`
                          : 'Opens after 3 completed gameweeks'}
                  </Text>
                </Pressable>

                <Pressable
                  style={[
                    styles.actionCard,
                    freeTransfersLeft > 0 && styles.actionCardActive,
                    freeTransfersLeft <= 0 && styles.actionCardLocked,
                  ]}
                  onPress={onPressFreeTransferCard}
                >
                  <View style={styles.actionCardHeader}>
                    <Text style={styles.actionCardTitle}>Free transfers</Text>
                    <Ionicons
                      name="medkit-outline"
                      size={18}
                      color={
                        freeTransfersLeft > 0 ? theme.colors.accent : theme.colors.textMuted
                      }
                    />
                  </View>
                  <Text
                    style={[
                      styles.actionCardValue,
                      freeTransfersLeft > 0 && styles.actionCardValueAccent,
                    ]}
                  >
                    {freeTransfersLeft}
                  </Text>
                  <Text style={styles.actionCardMeta}>
                    {freeTransfersLeft > 0
                      ? freeTransfersLeft === 1
                        ? '1 flagged player ready to replace'
                        : `${freeTransfersLeft} flagged players ready to replace`
                      : 'For injured / flagged players'}
                  </Text>
                </Pressable>
              </View>

              <Text style={styles.sectionLabel}>Your squad</Text>
              <PlayerProgressGrid
                selections={selections}
                scoredCount={scoredCount}
                canRegularSub={canRegularSub}
                onSubstitute={(id) => openSubPicker(id, false)}
              />

              <Text style={styles.sectionLabel}>Shootout (private)</Text>
              <Text style={styles.shootoutHint}>
                Only you can see these. Used if more than one tipster reaches 20 — rank 1 first,
                then 2, then 3. After that, team difficulty
                {difficultySum != null ? ` (yours: ${difficultySum})` : ''} decides, then split pot.
              </Text>
              {shootouts.length === 0 ? (
                <Text style={styles.shootoutEmpty}>
                  {canPick
                    ? 'Add 3 shootout players when you save your 20.'
                    : 'No shootout picks locked in.'}
                </Text>
              ) : (
                <View style={styles.shootoutList}>
                  {shootouts.map((row) => {
                    const scored = Boolean(row.scored_at);
                    const canFreeSub = !scored && row.owner_flagged;
                    return (
                      <View
                        key={row.shootout_rank}
                        style={[styles.shootoutCard, scored && styles.shootoutCardScored]}
                      >
                        <View style={styles.shootoutMain}>
                          <Text style={styles.shootoutRank}>SO{row.shootout_rank}</Text>
                          <Text style={styles.shootoutName} numberOfLines={1}>
                            {row.display_name}
                          </Text>
                          <Text style={styles.shootoutMeta}>
                            {row.team_short_name}
                            {scored
                              ? row.scored_gameweek_number != null
                                ? ` · Scored GW${row.scored_gameweek_number}`
                                : ' · Scored'
                              : row.owner_flagged
                                ? ' · Flagged'
                                : ''}
                          </Text>
                        </View>
                        {canFreeSub ? (
                          <Pressable
                            style={styles.shootoutSubBtn}
                            onPress={() => openSubPicker(row.player_id, true)}
                          >
                            <Text style={styles.shootoutSubBtnText}>Free substitute</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              )}
            </>
          ) : null}

          {tab === 'leaderboard' ? (
            leaderboard.map((row, idx) => (
              <View key={row.user_id} style={styles.lbRow}>
                <Text style={styles.lbRank}>{idx + 1}</Text>
                <Text style={styles.lbName}>{row.username?.trim() || row.user_id.slice(0, 8)}</Text>
                <Text style={styles.lbScore}>{row.scored_count}/20</Text>
              </View>
            ))
          ) : null}

          {tab === 'admin' && canHandleJoins ? (
            <F2tAdminPanel
              competitionId={competitionId}
              canManage={canManage}
              isCompManager={isCompManager}
              entry={entry}
              competitionName={name}
              initialJoinCode={joinCode}
              onEntrySaved={setEntry}
            />
          ) : null}
        </ScrollView>
      )}

      <AdBanner placement="t20" />

      <F2tWelcomeModal
        visible={welcomeOpen}
        competitionName={name}
        onContinue={() => void dismissWelcome()}
        onOpenHowItWorks={() => {
          void dismissWelcome();
          router.push('/(f2t)/how-it-works' as any);
        }}
        onOpenRules={() => {
          void dismissWelcome();
          router.push('/(f2t)/rules' as any);
        }}
      />

      <F2tPlayerPicker
        visible={pickerOpen}
        title={subMode ? 'Choose replacement' : 'Pick 20 players'}
        players={players}
        loading={playersLoading}
        initialSelectedIds={pickedIds}
        initialShootoutIds={shootouts
          .slice()
          .sort((a, b) => a.shootout_rank - b.shootout_rank)
          .map((s) => s.player_id)}
        submitting={submitting}
        subMode={subMode}
        squadPlayerIds={allSquadPlayerIds}
        outPlayer={
          subMode && subOutId
            ? subFromShootout
              ? shootouts.find((s) => s.player_id === subOutId) ?? null
              : selections.find((s) => s.player_id === subOutId) ?? null
            : null
        }
        onClose={() => setPickerOpen(false)}
        onSubmit={submitPicks}
      />
    </View>
  );
}
