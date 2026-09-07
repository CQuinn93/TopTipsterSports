import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';
import { useSidebar } from '@/contexts/SidebarContext';
import { useAuth } from '@/contexts/AuthContext';
import { FootballNextUpSpotlight } from '@/components/lms/FootballNextUpSpotlight';
import { GoalscorersPanel } from '@/components/f2t/GoalscorersPanel';
import { LmsTrademarkDisclaimer } from '@/components/lms/LmsTrademarkDisclaimer';
import { AdBanner } from '@/components/ads/AdBanner';
import { RewardedAdPrompt } from '@/components/ads/RewardedAdPrompt';
import { AD_UNLOCK_KEYS, isAdUnlockActive } from '@/lib/ads/sessionUnlock';
import { useShowAds } from '@/lib/ads/useShowAds';
import {
  f2tCreateCompetition,
  f2tGetHome,
  f2tJoinErrorMessage,
  f2tRequestJoin,
  type F2tCompetitionHomeSummary,
  type F2tPendingJoin,
} from '@/lib/f2t/api';
import { lmsListGameweeks, type LmsGameweek } from '@/lib/lms/api';
import { canCreateCompetitions } from '@/lib/adminSession';
import { confirmJoinLimitDisclaimer } from '@/lib/joinLimitDisclaimer';
import { isFootballCompetitionRegistering } from '@/lib/appUtils';
import { FundraiserForClub } from '@/components/FundraiserForClub';
import {
  fetchCompetitionsFundraiserBranding,
  fundraiserKey,
  type FundraiserBranding,
} from '@/lib/fundraiserBranding';

type HomeTab = 'competitions' | 'join' | 'goalscorers';
const F2T_SEASON = '2026/27';
const MANUAL_REFRESH_COOLDOWN_MS = 60_000;

