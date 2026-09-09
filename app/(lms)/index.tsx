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
  Animated,
  Easing,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';
import { useSidebar } from '@/contexts/SidebarContext';
import { useAuth } from '@/contexts/AuthContext';
import { isFootballCompetitionRegistering } from '@/lib/appUtils';
import {
  lmsCreateCompetition,
  lmsGetGameweekPickStats,
  lmsGetHome,
  lmsGetHomeInsights,
  lmsJoinErrorMessage,
  lmsListFixturesForGameweek,
  lmsListGameweeks,
  lmsListParticipants,
  lmsListPicksForGameweek,
  lmsRequestJoin,
  lmsFixturesNeedRefresh,
  type LmsCompetitionHomeSummary,
  type LmsEliminationSummary,
  type LmsHomeInsights,
  type LmsFixture,
  type LmsGameweek,
  type LmsGameweekPickStats,
  type LmsPendingJoin,
  type LmsPickStatOutcome,
  type LmsTeam,
} from '@/lib/lms/api';
import { lmsSessionSetFixtures } from '@/lib/lms/sessionCache';
import { useRealtimeLmsFixtures } from '@/lib/useRealtimeLmsFixtures';
import { canCreateCompetitions } from '@/lib/adminSession';
import { CreateCompetitionUpgradeCta } from '@/components/CreateCompetitionUpgradeCta';
import { confirmJoinLimitDisclaimer } from '@/lib/joinLimitDisclaimer';
import { TeamColourChip } from '@/components/lms/TeamColourChip';
import { LeagueTablePanel } from '@/components/lms/LeagueTablePanel';
import { FundraiserForClub } from '@/components/FundraiserForClub';
import { lmsDisplayTeamName } from '@/lib/lms/teamColours';
import {
  fetchCompetitionsFundraiserBranding,
  fundraiserKey,
  type FundraiserBranding,
} from '@/lib/fundraiserBranding';
import { LmsTrademarkDisclaimer } from '@/components/lms/LmsTrademarkDisclaimer';
import { LmsPushNotificationsCard } from '@/components/lms/LmsPushNotificationsCard';
import { AdBanner } from '@/components/ads/AdBanner';
import { SurvivalDonut } from '@/components/lms/SurvivalDonut';
import { LmsUserPoolGrid } from '@/components/lms/LmsUserPoolGrid';

type HomeTab = 'competitions' | 'join' | 'table';

/** Pause between fixture slides (auto-advance). */
const FIXTURE_CYCLE_MS = 6500;
/** Exit / enter duration for the swipe-left transition. */
const FIXTURE_SLIDE_MS = 380;
const LMS_MANUAL_REFRESH_COOLDOWN_MS = 60_000;

