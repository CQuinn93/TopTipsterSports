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
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';
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
import { F2tAdminPanel } from '@/components/f2t/F2tAdminPanel';
import { AdBanner } from '@/components/ads/AdBanner';
import {
  f2tGetCompetition,
  f2tListSelectablePlayers,
  f2tSubmitSelections,
  f2tUseSubstitution,
  type F2tSelectablePlayer,
  type F2tSelectionRow,
} from '@/lib/f2t/api';
import {
  f2tSessionGetPlayers,
  f2tSessionInvalidatePlayers,
  f2tSessionSetPlayers,
} from '@/lib/f2t/sessionCache';

type TabKey = 'team' | 'leaderboard' | 'admin';

export default function F2tCompetitionScreen() {
  const theme = useTheme();
  const { openSidebar } = useSidebar();
  const insets = useSafeAreaInsets();
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
  const [scoredCount, setScoredCount] = useState(0);
  const [unscoredCount, setUnscoredCount] = useState(0);
  const [selectionCount, setSelectionCount] = useState(0);
  const [selectionsLocked, setSelectionsLocked] = useState(false);
  const [participantStatus, setParticipantStatus] = useState<string | null>(null);
  const [subEligible, setSubEligible] = useState(false);
  const [regularSubUsed, setRegularSubUsed] = useState(false);
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
    setSubOutId(null);
    setPickerOpen(true);
  };

  const openSubPicker = (outId: string) => {
    setSubMode(true);
    setSubOutId(outId);
    setPickedIds([]);
    setPickerOpen(true);
  };

  const submitPicks = useCallback(
    async (pickedIds: string[]) => {
      if (!competitionId) return;
      setSubmitting(true);
      try {
        if (subMode && subOutId) {
          const inId = pickedIds[0];
          if (!inId) {
            Alert.alert('Substitution', 'Choose a replacement player.');
            return;
          }
          const flaggedOut = selections.find((s) => s.player_id === subOutId)?.owner_flagged;
          const type = flaggedOut ? 'owner_flag' : 'regular';
          const res = await f2tUseSubstitution(competitionId, subOutId, inId, type);
          if (!res.success) {
            Alert.alert('Substitution failed', res.error ?? 'Could not substitute');
            return;
          }
        } else {
          if (pickedIds.length !== 20) {
            Alert.alert('Selections', 'Pick exactly 20 players.');
            return;
          }
          const res = await f2tSubmitSelections(competitionId, pickedIds);
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
    [competitionId, subMode, subOutId, selections, load]
  );

  const canPick = !selectionsLocked;
  const canRegularSub = subEligible && !regularSubUsed;
  const deadlinePassed = deadlineAt
    ? Date.now() >= new Date(deadlineAt).getTime()
    : false;
  const competitionStarted = deadlinePassed || status === 'active' || status === 'completed';
  const playersRemaining =
    participantStatus != null ? Math.max(0, unscoredCount) : null;
  const freeTransferPlayers = selections.filter((s) => s.owner_flagged && !s.scored_at);
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
      openSubPicker(freeTransferPlayers[0].player_id);
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
                onSubstitute={openSubPicker}
              />
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

      <F2tPlayerPicker
        visible={pickerOpen}
        title={subMode ? 'Choose replacement' : 'Pick 20 players'}
        players={players}
        loading={playersLoading}
        initialSelectedIds={pickedIds}
        submitting={submitting}
        subMode={subMode}
        outPlayer={
          subMode && subOutId
            ? selections.find((s) => s.player_id === subOutId) ?? null
            : null
        }
        onClose={() => setPickerOpen(false)}
        onSubmit={submitPicks}
      />
    </View>
  );
}