export default function F2tHomeScreen() {
  const theme = useTheme();
  const { openSidebar } = useSidebar();
  const insets = useSafeAreaInsets();
  const { userId } = useAuth();
  const { showAds } = useShowAds();
  const [goalscorersUnlocked, setGoalscorersUnlocked] = useState(() =>
    isAdUnlockActive(AD_UNLOCK_KEYS.t20Goalscorers)
  );
  const [goalscorersPromptVisible, setGoalscorersPromptVisible] = useState(false);
  const { tab: tabParam, create: createParam, quoteId: quoteIdParam } = useLocalSearchParams<{
    tab?: string;
    create?: string;
    quoteId?: string;
  }>();
  const gamemasterQuoteId =
    typeof quoteIdParam === 'string' && quoteIdParam.trim() ? quoteIdParam.trim() : null;

  const [comps, setComps] = useState<F2tCompetitionHomeSummary[]>([]);
  const [fundraiserByComp, setFundraiserByComp] = useState<Record<string, FundraiserBranding>>({});
  const [pending, setPending] = useState<F2tPendingJoin[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<HomeTab>('competitions');
  const [tableRefreshKey, setTableRefreshKey] = useState(0);
  const [spotlightRefreshKey, setSpotlightRefreshKey] = useState(0);
  const [homePanelExpanded, setHomePanelExpanded] = useState(true);
  const [code, setCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [isStaff, setIsStaff] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createEntry, setCreateEntry] = useState('');
  const [createGwId, setCreateGwId] = useState<string | null>(null);
  const [createGws, setCreateGws] = useState<LmsGameweek[]>([]);
  const [creating, setCreating] = useState(false);

  const homeLoadedRef = useRef(false);
  const lastManualRefreshAtRef = useRef<number | null>(null);
  const loadRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    if (tabParam === 'goalscorers' || tabParam === 'table') {
      setTab('goalscorers');
    } else if (tabParam === 'join' || tabParam === 'competitions') {
      setTab(tabParam);
    }
  }, [tabParam]);

  useEffect(() => {
    if (createParam === '1' || createParam === 'true') {
      setTab('competitions');
      setShowCreate(true);
    }
  }, [createParam]);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const data = await f2tGetHome(F2T_SEASON);
      setComps(data.competitions ?? []);
      setPending(data.pending ?? []);
      try {
        const branding = await fetchCompetitionsFundraiserBranding(
          (data.competitions ?? []).map((c) => ({
            sport: 'f2t' as const,
            competition_id: c.competition_id,
          }))
        );
        setFundraiserByComp(branding);
      } catch {
        setFundraiserByComp({});
      }
      setTab((prev) => {
        if (tabParam === 'goalscorers' || tabParam === 'table') {
          return 'goalscorers';
        }
        if (tabParam === 'join' || tabParam === 'competitions') {
          return tabParam;
        }
        if (prev === 'join' || prev === 'goalscorers') return prev;
        return (data.competitions?.length ?? 0) === 0 && (data.pending?.length ?? 0) === 0
          ? 'join'
          : 'competitions';
      });

      const staff = await canCreateCompetitions(userId);
      setIsStaff(staff);

      const gws = await lmsListGameweeks(F2T_SEASON);
      setCreateGws(gws);
      const defaultGw =
        gws.find((g) => g.status !== 'complete')?.id ?? gws[0]?.id ?? null;
      setCreateGwId((prev) => prev ?? defaultGw);
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to load');
      setComps([]);
      setPending([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId, tabParam]);

  loadRef.current = load;

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      if (homeLoadedRef.current) return;
      homeLoadedRef.current = true;
      void loadRef.current();
    }, [userId])
  );

  const requestManualRefresh = useCallback(() => {
    if (refreshing || loading) return;
    const now = Date.now();
    const last = lastManualRefreshAtRef.current;
    if (last != null && now - last < MANUAL_REFRESH_COOLDOWN_MS) {
      const waitSec = Math.ceil((MANUAL_REFRESH_COOLDOWN_MS - (now - last)) / 1000);
      Alert.alert('Slow down', `You can refresh again in ${waitSec}s.`);
      return;
    }
    lastManualRefreshAtRef.current = now;
    setRefreshing(true);
    if (tab === 'goalscorers') setTableRefreshKey((k) => k + 1);
    setSpotlightRefreshKey((k) => k + 1);
    void load();
  }, [refreshing, loading, tab, load]);

  const onJoin = async () => {
    if (!code.trim()) {
      Alert.alert('Competition code', 'Enter the competition code to join.');
      return;
    }
    const confirmed = await confirmJoinLimitDisclaimer(code);
    if (!confirmed) return;

    setJoining(true);
    try {
      const res = await f2tRequestJoin(code);
      if (!res.success) {
        Alert.alert('Join failed', f2tJoinErrorMessage(res.error));
        return;
      }
      setCode('');
      const compName = res.competition_name?.trim() || 'the competition';
      const msg =
        `You have requested to join ${compName}. ` +
        'An admin will approve your request before you can pick players.';
      if (Platform.OS === 'web' && typeof window !== 'undefined') window.alert(msg);
      else Alert.alert('Request sent', msg);
      await load();
      setTab('competitions');
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Join failed');
    } finally {
      setJoining(false);
    }
  };

  const onCreate = async () => {
    if (!createName.trim()) {
      Alert.alert('Name required', 'Enter a competition name.');
      return;
    }
    if (!createGwId) {
      Alert.alert('Starting week required', 'Choose a starting gameweek.');
      return;
    }
    setCreating(true);
    try {
      const res = await f2tCreateCompetition(
        createName.trim(),
        createGwId,
        F2T_SEASON,
        createEntry.trim() || undefined,
        gamemasterQuoteId ? { gamemasterQuoteId } : undefined
      );
      if (!res.success) {
        Alert.alert('Failed', res.error ?? 'Could not create competition');
        return;
      }
      setCreateName('');
      setCreateEntry('');
      setShowCreate(false);
      Alert.alert('Created', `Join code: ${res.access_code ?? '—'}`);
      await load();
      if (res.competition_id) router.push(`/(f2t)/${res.competition_id}` as any);
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Create failed');
    } finally {
      setCreating(false);
    }
  };

  const statusLabel = (status: string) => {
    if (status === 'active') return 'In play';
    if (status === 'winner') return 'Winner';
    if (status === 'completed') return 'Finished';
    if (status === 'observer') return 'Admin access';
    return status;
  };

  const seasonOpenGw = useMemo(
    () => createGws.find((g) => g.status !== 'complete') ?? null,
    [createGws]
  );

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: { flex: 1, backgroundColor: theme.colors.background },
        header: {
          paddingTop:
            Platform.OS === 'web'
              ? Math.max(theme.spacing.md, insets.top + 6)
              : insets.top + theme.spacing.sm,
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: theme.spacing.sm,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.md,
        },
        back: { padding: 4 },
        titleBlock: { flex: 1 },
        headerRefresh: {
          padding: 6,
          minWidth: 36,
          alignItems: 'center',
          justifyContent: 'center',
        },
        title: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 20,
          color: theme.colors.text,
        },
        sub: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 13,
          color: theme.colors.accent,
          marginTop: 2,
        },
        mainScroll: { flex: 1 },
        mainScrollContent: {
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: insets.bottom + theme.spacing.xl,
          gap: theme.spacing.md,
          flexGrow: 1,
        },
        homePanel: {
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.lg,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          overflow: 'hidden',
        },
        homePanelTabsRow: {
          flexDirection: 'row',
          alignItems: 'stretch',
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.border,
          backgroundColor: theme.colors.surface,
        },
        homePanelCollapseBtn: {
          paddingHorizontal: 10,
          alignItems: 'center',
          justifyContent: 'center',
          borderLeftWidth: StyleSheet.hairlineWidth,
          borderLeftColor: theme.colors.border,
        },
        panelBody: {
          paddingHorizontal: theme.spacing.md,
          paddingTop: theme.spacing.md,
          paddingBottom: theme.spacing.md,
          gap: theme.spacing.lg,
        },
        tabs: {
          flex: 1,
          flexDirection: 'row',
          backgroundColor: theme.colors.surface,
        },
        tab: {
          flex: 1,
          paddingVertical: 11,
          paddingHorizontal: 2,
          alignItems: 'center',
          borderBottomWidth: 2,
          borderBottomColor: 'transparent',
        },
        tabActive: { borderBottomColor: theme.colors.accent },
        tabCollapsedActive: { borderBottomColor: 'transparent' },
        tabText: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 12,
          color: theme.colors.textMuted,
          textAlign: 'center',
        },
        tabTextActive: { color: theme.colors.accent },
        sectionLabel: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 11,
          letterSpacing: 1.1,
          textTransform: 'uppercase',
          color: theme.colors.textMuted,
          marginBottom: 8,
        },
        joinRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        },
        input: {
          flex: 1,
          fontFamily: theme.fontFamily.input,
          fontSize: 14,
          color: theme.colors.text,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.sm,
          paddingHorizontal: 12,
          paddingVertical: 8,
          letterSpacing: 1.5,
          textTransform: 'uppercase',
          backgroundColor: theme.colors.surface,
        },
        joinBtn: {
          backgroundColor: theme.colors.accent,
          borderRadius: theme.radius.sm,
          paddingVertical: 9,
          paddingHorizontal: 14,
          minWidth: 72,
          alignItems: 'center',
        },
        joinBtnText: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 13,
          color: theme.colors.white,
        },
        joinHint: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 12,
          color: theme.colors.textMuted,
          marginTop: 8,
          lineHeight: 16,
        },
        list: {
          borderTopWidth: StyleSheet.hairlineWidth,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
        },
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.md,
          paddingVertical: 14,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.border,
        },
        rowLast: { borderBottomWidth: 0 },
        rowCopy: { flex: 1, minWidth: 0, gap: 3 },
        rowTitle: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 15,
          color: theme.colors.text,
        },
        rowTitleRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
        },
        manageChip: {
          paddingVertical: 2,
          paddingHorizontal: 6,
          borderRadius: theme.radius.sm,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.accent,
          backgroundColor: theme.colors.accentMuted,
        },
        manageChipText: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 10,
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          color: theme.colors.accent,
        },
        rowMeta: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 12,
          color: theme.colors.textSecondary,
        },
        rowProgress: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 12,
          color: theme.colors.accent,
          marginTop: 2,
        },
        rowTrailing: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          flexShrink: 0,
        },
        registeringChip: {
          paddingVertical: 2,
          paddingHorizontal: 6,
          borderRadius: theme.radius.sm,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.borderLight,
          backgroundColor: theme.colors.surfaceElevated,
        },
        registeringChipText: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 10,
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          color: theme.colors.textSecondary,
        },
        createToggle: {
          alignSelf: 'flex-start',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingVertical: 6,
          marginBottom: 8,
        },
        createToggleText: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 13,
          color: theme.colors.accent,
        },
        createPanel: {
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          padding: 12,
          gap: 10,
          marginBottom: 12,
        },
        createInput: {
          fontFamily: theme.fontFamily.input,
          fontSize: 14,
          color: theme.colors.text,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.sm,
          paddingHorizontal: 12,
          paddingVertical: 8,
          backgroundColor: theme.colors.background,
        },
        createFieldLabel: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 11,
          letterSpacing: 1,
          textTransform: 'uppercase',
          color: theme.colors.textMuted,
        },
        createGwScroll: { marginHorizontal: -4 },
        createGwRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: 4,
        },
        createGwChip: {
          paddingVertical: 7,
          paddingHorizontal: 12,
          borderRadius: theme.radius.sm,
          backgroundColor: theme.colors.background,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
        },
        createGwChipActive: {
          backgroundColor: theme.colors.accentMuted,
          borderColor: theme.colors.accent,
        },
        createGwChipText: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 12,
          color: theme.colors.textSecondary,
        },
        createGwChipTextActive: { color: theme.colors.accent },
        createSubmit: {
          backgroundColor: theme.colors.accent,
          borderRadius: theme.radius.sm,
          paddingVertical: 10,
          alignItems: 'center',
        },
        createSubmitText: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 13,
          color: theme.colors.white,
        },
        empty: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 13,
          color: theme.colors.textMuted,
          paddingVertical: 8,
          lineHeight: 18,
        },
        emptyBlock: { gap: 10, paddingVertical: 4 },
        emptyAction: {
          alignSelf: 'flex-start',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingVertical: 6,
        },
        emptyActionText: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 13,
          color: theme.colors.accent,
        },
        badge: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 11,
          color: theme.colors.statusAccent,
          textTransform: 'uppercase',
        },
      }),
    [theme, insets]
  );

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable
          style={styles.back}
          onPress={openSidebar}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Open menu"
        >
          <Ionicons name="menu" size={24} color={theme.colors.text} />
        </Pressable>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>Tipster20</Text>
          <Text style={styles.sub}>Premier League {F2T_SEASON}</Text>
        </View>
        <Pressable
          style={styles.headerRefresh}
          onPress={requestManualRefresh}
          disabled={refreshing || loading}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Refresh"
        >
          {refreshing ? (
            <ActivityIndicator size="small" color={theme.colors.accent} />
          ) : (
            <Ionicons name="refresh" size={22} color={theme.colors.text} />
          )}
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={theme.colors.accent} />
      ) : (
        <>
          <FootballNextUpSpotlight season={F2T_SEASON} refreshKey={spotlightRefreshKey} />

          <ScrollView
            style={styles.mainScroll}
            contentContainerStyle={styles.mainScrollContent}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={requestManualRefresh}
                tintColor={theme.colors.accent}
                colors={[theme.colors.accent]}
              />
            }
          >
            <View style={styles.homePanel}>
              <View style={styles.homePanelTabsRow}>
                <View style={styles.tabs}>
                  {(
                    [
                      { key: 'competitions' as const, label: 'My competitions' },
                      { key: 'join' as const, label: 'Join' },
                      { key: 'goalscorers' as const, label: 'Goalscorers' },
                    ] as const
                  ).map((t) => {
                    const active = tab === t.key;
                    return (
                      <Pressable
                        key={t.key}
                        style={[
                          styles.tab,
                          active && styles.tabActive,
                          active && !homePanelExpanded && styles.tabCollapsedActive,
                        ]}
                        onPress={() => {
                          if (t.key === 'goalscorers' && showAds && !goalscorersUnlocked) {
                            setGoalscorersPromptVisible(true);
                            return;
                          }
                          setTab(t.key);
                          if (!homePanelExpanded) setHomePanelExpanded(true);
                        }}
                        accessibilityRole="tab"
                        accessibilityState={{ selected: active }}
                      >
                        <Text style={[styles.tabText, active && styles.tabTextActive]}>
                          {t.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Pressable
                  style={styles.homePanelCollapseBtn}
                  onPress={() => setHomePanelExpanded((v) => !v)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: homePanelExpanded }}
                  accessibilityLabel={
                    homePanelExpanded ? 'Collapse competitions panel' : 'Expand competitions panel'
                  }
                  hitSlop={6}
                >
                  <Ionicons
                    name={homePanelExpanded ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={theme.colors.textMuted}
                  />
                </Pressable>
              </View>

              {homePanelExpanded ? (
                <View style={styles.panelBody}>
                  {tab === 'competitions' ? (
                    <>
                      {pending.length > 0 ? (
                        <View>
                          <Text style={styles.sectionLabel}>Pending approval</Text>
                          <View style={styles.list}>
                            {pending.map((p, i) => (
                              <View
                                key={p.competition_id}
                                style={[styles.row, i === pending.length - 1 && styles.rowLast]}
                              >
                                <View style={styles.rowCopy}>
                                  <Text style={styles.rowTitle}>{p.name}</Text>
                                  <Text style={styles.rowMeta}>Waiting for admin</Text>
                                </View>
                                <Text style={styles.badge}>Pending</Text>
                              </View>
                            ))}
                          </View>
                        </View>
                      ) : null}

                      <View>
                        <Text style={styles.sectionLabel}>Your leagues</Text>
                        {isStaff ? (
                          <>
                            <Pressable
                              style={styles.createToggle}
                              onPress={() => setShowCreate((v) => !v)}
                              accessibilityRole="button"
                              accessibilityState={{ expanded: showCreate }}
                              accessibilityLabel="Create competition"
                            >
                              <Ionicons
                                name={showCreate ? 'chevron-up' : 'add-circle-outline'}
                                size={18}
                                color={theme.colors.accent}
                              />
                              <Text style={styles.createToggleText}>Create competition</Text>
                            </Pressable>
                            {showCreate ? (
                              <View style={styles.createPanel}>
                                <TextInput
                                  style={styles.createInput}
                                  value={createName}
                                  onChangeText={setCreateName}
                                  placeholder="e.g. Office Tipster20"
                                  placeholderTextColor={theme.colors.textMuted}
                                  autoCorrect={false}
                                />
                                <Text style={styles.createFieldLabel}>Starting gameweek</Text>
                                <ScrollView
                                  horizontal
                                  showsHorizontalScrollIndicator={false}
                                  style={styles.createGwScroll}
                                  contentContainerStyle={styles.createGwRow}
                                  nestedScrollEnabled
                                >
                                  {createGws.slice(0, 20).map((g) => {
                                    const active = createGwId === g.id;
                                    return (
                                      <Pressable
                                        key={g.id}
                                        style={[
                                          styles.createGwChip,
                                          active && styles.createGwChipActive,
                                        ]}
                                        onPress={() => setCreateGwId(g.id)}
                                      >
                                        <Text
                                          style={[
                                            styles.createGwChipText,
                                            active && styles.createGwChipTextActive,
                                          ]}
                                        >
                                          GW{g.number}
                                        </Text>
                                      </Pressable>
                                    );
                                  })}
                                </ScrollView>
                                <Text style={styles.createFieldLabel}>Entry fee (optional)</Text>
                                <TextInput
                                  style={styles.createInput}
                                  value={createEntry}
                                  onChangeText={setCreateEntry}
                                  placeholder="e.g. £10 cash to organiser"
                                  placeholderTextColor={theme.colors.textMuted}
                                  autoCorrect={false}
                                />
                                <Pressable
                                  style={styles.createSubmit}
                                  onPress={() => void onCreate()}
                                  disabled={creating}
                                >
                                  {creating ? (
                                    <ActivityIndicator color={theme.colors.white} size="small" />
                                  ) : (
                                    <Text style={styles.createSubmitText}>Create</Text>
                                  )}
                                </Pressable>
                              </View>
                            ) : null}
                          </>
                        ) : null}

                        {comps.length === 0 ? (
                          <View style={styles.emptyBlock}>
                            <Text style={styles.empty}>
                              No competitions yet. Got a competition code? Enter it on the Join tab
                              to get started.
                            </Text>
                            <Pressable
                              style={styles.emptyAction}
                              onPress={() => setTab('join')}
                              accessibilityRole="button"
                              accessibilityLabel="Enter competition code"
                            >
                              <Text style={styles.emptyActionText}>Enter competition code</Text>
                              <Ionicons name="arrow-forward" size={14} color={theme.colors.accent} />
                            </Pressable>
                          </View>
                        ) : (
                          <View style={styles.list}>
                            {comps.map((c, i) => {
                              const registering = isFootballCompetitionRegistering(
                                c.start_gameweek_number,
                                seasonOpenGw
                              );
                              return (
                              <Pressable
                                key={c.competition_id}
                                style={[styles.row, i === comps.length - 1 && styles.rowLast]}
                                onPress={() => router.push(`/(f2t)/${c.competition_id}` as any)}
                              >
                                <View style={styles.rowCopy}>
                                  <View style={styles.rowTitleRow}>
                                    <Text style={styles.rowTitle}>{c.name}</Text>
                                    {c.can_manage ? (
                                      <View style={styles.manageChip}>
                                        <Text style={styles.manageChipText}>Admin</Text>
                                      </View>
                                    ) : c.is_manager ? (
                                      <View style={styles.manageChip}>
                                        <Text style={styles.manageChipText}>Manager</Text>
                                      </View>
                                    ) : null}
                                  </View>
                                  <Text style={styles.rowMeta}>
                                    GW{c.start_gameweek_number} start ·{' '}
                                    {statusLabel(c.participant_status)}
                                  </Text>
                                  {fundraiserByComp[fundraiserKey('f2t', c.competition_id)] ? (
                                    <FundraiserForClub
                                      clubName={
                                        fundraiserByComp[fundraiserKey('f2t', c.competition_id)]
                                          .club_name
                                      }
                                      clubLogoUrl={
                                        fundraiserByComp[fundraiserKey('f2t', c.competition_id)]
                                          .club_logo_url
                                      }
                                      size="compact"
                                    />
                                  ) : null}
                                  <Text style={styles.rowProgress}>
                                    {c.scored_count}/20 scored · {c.selection_count} picked
                                  </Text>
                                </View>
                                <View style={styles.rowTrailing}>
                                  {registering ? (
                                    <View style={styles.registeringChip}>
                                      <Text style={styles.registeringChipText}>Registering</Text>
                                    </View>
                                  ) : null}
                                  <Ionicons
                                    name="chevron-forward"
                                    size={16}
                                    color={theme.colors.textMuted}
                                  />
                                </View>
                              </Pressable>
                              );
                            })}
                          </View>
                        )}
                      </View>
                    </>
                  ) : null}

                  {tab === 'join' ? (
                    <View>
                      <Text style={styles.sectionLabel}>Competition code</Text>
                      <View style={styles.joinRow}>
                        <TextInput
                          style={styles.input}
                          value={code}
                          onChangeText={setCode}
                          placeholder="CODE"
                          placeholderTextColor={theme.colors.textMuted}
                          autoCapitalize="characters"
                          maxLength={6}
                          autoCorrect={false}
                        />
                        <Pressable
                          style={styles.joinBtn}
                          onPress={() => void onJoin()}
                          disabled={joining}
                        >
                          {joining ? (
                            <ActivityIndicator color={theme.colors.white} size="small" />
                          ) : (
                            <Text style={styles.joinBtnText}>Join</Text>
                          )}
                        </Pressable>
                      </View>
                      <Text style={styles.joinHint}>
                        Ask the competition organiser for the 6-character code, then enter it here.
                        You’ll appear in My competitions once they approve you.
                      </Text>
                    </View>
                  ) : null}

                  {tab === 'goalscorers' ? (
                    showAds && !goalscorersUnlocked ? (
                      <View style={{ gap: 12, paddingVertical: 16 }}>
                        <Text style={styles.joinHint}>
                          Goalscorers are available after a short ad that helps keep Top Tipster
                          running.
                        </Text>
                        <Pressable
                          style={styles.joinBtn}
                          onPress={() => setGoalscorersPromptVisible(true)}
                        >
                          <Text style={styles.joinBtnText}>View goalscorers</Text>
                        </Pressable>
                      </View>
                    ) : (
                      <GoalscorersPanel refreshKey={tableRefreshKey} />
                    )
                  ) : null}
                </View>
              ) : null}
            </View>

            <LmsTrademarkDisclaimer />
          </ScrollView>
          <RewardedAdPrompt
            placement="t20Goalscorers"
            unlockKey={AD_UNLOCK_KEYS.t20Goalscorers}
            visible={goalscorersPromptVisible}
            onCancel={() => setGoalscorersPromptVisible(false)}
            onUnlocked={() => {
              setGoalscorersUnlocked(true);
              setGoalscorersPromptVisible(false);
              setTab('goalscorers');
              if (!homePanelExpanded) setHomePanelExpanded(true);
            }}
          />
        </>
      )}
      <AdBanner placement="t20" />
    </View>
  );
}