export default function LmsHomeScreen() {
  const theme = useTheme();
  const { openSidebar } = useSidebar();
  const insets = useSafeAreaInsets();
  const { userId } = useAuth();
  const { tab: tabParam, code: codeParam, create: createParam, quoteId: quoteIdParam } =
    useLocalSearchParams<{
      tab?: string;
      code?: string;
      create?: string;
      quoteId?: string;
    }>();
  const gamemasterQuoteId =
    typeof quoteIdParam === 'string' && quoteIdParam.trim() ? quoteIdParam.trim() : null;
  const [comps, setComps] = useState<LmsCompetitionHomeSummary[]>([]);
  const [fundraiserByComp, setFundraiserByComp] = useState<Record<string, FundraiserBranding>>({});
  const [pending, setPending] = useState<LmsPendingJoin[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [code, setCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [tab, setTab] = useState<HomeTab>('competitions');
  const [tableRefreshKey, setTableRefreshKey] = useState(0);
  const [gw, setGw] = useState<LmsGameweek | null>(null);
  const [fixtures, setFixtures] = useState<LmsFixture[]>([]);
  const [fxIndex, setFxIndex] = useState(0);
  const [pickStats, setPickStats] = useState<LmsGameweekPickStats | null>(null);
  /** Overall = all leagues; League = one competition (dropdown). */
  const [pickStatsScope, setPickStatsScope] = useState<'overall' | 'league'>('overall');
  const [pickStatsCompetitionId, setPickStatsCompetitionId] = useState<string | null>(null);
  const [pickStatsDisplay, setPickStatsDisplay] = useState<'pct' | 'count' | 'game'>('pct');
  const [pickStatsLoading, setPickStatsLoading] = useState(false);
  const [pickStatsLeagueMenuOpen, setPickStatsLeagueMenuOpen] = useState(false);
  /** team_id → usernames (league Game view only). */
  const [pickStatsPickersByTeam, setPickStatsPickersByTeam] = useState<Record<string, string[]>>(
    {}
  );
  const [pickStatsExpandedTeams, setPickStatsExpandedTeams] = useState<Record<string, boolean>>(
    {}
  );
  const [eliminationSummary, setEliminationSummary] = useState<LmsEliminationSummary | null>(null);
  const [eliminationLoading, setEliminationLoading] = useState(false);
  const [homeInsights, setHomeInsights] = useState<LmsHomeInsights | null>(null);
  const [poolCompetitionId, setPoolCompetitionId] = useState<string | null>(null);
  const [poolMenuOpen, setPoolMenuOpen] = useState(false);
  const [homePanelExpanded, setHomePanelExpanded] = useState(true);
  const [isStaff, setIsStaff] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createEntry, setCreateEntry] = useState('');
  const [createExtraLives, setCreateExtraLives] = useState(0);
  const [createGwId, setCreateGwId] = useState<string | null>(null);
  const [createGws, setCreateGws] = useState<LmsGameweek[]>([]);
  const [creating, setCreating] = useState(false);
  const [fixtureCardWidth, setFixtureCardWidth] = useState(280);
  const homeLoadedRef = useRef(false);
  const createGwsLoadedRef = useRef(false);
  const lastManualRefreshAtRef = useRef<number | null>(null);
  const fixtureSlideAnim = useRef(new Animated.Value(0)).current;
  const fixtureAnimatingRef = useRef(false);
  const fxIndexRef = useRef(0);
  const gwRef = useRef<LmsGameweek | null>(null);
  const fixturesRef = useRef<LmsFixture[]>([]);
  const fixtureRefreshInFlightRef = useRef(false);
  const fixtureRefreshPendingRef = useRef(false);

  useEffect(() => {
    if (tabParam === 'table' || tabParam === 'join' || tabParam === 'competitions') {
      setTab(tabParam);
    }
  }, [tabParam]);

  useEffect(() => {
    const raw = typeof codeParam === 'string' ? codeParam.trim().toUpperCase() : '';
    if (!raw) return;
    setCode(raw.slice(0, 6));
    setTab('join');
  }, [codeParam]);

  useEffect(() => {
    if (createParam === '1' || createParam === 'true') {
      setTab('competitions');
      setShowCreate(true);
    }
  }, [createParam]);

  const upcomingFixtures = useMemo(() => {
    const open = fixtures.filter((f) => f.status !== 'finished' && !f.excluded_from_lms);
    const list = open.length ? open : fixtures.filter((f) => !f.excluded_from_lms);
    return [...list].sort((a, b) => {
      if (a.status === 'live' && b.status !== 'live') return -1;
      if (b.status === 'live' && a.status !== 'live') return 1;
      return new Date(a.kickoff_at).getTime() - new Date(b.kickoff_at).getTime();
    });
  }, [fixtures]);

  /** True while the next gameweek's pick window is open (before the 20‑min deadline). */
  const picksOpen = useMemo(() => {
    if (!gw || gw.status === 'complete') return false;
    const deadlineMs = new Date(gw.deadline_at).getTime();
    return Number.isFinite(deadlineMs) && deadlineMs > Date.now();
  }, [gw]);

  /** Pick distribution visible only after deadline and before the gameweek settles. */
  const pickStatsWindowOpen = useMemo(() => {
    if (!gw || gw.status === 'complete') return false;
    const deadlineMs = new Date(gw.deadline_at).getTime();
    return Number.isFinite(deadlineMs) && deadlineMs <= Date.now();
  }, [gw]);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const [home, insights] = await Promise.all([
        lmsGetHome('2026/27'),
        lmsGetHomeInsights('2026/27').catch(() => null),
      ]);
      const staff = await canCreateCompetitions(userId);
      setIsStaff(staff);
      setComps(home.competitions);
      setPending(home.pending);
      try {
        const branding = await fetchCompetitionsFundraiserBranding(
          home.competitions.map((c) => ({
            sport: 'lms' as const,
            competition_id: c.competition_id,
          }))
        );
        setFundraiserByComp(branding);
      } catch {
        setFundraiserByComp({});
      }
      setGw(home.nextUp.gameweek);
      let nextFixtures = (home.nextUp.fixtures ?? []) as LmsFixture[];
      if (home.nextUp.gameweek?.id) {
        try {
          const full = await lmsListFixturesForGameweek(home.nextUp.gameweek.id);
          if (full.length) nextFixtures = full;
        } catch {
          /* keep home RPC fixtures */
        }
      }
      setFixtures(nextFixtures);
      if (home.nextUp.gameweek?.id && nextFixtures.length > 0) {
        lmsSessionSetFixtures(home.nextUp.gameweek.id, nextFixtures);
      }
      setHomeInsights(insights?.success ? insights : null);
      fxIndexRef.current = 0;
      setFxIndex(0);
      fixtureSlideAnim.setValue(0);
      fixtureAnimatingRef.current = false;
      setTab((prev) => {
        if (tabParam === 'table' || tabParam === 'join' || tabParam === 'competitions') {
          return tabParam;
        }
        if (prev === 'join' || prev === 'table') return prev;
        return home.competitions.length === 0 && home.pending.length === 0
          ? 'join'
          : 'competitions';
      });

      if (!home.nextUp.gameweek?.id) {
        setPickStats(null);
      }

      if (staff && !createGwsLoadedRef.current) {
        const gws = await lmsListGameweeks('2026/27');
        createGwsLoadedRef.current = true;
        setCreateGws(gws);
        const defaultGw =
          home.nextUp.gameweek?.id ??
          gws.find((g) => g.status !== 'complete')?.id ??
          gws[0]?.id ??
          null;
        setCreateGwId((prev) => prev ?? defaultGw);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load competitions';
      Alert.alert('Error', msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId, tabParam]);

  const loadRef = useRef(load);
  loadRef.current = load;
  gwRef.current = gw;
  fixturesRef.current = fixtures;

  const refreshLiveFixtures = useCallback(async (opts?: { force?: boolean }) => {
    const gwId = gwRef.current?.id;
    if (!gwId) return;
    const current = fixturesRef.current;
    if (!opts?.force && current.length > 0 && !lmsFixturesNeedRefresh(current)) return;
    if (fixtureRefreshInFlightRef.current) {
      fixtureRefreshPendingRef.current = true;
      return;
    }
    fixtureRefreshInFlightRef.current = true;
    try {
      const full = await lmsListFixturesForGameweek(gwId);
      if (full.length) {
        lmsSessionSetFixtures(gwId, full);
        setFixtures(full);
      }
    } catch {
      /* ignore; next realtime/focus retries */
    } finally {
      fixtureRefreshInFlightRef.current = false;
      if (fixtureRefreshPendingRef.current) {
        fixtureRefreshPendingRef.current = false;
        void refreshLiveFixtures({ force: true });
      }
    }
  }, []);

  const homeRealtimeIds = useMemo(
    () => fixtures.map((f) => f.id).filter(Boolean),
    [fixtures]
  );

  useRealtimeLmsFixtures(homeRealtimeIds, () => {
    void refreshLiveFixtures({ force: true });
  });

  /** Load / reload pick stats when the gameweek is live (locked, not yet complete). */
  useEffect(() => {
    if (!gw?.id || !pickStatsWindowOpen) {
      setPickStats(null);
      setPickStatsLoading(false);
      return;
    }
    const competitionId =
      pickStatsScope === 'league' ? pickStatsCompetitionId : null;
    if (pickStatsScope === 'league' && !competitionId) {
      setPickStats(null);
      setPickStatsLoading(false);
      return;
    }
    let cancelled = false;
    setPickStatsLoading(true);
    void lmsGetGameweekPickStats(gw.id, competitionId)
      .then((stats) => {
        if (cancelled) return;
        setPickStats(stats.revealed ? stats : null);
      })
      .catch(() => {
        if (!cancelled) setPickStats(null);
      })
      .finally(() => {
        if (!cancelled) setPickStatsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [gw?.id, gw?.status, pickStatsWindowOpen, pickStatsScope, pickStatsCompetitionId]);

  /** Derive survival card from the single home-insights payload (no extra round-trip). */
  useEffect(() => {
    if (!gw?.id || pickStatsWindowOpen || !homeInsights) {
      setEliminationSummary(null);
      setEliminationLoading(false);
      return;
    }
    setEliminationLoading(false);
    if (pickStatsScope === 'league') {
      const id = pickStatsCompetitionId;
      setEliminationSummary(
        id ? homeInsights.eliminations.byCompetition[id] ?? null : null
      );
      return;
    }
    setEliminationSummary(homeInsights.eliminations.overall);
  }, [
    gw?.id,
    pickStatsWindowOpen,
    homeInsights,
    pickStatsScope,
    pickStatsCompetitionId,
  ]);

  useEffect(() => {
    if (poolCompetitionId != null && !comps.some((c) => c.competition_id === poolCompetitionId)) {
      setPoolCompetitionId(comps[0]?.competition_id ?? null);
      setPoolMenuOpen(false);
    } else if (poolCompetitionId == null && comps.length > 0) {
      setPoolCompetitionId(comps[0].competition_id);
    }
  }, [comps, poolCompetitionId]);

  const poolTeams = useMemo(() => {
    if (!poolCompetitionId || pickStatsWindowOpen || !homeInsights) return [];
    return homeInsights.pools[poolCompetitionId] ?? [];
  }, [homeInsights, poolCompetitionId, pickStatsWindowOpen]);

  const poolLoading = !pickStatsWindowOpen && !!poolCompetitionId && !homeInsights;

  /** Drop a stale competition filter if the user left that league. */
  useEffect(() => {
    if (
      pickStatsCompetitionId != null &&
      !comps.some((c) => c.competition_id === pickStatsCompetitionId)
    ) {
      setPickStatsCompetitionId(comps[0]?.competition_id ?? null);
      if (!comps.length) {
        setPickStatsScope('overall');
        setPickStatsLeagueMenuOpen(false);
      }
    }
  }, [comps, pickStatsCompetitionId]);

  /** League Game view: who picked each team (one picks + participants load). */
  useEffect(() => {
    if (
      pickStatsDisplay !== 'game' ||
      pickStatsScope !== 'league' ||
      !pickStatsCompetitionId ||
      !gw?.id
    ) {
      setPickStatsPickersByTeam({});
      setPickStatsExpandedTeams({});
      return;
    }
    let cancelled = false;
    void Promise.all([
      lmsListPicksForGameweek(pickStatsCompetitionId, gw.id),
      lmsListParticipants(pickStatsCompetitionId),
    ])
      .then(([picks, participants]) => {
        if (cancelled) return;
        const nameById = new Map(
          participants.map((p) => [p.user_id, p.username?.trim() || p.user_id.slice(0, 8)])
        );
        const map: Record<string, string[]> = {};
        for (const pick of picks) {
          const label = nameById.get(pick.user_id) || pick.user_id.slice(0, 8);
          (map[pick.team_id] ??= []).push(label);
        }
        for (const teamId of Object.keys(map)) {
          map[teamId].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        }
        setPickStatsPickersByTeam(map);
      })
      .catch(() => {
        if (!cancelled) setPickStatsPickersByTeam({});
      });
    return () => {
      cancelled = true;
    };
  }, [pickStatsDisplay, pickStatsScope, pickStatsCompetitionId, gw?.id]);

  const requestManualRefresh = useCallback(() => {
    if (refreshing || loading) return;
    const now = Date.now();
    const last = lastManualRefreshAtRef.current;
    if (last != null && now - last < LMS_MANUAL_REFRESH_COOLDOWN_MS) {
      const waitSec = Math.ceil((LMS_MANUAL_REFRESH_COOLDOWN_MS - (now - last)) / 1000);
      Alert.alert('Slow down', `You can refresh again in ${waitSec}s.`);
      return;
    }
    lastManualRefreshAtRef.current = now;
    setRefreshing(true);
    if (tab === 'table') setTableRefreshKey((k) => k + 1);
    void load();
  }, [refreshing, loading, tab, load]);

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      if (homeLoadedRef.current) {
        void refreshLiveFixtures();
        return;
      }
      homeLoadedRef.current = true;
      void loadRef.current();
    }, [userId, refreshLiveFixtures])
  );

  useEffect(() => {
    fxIndexRef.current = fxIndex;
  }, [fxIndex]);

  const goToFixture = useCallback(
    (nextIndex: number, opts?: { animated?: boolean; direction?: 'left' | 'right' }) => {
      const count = upcomingFixtures.length;
      if (count < 1) return;
      const target = ((nextIndex % count) + count) % count;
      const animated = opts?.animated !== false;
      const current = fxIndexRef.current;

      if (target === current) return;
      if (fixtureAnimatingRef.current) return;

      if (!animated || count < 2) {
        fxIndexRef.current = target;
        setFxIndex(target);
        fixtureSlideAnim.setValue(0);
        return;
      }

      const direction =
        opts?.direction ??
        (target === (current + 1) % count || (current === count - 1 && target === 0)
          ? 'left'
          : target === (current - 1 + count) % count || (current === 0 && target === count - 1)
            ? 'right'
            : 'left');

      const exitTo = direction === 'left' ? -1 : 1;
      const enterFrom = direction === 'left' ? 1 : -1;

      fixtureAnimatingRef.current = true;
      Animated.timing(fixtureSlideAnim, {
        toValue: exitTo,
        duration: FIXTURE_SLIDE_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (!finished) {
          fixtureAnimatingRef.current = false;
          return;
        }
        fxIndexRef.current = target;
        setFxIndex(target);
        fixtureSlideAnim.setValue(enterFrom);
        Animated.timing(fixtureSlideAnim, {
          toValue: 0,
          duration: FIXTURE_SLIDE_MS,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start(() => {
          fixtureAnimatingRef.current = false;
        });
      });
    },
    [upcomingFixtures.length, fixtureSlideAnim]
  );

  useEffect(() => {
    if (upcomingFixtures.length < 2) return;
    const id = setInterval(() => {
      const next = (fxIndexRef.current + 1) % upcomingFixtures.length;
      goToFixture(next, { direction: 'left' });
    }, FIXTURE_CYCLE_MS);
    return () => clearInterval(id);
  }, [upcomingFixtures.length, goToFixture]);

  useEffect(() => {
    if (fxIndex >= upcomingFixtures.length) {
      fxIndexRef.current = 0;
      setFxIndex(0);
      fixtureSlideAnim.setValue(0);
    }
  }, [fxIndex, upcomingFixtures.length, fixtureSlideAnim]);

  const fixtureSlideStyle = useMemo(() => {
    const travel = Math.max(120, fixtureCardWidth * 0.55);
    return {
      opacity: fixtureSlideAnim.interpolate({
        inputRange: [-1, 0, 1],
        outputRange: [0, 1, 0],
      }),
      transform: [
        {
          translateX: fixtureSlideAnim.interpolate({
            inputRange: [-1, 0, 1],
            outputRange: [-travel, 0, travel],
          }),
        },
      ],
    };
  }, [fixtureSlideAnim, fixtureCardWidth]);

  const onJoin = async () => {
    if (!code.trim()) {
      Alert.alert('Competition code', 'Enter the competition code to join.');
      return;
    }
    const confirmed = await confirmJoinLimitDisclaimer(code);
    if (!confirmed) return;

    setJoining(true);
    try {
      const res = await lmsRequestJoin(code);
      if (!res.success) {
        Alert.alert('Join failed', lmsJoinErrorMessage(res.error));
        return;
      }
      setCode('');
      const compName = res.competition_name?.trim() || 'the competition';
      const joinMsg =
        `You have successfully requested to join ${compName}. ` +
        `Please contact one of the admins for this competition so they can verify you. ` +
        `Once verified, the admin will accept your request.`;
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.alert(joinMsg);
      } else {
        Alert.alert('Request sent', joinMsg);
      }
      await load();
      setTab('competitions');
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Join failed');
    } finally {
      setJoining(false);
    }
  };

  const onCreateCompetition = async () => {
    if (!createName.trim()) {
      Alert.alert('Name required', 'Enter a competition name.');
      return;
    }
    if (!createGwId) {
      Alert.alert('Starting week required', 'Choose which gameweek this competition starts on.');
      return;
    }
    setCreating(true);
    try {
      const res = await lmsCreateCompetition(
        createName.trim(),
        createGwId,
        '2026/27',
        createEntry.trim() || undefined,
        createExtraLives,
        gamemasterQuoteId ? { gamemasterQuoteId } : undefined
      );
      if (!res.success) {
        Alert.alert('Failed', res.error ?? 'Could not create competition');
        return;
      }
      setCreateName('');
      setCreateEntry('');
      setCreateExtraLives(0);
      setShowCreate(false);
      Alert.alert(
        'Created',
        `Join code: ${res.access_code ?? '—'}${
          res.start_gameweek_number != null ? `\nStarts GW${res.start_gameweek_number}` : ''
        }`
      );
      await load();
      if (res.competition_id) {
        router.push(`/(lms)/${res.competition_id}` as any);
      }
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Create failed');
    } finally {
      setCreating(false);
    }
  };

  const activeFixture = upcomingFixtures[fxIndex] ?? null;

  const statusLabel = (status: string) => {
    if (status === 'active') return 'Still standing';
    if (status === 'winner') return 'Champion';
    if (status === 'eliminated') return 'Eliminated';
    return status;
  };

  const outcomeLabel = (outcome: LmsPickStatOutcome) => {
    switch (outcome) {
      case 'won':
        return 'W';
      case 'lost':
        return 'L';
      case 'draw':
        return 'D';
      case 'pending':
        return '—';
      case 'excluded':
        return 'X';
      default:
        return '—';
    }
  };

  const outcomeColor = (outcome: LmsPickStatOutcome) => {
    switch (outcome) {
      case 'won':
        return theme.colors.accent;
      case 'lost':
        return theme.colors.error;
      case 'draw':
        return theme.colors.textMuted;
      default:
        return theme.colors.textMuted;
    }
  };

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
        spotlightWrap: {
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: theme.spacing.sm,
        },
        deadlineAlertsWrap: {
          paddingBottom: theme.spacing.sm,
          gap: theme.spacing.sm,
        },
        picksOpenBanner: {
          backgroundColor: theme.colors.accentMuted,
          borderRadius: theme.radius.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.accent,
          paddingVertical: 12,
          paddingHorizontal: 14,
          gap: 6,
        },
        picksOpenTitle: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 13,
          color: theme.colors.accent,
        },
        picksOpenBody: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 13,
          lineHeight: 18,
          color: theme.colors.text,
        },
        mainScroll: {
          flex: 1,
        },
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
        spotlight: {
          backgroundColor: theme.colors.surfaceElevated,
          borderRadius: theme.radius.lg,
          borderWidth: 1.5,
          borderColor: theme.colors.accent,
          paddingVertical: 16,
          paddingHorizontal: 16,
          gap: 12,
          shadowColor: theme.colors.accent,
          shadowOpacity: 0.18,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 0 },
          elevation: 4,
        },
        spotlightHead: {
          flexDirection: 'row',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 8,
        },
        spotlightTitle: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 12,
          letterSpacing: 1.2,
          textTransform: 'uppercase',
          color: theme.colors.accent,
        },
        spotlightMeta: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 11,
          color: theme.colors.textMuted,
          flexShrink: 1,
          textAlign: 'right',
        },
        cardTap: {
          paddingVertical: 6,
          overflow: 'hidden',
        },
        cardSlide: {
          width: '100%',
        },
        cardRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        },
        cardSide: {
          flex: 1,
          alignItems: 'center',
          gap: 6,
        },
        cardName: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 13,
          color: theme.colors.text,
          textAlign: 'center',
        },
        cardMid: {
          alignItems: 'center',
          minWidth: 64,
          gap: 4,
        },
        cardVs: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 12,
          color: theme.colors.textMuted,
        },
        cardTime: {
          fontFamily: theme.fontFamily.baiExtraLight,
          fontSize: 11,
          color: theme.colors.textMuted,
          textAlign: 'center',
        },
        cardScoreLive: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 16,
          color: theme.colors.accent,
        },
        cardInPlay: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 10,
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          color: theme.colors.accent,
          textAlign: 'center',
        },
        dots: {
          flexDirection: 'row',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 5,
          paddingTop: 2,
        },
        dot: {
          width: 5,
          height: 5,
          borderRadius: 2.5,
          backgroundColor: theme.colors.borderLight,
        },
        dotActive: {
          backgroundColor: theme.colors.accent,
          width: 14,
          borderRadius: 3,
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
        tabText: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 12,
          color: theme.colors.textMuted,
          textAlign: 'center',
        },
        tabTextActive: { color: theme.colors.accent },
        tabCollapsedActive: {
          borderBottomColor: 'transparent',
        },
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
        rolloverChip: {
          paddingVertical: 2,
          paddingHorizontal: 6,
          borderRadius: theme.radius.sm,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.statusAccent,
          backgroundColor: 'rgba(234, 179, 8, 0.12)',
        },
        rolloverChipText: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 10,
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          color: theme.colors.statusAccent,
        },
        championChip: {
          paddingVertical: 2,
          paddingHorizontal: 6,
          borderRadius: theme.radius.sm,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.accent,
          backgroundColor: theme.colors.accentMuted,
        },
        championChipText: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 10,
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          color: theme.colors.accent,
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
        createHint: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 12,
          color: theme.colors.textMuted,
          lineHeight: 16,
        },
        createGwScroll: {
          marginHorizontal: -4,
        },
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
        createGwChipTextActive: {
          color: theme.colors.accent,
        },
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
        rowMeta: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 12,
          color: theme.colors.textSecondary,
        },
        rowPickHint: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 12,
          color: theme.colors.accent,
          marginTop: 2,
        },
        pickCol: {
          alignItems: 'center',
          minWidth: 52,
          gap: 3,
        },
        pickAbbr: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 10,
          color: theme.colors.textSecondary,
          textTransform: 'uppercase',
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
        empty: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 13,
          color: theme.colors.textMuted,
          paddingVertical: 8,
          lineHeight: 18,
        },
        emptyBlock: {
          gap: 10,
          paddingVertical: 4,
        },
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
        pickStatsCard: {
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.lg,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          paddingVertical: 12,
          paddingHorizontal: 12,
          gap: 8,
        },
        pickStatsHead: {
          flexDirection: 'row',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 8,
        },
        pickStatsTitle: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 11,
          letterSpacing: 1.1,
          textTransform: 'uppercase',
          color: theme.colors.textMuted,
        },
        pickStatsMeta: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 11,
          color: theme.colors.textMuted,
        },
        pickStatsToggles: {
          gap: 8,
        },
        pickStatsScopeRow: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          flexWrap: 'wrap',
        },
        pickStatsToggleRow: {
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 6,
        },
        pickStatsChip: {
          paddingVertical: 5,
          paddingHorizontal: 10,
          borderRadius: theme.radius.sm,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surfaceElevated,
        },
        pickStatsChipActive: {
          borderColor: theme.colors.accent,
          backgroundColor: theme.colors.accentMuted,
        },
        pickStatsChipText: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 11,
          color: theme.colors.textMuted,
        },
        pickStatsChipTextActive: {
          color: theme.colors.accent,
          fontFamily: theme.fontFamily.baiSemiBold,
        },
        pickStatsDropdown: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          maxWidth: '58%',
          paddingVertical: 5,
          paddingHorizontal: 10,
          borderRadius: theme.radius.sm,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surfaceElevated,
        },
        pickStatsDropdownText: {
          flexShrink: 1,
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 11,
          color: theme.colors.text,
        },
        pickStatsDropdownMenu: {
          borderRadius: theme.radius.sm,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surfaceElevated,
          overflow: 'hidden',
        },
        pickStatsDropdownItem: {
          paddingVertical: 8,
          paddingHorizontal: 10,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.border,
        },
        pickStatsDropdownItemActive: {
          backgroundColor: theme.colors.accentMuted,
        },
        pickStatsDropdownItemText: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 12,
          color: theme.colors.textSecondary,
        },
        pickStatsDropdownItemTextActive: {
          color: theme.colors.accent,
          fontFamily: theme.fontFamily.baiSemiBold,
        },
        pickStatRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingVertical: 4,
        },
        pickStatName: {
          width: 36,
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 11,
          color: theme.colors.textSecondary,
        },
        pickStatBarTrack: {
          flex: 1,
          height: 8,
          borderRadius: 4,
          backgroundColor: theme.colors.surfaceElevated,
          overflow: 'hidden',
        },
        pickStatBarFill: {
          height: '100%',
          borderRadius: 4,
          backgroundColor: theme.colors.accent,
          minWidth: 0,
        },
        pickStatPct: {
          width: 40,
          textAlign: 'right',
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 11,
          color: theme.colors.text,
        },
        pickStatOutcome: {
          width: 16,
          textAlign: 'center',
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 11,
        },
        eliminationRow: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          paddingVertical: 8,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.border,
        },
        eliminationRowLast: {
          borderBottomWidth: 0,
        },
        eliminationGw: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 13,
          color: theme.colors.text,
        },
        eliminationCount: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 13,
          color: theme.colors.textSecondary,
        },
        eliminationFooter: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 12,
          color: theme.colors.textMuted,
          marginTop: 4,
        },
        donutScroll: {
          marginHorizontal: -4,
        },
        donutScrollContent: {
          flexDirection: 'row',
          gap: 16,
          paddingHorizontal: 4,
          paddingVertical: 4,
        },
        donutCell: {
          alignItems: 'center',
          gap: 4,
          minWidth: 72,
        },
        donutGwLabel: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 11,
          color: theme.colors.textSecondary,
          textTransform: 'uppercase',
          letterSpacing: 0.4,
        },
        donutOutLabel: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 10,
          color: theme.colors.textMuted,
        },
        homeInsightsGap: {
          gap: 10,
        },
        pickGameFixture: {
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: theme.colors.border,
          paddingTop: 10,
          paddingBottom: 4,
          gap: 6,
        },
        pickGameRow: {
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: 6,
        },
        pickGameSide: {
          flex: 1,
          alignItems: 'center',
          gap: 2,
          minWidth: 0,
        },
        pickGameSideName: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 12,
          color: theme.colors.text,
        },
        pickGamePicksLabel: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 10,
          color: theme.colors.textMuted,
        },
        pickGameMid: {
          width: 56,
          alignItems: 'center',
          paddingTop: 10,
          gap: 2,
        },
        pickGameVs: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 11,
          color: theme.colors.textMuted,
          textTransform: 'uppercase',
        },
        pickGameScore: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 14,
          color: theme.colors.text,
        },
        pickGameKickoff: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 9,
          color: theme.colors.textMuted,
          textAlign: 'center',
        },
        pickGameExpandBtn: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 2,
          paddingVertical: 2,
          paddingHorizontal: 4,
        },
        pickGameExpandText: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 10,
          color: theme.colors.accent,
        },
        pickGamePickers: {
          alignSelf: 'stretch',
          marginTop: 2,
          paddingHorizontal: 4,
          gap: 2,
        },
        pickGamePickerName: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 10,
          color: theme.colors.textSecondary,
          textAlign: 'center',
        },
      }),
    [theme, insets.top, insets.bottom]
  );

  const renderNextUp = () => {
    if (!gw) return null;
    return (
      <View style={styles.spotlightWrap}>
        <View style={styles.spotlight}>
          <View style={styles.spotlightHead}>
            <Text style={styles.spotlightTitle}>Next up · GW{gw.number}</Text>
            <Text style={styles.spotlightMeta} numberOfLines={1}>
              {upcomingFixtures.length
                ? `${fxIndex + 1}/${upcomingFixtures.length}`
                : 'No fixtures'}
            </Text>
          </View>

          {activeFixture ? (
            <Pressable
              style={styles.cardTap}
              onLayout={(e) => {
                const w = e.nativeEvent.layout.width;
                if (w > 0 && Math.abs(w - fixtureCardWidth) > 1) setFixtureCardWidth(w);
              }}
              onPress={() =>
                goToFixture(
                  upcomingFixtures.length ? (fxIndex + 1) % upcomingFixtures.length : 0,
                  { direction: 'left' }
                )
              }
              accessibilityRole="button"
              accessibilityLabel="Next fixture"
            >
              <Animated.View style={[styles.cardSlide, fixtureSlideStyle]}>
                <View style={styles.cardRow}>
                  <View style={styles.cardSide}>
                    <TeamColourChip
                      shortName={activeFixture.home_team?.short_name}
                      name={activeFixture.home_team?.name}
                      slug={activeFixture.home_team?.slug}
                      size={44}
                    />
                    <Text style={styles.cardName} numberOfLines={1}>
                      {activeFixture.home_team?.short_name ?? 'H'}
                    </Text>
                  </View>
                  <View style={styles.cardMid}>
                    {activeFixture.status === 'live' ? (
                      <>
                        {activeFixture.home_goals != null &&
                        activeFixture.away_goals != null ? (
                          <Text style={styles.cardScoreLive}>
                            {activeFixture.home_goals}–{activeFixture.away_goals}
                          </Text>
                        ) : null}
                        <Text style={styles.cardInPlay}>In play</Text>
                      </>
                    ) : (
                      <>
                        <Text style={styles.cardVs}>vs</Text>
                        <Text style={styles.cardTime}>
                          {new Date(activeFixture.kickoff_at).toLocaleString(undefined, {
                            weekday: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </Text>
                      </>
                    )}
                  </View>
                  <View style={styles.cardSide}>
                    <TeamColourChip
                      shortName={activeFixture.away_team?.short_name}
                      name={activeFixture.away_team?.name}
                      slug={activeFixture.away_team?.slug}
                      size={44}
                    />
                    <Text style={styles.cardName} numberOfLines={1}>
                      {activeFixture.away_team?.short_name ?? 'A'}
                    </Text>
                  </View>
                </View>
              </Animated.View>
            </Pressable>
          ) : (
            <Text style={styles.empty}>Fixtures not loaded yet.</Text>
          )}

          {upcomingFixtures.length > 1 ? (
            <View style={styles.dots}>
              {upcomingFixtures.map((f, i) => (
                <Pressable
                  key={f.id}
                  onPress={() => goToFixture(i)}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={`Show fixture ${i + 1}`}
                >
                  <View style={[styles.dot, i === fxIndex && styles.dotActive]} />
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      </View>
    );
  };

  const renderHomeStatsScopeControls = () => {
    const selectedLeague =
      pickStatsCompetitionId != null
        ? comps.find((c) => c.competition_id === pickStatsCompetitionId)
        : null;

    return (
      <View style={styles.pickStatsToggles}>
        <View style={styles.pickStatsScopeRow}>
          <View style={styles.pickStatsToggleRow}>
            <Pressable
              style={[
                styles.pickStatsChip,
                pickStatsScope === 'overall' && styles.pickStatsChipActive,
              ]}
              onPress={() => {
                setPickStatsScope('overall');
                setPickStatsLeagueMenuOpen(false);
                setPickStatsExpandedTeams({});
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: pickStatsScope === 'overall' }}
              accessibilityLabel="Show stats across all leagues"
            >
              <Text
                style={[
                  styles.pickStatsChipText,
                  pickStatsScope === 'overall' && styles.pickStatsChipTextActive,
                ]}
              >
                Overall
              </Text>
            </Pressable>
            <Pressable
              style={[
                styles.pickStatsChip,
                pickStatsScope === 'league' && styles.pickStatsChipActive,
                comps.length === 0 && { opacity: 0.45 },
              ]}
              onPress={() => {
                if (!comps.length) return;
                const nextId = pickStatsCompetitionId ?? comps[0]?.competition_id ?? null;
                setPickStatsCompetitionId(nextId);
                setPickStatsScope('league');
                setPickStatsExpandedTeams({});
              }}
              accessibilityRole="button"
              accessibilityState={{
                selected: pickStatsScope === 'league',
                disabled: comps.length === 0,
              }}
              accessibilityLabel="Show stats for one competition"
            >
              <Text
                style={[
                  styles.pickStatsChipText,
                  pickStatsScope === 'league' && styles.pickStatsChipTextActive,
                ]}
              >
                League
              </Text>
            </Pressable>
          </View>

          {pickStatsScope === 'league' && comps.length > 0 ? (
            <Pressable
              style={styles.pickStatsDropdown}
              onPress={() => setPickStatsLeagueMenuOpen((o) => !o)}
              accessibilityRole="button"
              accessibilityState={{ expanded: pickStatsLeagueMenuOpen }}
              accessibilityLabel="Choose competition"
            >
              <Text style={styles.pickStatsDropdownText} numberOfLines={1}>
                {selectedLeague?.name ?? 'Select league'}
              </Text>
              <Ionicons
                name={pickStatsLeagueMenuOpen ? 'chevron-up' : 'chevron-down'}
                size={14}
                color={theme.colors.textMuted}
              />
            </Pressable>
          ) : null}
        </View>

        {pickStatsScope === 'league' && pickStatsLeagueMenuOpen ? (
          <View style={styles.pickStatsDropdownMenu}>
            {comps.map((c, i) => {
              const active = c.competition_id === pickStatsCompetitionId;
              return (
                <Pressable
                  key={c.competition_id}
                  style={[
                    styles.pickStatsDropdownItem,
                    active && styles.pickStatsDropdownItemActive,
                    i === comps.length - 1 && { borderBottomWidth: 0 },
                  ]}
                  onPress={() => {
                    setPickStatsCompetitionId(c.competition_id);
                    setPickStatsLeagueMenuOpen(false);
                    setPickStatsExpandedTeams({});
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text
                    style={[
                      styles.pickStatsDropdownItemText,
                      active && styles.pickStatsDropdownItemTextActive,
                    ]}
                    numberOfLines={1}
                  >
                    {c.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </View>
    );
  };

  const renderEliminationSummary = () => {
    if (!gw || pickStatsWindowOpen) return null;
    if (!eliminationLoading && !eliminationSummary?.gameweeks?.length) return null;

    const selectedLeague =
      pickStatsCompetitionId != null
        ? comps.find((c) => c.competition_id === pickStatsCompetitionId)
        : null;
    const scopeLabel =
      pickStatsScope === 'overall' ? 'all leagues' : selectedLeague?.name ?? 'league';
    const rows = eliminationSummary?.gameweeks ?? [];
    const stillStanding =
      eliminationSummary?.still_standing ??
      (pickStatsScope === 'overall'
        ? comps.reduce((sum, c) => sum + c.aliveCount, 0)
        : selectedLeague?.aliveCount ?? 0);

    return (
      <View style={styles.pickStatsCard}>
        <View style={styles.pickStatsHead}>
          <Text style={styles.pickStatsTitle}>Survival rate</Text>
          <Text style={styles.pickStatsMeta}>
            {eliminationLoading ? 'Loading…' : scopeLabel}
          </Text>
        </View>

        {renderHomeStatsScopeControls()}

        {eliminationLoading && !eliminationSummary ? (
          <ActivityIndicator color={theme.colors.accent} style={{ marginVertical: 8 }} />
        ) : (
          <>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.donutScroll}
              contentContainerStyle={styles.donutScrollContent}
            >
              {rows.map((row) => {
                const survivalPct =
                  row.survival_pct ??
                  (row.entrants_count > 0
                    ? Math.round(
                        ((row.entrants_count - row.eliminated_count) / row.entrants_count) *
                          100
                      )
                    : 100);
                return (
                  <View key={row.gameweek_id} style={styles.donutCell}>
                    <Text style={styles.donutGwLabel}>GW{row.gameweek_number}</Text>
                    <SurvivalDonut survivalPct={survivalPct} size={58} strokeWidth={7} />
                    <Text style={styles.donutOutLabel}>
                      {row.eliminated_count} out
                    </Text>
                  </View>
                );
              })}
            </ScrollView>
            {stillStanding > 0 ? (
              <Text style={styles.eliminationFooter}>
                {stillStanding} still standing · {scopeLabel}
              </Text>
            ) : null}
          </>
        )}
      </View>
    );
  };

  const renderUserPool = () => {
    if (!gw || pickStatsWindowOpen || comps.length === 0 || !poolCompetitionId) return null;
    const selected = comps.find((c) => c.competition_id === poolCompetitionId);
    if (!selected) return null;

    return (
      <LmsUserPoolGrid
        competitionName={selected.name}
        menuOpen={poolMenuOpen}
        onToggleMenu={() => setPoolMenuOpen((o) => !o)}
        competitions={comps.map((c) => ({
          competition_id: c.competition_id,
          name: c.name,
        }))}
        selectedCompetitionId={poolCompetitionId}
        onSelectCompetition={(id) => {
          setPoolCompetitionId(id);
          setPoolMenuOpen(false);
        }}
        teams={poolTeams}
        loading={poolLoading}
      />
    );
  };

  const renderBetweenGameweeksInsights = () => {
    if (!gw || pickStatsWindowOpen) return null;
    const elimination = renderEliminationSummary();
    const pool = renderUserPool();
    if (!elimination && !pool) return null;
    return (
      <View style={styles.homeInsightsGap}>
        {elimination}
        {pool}
      </View>
    );
  };

  const renderPickStats = () => {
    if (!gw || !pickStatsWindowOpen) return null;
    if (!pickStats?.revealed && !pickStatsLoading) return null;
    if (!pickStatsLoading && (!pickStats || pickStats.teams.length === 0)) return null;

    const selectedLeague =
      pickStatsCompetitionId != null
        ? comps.find((c) => c.competition_id === pickStatsCompetitionId)
        : null;
    const scopeLabel =
      pickStatsScope === 'overall' ? 'all leagues' : selectedLeague?.name ?? 'league';

    const pickCountByTeamId = new Map(
      (pickStats?.teams ?? []).map((t) => [t.team_id, t.pick_count] as const)
    );
    const outcomeByTeamId = new Map(
      (pickStats?.teams ?? []).map((t) => [t.team_id, t.outcome] as const)
    );

    const gameFixtures = [...fixtures]
      .filter((f) => !f.excluded_from_lms)
      .sort((a, b) => new Date(a.kickoff_at).getTime() - new Date(b.kickoff_at).getTime());

    const canExpandPickers = pickStatsScope === 'league' && !!pickStatsCompetitionId;

    const toggleTeamExpanded = (teamId: string) => {
      setPickStatsExpandedTeams((prev) => ({ ...prev, [teamId]: !prev[teamId] }));
    };

    const renderGameTeamSide = (
      team: LmsTeam | undefined,
      teamId: string,
      fallbackLabel: string
    ) => {
      const count = pickCountByTeamId.get(teamId) ?? 0;
      const outcome = outcomeByTeamId.get(teamId);
      const expanded = !!pickStatsExpandedTeams[teamId];
      const pickers = pickStatsPickersByTeam[teamId] ?? [];
      const showExpand = canExpandPickers && count > 0;
      const short =
        team?.short_name ||
        pickStats?.teams.find((t) => t.team_id === teamId)?.short_name ||
        fallbackLabel;

      return (
        <View style={styles.pickGameSide}>
          <TeamColourChip
            shortName={team?.short_name}
            name={team?.name}
            slug={team?.slug}
            size={28}
          />
          <Text style={styles.pickGameSideName} numberOfLines={1}>
            {short}
          </Text>
          <Text style={styles.pickGamePicksLabel}>Picks: {count}</Text>
          {outcome ? (
            <Text style={[styles.pickStatOutcome, { color: outcomeColor(outcome) }]}>
              {outcomeLabel(outcome)}
            </Text>
          ) : null}
          {showExpand ? (
            <Pressable
              style={styles.pickGameExpandBtn}
              onPress={() => toggleTeamExpanded(teamId)}
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              accessibilityLabel={
                expanded
                  ? `Hide players who picked ${short}`
                  : `Show players who picked ${short}`
              }
            >
              <Text style={styles.pickGameExpandText}>{expanded ? 'Hide' : 'Who'}</Text>
              <Ionicons
                name={expanded ? 'chevron-up' : 'chevron-down'}
                size={12}
                color={theme.colors.accent}
              />
            </Pressable>
          ) : null}
          {showExpand && expanded ? (
            <View style={styles.pickGamePickers}>
              {pickers.length === 0 ? (
                <Text style={styles.pickGamePickerName}>—</Text>
              ) : (
                pickers.map((name, i) => (
                  <Text key={`${name}-${i}`} style={styles.pickGamePickerName} numberOfLines={1}>
                    {name}
                  </Text>
                ))
              )}
            </View>
          ) : null}
        </View>
      );
    };

    return (
      <View style={styles.pickStatsCard}>
        <View style={styles.pickStatsHead}>
          <Text style={styles.pickStatsTitle}>
            GW{pickStats?.gameweek_number ?? gw.number} picks
          </Text>
          <Text style={styles.pickStatsMeta}>
            {pickStatsLoading
              ? 'Loading…'
              : `${pickStats?.total_picks ?? 0} pick${(pickStats?.total_picks ?? 0) === 1 ? '' : 's'} · ${scopeLabel}`}
          </Text>
        </View>

        {renderHomeStatsScopeControls()}

        <View style={styles.pickStatsToggleRow}>
          {(
            [
              { id: 'pct' as const, label: '%', a11y: 'Show pick percentages' },
              { id: 'count' as const, label: 'Count', a11y: 'Show pick counts' },
              { id: 'game' as const, label: 'Game', a11y: 'Show picks by fixture' },
            ] as const
          ).map((opt) => {
            const active = pickStatsDisplay === opt.id;
            return (
              <Pressable
                key={opt.id}
                style={[styles.pickStatsChip, active && styles.pickStatsChipActive]}
                onPress={() => {
                  setPickStatsDisplay(opt.id);
                  if (opt.id !== 'game') setPickStatsExpandedTeams({});
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={opt.a11y}
              >
                <Text
                  style={[
                    styles.pickStatsChipText,
                    active && styles.pickStatsChipTextActive,
                  ]}
                >
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {pickStatsLoading && !pickStats ? (
          <ActivityIndicator color={theme.colors.accent} style={{ marginVertical: 8 }} />
        ) : pickStatsDisplay === 'game' ? (
          gameFixtures.length === 0 ? (
            <Text style={styles.pickStatsMeta}>No fixtures for this gameweek.</Text>
          ) : (
            gameFixtures.map((f) => {
              const liveScore =
                f.status === 'live' || f.status === 'finished'
                  ? f.home_goals != null && f.away_goals != null
                    ? `${f.home_goals}–${f.away_goals}`
                    : null
                  : null;
              return (
                <View key={f.id} style={styles.pickGameFixture}>
                  <View style={styles.pickGameRow}>
                    {renderGameTeamSide(f.home_team, f.home_team_id, 'H')}
                    <View style={styles.pickGameMid}>
                      {liveScore ? (
                        <Text style={styles.pickGameScore}>{liveScore}</Text>
                      ) : (
                        <Text style={styles.pickGameVs}>vs</Text>
                      )}
                      <Text style={styles.pickGameKickoff}>
                        {f.status === 'live'
                          ? 'In play'
                          : new Date(f.kickoff_at).toLocaleString(undefined, {
                              weekday: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                      </Text>
                    </View>
                    {renderGameTeamSide(f.away_team, f.away_team_id, 'A')}
                  </View>
                </View>
              );
            })
          )
        ) : (
          (pickStats?.teams ?? []).map((t) => {
            const widthPct = Math.min(100, Math.max(0, t.pick_pct));
            return (
              <View key={t.team_id} style={styles.pickStatRow}>
                <TeamColourChip
                  shortName={t.short_name}
                  name={t.name}
                  slug={t.slug}
                  size={22}
                />
                <Text style={styles.pickStatName} numberOfLines={1}>
                  {t.short_name || lmsDisplayTeamName(t.name).slice(0, 3)}
                </Text>
                <View style={styles.pickStatBarTrack}>
                  <View
                    style={[
                      styles.pickStatBarFill,
                      {
                        width: `${widthPct}%`,
                        opacity: t.pick_count > 0 ? 1 : 0.25,
                      },
                    ]}
                  />
                </View>
                <Text style={styles.pickStatPct}>
                  {pickStatsDisplay === 'count'
                    ? String(t.pick_count)
                    : `${t.pick_pct.toFixed(t.pick_pct % 1 === 0 ? 0 : 1)}%`}
                </Text>
                <Text style={[styles.pickStatOutcome, { color: outcomeColor(t.outcome) }]}>
                  {outcomeLabel(t.outcome)}
                </Text>
              </View>
            );
          })
        )}
      </View>
    );
  };

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
          <Text style={styles.title}>Last Man Standing</Text>
          <Text style={styles.sub}>Premier League 2026/27</Text>
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
          {renderNextUp()}

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
            {picksOpen && gw ? (
              <View
                style={styles.picksOpenBanner}
                accessibilityRole="text"
                accessibilityLabel={`Gameweek ${gw.number} is now open`}
              >
                <Text style={styles.picksOpenTitle}>Gameweek {gw.number} is now open</Text>
                <Text style={styles.picksOpenBody}>
                  Remember entries close 20 minutes before the first game of the week. Good luck!
                </Text>
              </View>
            ) : null}

            <View style={styles.homePanel}>
              <View style={styles.homePanelTabsRow}>
                <View style={styles.tabs}>
                  {(
                    [
                      { key: 'competitions' as const, label: 'My competitions' },
                      { key: 'join' as const, label: 'Join' },
                      { key: 'table' as const, label: 'Table' },
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
                      {!isStaff ? (
                        <CreateCompetitionUpgradeCta modeLabel="Last Man Standing" />
                      ) : null}
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
                                placeholder="e.g. Office LMS"
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
                              <Text style={styles.createFieldLabel}>Extra lives</Text>
                              <ScrollView
                                horizontal
                                showsHorizontalScrollIndicator={false}
                                style={styles.createGwScroll}
                                contentContainerStyle={styles.createGwRow}
                                nestedScrollEnabled
                              >
                                {[0, 1, 2, 3].map((n) => {
                                  const active = createExtraLives === n;
                                  return (
                                    <Pressable
                                      key={n}
                                      style={[
                                        styles.createGwChip,
                                        active && styles.createGwChipActive,
                                      ]}
                                      onPress={() => setCreateExtraLives(n)}
                                    >
                                      <Text
                                        style={[
                                          styles.createGwChipText,
                                          active && styles.createGwChipTextActive,
                                        ]}
                                      >
                                        {n}
                                      </Text>
                                    </Pressable>
                                  );
                                })}
                              </ScrollView>
                              <Text style={styles.createHint}>
                                0 = out on first loss. Missed picks still go out immediately.
                              </Text>
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
                                onPress={() => void onCreateCompetition()}
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
                            const remainLabel =
                              c.totalCount > 0
                                ? `${c.aliveCount} of ${c.totalCount} remain`
                                : statusLabel(c.participant_status);
                            const registering = isFootballCompetitionRegistering(
                              c.start_gameweek_number,
                              gw
                            );
                            return (
                              <Pressable
                                key={c.competition_id}
                                style={[styles.row, i === comps.length - 1 && styles.rowLast]}
                                onPress={() => router.push(`/(lms)/${c.competition_id}` as any)}
                              >
                                <View style={styles.rowCopy}>
                                  <View style={styles.rowTitleRow}>
                                    <Text style={styles.rowTitle}>{c.name}</Text>
                                    {c.isCreator ? (
                                      <View style={styles.manageChip}>
                                        <Text style={styles.manageChipText}>Admin</Text>
                                      </View>
                                    ) : c.canManage ? (
                                      <View style={styles.manageChip}>
                                        <Text style={styles.manageChipText}>Owner</Text>
                                      </View>
                                    ) : c.isManager || c.canHandleJoins ? (
                                      <View style={styles.manageChip}>
                                        <Text style={styles.manageChipText}>Manager</Text>
                                      </View>
                                    ) : null}
                                    {c.participant_status === 'winner' ? (
                                      <View style={styles.championChip}>
                                        <Text style={styles.championChipText}>Champion</Text>
                                      </View>
                                    ) : c.showRolloverLabel ? (
                                      <View style={styles.rolloverChip}>
                                        <Text style={styles.rolloverChipText}>
                                          {c.hasPendingRejoin ? 'Pending' : 'Rollover'}
                                        </Text>
                                      </View>
                                    ) : null}
                                  </View>
                                  <Text style={styles.rowMeta}>{remainLabel}</Text>
                                  {fundraiserByComp[fundraiserKey('lms', c.competition_id)] ? (
                                    <FundraiserForClub
                                      clubName={
                                        fundraiserByComp[fundraiserKey('lms', c.competition_id)]
                                          .club_name
                                      }
                                      clubLogoUrl={
                                        fundraiserByComp[fundraiserKey('lms', c.competition_id)]
                                          .club_logo_url
                                      }
                                      size="compact"
                                    />
                                  ) : null}
                                  {c.participant_status === 'active' && c.pickAvailable ? (
                                    <Text style={styles.rowPickHint}>Pick available</Text>
                                  ) : c.participant_status !== 'active' &&
                                    c.participant_status !== 'winner' ? (
                                    <Text style={styles.rowMeta}>
                                      {statusLabel(c.participant_status)}
                                    </Text>
                                  ) : null}
                                </View>
                                <View style={styles.rowTrailing}>
                                  {registering ? (
                                    <View style={styles.registeringChip}>
                                      <Text style={styles.registeringChipText}>Registering</Text>
                                    </View>
                                  ) : null}
                                  {c.pickTeam ? (
                                    <View style={styles.pickCol}>
                                      <TeamColourChip
                                        shortName={c.pickTeam.short_name}
                                        name={c.pickTeam.name}
                                        slug={c.pickTeam.slug}
                                        size={28}
                                      />
                                      <Text style={styles.pickAbbr} numberOfLines={1}>
                                        {c.pickTeam.short_name || c.pickTeam.name.slice(0, 3)}
                                      </Text>
                                    </View>
                                  ) : (
                                    <Ionicons
                                      name="chevron-forward"
                                      size={16}
                                      color={theme.colors.textMuted}
                                    />
                                  )}
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

                {tab === 'table' ? <LeagueTablePanel refreshKey={tableRefreshKey} /> : null}
              </View>
              ) : null}
            </View>


            {pickStatsWindowOpen ? renderPickStats() : renderBetweenGameweeksInsights()}

            <View style={styles.deadlineAlertsWrap}>
              <LmsPushNotificationsCard />
            </View>

            <LmsTrademarkDisclaimer />
          </ScrollView>
        </>
      )}
      <AdBanner placement="lms" />
    </View>
  );
}
