import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Platform,
  TextInput,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
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
import { useAuth } from '@/contexts/AuthContext';
import { TeamColourChip } from '@/components/lms/TeamColourChip';
// Crest images disabled (trademark risk) — restore TeamCrest if logo rights obtained.
// import { TeamCrest } from '@/components/lms/TeamCrest';
import { TeamFormDots, SelectionTeamFormDots } from '@/components/lms/TeamFormDots';
import {
  StandingPlayerCards,
  StandingPlayerPoolCard,
} from '@/components/lms/StandingBetweenViews';
import {
  buildChampionJourney,
  ChampionStandingJourney,
} from '@/components/lms/ChampionStandingJourney';
import { LmsTrademarkDisclaimer } from '@/components/lms/LmsTrademarkDisclaimer';
import {
  lmsAdminSetCompetitionTeam,
  lmsAdminDeleteCompetition,
  lmsAdminBroadcastPush,
  lmsAdminListPendingForCompetition,
  lmsAdminRemoveParticipant,
  lmsAdminSubmitPickForUser,
  lmsApproveJoinRequest,
  lmsBroadcastErrorMessage,
  lmsCanManageCompetition,
  lmsGetCompetitionJoinCodes,
  lmsGetCompetitionRejoinInfo,
  lmsRequestRejoin,
  lmsGetJoinNotifyPref,
  lmsSetJoinNotifyPref,
  lmsListAssignableManagers,
  lmsListCompetitionManagers,
  lmsSetCompetitionManager,
  lmsSetCompetitionEntry,
  type LmsAssignableManagerRow,
  lmsGetCompetition,
  lmsGetCompetitionCurrentGameweek,
  lmsGetMyParticipant,
  lmsGetMyPick,
  lmsListCompetitionGameweeks,
  lmsListCompetitionTeamIds,
  lmsListCompletedPicksForUser,
  lmsListFixturesForGameweek,
  lmsListParticipants,
  lmsListPicksForGameweek,
  lmsListRecentFinishedFixtures,
  lmsListTeams,
  lmsListUsedTeamIds,
  lmsGetStandingBoard,
  lmsPickErrorMessage,
  lmsRejectJoinRequest,
  lmsSubmitPick,
  lmsMergeFixtures,
  lmsTeamFormFromFixtures,
  lmsFixturesNeedRefresh,
  lmsDefaultGameweekFilterId,
  type LmsCompetition,
  type LmsCompletedPick,
  type LmsFixture,
  type LmsGameweek,
  type LmsParticipant,
  type LmsPick,
  type LmsTeam,
} from '@/lib/lms/api';
import { lmsDisplayTeamName } from '@/lib/lms/teamColours';
import { useRealtimeLmsFixtures } from '@/lib/useRealtimeLmsFixtures';
import {
  lmsSessionGetFixtures,
  lmsSessionGetFormFixtures,
  lmsSessionGetTeams,
  lmsSessionHasFixtures,
  lmsSessionInvalidateFixtures,
  lmsSessionInvalidateFormFixtures,
  lmsSessionListCachedFixtures,
  // lmsSessionPrefetchCrests,
  lmsSessionSetFixtures,
  lmsSessionSetFormFixtures,
  lmsSessionSetTeams,
} from '@/lib/lms/sessionCache';

type TabKey = 'gameweeks' | 'selection' | 'leaderboard' | 'admin';
type StandingViewMode = 'list' | 'cards' | 'pools';

/** Manual refresh (header / pull) may hit the DB at most once per minute. */
const LMS_MANUAL_REFRESH_COOLDOWN_MS = 60_000;

export default function LmsCompetitionDashboard() {
  const theme = useTheme();
  const { openSidebar } = useSidebar();
  const insets = useSafeAreaInsets();
  const { userId } = useAuth();
  const params = useLocalSearchParams<{ competitionId: string }>();
  const competitionId = String(params.competitionId ?? '');

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectionLoading, setSelectionLoading] = useState(false);
  const [gameweeksLoading, setGameweeksLoading] = useState(false);
  const [tab, setTab] = useState<TabKey>('leaderboard');
  const [name, setName] = useState('');
  const [fundraiser, setFundraiser] = useState<FundraiserBranding | null>(null);
  const [compStatus, setCompStatus] = useState('');
  const [startGwNumber, setStartGwNumber] = useState<number | null>(null);
  const [extraLives, setExtraLives] = useState(0);
  const [me, setMe] = useState<LmsParticipant | null>(null);
  const [currentGw, setCurrentGw] = useState<LmsGameweek | null>(null);
  const [gameweeks, setGameweeks] = useState<LmsGameweek[]>([]);
  const [seasonFixtures, setSeasonFixtures] = useState<LmsFixture[]>([]);
  const [formFixtures, setFormFixtures] = useState<LmsFixture[]>([]);
  const [filterGwId, setFilterGwId] = useState<string | null>(null);
  const [filterTeamId, setFilterTeamId] = useState<string | null>(null);
  const [pickGwFixtures, setPickGwFixtures] = useState<LmsFixture[]>([]);
  const [fixturesLoadingGwId, setFixturesLoadingGwId] = useState<string | null>(null);
  const [teams, setTeams] = useState<LmsTeam[]>([]);
  const [usedIds, setUsedIds] = useState<string[]>([]);
  const [pick, setPick] = useState<LmsPick | null>(null);
  const [gwPicks, setGwPicks] = useState<LmsPick[]>([]);
  const [historyPicks, setHistoryPicks] = useState<LmsCompletedPick[]>([]);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [standingSearch, setStandingSearch] = useState('');
  const [standingPickSort, setStandingPickSort] = useState<'alpha' | 'popular'>('alpha');
  const [standingViewMode, setStandingViewMode] = useState<StandingViewMode>('list');
  const [standingBoardPicks, setStandingBoardPicks] = useState<LmsCompletedPick[]>([]);
  const [standingBoardPool, setStandingBoardPool] = useState<LmsTeam[]>([]);
  const [standingBoardLoading, setStandingBoardLoading] = useState(false);
  const standingBoardLoadedRef = useRef(false);
  const [leaderboard, setLeaderboard] = useState<LmsParticipant[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [canHandleJoins, setCanHandleJoins] = useState(false);
  const [isGamemasterAdmin, setIsGamemasterAdmin] = useState(false);
  const [signedUpCount, setSignedUpCount] = useState(0);
  const [quotaMax, setQuotaMax] = useState<number | null>(null);
  const [isCompManager, setIsCompManager] = useState(false);
  const [createdByUserId, setCreatedByUserId] = useState<string | null>(null);
  const [managerUserIds, setManagerUserIds] = useState<Set<string>>(new Set());
  const [assignablePlayers, setAssignablePlayers] = useState<LmsAssignableManagerRow[]>([]);
  const [managerBusyId, setManagerBusyId] = useState<string | null>(null);
  const [poolTeamIds, setPoolTeamIds] = useState<string[]>([]);
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminSubTab, setAdminSubTab] = useState<'joins' | 'pool' | 'users' | 'picks' | 'notify'>(
    'joins'
  );
  const [pendingJoins, setPendingJoins] = useState<
    {
      id: string;
      competition_id: string;
      username: string | null;
      code_type: string;
      created_at: string;
      is_reentry?: boolean;
      request_kind?: string;
      payment_method?: string | null;
      payment_note?: string | null;
    }[]
  >([]);
  const [joinBusyId, setJoinBusyId] = useState<string | null>(null);
  const [joinNotifyEnabled, setJoinNotifyEnabled] = useState(true);
  const [joinNotifyBusy, setJoinNotifyBusy] = useState(false);
  const [joinCode, setJoinCode] = useState<string | null>(null);
  const [rejoinCode, setRejoinCode] = useState<string | null>(null);
  const [rolloverActive, setRolloverActive] = useState(false);
  const [rolloverRejoinGw, setRolloverRejoinGw] = useState<number | null>(null);
  const [canRequestRejoin, setCanRequestRejoin] = useState(false);
  const [hasPendingRejoin, setHasPendingRejoin] = useState(false);
  const [rejoinBusy, setRejoinBusy] = useState(false);
  const [entryDraft, setEntryDraft] = useState('');
  const [entrySaving, setEntrySaving] = useState(false);
  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastBody, setBroadcastBody] = useState('');
  const [broadcastSending, setBroadcastSending] = useState(false);
  const [adminPickUserId, setAdminPickUserId] = useState<string | null>(null);
  const [adminPickTeamId, setAdminPickTeamId] = useState<string | null>(null);
  const [adminPickUsedIds, setAdminPickUsedIds] = useState<string[]>([]);
  const [adminPickLoadingUser, setAdminPickLoadingUser] = useState(false);
  const [manageUserDropdownOpen, setManageUserDropdownOpen] = useState(false);
  const [historyLoadingUserId, setHistoryLoadingUserId] = useState<string | null>(null);

  const competitionRef = useRef<LmsCompetition | null>(null);
  const currentGwIdRef = useRef<string | null>(null);
  const currentGwRef = useRef<LmsGameweek | null>(null);
  const gameweeksRef = useRef<LmsGameweek[]>([]);
  const loadedCompetitionIdRef = useRef<string | null>(null);
  const lastManualRefreshAtRef = useRef<number | null>(null);
  const loadedRef = useRef({
    leaderboardExtras: false,
    selection: false,
    gameweeks: false,
    pickGwFixtures: false,
  });
  const historyLoadedUsersRef = useRef(new Set<string>());
  const tabRef = useRef<TabKey>(tab);
  const canManageRef = useRef(canManage);
  canManageRef.current = canManage;
  tabRef.current = tab;
  const filterGwIdRef = useRef(filterGwId);
  filterGwIdRef.current = filterGwId;
  currentGwRef.current = currentGw;
  gameweeksRef.current = gameweeks;

  const mergeTeams = useCallback((incoming: LmsTeam[]) => {
    if (!incoming.length) return;
    setTeams((prev) => {
      if (!prev.length) return incoming;
      const byId = new Map(prev.map((t) => [t.id, t]));
      for (const t of incoming) byId.set(t.id, t);
      return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
    });
    // void lmsSessionPrefetchCrests(incoming);
  }, []);

  const loadTeamsCached = useCallback(
    async (opts?: { force?: boolean }) => {
      if (!opts?.force) {
        const cached = lmsSessionGetTeams();
        if (cached?.length) {
          mergeTeams(cached);
          return cached;
        }
      }
      const allTeams = await lmsListTeams();
      lmsSessionSetTeams(allTeams);
      mergeTeams(allTeams);
      return allTeams;
    },
    [mergeTeams]
  );

  const syncSeasonFixturesFromCache = useCallback(() => {
    const next = lmsSessionListCachedFixtures();
    setSeasonFixtures((prev) => {
      if (prev.length !== next.length) return next;
      const prevById = new Map(prev.map((f) => [f.id, f]));
      for (const f of next) {
        const p = prevById.get(f.id);
        if (
          !p ||
          p.gameweek_number !== f.gameweek_number ||
          p.excluded_from_lms !== f.excluded_from_lms ||
          p.status !== f.status ||
          p.home_goals !== f.home_goals ||
          p.away_goals !== f.away_goals
        ) {
          return next;
        }
      }
      return prev;
    });
  }, []);

  const ensureGameweekFixtures = useCallback(
    async (gwId: string, opts?: { force?: boolean }) => {
      const localNumber =
        gameweeksRef.current.find((g) => g.id === gwId)?.number ??
        (currentGwRef.current?.id === gwId ? currentGwRef.current.number : undefined);

      const withNumber = (list: LmsFixture[]) =>
        localNumber == null
          ? list
          : list.map((f) => ({
              ...f,
              gameweek_number: f.gameweek_number ?? localNumber,
            }));

      if (!opts?.force && lmsSessionHasFixtures(gwId)) {
        const cached = withNumber(lmsSessionGetFixtures(gwId) ?? []);
        if (!lmsFixturesNeedRefresh(cached)) {
          const prev = lmsSessionGetFixtures(gwId) ?? [];
          const changed =
            cached.length !== prev.length ||
            cached.some(
              (f, i) => f.id !== prev[i]?.id || f.gameweek_number !== prev[i]?.gameweek_number
            );
          if (changed) {
            lmsSessionSetFixtures(gwId, cached);
            syncSeasonFixturesFromCache();
          }
          return cached;
        }
      }
      setFixturesLoadingGwId(gwId);
      try {
        const fx = withNumber(await lmsListFixturesForGameweek(gwId));
        lmsSessionSetFixtures(gwId, fx);
        syncSeasonFixturesFromCache();
        return fx;
      } finally {
        setFixturesLoadingGwId((prev) => (prev === gwId ? null : prev));
      }
    },
    [syncSeasonFixturesFromCache]
  );

  const ensureFormFixtures = useCallback(
    async (season: string, opts?: { force?: boolean }) => {
      const hasFinishedResult = (list: LmsFixture[]) =>
        list.some(
          (f) => f.status === 'finished' && f.home_goals != null && f.away_goals != null
        );

      if (!opts?.force) {
        const cached = lmsSessionGetFormFixtures(season);
        // Skip empty cache — it may be from before any fixtures had finished.
        // Also skip caches that only have future weeks (no finished results yet).
        if (cached && cached.length > 0) {
          const merged = lmsMergeFixtures(cached, lmsSessionListCachedFixtures());
          if (hasFinishedResult(merged)) {
            setFormFixtures(merged);
            return merged;
          }
        }
      }
      const fx = await lmsListRecentFinishedFixtures(season);
      // Seed per-GW cache so “All” can include recent weeks without extra fetches.
      const byGw = new Map<string, LmsFixture[]>();
      for (const f of fx) {
        const list = byGw.get(f.gameweek_id) ?? [];
        list.push(f);
        byGw.set(f.gameweek_id, list);
      }
      for (const [gwId, list] of byGw) {
        if (!lmsSessionHasFixtures(gwId)) lmsSessionSetFixtures(gwId, list);
      }
      syncSeasonFixturesFromCache();
      const merged = lmsMergeFixtures(fx, lmsSessionListCachedFixtures());
      lmsSessionSetFormFixtures(season, merged);
      setFormFixtures(merged);
      return merged;
    },
    [syncSeasonFixturesFromCache]
  );

  const ensurePickGwFixtures = useCallback(
    async (gwId: string, opts?: { force?: boolean }) => {
      if (
        !opts?.force &&
        loadedRef.current.pickGwFixtures &&
        currentGwIdRef.current === gwId
      ) {
        return;
      }
      const pickFx = await ensureGameweekFixtures(gwId, opts);
      setPickGwFixtures(pickFx);
      loadedRef.current.pickGwFixtures = true;
      currentGwIdRef.current = gwId;
    },
    [ensureGameweekFixtures]
  );

  const loadLeaderboardExtras = useCallback(
    async (gw: LmsGameweek | null, opts?: { force?: boolean }) => {
      if (!competitionId) return;
      if (!opts?.force && loadedRef.current.leaderboardExtras) return;
      if (!gw) {
        setGwPicks([]);
        setPickGwFixtures([]);
        loadedRef.current.leaderboardExtras = true;
        loadedRef.current.pickGwFixtures = false;
        currentGwIdRef.current = null;
        return;
      }
      const [pickFx, picks] = await Promise.all([
        ensureGameweekFixtures(gw.id, opts),
        lmsListPicksForGameweek(competitionId, gw.id),
      ]);
      setPickGwFixtures(pickFx);
      setGwPicks(picks);
      loadedRef.current.leaderboardExtras = true;
      loadedRef.current.pickGwFixtures = true;
      currentGwIdRef.current = gw.id;
    },
    [competitionId, ensureGameweekFixtures]
  );

  const loadLeaderboardExtrasRef = useRef(loadLeaderboardExtras);
  loadLeaderboardExtrasRef.current = loadLeaderboardExtras;
  const ensureGameweekFixturesRef = useRef(ensureGameweekFixtures);
  ensureGameweekFixturesRef.current = ensureGameweekFixtures;

  /** Fixture ids for the open gameweek — used to filter Realtime updates. */
  const realtimeFixtureIds = useMemo(
    () => pickGwFixtures.map((f) => f.id).filter(Boolean),
    [pickGwFixtures]
  );

  const realtimeRefreshInFlightRef = useRef(false);
  const realtimeRefreshPendingRef = useRef(false);

  const ensureFormFixturesRef = useRef(ensureFormFixtures);
  ensureFormFixturesRef.current = ensureFormFixtures;

  /** Realtime-driven refresh: force fixtures + standing without the manual cooldown. */
  const refreshFromRealtime = useCallback(async () => {
    if (!competitionId) return;
    if (realtimeRefreshInFlightRef.current) {
      realtimeRefreshPendingRef.current = true;
      return;
    }
    const gw = currentGwRef.current;
    if (!gw) return;
    realtimeRefreshInFlightRef.current = true;
    try {
      lmsSessionInvalidateFixtures(gw.id);
      const filterGw = filterGwIdRef.current;
      if (tabRef.current === 'gameweeks' && filterGw && filterGw !== gw.id) {
        lmsSessionInvalidateFixtures(filterGw);
      }

      const season = competitionRef.current?.season ?? '2026/27';
      const [parts] = await Promise.all([
        lmsListParticipants(competitionId),
        loadLeaderboardExtrasRef.current(gw, { force: true }),
        ensureFormFixturesRef.current(season, { force: true }),
        tabRef.current === 'gameweeks' && filterGw && filterGw !== gw.id
          ? ensureGameweekFixturesRef.current(filterGw, { force: true })
          : Promise.resolve(null),
      ]);
      setLeaderboard(parts);
    } catch {
      /* ignore transient Realtime refetch errors; next sync/event retries */
    } finally {
      realtimeRefreshInFlightRef.current = false;
      if (realtimeRefreshPendingRef.current) {
        realtimeRefreshPendingRef.current = false;
        void refreshFromRealtime();
      }
    }
  }, [competitionId]);

  useRealtimeLmsFixtures(realtimeFixtureIds, () => {
    void refreshFromRealtime();
  });

  const loadSelectionSlice = useCallback(
    async (opts?: { force?: boolean }) => {
      if (!competitionId || !userId) return;
      if (!opts?.force && loadedRef.current.selection) return;
      setSelectionLoading(true);
      try {
        const comp = competitionRef.current;
        const gwId = currentGwIdRef.current;
        const season = comp?.season ?? '2026/27';

        const base = await Promise.all([
          loadTeamsCached(opts),
          lmsListCompetitionTeamIds(competitionId),
          lmsListUsedTeamIds(competitionId, userId),
          lmsListCompletedPicksForUser(competitionId, userId, comp),
          gwId ? lmsGetMyPick(competitionId, userId, gwId) : Promise.resolve(null),
          gwId && (!loadedRef.current.pickGwFixtures || opts?.force)
            ? ensurePickGwFixtures(gwId, opts)
            : Promise.resolve(),
          ensureFormFixtures(season, opts),
        ]);

        const poolIds = base[1] as string[];
        const used = base[2] as string[];
        const myHistory = base[3] as LmsCompletedPick[];
        const myPick = base[4] as LmsPick | null;

        setPoolTeamIds(poolIds);
        setUsedIds(used);
        setPick(myPick);
        setSelectedTeamId(myPick?.team_id ?? null);
        if (myPick?.team) mergeTeams([myPick.team]);

        setHistoryPicks((prev) => {
          const others = prev.filter((h) => h.user_id !== userId);
          return [...others, ...myHistory];
        });
        historyLoadedUsersRef.current.add(userId);
        loadedRef.current.selection = true;
      } finally {
        setSelectionLoading(false);
      }
    },
    [competitionId, userId, ensurePickGwFixtures, ensureFormFixtures, loadTeamsCached, mergeTeams]
  );

  const loadGameweeksSlice = useCallback(
    async (opts?: { force?: boolean }) => {
      if (!competitionId) return;
      if (!opts?.force && loadedRef.current.gameweeks) return;
      setGameweeksLoading(true);
      try {
        const comp = competitionRef.current ?? (await lmsGetCompetition(competitionId));
        if (comp) competitionRef.current = comp;
        const season = comp?.season ?? '2026/27';
        const [gws] = await Promise.all([
          lmsListCompetitionGameweeks(competitionId, comp),
          loadTeamsCached(opts),
          ensureFormFixtures(season, opts),
        ]);
        setGameweeks(gws);
        const defaultGwId = lmsDefaultGameweekFilterId(gws, currentGwIdRef.current);
        setFilterGwId((prev) => prev ?? defaultGwId);
        if (defaultGwId) {
          await ensureGameweekFixtures(defaultGwId, opts);
        }
        if (!loadedRef.current.selection) {
          const poolIds = await lmsListCompetitionTeamIds(competitionId);
          setPoolTeamIds(poolIds);
        }
        syncSeasonFixturesFromCache();
        loadedRef.current.gameweeks = true;
      } finally {
        setGameweeksLoading(false);
      }
    },
    [competitionId, loadTeamsCached, ensureFormFixtures, ensureGameweekFixtures, syncSeasonFixturesFromCache]
  );

  const loadHistoryForUser = useCallback(
    async (targetUserId: string) => {
      if (!competitionId || historyLoadedUsersRef.current.has(targetUserId)) return;
      setHistoryLoadingUserId(targetUserId);
      try {
        const rows = await lmsListCompletedPicksForUser(
          competitionId,
          targetUserId,
          competitionRef.current
        );
        historyLoadedUsersRef.current.add(targetUserId);
        setHistoryPicks((prev) => {
          const others = prev.filter((h) => h.user_id !== targetUserId);
          return [...others, ...rows];
        });
      } finally {
        setHistoryLoadingUserId((prev) => (prev === targetUserId ? null : prev));
      }
    },
    [competitionId]
  );

  const loadShell = useCallback(async () => {
    if (!competitionId || !userId) return;
    const [comp, participant, parts, manage] = await Promise.all([
      lmsGetCompetition(competitionId),
      lmsGetMyParticipant(competitionId, userId),
      lmsListParticipants(competitionId),
      lmsCanManageCompetition(competitionId),
    ]);
    competitionRef.current = comp;
    const gwInfo = await lmsGetCompetitionCurrentGameweek(competitionId, comp);
    const gw = gwInfo.gameweek;

    setName(comp?.name ?? 'Competition');
    try {
      const branding = await fetchCompetitionsFundraiserBranding([
        { sport: 'lms', competition_id: competitionId },
      ]);
      setFundraiser(branding[fundraiserKey('lms', competitionId)] ?? null);
    } catch {
      setFundraiser(null);
    }
    setCompStatus(comp?.status ?? '');
    setStartGwNumber(gwInfo.startGameweekNumber);
    setExtraLives(comp?.extra_lives ?? 0);
    setEntryDraft(comp?.entry?.trim() ?? '');
    setMe(participant);
    setCurrentGw(gw);
    setLeaderboard(parts);
    setCanManage(!!manage.can_manage);
    setCanHandleJoins(!!manage.can_handle_joins);
    setIsCompManager(!!manage.is_manager);
    setCreatedByUserId(manage.created_by_user_id ?? null);
    const ent = await fetchMyEntitlements().catch(() => null);
    const gmAdmin = isGamemasterAccount(ent) && !!manage.can_handle_joins;
    setIsGamemasterAdmin(gmAdmin);
    if (gmAdmin) {
      setTab('admin');
      try {
        const cap = await fetchCompetitionCapacity('lms', competitionId);
        setSignedUpCount(cap.currentParticipants);
        setQuotaMax(cap.maxParticipants);
      } catch {
        setSignedUpCount(parts.length);
        setQuotaMax(null);
      }
    } else {
      setIsGamemasterAdmin(false);
    }
    currentGwIdRef.current = gw?.id ?? null;

    // Reset dependent slices when shell reloads (focus / pull-to-refresh).
    loadedRef.current.leaderboardExtras = false;
    loadedRef.current.selection = false;
    loadedRef.current.gameweeks = false;
    loadedRef.current.pickGwFixtures = false;
    historyLoadedUsersRef.current = new Set();
    setHistoryPicks([]);
    setExpandedUserId(null);
    standingBoardLoadedRef.current = false;
    setStandingBoardPicks([]);
    setStandingBoardPool([]);

    await loadLeaderboardExtrasRef.current(gw, { force: true });

    // Managers / assignable lists are admin-only — skip for normal players.
    const joins = !!manage.can_handle_joins;
    const ownerAdmin = !!manage.can_manage;
    if (joins || ownerAdmin) {
      void loadCompetitionManagersRef.current({ loadAssignable: ownerAdmin });
    } else {
      setManagerUserIds(new Set());
      setAssignablePlayers([]);
    }
  }, [competitionId, userId]);

  /** Manager badges (+ optional assignable list for owners). Not for normal players. */
  const loadCompetitionManagers = useCallback(
    async (opts?: { loadAssignable?: boolean }) => {
      if (!competitionId) return;
      try {
        const rows = await lmsListCompetitionManagers(competitionId);
        setManagerUserIds(new Set(rows.map((r) => r.user_id)));
      } catch {
        /* leave previous manager chips */
      }

      if (!opts?.loadAssignable) {
        setAssignablePlayers([]);
        return;
      }

      try {
        const players = await lmsListAssignableManagers(competitionId);
        setAssignablePlayers(players);
      } catch {
        // manageUserPlayers already falls back to the in-memory leaderboard
        setAssignablePlayers([]);
      }
    },
    [competitionId]
  );

  const loadPendingJoins = useCallback(async () => {
    if (!competitionId) return;
    try {
      const rows = await lmsAdminListPendingForCompetition(competitionId);
      setPendingJoins(rows);
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to load join requests');
    }
  }, [competitionId]);

  const loadJoinNotifyPref = useCallback(async () => {
    if (!competitionId) return;
    try {
      const res = await lmsGetJoinNotifyPref(competitionId);
      if (res.success) setJoinNotifyEnabled(res.enabled);
    } catch {
      /* leave previous */
    }
  }, [competitionId]);

  const loadJoinCodes = useCallback(async () => {
    if (!competitionId) return;
    try {
      const res = await lmsGetCompetitionJoinCodes(competitionId);
      if (res.success) {
        setJoinCode(res.join_code);
        setRejoinCode(res.active_rejoin_code);
      }
    } catch {
      /* leave previous */
    }
  }, [competitionId]);

  const loadRolloverRejoinInfo = useCallback(async () => {
    if (!competitionId) return;
    try {
      const res = await lmsGetCompetitionRejoinInfo(competitionId);
      if (res.success && res.has_active_rejoin) {
        setRolloverActive(true);
        setRolloverRejoinGw(res.rejoin_valid_for_gameweek_number);
        setCanRequestRejoin(!!res.can_request_rejoin);
        setHasPendingRejoin(!!res.has_pending_rejoin);
        if (res.active_rejoin_code) setRejoinCode(res.active_rejoin_code);
      } else {
        setRolloverActive(false);
        setRolloverRejoinGw(null);
        setCanRequestRejoin(false);
        setHasPendingRejoin(false);
      }
    } catch {
      /* leave previous */
    }
  }, [competitionId]);

  const onRequestRejoin = async () => {
    if (!competitionId || rejoinBusy) return;
    setRejoinBusy(true);
    try {
      const res = await lmsRequestRejoin(competitionId);
      if (!res.success) {
        Alert.alert(
          'Rejoin',
          res.error === 'already_in'
            ? 'You are already active in this competition.'
            : res.error === 'no_active_rejoin' || res.error === 'code_void'
              ? 'Rejoin is not open for this competition right now.'
              : res.error ?? 'Could not request rejoin'
        );
        return;
      }
      setCanRequestRejoin(false);
      setHasPendingRejoin(true);
      Alert.alert('Rejoin requested', 'The organiser has been notified. You’ll be active again once they approve you.');
      await loadRolloverRejoinInfo();
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not request rejoin');
    } finally {
      setRejoinBusy(false);
    }
  };

  const copyAccessCode = async (code: string | null, label: string) => {
    if (!code) {
      Alert.alert(`No ${label}`, `This competition does not have a ${label} yet.`);
      return;
    }
    try {
      await Clipboard.setStringAsync(code);
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.alert(`Copied ${label}: ${code}`);
      } else {
        Alert.alert('Copied', `${label} ${code} copied to clipboard.`);
      }
    } catch {
      Alert.alert('Copy failed', `Could not copy the ${label}. Try selecting it manually.`);
    }
  };

  const onSaveEntry = async () => {
    if (!competitionId || entrySaving) return;
    setEntrySaving(true);
    try {
      const res = await lmsSetCompetitionEntry(competitionId, entryDraft);
      if (!res.success) {
        Alert.alert('Error', res.error || 'Could not save entry fee');
        return;
      }
      setEntryDraft(res.entry ?? '');
      if (competitionRef.current) {
        competitionRef.current = { ...competitionRef.current, entry: res.entry ?? null };
      }
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not save entry fee');
    } finally {
      setEntrySaving(false);
    }
  };

  const onToggleJoinNotify = async (next: boolean) => {
    if (!competitionId || joinNotifyBusy) return;
    setJoinNotifyBusy(true);
    const prev = joinNotifyEnabled;
    setJoinNotifyEnabled(next);
    try {
      const res = await lmsSetJoinNotifyPref(competitionId, next);
      if (!res.success) {
        setJoinNotifyEnabled(prev);
        Alert.alert('Error', res.error || 'Could not update notification preference');
      } else {
        setJoinNotifyEnabled(res.enabled);
      }
    } catch (e) {
      setJoinNotifyEnabled(prev);
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not update preference');
    } finally {
      setJoinNotifyBusy(false);
    }
  };

  const onToggleManager = async (targetUserId: string, next: boolean) => {
    if (!competitionId || managerBusyId) return;
    setManagerBusyId(targetUserId);
    const prev = managerUserIds;
    const nextSet = new Set(prev);
    if (next) nextSet.add(targetUserId);
    else nextSet.delete(targetUserId);
    setManagerUserIds(nextSet);
    try {
      const res = await lmsSetCompetitionManager(competitionId, targetUserId, next);
      if (!res.success) {
        setManagerUserIds(prev);
        const msg =
          res.error === 'manager_limit'
            ? `You can assign up to ${res.max ?? 3} managers.`
            : res.error === 'not_a_participant'
              ? 'That player is not in this competition.'
              : res.error === 'already_creator'
                ? 'The competition creator is already an admin.'
                : res.error || 'Could not update manager';
        Alert.alert('Managers', msg);
      } else {
        void loadCompetitionManagers({ loadAssignable: true });
      }
    } catch (e) {
      setManagerUserIds(prev);
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not update manager');
    } finally {
      setManagerBusyId(null);
    }
  };

  const loadSelectionSliceRef = useRef(loadSelectionSlice);
  loadSelectionSliceRef.current = loadSelectionSlice;
  const loadGameweeksSliceRef = useRef(loadGameweeksSlice);
  loadGameweeksSliceRef.current = loadGameweeksSlice;
  const loadPendingJoinsRef = useRef(loadPendingJoins);
  loadPendingJoinsRef.current = loadPendingJoins;
  const loadJoinNotifyPrefRef = useRef(loadJoinNotifyPref);
  loadJoinNotifyPrefRef.current = loadJoinNotifyPref;
  const loadJoinCodesRef = useRef(loadJoinCodes);
  loadJoinCodesRef.current = loadJoinCodes;
  const loadRolloverRejoinInfoRef = useRef(loadRolloverRejoinInfo);
  loadRolloverRejoinInfoRef.current = loadRolloverRejoinInfo;
  const loadCompetitionManagersRef = useRef(loadCompetitionManagers);
  loadCompetitionManagersRef.current = loadCompetitionManagers;

  const reloadVisible = useCallback(async (mode: 'initial' | 'manual' = 'initial') => {
    if (!competitionId || !userId) return;
    try {
      if (mode === 'manual') {
        lmsSessionInvalidateFormFixtures();
        if (currentGwIdRef.current) lmsSessionInvalidateFixtures(currentGwIdRef.current);
        if (tabRef.current === 'gameweeks' && filterGwIdRef.current) {
          lmsSessionInvalidateFixtures(filterGwIdRef.current);
        }
      }

      await loadShell();
      const t = tabRef.current;
      const tasks: Promise<unknown>[] = [loadRolloverRejoinInfoRef.current()];
      if (t === 'selection') tasks.push(loadSelectionSliceRef.current({ force: mode === 'manual' }));
      if (t === 'gameweeks' || t === 'admin') {
        const gwToRefresh = t === 'gameweeks' ? filterGwIdRef.current : currentGwIdRef.current;
        tasks.push(
          loadGameweeksSliceRef.current({ force: mode === 'manual' }).then(async () => {
            if (gwToRefresh) {
              await ensureGameweekFixturesRef.current(gwToRefresh, {
                force: mode === 'manual',
              });
            }
          })
        );
      }
      if (t === 'admin') {
        tasks.push(loadPendingJoinsRef.current());
        tasks.push(loadJoinNotifyPrefRef.current());
        tasks.push(loadJoinCodesRef.current());
        tasks.push(
          loadCompetitionManagersRef.current({ loadAssignable: canManageRef.current })
        );
      }
      // Leaderboard standings + GW picks come from loadShell → loadLeaderboardExtras.
      await Promise.all(tasks);
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [competitionId, userId, loadShell]);

  const reloadVisibleRef = useRef(reloadVisible);
  reloadVisibleRef.current = reloadVisible;

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
    void reloadVisible('manual');
  }, [refreshing, loading, reloadVisible]);

  useFocusEffect(
    useCallback(() => {
      if (!competitionId || !userId) return;
      // Keep in-memory screen data while staying on / returning to this competition.
      if (loadedCompetitionIdRef.current === competitionId) return;
      loadedCompetitionIdRef.current = competitionId;
      void reloadVisibleRef.current('initial');
    }, [competitionId, userId])
  );

  useEffect(() => {
    if (tab === 'selection') {
      void loadSelectionSliceRef.current().catch((e) => {
        Alert.alert('Error', e instanceof Error ? e.message : 'Failed to load selection');
      });
    }
    if (tab === 'gameweeks' || tab === 'admin') {
      void loadGameweeksSliceRef.current().catch((e) => {
        Alert.alert('Error', e instanceof Error ? e.message : 'Failed to load fixtures');
      });
    }
    if (tab === 'admin' && canHandleJoins) {
      void loadPendingJoinsRef.current();
      void loadJoinNotifyPrefRef.current();
      void loadJoinCodesRef.current();
      void loadCompetitionManagersRef.current({ loadAssignable: canManage });
    }
  }, [tab, canHandleJoins, canManage]);

  useEffect(() => {
    if (tab !== 'gameweeks') return;
    if (!filterGwId) {
      syncSeasonFixturesFromCache();
      return;
    }
    void ensureGameweekFixturesRef.current(filterGwId).catch((e) => {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to load gameweek fixtures');
    });
  }, [tab, filterGwId, syncSeasonFixturesFromCache]);

  useEffect(() => {
    if (!expandedUserId) return;
    void loadHistoryForUser(expandedUserId).catch(() => {
      // Non-fatal: drawer shows empty until retry.
    });
  }, [expandedUserId, loadHistoryForUser]);

  useEffect(() => {
    if (isGamemasterAdmin) {
      if (tab !== 'admin') setTab('admin');
      return;
    }
    if (!canHandleJoins && tab === 'admin') {
      setTab('leaderboard');
    }
  }, [canHandleJoins, isGamemasterAdmin, tab]);

  useEffect(() => {
    if (
      canHandleJoins &&
      !canManage &&
      adminSubTab !== 'joins' &&
      adminSubTab !== 'picks'
    ) {
      setAdminSubTab('joins');
    }
  }, [canHandleJoins, canManage, adminSubTab]);

  useEffect(() => {
    if (adminSubTab !== 'users') setManageUserDropdownOpen(false);
  }, [adminSubTab]);

  const formSourceFixtures = useMemo(
    () => lmsMergeFixtures(formFixtures, seasonFixtures),
    [formFixtures, seasonFixtures]
  );

  const formByTeamId = useMemo(() => {
    const map = new Map<string, ReturnType<typeof lmsTeamFormFromFixtures>>();
    const teamIds = new Set<string>();
    for (const t of teams) teamIds.add(t.id);
    for (const f of formSourceFixtures) {
      teamIds.add(f.home_team_id);
      teamIds.add(f.away_team_id);
    }
    for (const id of teamIds) {
      map.set(id, lmsTeamFormFromFixtures(formSourceFixtures, id));
    }
    return map;
  }, [teams, formSourceFixtures]);

  const filteredFixtures = useMemo(() => {
    return seasonFixtures.filter((f) => {
      if (filterGwId && f.gameweek_id !== filterGwId) return false;
      if (
        filterTeamId &&
        f.home_team_id !== filterTeamId &&
        f.away_team_id !== filterTeamId
      ) {
        return false;
      }
      // Team filter alone: upcoming/live only (helps pick planning)
      if (filterTeamId && !filterGwId && f.status === 'finished') return false;
      return true;
    });
  }, [seasonFixtures, filterGwId, filterTeamId]);

  const fixturesByGameweek = useMemo(() => {
    const groups: { gw: LmsGameweek | null; number: number; fixtures: LmsFixture[] }[] = [];
    const byNumber = new Map<number, LmsFixture[]>();
    const numberByGwId = new Map(gameweeks.map((g) => [g.id, g.number]));
    for (const f of filteredFixtures) {
      const n = f.gameweek_number ?? numberByGwId.get(f.gameweek_id) ?? 0;
      if (!byNumber.has(n)) byNumber.set(n, []);
      byNumber.get(n)!.push(f);
    }
    const numbers = [...byNumber.keys()].sort((a, b) => a - b);
    for (const n of numbers) {
      groups.push({
        number: n,
        gw: gameweeks.find((g) => g.number === n) ?? null,
        fixtures: byNumber.get(n) ?? [],
      });
    }
    return groups;
  }, [filteredFixtures, gameweeks]);

  const poolTeamIdSet = useMemo(() => new Set(poolTeamIds), [poolTeamIds]);

  const competitionTeams = useMemo(
    () => teams.filter((t) => poolTeamIdSet.has(t.id)),
    [teams, poolTeamIdSet]
  );

  /** Teams playing a non-excluded fixture this pick gameweek. */
  const playingTeamIds = useMemo(() => {
    const ids = new Set<string>();
    for (const f of pickGwFixtures) {
      if (f.excluded_from_lms) continue;
      ids.add(f.home_team_id);
      ids.add(f.away_team_id);
    }
    return ids;
  }, [pickGwFixtures]);

  /** Reasons why a pool team cannot be picked this GW (excluded fixture or no game). */
  const unavailableNoteByTeamId = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of pickGwFixtures) {
      if (!f.excluded_from_lms) continue;
      const note = f.excluded_reason?.trim() || 'No game this week';
      map.set(f.home_team_id, note);
      map.set(f.away_team_id, note);
    }
    for (const t of competitionTeams) {
      if (playingTeamIds.has(t.id) || map.has(t.id)) continue;
      const hasAnyFixture = pickGwFixtures.some(
        (f) => f.home_team_id === t.id || f.away_team_id === t.id
      );
      if (!hasAnyFixture) map.set(t.id, 'No game this week');
    }
    return map;
  }, [pickGwFixtures, competitionTeams, playingTeamIds]);

  const opponentByTeamId = useMemo(() => {
    const map = new Map<string, LmsTeam>();
    for (const f of pickGwFixtures) {
      if (f.away_team) map.set(f.home_team_id, f.away_team);
      if (f.home_team) map.set(f.away_team_id, f.home_team);
    }
    return map;
  }, [pickGwFixtures]);

  /** H = home, A = away for the team in this gameweek's fixture. */
  const venueByTeamId = useMemo(() => {
    const map = new Map<string, 'H' | 'A'>();
    for (const f of pickGwFixtures) {
      map.set(f.home_team_id, 'H');
      map.set(f.away_team_id, 'A');
    }
    return map;
  }, [pickGwFixtures]);

  /** Current GW result for each team (W / D / L) once the fixture is finished. */
  const gwOutcomeByTeamId = useMemo(() => {
    const map = new Map<string, 'W' | 'D' | 'L'>();
    for (const f of pickGwFixtures) {
      if (f.excluded_from_lms) continue;
      if (f.status !== 'finished' || f.home_goals == null || f.away_goals == null) continue;
      const hg = f.home_goals;
      const ag = f.away_goals;
      if (hg === ag) {
        map.set(f.home_team_id, 'D');
        map.set(f.away_team_id, 'D');
      } else if (hg > ag) {
        map.set(f.home_team_id, 'W');
        map.set(f.away_team_id, 'L');
      } else {
        map.set(f.home_team_id, 'L');
        map.set(f.away_team_id, 'W');
      }
    }
    return map;
  }, [pickGwFixtures]);

  /** Unused competition-pool teams shown on Selection (pickable + greyed). */
  const selectionTeams = useMemo(() => {
    const used = new Set(usedIds);
    if (pick?.team_id) used.delete(pick.team_id);
    return competitionTeams
      .filter((t) => !used.has(t.id))
      .sort((a, b) =>
        (a.short_name || a.name).localeCompare(b.short_name || b.name, undefined, {
          sensitivity: 'base',
        })
      );
  }, [competitionTeams, usedIds, pick?.team_id]);

  const remainingTeams = useMemo(
    () => selectionTeams.filter((t) => playingTeamIds.has(t.id)),
    [selectionTeams, playingTeamIds]
  );

  const poolTeams = useMemo(() => {
    const used = new Set(usedIds);
    return {
      available: competitionTeams.filter((t) => !used.has(t.id)),
      used: competitionTeams.filter((t) => used.has(t.id)),
    };
  }, [competitionTeams, usedIds]);

  const teamsAlphabetical = useMemo(
    () =>
      [...competitionTeams].sort((a, b) =>
        (a.short_name || a.name).localeCompare(b.short_name || b.name, undefined, {
          sensitivity: 'base',
        })
      ),
    [competitionTeams]
  );

  const allTeamsAlphabetical = useMemo(
    () =>
      [...teams].sort((a, b) =>
        (a.short_name || a.name).localeCompare(b.short_name || b.name, undefined, {
          sensitivity: 'base',
        })
      ),
    [teams]
  );

  const usedTeamIdSet = useMemo(() => new Set(usedIds), [usedIds]);

  const manageUserPlayers = useMemo(() => {
    if (assignablePlayers.length) {
      return assignablePlayers.map((p) => ({
        user_id: p.user_id,
        username: p.username ?? null,
        status: p.status ?? 'active',
        is_creator: !!p.is_creator,
        is_manager: !!p.is_manager || managerUserIds.has(p.user_id),
      }));
    }
    return leaderboard.map((p) => ({
      user_id: p.user_id,
      username: p.username ?? null,
      status: p.status,
      is_creator: createdByUserId != null && p.user_id === createdByUserId,
      is_manager: managerUserIds.has(p.user_id),
    }));
  }, [assignablePlayers, leaderboard, createdByUserId, managerUserIds]);

  const selectedManageUser = useMemo(
    () => manageUserPlayers.find((p) => p.user_id === adminPickUserId) ?? null,
    [manageUserPlayers, adminPickUserId]
  );

  const adminPickTeams = useMemo(() => {
    const used = new Set(adminPickUsedIds);
    if (adminPickUserId) {
      const existing = gwPicks.find((p) => p.user_id === adminPickUserId);
      if (existing?.team_id) used.delete(existing.team_id);
    }
    return competitionTeams
      .filter((t) => !used.has(t.id) && playingTeamIds.has(t.id))
      .sort((a, b) =>
        (a.short_name || a.name).localeCompare(b.short_name || b.name, undefined, {
          sensitivity: 'base',
        })
      );
  }, [competitionTeams, adminPickUsedIds, playingTeamIds, adminPickUserId, gwPicks]);

  const picksRevealed = useMemo(() => {
    if (!pickGwFixtures.length) return false;
    const firstKo = Math.min(...pickGwFixtures.map((f) => new Date(f.kickoff_at).getTime()));
    return Number.isFinite(firstKo) && firstKo <= Date.now();
  }, [pickGwFixtures]);

  /** After settle / before the open GW goes live — default Cards layout. */
  const standingBetweenWeeks = !currentGw || currentGw.status === 'upcoming';

  // Standing board (used teams + pool) for Cards / Pools — available mid-week too.
  useEffect(() => {
    if (loading) return;
    if (tab !== 'leaderboard' || !competitionId) return;
    if (standingBoardLoadedRef.current) return;
    let cancelled = false;
    setStandingBoardLoading(true);
    void lmsGetStandingBoard(competitionId, competitionRef.current)
      .then((board) => {
        if (cancelled) return;
        standingBoardLoadedRef.current = true;
        setStandingBoardPicks(board.picks);
        setStandingBoardPool(board.pool_teams);
        setHistoryPicks((prev) => {
          // Seed per-user drawers without extra fetches.
          const byUser = new Map<string, LmsCompletedPick[]>();
          for (const p of board.picks) {
            const list = byUser.get(p.user_id) ?? [];
            list.push(p);
            byUser.set(p.user_id, list);
          }
          for (const userId of byUser.keys()) historyLoadedUsersRef.current.add(userId);
          const others = prev.filter((h) => !byUser.has(h.user_id));
          return [...others, ...board.picks];
        });
      })
      .catch(() => {
        if (!cancelled) {
          setStandingBoardPicks([]);
          setStandingBoardPool([]);
        }
      })
      .finally(() => {
        if (!cancelled) setStandingBoardLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, competitionId, loading]);

  useEffect(() => {
    if (standingBetweenWeeks) {
      setStandingViewMode((prev) => (prev === 'list' ? 'cards' : prev));
    }
  }, [standingBetweenWeeks]);

  const standingBoardByUserId = useMemo(() => {
    const map = new Map<string, LmsCompletedPick[]>();
    for (const p of standingBoardPicks) {
      const list = map.get(p.user_id) ?? [];
      list.push(p);
      map.set(p.user_id, list);
    }
    // During a live GW, fold in revealed current picks so cards match post-week layout.
    if (picksRevealed && currentGw) {
      for (const pick of gwPicks) {
        if (!pick.team_id) continue;
        const list = map.get(pick.user_id) ?? [];
        if (list.some((x) => x.gameweek_id === currentGw.id)) {
          map.set(pick.user_id, list);
          continue;
        }
        list.push({
          user_id: pick.user_id,
          gameweek_id: currentGw.id,
          gameweek_number: currentGw.number,
          team_id: pick.team_id,
          result: pick.result ?? '',
          team: pick.team ?? undefined,
        });
        map.set(pick.user_id, list);
      }
    }
    return map;
  }, [standingBoardPicks, picksRevealed, currentGw, gwPicks]);

  const standingBetweenPlayers = useMemo(() => {
    const q = standingSearch.trim().toLowerCase();
    const matches = (p: LmsParticipant) => {
      if (!q) return true;
      const name = (p.username || '').toLowerCase();
      return name.includes(q) || p.user_id.slice(0, 8).toLowerCase().includes(q);
    };
    return [...leaderboard]
      .filter(matches)
      .sort((a, b) => {
        const rank = (s: string) => (s === 'winner' ? 0 : s === 'active' ? 1 : 2);
        const d = rank(a.status) - rank(b.status);
        if (d !== 0) return d;
        return (a.username || a.user_id).localeCompare(b.username || b.user_id);
      });
  }, [leaderboard, standingSearch]);

  const pickByUserId = useMemo(() => {
    const map = new Map<string, LmsPick>();
    for (const p of gwPicks) map.set(p.user_id, p);
    return map;
  }, [gwPicks]);

  /** Active players for current GW: who has locked a pick vs who still needs one. */
  const adminPickStatusRows = useMemo(() => {
    const active = leaderboard.filter((p) => p.status === 'active');
    const rows = active.map((p) => {
      const pick = pickByUserId.get(p.user_id);
      return {
        user_id: p.user_id,
        username: p.username ?? null,
        locked: Boolean(pick),
        teamLabel: pick?.team
          ? pick.team.short_name || lmsDisplayTeamName(pick.team.name)
          : null,
      };
    });
    rows.sort((a, b) => {
      if (a.locked !== b.locked) return a.locked ? 1 : -1;
      return (a.username || '').localeCompare(b.username || '', undefined, {
        sensitivity: 'base',
      });
    });
    return rows;
  }, [leaderboard, pickByUserId]);

  const adminPickStatusLockedCount = useMemo(
    () => adminPickStatusRows.filter((r) => r.locked).length,
    [adminPickStatusRows]
  );

  const historyByUserId = useMemo(() => {
    const map = new Map<string, typeof historyPicks>();
    for (const h of historyPicks) {
      const list = map.get(h.user_id) ?? [];
      list.push(h);
      map.set(h.user_id, list);
    }
    return map;
  }, [historyPicks]);

  const deadlinePassed = currentGw
    ? new Date(currentGw.deadline_at).getTime() <= Date.now()
    : true;
  const canPick =
    me?.status === 'active' && !!currentGw && !deadlinePassed && compStatus !== 'completed';

  const aliveCount = useMemo(
    () => leaderboard.filter((p) => p.status === 'active' || p.status === 'winner').length,
    [leaderboard]
  );

  const champion = useMemo(
    () => leaderboard.find((p) => p.status === 'winner') ?? null,
    [leaderboard]
  );

  const championPicks = useMemo(() => {
    if (!champion) return [];
    const fromBoard = standingBoardByUserId.get(champion.user_id) ?? [];
    const fromHistory = historyByUserId.get(champion.user_id) ?? [];
    const merged = new Map<string, (typeof fromBoard)[number]>();
    for (const pick of [...fromHistory, ...fromBoard]) {
      merged.set(`${pick.gameweek_id}-${pick.team_id}`, pick);
    }
    return [...merged.values()].sort((a, b) => a.gameweek_number - b.gameweek_number);
  }, [champion, standingBoardByUserId, historyByUserId]);

  const championJourneySteps = useMemo(() => {
    if (!champion || !championPicks.length) return [];
    return buildChampionJourney(champion, championPicks, leaderboard);
  }, [champion, championPicks, leaderboard]);

  useEffect(() => {
    if (tab !== 'leaderboard' || !champion) return;
    void loadGameweeksSliceRef.current().catch(() => {});
    if (!historyLoadedUsersRef.current.has(champion.user_id)) {
      void loadHistoryForUser(champion.user_id).catch(() => {});
    }
  }, [tab, champion, loadHistoryForUser]);

  const standingSections = useMemo(() => {
    const byName = (a: LmsParticipant, b: LmsParticipant) =>
      (a.username || a.user_id).localeCompare(b.username || b.user_id);

    const q = standingSearch.trim().toLowerCase();
    const matchesSearch = (p: LmsParticipant) => {
      if (!q) return true;
      const name = (p.username || '').toLowerCase();
      const idShort = p.user_id.slice(0, 8).toLowerCase();
      return name.includes(q) || idShort.includes(q);
    };

    type PickGroup = {
      key: string;
      label: string;
      team: LmsTeam | null;
      players: LmsParticipant[];
    };

    const groupByCurrentPick = (players: LmsParticipant[]): PickGroup[] => {
      const sortedPlayers = [...players].sort(byName);
      if (!picksRevealed || !currentGw) {
        return sortedPlayers.length
          ? [{ key: 'all', label: '', team: null, players: sortedPlayers }]
          : [];
      }

      const map = new Map<string, PickGroup>();
      for (const p of sortedPlayers) {
        const pick = pickByUserId.get(p.user_id);
        const team = pick?.team ?? null;
        const key = team?.id ?? 'no-pick';
        const label = team ? lmsDisplayTeamName(team.name) : 'No pick';
        const existing = map.get(key);
        if (existing) existing.players.push(p);
        else map.set(key, { key, label, team, players: [p] });
      }

      const groups = Array.from(map.values());
      groups.sort((a, b) => {
        if (a.key === 'no-pick') return 1;
        if (b.key === 'no-pick') return -1;
        if (standingPickSort === 'popular') {
          if (b.players.length !== a.players.length) {
            return b.players.length - a.players.length;
          }
        }
        return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
      });
      return groups;
    };

    const survivors = leaderboard
      .filter((p) => p.status === 'active' || p.status === 'winner')
      .filter(matchesSearch)
      .sort((a, b) => {
        if (a.status === 'winner' && b.status !== 'winner') return -1;
        if (b.status === 'winner' && a.status !== 'winner') return 1;
        return byName(a, b);
      });

    const currentGwId = currentGw?.id ?? null;
    const outThisWeek = leaderboard
      .filter(
        (p) =>
          p.status === 'eliminated' &&
          !!currentGwId &&
          p.eliminated_gameweek_id === currentGwId
      )
      .filter(matchesSearch)
      .sort(byName);

    const eliminated = leaderboard
      .filter(
        (p) =>
          p.status === 'eliminated' &&
          (!currentGwId || p.eliminated_gameweek_id !== currentGwId)
      )
      .filter(matchesSearch)
      .sort(byName);

    return {
      survivors,
      survivorsByPick: groupByCurrentPick(survivors),
      outThisWeek,
      outThisWeekByPick: groupByCurrentPick(outThisWeek),
      eliminated,
      matchCount: survivors.length + outThisWeek.length + eliminated.length,
    };
  }, [leaderboard, currentGw?.id, currentGw, standingSearch, standingPickSort, picksRevealed, pickByUserId]);

  const gwNumberById = useMemo(() => {
    const map = new Map<string, number>();
    for (const g of gameweeks) map.set(g.id, g.number);
    if (currentGw) map.set(currentGw.id, currentGw.number);
    for (const h of historyPicks) {
      if (h.gameweek_id && h.gameweek_number != null) {
        map.set(h.gameweek_id, h.gameweek_number);
      }
    }
    return map;
  }, [gameweeks, currentGw, historyPicks]);

  const currentPickTeam = useMemo(
    () => (pick ? teams.find((t) => t.id === pick.team_id) ?? null : null),
    [pick, teams]
  );

  const myPreviousSelections = useMemo(() => {
    const mine = (historyByUserId.get(userId ?? '') ?? []).map((h) => ({
      gameweek_number: h.gameweek_number,
      team: h.team,
      team_id: h.team_id,
    }));
    if (pick && currentGw && currentPickTeam) {
      const already = mine.some((m) => m.gameweek_number === currentGw.number);
      if (!already) {
        mine.push({
          gameweek_number: currentGw.number,
          team: currentPickTeam,
          team_id: currentPickTeam.id,
        });
      }
    }
    return mine.sort((a, b) => a.gameweek_number - b.gameweek_number);
  }, [historyByUserId, userId, pick, currentGw, currentPickTeam]);

  const onSavePick = async (teamId?: string) => {
    const pickTeamId = teamId ?? selectedTeamId;
    if (!pickTeamId || !currentGw || !userId) return;
    setSaving(true);
    try {
      const res = await lmsSubmitPick({
        competitionId,
        gameweekId: currentGw.id,
        teamId: pickTeamId,
      });
      if (!res.success) {
        Alert.alert('Pick not saved', lmsPickErrorMessage(res.error));
        return;
      }

      const team =
        teams.find((t) => t.id === pickTeamId) ??
        competitionTeams.find((t) => t.id === pickTeamId) ??
        null;
      const nextPick: LmsPick = {
        id: pick?.id ?? `local-${pickTeamId}`,
        competition_id: competitionId,
        user_id: userId,
        gameweek_id: currentGw.id,
        team_id: pickTeamId,
        result: pick?.result ?? 'pending',
        team: team ?? undefined,
      };
      setPick(nextPick);
      setSelectedTeamId(pickTeamId);
      setUsedIds((prev) => {
        const withoutOld = pick?.team_id ? prev.filter((id) => id !== pick.team_id) : prev;
        return withoutOld.includes(pickTeamId) ? withoutOld : [...withoutOld, pickTeamId];
      });
      setGwPicks((prev) => {
        const others = prev.filter((p) => p.user_id !== userId);
        return [...others, nextPick];
      });

      Alert.alert('Saved', 'Your gameweek pick is locked in until the deadline.');
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not save pick');
    } finally {
      setSaving(false);
    }
  };

  const confirmAction = (
    title: string,
    message: string,
    confirmLabel: string,
    onConfirm: () => void
  ) => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      if (window.confirm(`${title}\n\n${message}`)) onConfirm();
      return;
    }
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: confirmLabel, onPress: onConfirm },
    ]);
  };

  const requestConfirmPick = (teamId: string) => {
    if (!currentGw || saving) return;
    const team =
      teams.find((t) => t.id === teamId) ??
      competitionTeams.find((t) => t.id === teamId) ??
      null;
    const teamName = team ? lmsDisplayTeamName(team.name) : 'this team';
    const updating = !!pick && pick.team_id !== teamId;
    confirmAction(
      updating || pick ? 'Confirm pick update' : 'Confirm pick',
      `Lock in ${teamName} for GW${currentGw.number}? You can change this until the deadline.`,
      pick ? 'Update pick' : 'Lock in pick',
      () => {
        setSelectedTeamId(teamId);
        void onSavePick(teamId);
      }
    );
  };

  const confirmDestructive = (
    title: string,
    message: string,
    confirmLabel: string,
    onConfirm: () => void
  ) => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      if (window.confirm(`${title}\n\n${message}`)) onConfirm();
      return;
    }
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: confirmLabel, style: 'destructive', onPress: onConfirm },
    ]);
  };

  const onApproveJoin = async (requestId: string) => {
    setJoinBusyId(requestId);
    try {
      const res = await lmsApproveJoinRequest(requestId);
      if (!res.success) {
        Alert.alert(
          'Failed',
          res.error === 'entries_closed'
            ? 'Entries are closed — the start gameweek pick deadline has passed. Request rejected.'
            : res.error === 'code_void'
              ? 'This rejoin code is no longer valid.'
              : res.error ?? 'Confirm failed'
        );
      }
      await reloadVisible();
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Confirm failed');
    } finally {
      setJoinBusyId(null);
    }
  };

  const onRejectJoin = async (requestId: string) => {
    setJoinBusyId(requestId);
    try {
      const res = await lmsRejectJoinRequest(requestId);
      if (!res.success) Alert.alert('Failed', res.error ?? 'Reject failed');
      await loadPendingJoins();
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Reject failed');
    } finally {
      setJoinBusyId(null);
    }
  };

  const onSelectAdminPickUser = async (targetUserId: string) => {
    setAdminPickUserId(targetUserId);
    const existing = gwPicks.find((p) => p.user_id === targetUserId);
    setAdminPickTeamId(existing?.team_id ?? null);
    setAdminPickLoadingUser(true);
    try {
      const used = await lmsListUsedTeamIds(competitionId, targetUserId);
      setAdminPickUsedIds(used);
    } catch (e) {
      setAdminPickUsedIds([]);
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to load user picks');
    } finally {
      setAdminPickLoadingUser(false);
    }
  };

  const onAdminSubmitPick = async () => {
    if (!adminPickUserId || !adminPickTeamId || !currentGw) return;
    setAdminBusy(true);
    try {
      const res = await lmsAdminSubmitPickForUser(
        competitionId,
        adminPickUserId,
        currentGw.id,
        adminPickTeamId
      );
      if (!res.success) {
        Alert.alert('Pick not saved', lmsPickErrorMessage(res.error) || res.error || 'Unknown error');
        return;
      }
      Alert.alert('Saved', 'Pick submitted for that player.');
      setAdminPickTeamId(null);
      const used = await lmsListUsedTeamIds(competitionId, adminPickUserId);
      setAdminPickUsedIds(used);
      await loadLeaderboardExtrasRef.current(currentGw, { force: true });
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not submit pick');
    } finally {
      setAdminBusy(false);
    }
  };

  const onTogglePoolTeam = (team: LmsTeam, enabled: boolean) => {
    const apply = async () => {
      setAdminBusy(true);
      try {
        const res = await lmsAdminSetCompetitionTeam(competitionId, team.id, enabled);
        if (!res.success) {
          Alert.alert('Could not update pool', res.error ?? 'Unknown error');
          return;
        }
        await reloadVisible();
      } catch (e) {
        Alert.alert('Error', e instanceof Error ? e.message : 'Could not update team pool');
      } finally {
        setAdminBusy(false);
      }
    };

    if (!enabled) {
      confirmDestructive(
        'Remove from pool?',
        `${lmsDisplayTeamName(team.name)} will leave this competition’s team pool. Pending picks using that club will be cleared.`,
        'Remove',
        () => void apply()
      );
      return;
    }
    void apply();
  };

  const onRemoveParticipant = (target: {
    user_id: string;
    username: string | null;
    is_creator: boolean;
  }) => {
    if (target.is_creator) {
      Alert.alert('Cannot remove', 'The competition creator cannot be removed.');
      return;
    }
    const label = target.username || target.user_id.slice(0, 8);
    confirmDestructive(
      'Remove player?',
      `${label} will be removed from this competition. Their picks and any manager role will be cleared. They can request to join again with a code if needed.`,
      'Remove',
      () => {
        void (async () => {
          setAdminBusy(true);
          try {
            const res = await lmsAdminRemoveParticipant(competitionId, target.user_id);
            if (!res.success) {
              const msg =
                res.error === 'cannot_remove_creator'
                  ? 'The competition creator cannot be removed.'
                  : res.error === 'not_a_participant'
                    ? 'That player is not in this competition.'
                    : res.error === 'unauthorized'
                      ? 'Only the creator or Owner can remove players.'
                      : res.error ?? 'Unknown error';
              Alert.alert('Could not remove', msg);
              return;
            }
            if (adminPickUserId === target.user_id) {
              setAdminPickUserId(null);
              setAdminPickTeamId(null);
              setAdminPickUsedIds([]);
            }
            setManagerUserIds((prev) => {
              if (!prev.has(target.user_id)) return prev;
              const next = new Set(prev);
              next.delete(target.user_id);
              return next;
            });
            await reloadVisible();
            Alert.alert('Removed', `${label} has been removed from this competition.`);
          } catch (e) {
            Alert.alert(
              'Error',
              e instanceof Error ? e.message : 'Could not remove player'
            );
          } finally {
            setAdminBusy(false);
          }
        })();
      }
    );
  };

  const onDeleteCompetition = () => {
    confirmDestructive(
      'Delete competition?',
      `“${name}” will be permanently deleted, including all players, picks, and access codes. This cannot be undone.`,
      'Delete',
      () => {
        void (async () => {
          setAdminBusy(true);
          try {
            const res = await lmsAdminDeleteCompetition(competitionId);
            if (!res.success) {
              Alert.alert('Could not delete', res.error ?? 'Unknown error');
              return;
            }
            router.replace('/(lms)');
          } catch (e) {
            Alert.alert(
              'Error',
              e instanceof Error ? e.message : 'Could not delete competition'
            );
          } finally {
            setAdminBusy(false);
          }
        })();
      }
    );
  };

  const onSendBroadcast = () => {
    const title = broadcastTitle.trim();
    const body = broadcastBody.trim();
    if (!title || !body) {
      Alert.alert('Missing message', 'Enter a title and message before sending.');
      return;
    }
    confirmDestructive(
      'Send notification?',
      `This will push to players in “${name}” who have Deadline Alerts enabled.`,
      'Send',
      () => {
        void (async () => {
          setBroadcastSending(true);
          try {
            const res = await lmsAdminBroadcastPush(competitionId, title, body);
            if (!res.success) {
              Alert.alert('Not sent', lmsBroadcastErrorMessage(res.error));
              return;
            }
            setBroadcastTitle('');
            setBroadcastBody('');
            const notified = res.users_notified ?? 0;
            const devices = res.sent ?? 0;
            Alert.alert(
              'Sent',
              notified > 0
                ? `Notification delivered to ${notified} player${notified === 1 ? '' : 's'} (${devices} device${devices === 1 ? '' : 's'}).`
                : 'Notification sent.'
            );
          } catch (e) {
            Alert.alert(
              'Error',
              e instanceof Error ? e.message : 'Could not send notification'
            );
          } finally {
            setBroadcastSending(false);
          }
        })();
      }
    );
  };

  const formatKickoff = (iso: string) => {
    try {
      return new Date(iso).toLocaleString(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  const statusLabel = (s: string) => {
    if (s === 'active') return 'Still standing';
    if (s === 'winner') return 'Champion';
    if (s === 'eliminated') return 'Eliminated';
    return s;
  };

  const statusColor = (s: string) => {
    if (s === 'active' || s === 'winner') return theme.colors.accent;
    if (s === 'eliminated') return theme.colors.error;
    return theme.colors.textMuted;
  };

  const gwOutcomeColor = (outcome: 'W' | 'D' | 'L') => {
    if (outcome === 'W') return theme.colors.accent;
    if (outcome === 'L') return theme.colors.error;
    return theme.colors.textMuted;
  };

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: { flex: 1, backgroundColor: theme.colors.background },
        header: {
          // Web: match competition-hub (body no longer adds safe-area padding).
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
          fontSize: 12,
          color: theme.colors.textSecondary,
          marginTop: 2,
          textTransform: 'capitalize',
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
          flexGrow: 1,
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: insets.bottom + theme.spacing.xl,
          gap: theme.spacing.lg,
        },
        standingContent: {
          paddingHorizontal: 8,
        },
        sectionIntro: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 13,
          color: theme.colors.textSecondary,
          lineHeight: 18,
        },
        rolloverBanner: {
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.statusAccent,
          padding: theme.spacing.md,
          gap: theme.spacing.sm,
        },
        rolloverBannerTitle: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 14,
          color: theme.colors.statusAccent,
          textTransform: 'uppercase',
          letterSpacing: 0.6,
        },
        rolloverBannerBody: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 13,
          color: theme.colors.textSecondary,
          lineHeight: 18,
        },
        rolloverCodeBtn: {
          alignSelf: 'flex-start',
          marginTop: 4,
          paddingVertical: 10,
          paddingHorizontal: 14,
          borderRadius: theme.radius.md,
          borderWidth: 1,
          borderColor: theme.colors.accent,
          backgroundColor: theme.colors.accentMuted,
          gap: 2,
        },
        rolloverCodeText: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 20,
          letterSpacing: 2,
          color: theme.colors.accent,
        },
        rolloverCodeHint: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 11,
          color: theme.colors.textMuted,
        },
        filterLabel: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 11,
          letterSpacing: 1,
          textTransform: 'uppercase',
          color: theme.colors.textMuted,
          marginBottom: 6,
        },
        filterScroll: {
          marginHorizontal: -theme.spacing.lg,
        },
        filterRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: 2,
        },
        filterChip: {
          paddingVertical: 7,
          paddingHorizontal: 12,
          borderRadius: theme.radius.sm,
          backgroundColor: theme.colors.surface,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
        },
        filterChipActive: {
          backgroundColor: theme.colors.accentMuted,
          borderColor: theme.colors.accent,
        },
        filterChipText: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 12,
          color: theme.colors.textSecondary,
        },
        filterChipTextActive: {
          color: theme.colors.accent,
        },
        gwHeader: {
          gap: 2,
          marginTop: theme.spacing.sm,
          marginBottom: 4,
        },
        gwTitle: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 16,
          color: theme.colors.text,
        },
        gwMeta: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 12,
          color: theme.colors.textMuted,
        },
        fixtureList: { gap: 0 },
        fixtureRow: {
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: 12,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.border,
        },
        fixtureInner: {
          flex: 1,
          minWidth: 0,
        },
        fixtureTeamsRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        },
        fixtureTeam: {
          flex: 2,
          minWidth: 0,
          gap: 4,
          alignItems: 'flex-start',
        },
        fixtureTeamAway: {
          alignItems: 'flex-end',
        },
        fixtureTeamMain: {
          flexDirection: 'row',
          alignItems: 'center',
          alignSelf: 'stretch',
          gap: 8,
          paddingVertical: 4,
          paddingHorizontal: 6,
          borderRadius: theme.radius.sm,
          borderWidth: 1.5,
          borderColor: 'transparent',
        },
        fixtureTeamMainAway: {
          flexDirection: 'row-reverse',
        },
        fixtureTeamWin: {
          borderColor: theme.colors.accent,
        },
        fixtureWinLabel: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 10,
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          color: theme.colors.accent,
        },
        fixtureName: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 13,
          color: theme.colors.text,
          flexShrink: 1,
        },
        fixtureNameAway: {
          textAlign: 'right',
        },
        scoreBox: {
          flex: 1,
          minWidth: 52,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 4,
          gap: 2,
        },
        scoreText: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 15,
          color: theme.colors.text,
        },
        scoreTextLive: {
          color: theme.colors.accent,
        },
        inPlayLabel: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 10,
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          color: theme.colors.accent,
        },
        drawLabel: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 11,
          letterSpacing: 0.5,
          textTransform: 'uppercase',
          color: theme.colors.statusAccent,
        },
        vsText: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 12,
          color: theme.colors.textMuted,
        },
        kickoffUnder: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 11,
          color: theme.colors.textMuted,
          marginTop: 2,
        },
        pickBanner: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          padding: theme.spacing.md,
          backgroundColor: theme.colors.accentMuted,
          borderRadius: theme.radius.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.accent,
        },
        pickBannerTitle: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 11,
          letterSpacing: 1,
          textTransform: 'uppercase',
          color: theme.colors.accent,
        },
        pickBannerName: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 16,
          color: theme.colors.text,
          marginTop: 2,
        },
        muted: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 13,
          color: theme.colors.textMuted,
          lineHeight: 18,
        },
        teamGrid: {
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 8,
        },
        teamTile: {
          width: '48%',
          flexGrow: 1,
          flexBasis: '46%',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingVertical: 12,
          paddingHorizontal: 12,
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.md,
          borderWidth: 1.5,
          borderColor: theme.colors.border,
        },
        teamTileSelected: {
          borderColor: theme.colors.accent,
          backgroundColor: theme.colors.accentMuted,
        },
        teamTileDisabled: {
          opacity: 0.45,
        },
        teamTileTextCol: {
          flex: 1,
          flexShrink: 1,
          gap: 2,
        },
        teamTileName: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 13,
          color: theme.colors.text,
          flexShrink: 1,
        },
        teamTileNameSelected: { fontFamily: theme.fontFamily.baiSemiBold, color: theme.colors.accent },
        teamTileVs: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 11,
          color: theme.colors.textSecondary,
        },
        teamTileVsSelected: {
          color: theme.colors.accentDim,
        },
        primaryBtn: {
          backgroundColor: theme.colors.accent,
          borderRadius: theme.radius.md,
          paddingVertical: 14,
          alignItems: 'center',
        },
        primaryBtnDisabled: {
          opacity: 0.45,
        },
        primaryBtnText: {
          fontFamily: theme.fontFamily.baiSemiBold,
          color: theme.colors.white,
          fontSize: 15,
        },
        filterChipUsed: {
          opacity: 0.75,
          backgroundColor: theme.colors.surfaceElevated,
          borderColor: theme.colors.statusAccent,
          borderWidth: 1.5,
        },
        filterChipTextUsed: {
          color: theme.colors.textMuted,
          textDecorationLine: 'line-through',
        },
        prevWrap: {
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 8,
        },
        prevChip: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 5,
          paddingVertical: 4,
          paddingHorizontal: 8,
          borderRadius: theme.radius.sm,
          backgroundColor: theme.colors.surface,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
        },
        prevGw: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 10,
          color: theme.colors.textMuted,
        },
        poolTitle: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 11,
          letterSpacing: 1.1,
          textTransform: 'uppercase',
          color: theme.colors.textMuted,
          marginBottom: 8,
        },
        usedRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingVertical: 6,
          opacity: 0.55,
        },
        usedName: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 13,
          color: theme.colors.textMuted,
          textDecorationLine: 'line-through',
        },
        lbRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingVertical: 12,
          paddingHorizontal: 14,
        },
        lbBlock: {
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.border,
        },
        standingSection: {
          marginTop: theme.spacing.sm,
          marginBottom: theme.spacing.xs,
        },
        standingSectionTitle: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 11,
          letterSpacing: 1.1,
          textTransform: 'uppercase',
          color: theme.colors.textMuted,
          marginBottom: 4,
        },
        standingSectionCount: {
          fontFamily: theme.fontFamily.baiMedium,
          color: theme.colors.textSecondary,
        },
        standingSearchRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.sm,
          paddingHorizontal: 10,
          paddingVertical: Platform.OS === 'web' ? 8 : 6,
          backgroundColor: theme.colors.surface,
          marginBottom: theme.spacing.sm,
        },
        standingSearchInput: {
          flex: 1,
          fontFamily: theme.fontFamily.input,
          fontSize: 14,
          color: theme.colors.text,
          paddingVertical: 2,
          outlineStyle: 'none' as unknown as undefined,
        },
        standingSortRow: {
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 8,
          marginBottom: theme.spacing.sm,
        },
        standingSortChip: {
          paddingVertical: 6,
          paddingHorizontal: 12,
          borderRadius: theme.radius.sm,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface,
        },
        standingSortChipActive: {
          borderColor: theme.colors.accent,
          backgroundColor: theme.colors.accentMuted,
        },
        standingSortChipText: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 12,
          color: theme.colors.textMuted,
        },
        standingSortChipTextActive: {
          color: theme.colors.accent,
          fontFamily: theme.fontFamily.baiSemiBold,
        },
        standingViewRow: {
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 6,
          marginBottom: 4,
        },
        standingBetweenList: {
          gap: 8,
        },
        standingPickGroup: {
          marginBottom: theme.spacing.sm,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.md,
          overflow: 'hidden',
          backgroundColor: theme.colors.surface,
        },
        standingPickGroupHead: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: 14,
          paddingVertical: 8,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.border,
          backgroundColor: theme.colors.surfaceElevated,
        },
        standingPickGroupIconFallback: {
          width: 22,
          height: 22,
          borderRadius: 11,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.background,
        },
        standingPickGroupTitle: {
          flex: 1,
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 13,
          color: theme.colors.text,
        },
        standingPickGroupOutcome: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 12,
          letterSpacing: 0.4,
          minWidth: 16,
          textAlign: 'center',
        },
        standingPickGroupCount: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 12,
          color: theme.colors.textMuted,
          minWidth: 20,
          textAlign: 'right',
        },
        lbBody: { flex: 1, minWidth: 0 },
        lbNameRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
        },
        lbName: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 15,
          color: theme.colors.text,
          flexShrink: 1,
        },
        lbYou: {
          color: theme.colors.accent,
        },
        standingThroughChip: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 10,
          letterSpacing: 0.3,
          textTransform: 'uppercase',
          color: theme.colors.accent,
        },
        livesChip: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 11,
          color: theme.colors.accent,
        },
        standingRoleChip: {
          paddingVertical: 1,
          paddingHorizontal: 6,
          borderRadius: theme.radius.sm,
          backgroundColor: theme.colors.accentMuted,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.accent,
        },
        standingRoleChipText: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 9,
          letterSpacing: 0.4,
          textTransform: 'uppercase',
          color: theme.colors.accent,
        },
        lbOutMeta: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 11,
          color: theme.colors.textMuted,
          marginTop: 2,
        },
        lbDrawer: {
          paddingHorizontal: 14,
          paddingBottom: 12,
          gap: 6,
        },
        lbDrawerEmpty: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 12,
          color: theme.colors.textMuted,
        },
        lbHistoryRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        },
        lbHistoryGw: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 11,
          color: theme.colors.textMuted,
          width: 36,
        },
        lbHistoryName: {
          fontFamily: theme.fontFamily.bai,
          fontSize: 13,
          color: theme.colors.textSecondary,
          flex: 1,
          flexShrink: 1,
        },
        lbHistoryResult: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 11,
          textTransform: 'uppercase',
        },
        lbPick: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          maxWidth: '36%',
        },
        lbPickName: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 12,
          color: theme.colors.textSecondary,
          flexShrink: 1,
        },
        lbPickHidden: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 11,
          color: theme.colors.textMuted,
          fontStyle: 'italic',
        },
        fixtureExcludedNote: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 11,
          color: theme.colors.textMuted,
          textAlign: 'center',
          marginTop: 4,
          fontStyle: 'italic',
        },
        teamTileNote: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 10,
          color: theme.colors.textMuted,
          marginTop: 2,
        },
        adminRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingVertical: 10,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.border,
        },
        adminRowBody: { flex: 1, gap: 2 },
        adminRowTitle: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 14,
          color: theme.colors.text,
        },
        adminRowMeta: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 11,
          color: theme.colors.textMuted,
        },
        playerNameRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          flex: 1,
          minWidth: 0,
        },
        manageDropdownTrigger: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          paddingVertical: 12,
          paddingHorizontal: 12,
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.md,
          backgroundColor: theme.colors.surfaceElevated,
        },
        manageDropdownValue: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 15,
          color: theme.colors.text,
          flexShrink: 1,
        },
        manageDropdownPlaceholder: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 15,
          color: theme.colors.textMuted,
          flexShrink: 1,
        },
        manageDropdownMenu: {
          marginTop: 6,
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.md,
          backgroundColor: theme.colors.surface,
          overflow: 'hidden',
        },
        manageDropdownScroll: {
          maxHeight: 260,
        },
        manageDropdownOption: {
          paddingVertical: 10,
          paddingHorizontal: 12,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.border,
          gap: 2,
        },
        manageDropdownOptionActive: {
          backgroundColor: theme.colors.accentMuted,
        },
        manageDropdownOptionText: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 14,
          color: theme.colors.text,
          flexShrink: 1,
        },
        manageDropdownOptionTextActive: {
          color: theme.colors.accent,
        },
        adminToggle: {
          paddingVertical: 6,
          paddingHorizontal: 10,
          borderRadius: theme.radius.sm,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surfaceElevated,
        },
        adminToggleOn: {
          borderColor: theme.colors.accent,
          backgroundColor: theme.colors.accentMuted,
        },
        adminToggleOff: {
          opacity: 0.85,
        },
        adminToggleText: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 11,
          color: theme.colors.textSecondary,
        },
        adminToggleTextOn: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 11,
          color: theme.colors.accent,
        },
        adminToggleTextOff: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 11,
          color: theme.colors.textSecondary,
        },
        adminSubTabs: {
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 8,
        },
        joinCodeCard: {
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.md,
          padding: theme.spacing.md,
          backgroundColor: theme.colors.surface,
          gap: theme.spacing.sm,
        },
        joinCodeLabel: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 12,
          color: theme.colors.textMuted,
          textTransform: 'uppercase',
          letterSpacing: 0.6,
        },
        joinCodeRow: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: theme.spacing.md,
        },
        joinCodeValue: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 28,
          letterSpacing: 4,
          color: theme.colors.text,
        },
        joinCodeHint: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 11,
          color: theme.colors.textMuted,
        },
        rejoinMeta: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 12,
          color: theme.colors.textSecondary,
        },
        entryInput: {
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
        entrySaveBtn: {
          alignSelf: 'flex-start',
          paddingVertical: 6,
          paddingHorizontal: 10,
          borderRadius: theme.radius.sm,
          borderWidth: 1,
          borderColor: theme.colors.accent,
        },
        entrySaveBtnText: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 12,
          color: theme.colors.accent,
        },
        broadcastBodyInput: {
          minHeight: 96,
          paddingTop: 10,
          paddingBottom: 10,
        },
        shareInviteBtn: {
          marginTop: 4,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          backgroundColor: theme.colors.accent,
          borderRadius: theme.radius.sm,
          paddingVertical: 10,
        },
        shareInviteBtnText: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 14,
          color: theme.colors.white,
        },
        adminSubTab: {
          flexGrow: 1,
          flexBasis: '30%',
          minWidth: 96,
          paddingVertical: 10,
          paddingHorizontal: 8,
          alignItems: 'center',
          borderRadius: theme.radius.sm,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface,
        },
        adminSubTabActive: {
          borderColor: theme.colors.accent,
          backgroundColor: theme.colors.accentMuted,
        },
        adminSubTabText: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 12,
          color: theme.colors.textMuted,
          textAlign: 'center',
        },
        adminSubTabTextActive: {
          color: theme.colors.accent,
        },
        pickStatusBadge: {
          paddingVertical: 5,
          paddingHorizontal: 10,
          borderRadius: theme.radius.sm,
          borderWidth: 1,
        },
        pickStatusBadgeLocked: {
          borderColor: theme.colors.accent,
          backgroundColor: theme.colors.accentMuted,
        },
        pickStatusBadgeMissing: {
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surfaceElevated,
        },
        pickStatusBadgeTextLocked: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 11,
          color: theme.colors.accent,
        },
        pickStatusBadgeTextMissing: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 11,
          color: theme.colors.textSecondary,
        },
        adminJoinActions: {
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 8,
          marginTop: 8,
        },
        adminConfirmBtn: {
          backgroundColor: theme.colors.accent,
          borderRadius: theme.radius.sm,
          paddingVertical: 8,
          paddingHorizontal: 12,
          alignItems: 'center',
        },
        adminConfirmBtnText: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 12,
          color: theme.colors.white,
        },
        adminRejectBtn: {
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.sm,
          paddingVertical: 8,
          paddingHorizontal: 12,
          alignItems: 'center',
          backgroundColor: theme.colors.surfaceElevated,
        },
        adminRejectBtnText: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 12,
          color: theme.colors.text,
        },
        dangerZone: {
          marginTop: theme.spacing.md,
          paddingTop: theme.spacing.lg,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: theme.colors.border,
          gap: theme.spacing.sm,
        },
        removePlayerZone: {
          marginTop: theme.spacing.lg,
          paddingTop: theme.spacing.md,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: theme.colors.border,
          gap: theme.spacing.sm,
        },
        dangerBtn: {
          borderRadius: theme.radius.md,
          paddingVertical: 14,
          alignItems: 'center',
          borderWidth: 1,
          borderColor: theme.colors.error,
          backgroundColor: 'transparent',
        },
        dangerBtnDisabled: {
          opacity: 0.45,
        },
        dangerBtnText: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 14,
          color: theme.colors.error,
        },
        lbStatus: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 12,
          textTransform: 'uppercase',
          letterSpacing: 0.6,
          minWidth: 48,
          textAlign: 'right',
        },
      }),
    [theme, insets.top, insets.bottom, canManage, canHandleJoins]
  );

  const renderFixtureRow = (f: LmsFixture, i: number, list: LmsFixture[]) => {
    const finished = f.status === 'finished';
    const inPlay = f.status === 'live';
    const excluded = !!f.excluded_from_lms;
    const homeForm = formByTeamId.get(f.home_team_id) ?? [null, null, null, null, null];
    const awayForm = formByTeamId.get(f.away_team_id) ?? [null, null, null, null, null];
    const hg = f.home_goals;
    const ag = f.away_goals;
    const hasScore = hg != null && ag != null;
    const isDraw =
      finished && hasScore && hg === ag;
    const homeWin =
      finished && hasScore && hg > ag;
    const awayWin =
      finished && hasScore && ag > hg;

    return (
      <View
        key={f.id}
        style={[
          styles.fixtureRow,
          i === list.length - 1 && { borderBottomWidth: 0 },
          excluded && { opacity: 0.55 },
        ]}
      >
        <View style={styles.fixtureInner}>
          <View style={styles.fixtureTeamsRow}>
            <View style={styles.fixtureTeam}>
              <View
                style={[styles.fixtureTeamMain, homeWin && styles.fixtureTeamWin]}
              >
                <TeamColourChip
                  shortName={f.home_team?.short_name}
                  name={f.home_team?.name}
                  slug={f.home_team?.slug}
                  size={24}
                />
                <Text style={styles.fixtureName} numberOfLines={1}>
                  {f.home_team?.short_name ?? f.home_team?.name ?? 'H'}
                </Text>
                {homeWin ? <Text style={styles.fixtureWinLabel}>Win</Text> : null}
              </View>
              <TeamFormDots results={homeForm} />
            </View>
            <View style={styles.scoreBox}>
              {finished && hasScore ? (
                <>
                  <Text style={styles.scoreText}>
                    {hg}–{ag}
                  </Text>
                  {isDraw ? <Text style={styles.drawLabel}>Draw</Text> : null}
                </>
              ) : inPlay ? (
                <>
                  {hasScore ? (
                    <Text style={[styles.scoreText, styles.scoreTextLive]}>
                      {hg}–{ag}
                    </Text>
                  ) : null}
                  <Text style={styles.inPlayLabel}>In play</Text>
                </>
              ) : (
                <>
                  <Text style={styles.vsText}>vs</Text>
                  <Text style={styles.kickoffUnder}>
                    {new Date(f.kickoff_at).toLocaleTimeString(undefined, {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </Text>
                </>
              )}
            </View>
            <View style={[styles.fixtureTeam, styles.fixtureTeamAway]}>
              <View
                style={[
                  styles.fixtureTeamMain,
                  styles.fixtureTeamMainAway,
                  awayWin && styles.fixtureTeamWin,
                ]}
              >
                <TeamColourChip
                  shortName={f.away_team?.short_name}
                  name={f.away_team?.name}
                  slug={f.away_team?.slug}
                  size={24}
                />
                <Text style={[styles.fixtureName, styles.fixtureNameAway]} numberOfLines={1}>
                  {f.away_team?.short_name ?? f.away_team?.name ?? 'A'}
                </Text>
                {awayWin ? <Text style={styles.fixtureWinLabel}>Win</Text> : null}
              </View>
              <TeamFormDots results={awayForm} />
            </View>
          </View>
          {excluded ? (
            <Text style={styles.fixtureExcludedNote}>
              {f.excluded_reason?.trim() || 'Excluded from LMS'}
            </Text>
          ) : null}
        </View>
      </View>
    );
  };

  const renderStandingRow = (
    p: LmsParticipant,
    opts?: { showOutGw?: boolean; hidePick?: boolean }
  ) => {
    const isYou = p.user_id === userId;
    const userPick = pickByUserId.get(p.user_id);
    const expanded = expandedUserId === p.user_id;
    const history = historyByUserId.get(p.user_id) ?? [];
    const outGw =
      opts?.showOutGw && p.eliminated_gameweek_id
        ? gwNumberById.get(p.eliminated_gameweek_id)
        : null;
    const throughToNext = p.status === 'active' && userPick?.result === 'correct';
    const statusText =
      p.status === 'active' ? 'Alive' : p.status === 'winner' ? 'Winner' : 'Out';
    const showPick = !opts?.hidePick;

    return (
      <View key={p.id} style={styles.lbBlock}>
        <Pressable
          style={styles.lbRow}
          onPress={() => setExpandedUserId((prev) => (prev === p.user_id ? null : p.user_id))}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={`${p.username || 'Player'}${throughToNext ? ', through to next round' : ''} history`}
        >
          <View style={styles.lbBody}>
            <View style={styles.lbNameRow}>
              <Text style={[styles.lbName, isYou && styles.lbYou]} numberOfLines={1}>
                {p.username || p.user_id.slice(0, 8)}
                {isYou ? ' (you)' : ''}
              </Text>
              {throughToNext ? (
                <Text style={styles.standingThroughChip} accessibilityLabel="Through to next round">
                  Through
                </Text>
              ) : null}
              {managerUserIds.has(p.user_id) ? (
                <Ionicons
                  name="star"
                  size={14}
                  color={theme.colors.accent}
                  accessibilityLabel="Manager"
                />
              ) : null}
              {extraLives > 0 && p.status === 'active' ? (
                <Text style={styles.livesChip}>
                  {Math.max(0, p.lives_remaining ?? 0)} extra
                </Text>
              ) : null}
              <Ionicons
                name={expanded ? 'chevron-up' : 'chevron-down'}
                size={14}
                color={theme.colors.textMuted}
              />
            </View>
            {outGw != null ? <Text style={styles.lbOutMeta}>Out GW{outGw}</Text> : null}
          </View>
          {showPick && p.status !== 'eliminated' && currentGw ? (
            picksRevealed && userPick?.team ? (
              <View style={styles.lbPick}>
                <TeamColourChip
                  shortName={userPick.team.short_name}
                  name={userPick.team.name}
                  slug={userPick.team.slug}
                  size={22}
                />
                <Text style={styles.lbPickName} numberOfLines={1}>
                  {userPick.team.short_name || lmsDisplayTeamName(userPick.team.name)}
                </Text>
              </View>
            ) : (
              <Text style={styles.lbPickHidden}>{picksRevealed ? 'No pick' : 'Hidden'}</Text>
            )
          ) : null}
          <Text style={[styles.lbStatus, { color: statusColor(p.status) }]}>{statusText}</Text>
        </Pressable>
        {expanded ? (
          <View style={styles.lbDrawer}>
            {historyLoadingUserId === p.user_id ? (
              <ActivityIndicator color={theme.colors.accent} />
            ) : history.length === 0 ? (
              <Text style={styles.lbDrawerEmpty}>No completed gameweek picks yet.</Text>
            ) : (
              history.map((h) => (
                <View key={`${h.gameweek_id}-${h.team_id}`} style={styles.lbHistoryRow}>
                  <Text style={styles.lbHistoryGw}>GW{h.gameweek_number}</Text>
                  <TeamColourChip
                    shortName={h.team?.short_name}
                    name={h.team?.name}
                    slug={h.team?.slug}
                    size={20}
                  />
                  <Text style={styles.lbHistoryName} numberOfLines={1}>
                    {lmsDisplayTeamName(h.team?.name) || 'Unknown team'}
                  </Text>
                  <Text
                    style={[
                      styles.lbHistoryResult,
                      {
                        color:
                          h.result === 'correct'
                            ? theme.colors.accent
                            : h.result === 'incorrect'
                              ? theme.colors.error
                              : theme.colors.textMuted,
                      },
                    ]}
                  >
                    {h.result === 'correct' ? 'Won' : h.result === 'incorrect' ? 'Out' : h.result}
                  </Text>
                </View>
              ))
            )}
          </View>
        ) : null}
      </View>
    );
  };

  const renderPickGroups = (
    groups: {
      key: string;
      label: string;
      team: LmsTeam | null;
      players: LmsParticipant[];
    }[],
    opts?: { showOutGw?: boolean }
  ) =>
    groups.map((group) => {
      const grouped = Boolean(group.label);
      const teamOutcome = group.team ? gwOutcomeByTeamId.get(group.team.id) : undefined;
      return (
        <View key={group.key} style={grouped ? styles.standingPickGroup : undefined}>
          {grouped ? (
            <View style={styles.standingPickGroupHead}>
              {group.team ? (
                <TeamColourChip
                  shortName={group.team.short_name}
                  name={group.team.name}
                  slug={group.team.slug}
                  size={22}
                />
              ) : (
                <View style={styles.standingPickGroupIconFallback}>
                  <Ionicons name="help-outline" size={14} color={theme.colors.textMuted} />
                </View>
              )}
              <Text style={styles.standingPickGroupTitle} numberOfLines={1}>
                {group.label}
              </Text>
              {teamOutcome ? (
                <Text
                  style={[
                    styles.standingPickGroupOutcome,
                    { color: gwOutcomeColor(teamOutcome) },
                  ]}
                  accessibilityLabel={
                    teamOutcome === 'W'
                      ? 'Won'
                      : teamOutcome === 'L'
                        ? 'Lost'
                        : 'Drew'
                  }
                >
                  {teamOutcome}
                </Text>
              ) : null}
              <Text style={styles.standingPickGroupCount}>{group.players.length}</Text>
            </View>
          ) : null}
          {group.players.map((p) =>
            renderStandingRow(p, {
              showOutGw: opts?.showOutGw,
              hidePick: grouped && group.key !== 'no-pick',
            })
          )}
        </View>
      );
    });

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={openSidebar} hitSlop={8} accessibilityRole="button" accessibilityLabel="Open menu">
          <Ionicons name="menu" size={24} color={theme.colors.text} />
        </Pressable>
        <Pressable onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={22} color={theme.colors.text} />
        </Pressable>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>{name}</Text>
          <Text style={styles.sub}>Last Man Standing · {compStatus || '—'}</Text>
        </View>
        <Pressable
          style={styles.headerRefresh}
          onPress={requestManualRefresh}
          disabled={refreshing || loading}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Refresh competition"
        >
          {refreshing ? (
            <ActivityIndicator size="small" color={theme.colors.accent} />
          ) : (
            <Ionicons name="refresh" size={22} color={theme.colors.text} />
          )}
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

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={theme.colors.accent} />
      ) : (
        <>
          <View style={styles.survivalBanner}>
            <View style={styles.survivalLeft}>
              <Text
                style={[
                  styles.survivalStatus,
                  {
                    color: isGamemasterAdmin
                      ? theme.colors.accent
                      : statusColor(me?.status ?? 'eliminated'),
                  },
                ]}
              >
                {isGamemasterAdmin ? 'Admin' : statusLabel(me?.status ?? '—')}
              </Text>
              <Text style={styles.survivalMeta}>
                {isGamemasterAdmin
                  ? 'Club competition management'
                  : currentGw
                    ? `Gameweek ${currentGw.number}${deadlinePassed ? ' · picks closed' : ' · picks open'}`
                    : startGwNumber != null
                      ? `Starts GW${startGwNumber}`
                      : 'Waiting for gameweek'}
              </Text>
            </View>
            <View style={styles.survivalStat}>
              <Text style={styles.survivalStatValue}>
                {isGamemasterAdmin
                  ? quotaMax != null
                    ? `${signedUpCount}/${quotaMax}`
                    : `${signedUpCount}`
                  : aliveCount}
              </Text>
              <Text style={styles.survivalStatLabel}>
                {isGamemasterAdmin ? 'Signed up' : 'Alive'}
              </Text>
            </View>
          </View>

          {!isGamemasterAdmin ? (
            <View style={styles.tabs}>
              {(
                [
                  { key: 'gameweeks' as const, label: 'Gameweeks' },
                  { key: 'selection' as const, label: 'Selection' },
                  { key: 'leaderboard' as const, label: 'Standing' },
                  ...(canHandleJoins ? [{ key: 'admin' as const, label: 'Admin' }] : []),
                ] as { key: TabKey; label: string }[]
              ).map((t) => {
                const active = tab === t.key;
                return (
                  <Pressable
                    key={t.key}
                    style={[styles.tab, active && styles.tabActive]}
                    onPress={() => setTab(t.key)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={[styles.tabText, active && styles.tabTextActive]}>{t.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          <ScrollView
            contentContainerStyle={[
              styles.content,
              tab === 'leaderboard' && styles.standingContent,
            ]}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={requestManualRefresh}
                tintColor={theme.colors.accent}
                colors={[theme.colors.accent]}
              />
            }
          >
            {tab === 'gameweeks' ? (
              gameweeksLoading && !gameweeks.length ? (
                <ActivityIndicator style={{ marginTop: 24 }} color={theme.colors.accent} />
              ) : (
              <>
                <Text style={styles.sectionIntro}>
                  Fixtures load per gameweek and stay cached while this tab is open. Form dots under
                  each club show their last five results (green / grey / red).
                </Text>

                <View>
                  <Text style={styles.filterLabel}>Gameweek</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.filterScroll}
                    contentContainerStyle={styles.filterRow}
                    nestedScrollEnabled
                  >
                    <Pressable
                      style={[styles.filterChip, !filterGwId && styles.filterChipActive]}
                      onPress={() => setFilterGwId(null)}
                    >
                      <Text
                        style={[
                          styles.filterChipText,
                          !filterGwId && styles.filterChipTextActive,
                        ]}
                      >
                        Opened
                      </Text>
                    </Pressable>
                    {gameweeks.map((g) => {
                      const active = filterGwId === g.id;
                      return (
                        <Pressable
                          key={g.id}
                          style={[styles.filterChip, active && styles.filterChipActive]}
                          onPress={() => setFilterGwId(g.id)}
                        >
                          <Text
                            style={[
                              styles.filterChipText,
                              active && styles.filterChipTextActive,
                            ]}
                          >
                            GW{g.number}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>

                <View>
                  <Text style={styles.filterLabel}>Team</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.filterScroll}
                    contentContainerStyle={styles.filterRow}
                    nestedScrollEnabled
                  >
                    <Pressable
                      style={[styles.filterChip, !filterTeamId && styles.filterChipActive]}
                      onPress={() => setFilterTeamId(null)}
                    >
                      <Text
                        style={[
                          styles.filterChipText,
                          !filterTeamId && styles.filterChipTextActive,
                        ]}
                      >
                        All
                      </Text>
                    </Pressable>
                    {teamsAlphabetical.map((t) => {
                      const active = filterTeamId === t.id;
                      const used = usedTeamIdSet.has(t.id);
                      return (
                        <Pressable
                          key={t.id}
                          style={[
                            styles.filterChip,
                            active && styles.filterChipActive,
                            used && styles.filterChipUsed,
                          ]}
                          onPress={() => setFilterTeamId(active ? null : t.id)}
                          accessibilityState={{ selected: active, disabled: false }}
                          accessibilityLabel={
                            used
                              ? `${t.short_name || t.name} already used`
                              : t.short_name || t.name
                          }
                        >
                          <Text
                            style={[
                              styles.filterChipText,
                              active && styles.filterChipTextActive,
                              used && styles.filterChipTextUsed,
                            ]}
                          >
                            {t.short_name || lmsDisplayTeamName(t.name)}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>

                {fixturesLoadingGwId && filterGwId === fixturesLoadingGwId ? (
                  <ActivityIndicator style={{ marginVertical: 16 }} color={theme.colors.accent} />
                ) : fixturesByGameweek.length === 0 ? (
                  <Text style={styles.muted}>
                    {!filterGwId
                      ? 'No gameweeks opened yet this session. Pick a gameweek above to load fixtures.'
                      : 'No fixtures match these filters.'}
                  </Text>
                ) : (
                  fixturesByGameweek.map((group) => (
                    <View key={group.number}>
                      <View style={styles.gwHeader}>
                        <Text style={styles.gwTitle}>Gameweek {group.number}</Text>
                        <Text style={styles.gwMeta}>
                          {group.gw?.status === 'complete'
                            ? 'Results final'
                            : group.gw?.status === 'live'
                              ? 'In play'
                              : group.gw
                                ? `From ${formatKickoff(group.gw.starts_at)}`
                                : `${group.fixtures.length} fixture${group.fixtures.length === 1 ? '' : 's'}`}
                        </Text>
                      </View>
                      <View style={styles.fixtureList}>
                        {group.fixtures.map((f, i) =>
                          renderFixtureRow(f, i, group.fixtures)
                        )}
                      </View>
                    </View>
                  ))
                )}
              </>
              )
            ) : null}

            {tab === 'selection' ? (
              selectionLoading && poolTeamIds.length === 0 ? (
                <ActivityIndicator style={{ marginTop: 24 }} color={theme.colors.accent} />
              ) : (
              <>
                <Text style={styles.sectionIntro}>
                  {extraLives > 0
                    ? `Pick one unused team that must win this gameweek. A draw or defeat uses one extra life; you go out when none are left. This league starts with ${extraLives} extra ${extraLives === 1 ? 'life' : 'lives'}. You have ${Math.max(0, me?.lives_remaining ?? 0)} left. A missed pick still goes out. Each club can only be used once. Deadline is 20 minutes before the first kick-off — if you miss it, the next unused team alphabetically is assigned for you.`
                    : 'Pick one unused team that must win this gameweek. Draws eliminate you. Each club can only be used once. Deadline is 20 minutes before the first kick-off — if you miss it, the next unused team alphabetically is assigned for you.'}
                </Text>

                <View>
                  <Text style={styles.poolTitle}>Previous selected teams</Text>
                  {myPreviousSelections.length === 0 ? (
                    <Text style={styles.muted}>No teams selected yet.</Text>
                  ) : (
                    <View style={styles.prevWrap}>
                      {myPreviousSelections.map((s) => (
                        <View key={`${s.gameweek_number}-${s.team_id}`} style={styles.prevChip}>
                          <Text style={styles.prevGw}>GW{s.gameweek_number}</Text>
                          <TeamColourChip
                            shortName={s.team?.short_name}
                            name={s.team?.name}
                            slug={s.team?.slug}
                            size={18}
                          />
                        </View>
                      ))}
                    </View>
                  )}
                </View>

                {currentPickTeam ? (
                  <View style={styles.pickBanner}>
                    <TeamColourChip
                      shortName={currentPickTeam.short_name}
                      name={currentPickTeam.name}
                      slug={currentPickTeam.slug}
                      size={40}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.pickBannerTitle}>
                        {canPick ? 'Your current pick' : 'Locked pick'}
                      </Text>
                      <Text style={styles.pickBannerName}>
                        {lmsDisplayTeamName(currentPickTeam.name)}
                      </Text>
                      <SelectionTeamFormDots
                        teamResults={
                          formByTeamId.get(currentPickTeam.id) ?? [
                            null,
                            null,
                            null,
                            null,
                            null,
                          ]
                        }
                        opponentResults={
                          opponentByTeamId.get(currentPickTeam.id)
                            ? formByTeamId.get(
                                opponentByTeamId.get(currentPickTeam.id)!.id
                              ) ?? [null, null, null, null, null]
                            : null
                        }
                      />
                    </View>
                  </View>
                ) : null}

                {me?.status !== 'active' ? (
                  <Text style={styles.muted}>
                    {me?.status === 'winner'
                      ? 'You won this competition. Check Standing for your road to the title.'
                      : 'You are eliminated and cannot make further picks.'}
                  </Text>
                ) : !currentGw ? (
                  <Text style={styles.muted}>
                    {startGwNumber != null
                      ? `This competition starts at GW${startGwNumber}. Selection opens then.`
                      : 'No open gameweek for picks yet.'}
                  </Text>
                ) : !canPick ? (
                  <Text style={styles.muted}>
                    {pick
                      ? 'Picks are locked for this gameweek. Come back after settlement for the next round.'
                      : 'Picks are closed for this gameweek.'}
                  </Text>
                ) : selectionTeams.length === 0 ? (
                  <Text style={styles.muted}>
                    No unused teams left in this competition’s pool for this gameweek.
                  </Text>
                ) : (
                  <>
                    <Text style={styles.poolTitle}>
                      Choose a winner · GW{currentGw.number}
                    </Text>
                    {remainingTeams.length === 0 ? (
                      <Text style={styles.muted}>
                        Every remaining pool team is unavailable this gameweek (excluded fixture or
                        no game).
                      </Text>
                    ) : (
                      <Pressable
                        style={[
                          styles.primaryBtn,
                          (!selectedTeamId ||
                            saving ||
                            !playingTeamIds.has(selectedTeamId)) &&
                            styles.primaryBtnDisabled,
                        ]}
                        disabled={
                          !selectedTeamId ||
                          saving ||
                          !playingTeamIds.has(selectedTeamId)
                        }
                        onPress={() => {
                          if (selectedTeamId) requestConfirmPick(selectedTeamId);
                        }}
                      >
                        {saving ? (
                          <ActivityIndicator color={theme.colors.white} />
                        ) : (
                          <Text style={styles.primaryBtnText}>
                            {pick ? 'Update pick' : 'Lock in pick'}
                          </Text>
                        )}
                      </Pressable>
                    )}
                    <View style={styles.teamGrid}>
                      {selectionTeams.map((t) => {
                        const selected = selectedTeamId === t.id;
                        const pickable = playingTeamIds.has(t.id);
                        const note = unavailableNoteByTeamId.get(t.id);
                        const opponent = opponentByTeamId.get(t.id);
                        const opponentLabel =
                          opponent?.short_name || opponent?.name || null;
                        const venue = venueByTeamId.get(t.id);
                        const opponentVenue = opponent
                          ? venueByTeamId.get(opponent.id)
                          : undefined;
                        const teamLabel = venue
                          ? `${lmsDisplayTeamName(t.name)} (${venue})`
                          : lmsDisplayTeamName(t.name);
                        const vsLabel =
                          opponentLabel && opponentVenue
                            ? `vs ${opponentLabel} (${opponentVenue})`
                            : opponentLabel
                              ? `vs ${opponentLabel}`
                              : null;
                        return (
                          <Pressable
                            key={t.id}
                            style={[
                              styles.teamTile,
                              selected && pickable && styles.teamTileSelected,
                              !pickable && styles.teamTileDisabled,
                            ]}
                            onPress={() => {
                              if (!pickable || saving) return;
                              requestConfirmPick(t.id);
                            }}
                            disabled={!pickable || saving}
                            accessibilityRole="button"
                            accessibilityState={{ disabled: !pickable, selected }}
                            accessibilityLabel={
                              !pickable
                                ? `${teamLabel} unavailable: ${note ?? 'No game'}`
                                : vsLabel
                                  ? `Select ${teamLabel} ${vsLabel}`
                                  : `Select ${teamLabel}`
                            }
                          >
                            <TeamColourChip shortName={t.short_name} name={t.name} slug={t.slug} size={28} />
                            <View style={styles.teamTileTextCol}>
                              <Text
                                style={[
                                  styles.teamTileName,
                                  selected && pickable && styles.teamTileNameSelected,
                                ]}
                                numberOfLines={2}
                              >
                                {teamLabel}
                              </Text>
                              {vsLabel ? (
                                <Text
                                  style={[
                                    styles.teamTileVs,
                                    selected && pickable && styles.teamTileVsSelected,
                                  ]}
                                  numberOfLines={1}
                                >
                                  {vsLabel}
                                </Text>
                              ) : null}
                              <SelectionTeamFormDots
                                teamResults={
                                  formByTeamId.get(t.id) ?? [null, null, null, null, null]
                                }
                                opponentResults={
                                  opponent
                                    ? formByTeamId.get(opponent.id) ?? [
                                        null,
                                        null,
                                        null,
                                        null,
                                        null,
                                      ]
                                    : null
                                }
                              />
                              {!pickable && note ? (
                                <Text style={styles.teamTileNote} numberOfLines={2}>
                                  {note}
                                </Text>
                              ) : null}
                            </View>
                            {selected && pickable ? (
                              <Ionicons
                                name="checkmark-circle"
                                size={18}
                                color={theme.colors.accent}
                              />
                            ) : null}
                          </Pressable>
                        );
                      })}
                    </View>
                  </>
                )}

                {poolTeams.available.length > 0 && !canPick ? (
                  <View>
                    <Text style={styles.poolTitle}>Still in your pool</Text>
                    <View style={styles.teamGrid}>
                      {poolTeams.available.map((t) => (
                        <View key={t.id} style={[styles.teamTile, styles.teamTileDisabled]}>
                          <TeamColourChip shortName={t.short_name} name={t.name} slug={t.slug} size={28} />
                          <Text style={styles.teamTileName} numberOfLines={2}>
                            {lmsDisplayTeamName(t.name)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                ) : null}
              </>
              )
            ) : null}

            {tab === 'leaderboard' ? (
              <>
                {rolloverActive && (canRequestRejoin || hasPendingRejoin) ? (
                  <View style={styles.rolloverBanner}>
                    <Text style={styles.rolloverBannerTitle}>Rollover</Text>
                    <Text style={styles.rolloverBannerBody}>
                      There was no overall winner for this competition, the prize pool will now
                      rollover to the next competition.
                    </Text>
                    {hasPendingRejoin ? (
                      <Text style={styles.rolloverBannerBody}>
                        Your rejoin request is waiting for organiser approval
                        {rolloverRejoinGw != null ? ` (GW${rolloverRejoinGw})` : ''}.
                      </Text>
                    ) : (
                      <>
                        <Text style={styles.rolloverBannerBody}>
                          Tap Rejoin to ask the organiser to bring you back in
                          {rolloverRejoinGw != null ? ` for GW${rolloverRejoinGw}` : ''}.
                        </Text>
                        <Pressable
                          style={[styles.rolloverCodeBtn, rejoinBusy && styles.primaryBtnDisabled]}
                          onPress={() => void onRequestRejoin()}
                          disabled={rejoinBusy}
                          accessibilityRole="button"
                          accessibilityLabel="Request to rejoin this competition"
                        >
                          {rejoinBusy ? (
                            <ActivityIndicator color={theme.colors.accent} />
                          ) : (
                            <>
                              <Text style={styles.rolloverCodeText}>Rejoin</Text>
                              <Text style={styles.rolloverCodeHint}>Notify the organiser</Text>
                            </>
                          )}
                        </Pressable>
                      </>
                    )}
                  </View>
                ) : null}
                {champion ? (
                  championJourneySteps.length > 0 ? (
                    <ChampionStandingJourney
                      champion={champion}
                      steps={championJourneySteps}
                      totalPlayers={leaderboard.length}
                      isYou={champion.user_id === userId}
                    />
                  ) : standingBoardLoading || historyLoadingUserId === champion.user_id ? (
                    <ActivityIndicator color={theme.colors.accent} style={{ marginTop: 16 }} />
                  ) : (
                    <Text style={styles.muted}>Loading champion journey…</Text>
                  )
                ) : (
                  <>
                <Text style={styles.sectionIntro}>
                  {standingViewMode === 'cards' || standingViewMode === 'pools'
                    ? 'Browse players as cards or pool grids to see used teams (with GW#) and what’s still available. List view shows the classic standing.'
                    : standingBetweenWeeks
                      ? 'Between gameweeks — browse players as cards or pool grids to see used teams and what’s still available. List view keeps the classic standing.'
                      : 'Still standing wins. During the gameweek, List groups players under their pick. Finished fixtures show W / D / L beside the team; players whose pick won get a Through mark. Use Cards or Pools for the used-teams board. Switch between A–Z and most picked on List. Tap a player for their used teams.'}
                  {currentGw
                    ? picksRevealed
                      ? ` Showing GW${currentGw.number} picks.`
                      : standingBetweenWeeks
                        ? ` Next up: GW${currentGw.number}.`
                        : ` GW${currentGw.number} picks stay hidden until the first kickoff.`
                    : ''}
                </Text>
                <View style={styles.standingSearchRow}>
                  <Ionicons name="search" size={16} color={theme.colors.textMuted} />
                  <TextInput
                    style={styles.standingSearchInput}
                    value={standingSearch}
                    onChangeText={setStandingSearch}
                    placeholder="Search player…"
                    placeholderTextColor={theme.colors.textMuted}
                    autoCorrect={false}
                    autoCapitalize="none"
                    clearButtonMode="while-editing"
                    accessibilityLabel="Search standing by username"
                  />
                  {standingSearch.trim() ? (
                    <Pressable
                      onPress={() => setStandingSearch('')}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel="Clear search"
                    >
                      <Ionicons name="close-circle" size={16} color={theme.colors.textMuted} />
                    </Pressable>
                  ) : null}
                </View>
                <View style={styles.standingViewRow}>
                  {(
                    [
                      { key: 'cards' as const, label: 'Cards', a11y: 'Player cards with used teams' },
                      { key: 'pools' as const, label: 'Pools', a11y: 'Player pool grids' },
                      { key: 'list' as const, label: 'List', a11y: 'Classic standing list' },
                    ] as const
                  ).map((opt) => {
                    const active = standingViewMode === opt.key;
                    return (
                      <Pressable
                        key={opt.key}
                        style={[styles.standingSortChip, active && styles.standingSortChipActive]}
                        onPress={() => setStandingViewMode(opt.key)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        accessibilityLabel={opt.a11y}
                      >
                        <Text
                          style={[
                            styles.standingSortChipText,
                            active && styles.standingSortChipTextActive,
                          ]}
                        >
                          {opt.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {standingViewMode === 'list' && !standingBetweenWeeks && picksRevealed ? (
                  <View style={styles.standingSortRow}>
                    {(
                      [
                        { key: 'alpha' as const, label: 'A–Z' },
                        { key: 'popular' as const, label: 'Most picked' },
                      ] as const
                    ).map((opt) => {
                      const active = standingPickSort === opt.key;
                      return (
                        <Pressable
                          key={opt.key}
                          style={[styles.standingSortChip, active && styles.standingSortChipActive]}
                          onPress={() => setStandingPickSort(opt.key)}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active }}
                          accessibilityLabel={`Sort teams ${opt.label}`}
                        >
                          <Text
                            style={[
                              styles.standingSortChipText,
                              active && styles.standingSortChipTextActive,
                            ]}
                          >
                            {opt.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
                {leaderboard.length === 0 ? (
                  <Text style={styles.muted}>No players in this competition yet.</Text>
                ) : standingViewMode === 'cards' || standingViewMode === 'pools' ? (
                  standingBoardLoading && standingBoardPool.length === 0 ? (
                    <ActivityIndicator color={theme.colors.accent} style={{ marginTop: 16 }} />
                  ) : standingBetweenPlayers.length === 0 ? (
                    <Text style={styles.muted}>
                      No players match “{standingSearch.trim()}”.
                    </Text>
                  ) : standingViewMode === 'cards' ? (
                    <StandingPlayerCards
                      players={standingBetweenPlayers}
                      picksByUserId={standingBoardByUserId}
                      onPressPlayer={(id) =>
                        setExpandedUserId((prev) => (prev === id ? null : id))
                      }
                    />
                  ) : (
                    <View style={styles.standingBetweenList}>
                      {standingBetweenPlayers.map((p) => (
                        <StandingPlayerPoolCard
                          key={p.id}
                          player={p}
                          poolTeams={standingBoardPool}
                          picks={standingBoardByUserId.get(p.user_id) ?? []}
                          onPress={() =>
                            setExpandedUserId((prev) => (prev === p.user_id ? null : p.user_id))
                          }
                        />
                      ))}
                    </View>
                  )
                ) : standingSections.matchCount === 0 ? (
                  <Text style={styles.muted}>No players match “{standingSearch.trim()}”.</Text>
                ) : (
                  <>
                    {standingSections.survivors.length > 0 ? (
                      <View style={styles.standingSection}>
                        <Text style={styles.standingSectionTitle}>
                          {standingSections.survivors.every((p) => p.status === 'winner')
                            ? standingSections.survivors.length === 1
                              ? 'Champion'
                              : 'Champions'
                            : 'Still standing'}
                          <Text style={styles.standingSectionCount}>
                            {' '}
                            · {standingSections.survivors.length}
                          </Text>
                        </Text>
                        {renderPickGroups(standingSections.survivorsByPick)}
                      </View>
                    ) : null}

                    {standingSections.outThisWeek.length > 0 ? (
                      <View style={styles.standingSection}>
                        <Text style={styles.standingSectionTitle}>
                          Out this week
                          {currentGw ? ` · GW${currentGw.number}` : ''}
                          <Text style={styles.standingSectionCount}>
                            {' '}
                            · {standingSections.outThisWeek.length}
                          </Text>
                        </Text>
                        {renderPickGroups(standingSections.outThisWeekByPick, {
                          showOutGw: true,
                        })}
                      </View>
                    ) : null}

                    {standingSections.eliminated.length > 0 ? (
                      <View style={styles.standingSection}>
                        <Text style={styles.standingSectionTitle}>
                          Eliminated
                          <Text style={styles.standingSectionCount}>
                            {' '}
                            · {standingSections.eliminated.length}
                          </Text>
                        </Text>
                        {standingSections.eliminated.map((p) =>
                          renderStandingRow(p, { showOutGw: true })
                        )}
                      </View>
                    ) : null}
                  </>
                )}
                  </>
                )}
              </>
            ) : null}

            {tab === 'admin' && canHandleJoins ? (
              <>
                <View style={styles.joinCodeCard}>
                  <Text style={styles.joinCodeLabel}>Join code</Text>
                  <Pressable
                    style={styles.joinCodeRow}
                    onPress={() => void copyAccessCode(joinCode, 'join code')}
                    accessibilityRole="button"
                    accessibilityLabel={
                      joinCode ? `Copy join code ${joinCode}` : 'No join code available'
                    }
                  >
                    <View>
                      <Text style={styles.joinCodeValue}>{joinCode ?? '————'}</Text>
                      <Text style={styles.joinCodeHint}>
                        {joinCode ? 'Tap to copy · share with players' : 'No join code yet'}
                      </Text>
                    </View>
                    {joinCode ? (
                      <Ionicons name="copy-outline" size={22} color={theme.colors.accent} />
                    ) : null}
                  </Pressable>
                  {rejoinCode ? (
                    <Pressable
                      onPress={() => void copyAccessCode(rejoinCode, 'rejoin code')}
                      accessibilityRole="button"
                      accessibilityLabel={`Copy rejoin code ${rejoinCode}`}
                    >
                      <Text style={styles.rejoinMeta}>
                        Active rejoin code: {rejoinCode} · tap to copy
                      </Text>
                    </Pressable>
                  ) : null}
                  {canManage ? (
                    <>
                      <Text style={styles.joinCodeLabel}>Entry fee</Text>
                      <TextInput
                        style={styles.entryInput}
                        value={entryDraft}
                        onChangeText={setEntryDraft}
                        placeholder="£10 cash to organiser"
                        placeholderTextColor={theme.colors.textMuted}
                        autoCorrect={false}
                        editable={!entrySaving}
                      />
                      <Text style={styles.joinCodeHint}>
                        Display only — money is not taken in the app.
                      </Text>
                      <Pressable
                        style={styles.entrySaveBtn}
                        onPress={() => void onSaveEntry()}
                        disabled={entrySaving}
                        accessibilityRole="button"
                        accessibilityLabel="Save entry fee"
                      >
                        {entrySaving ? (
                          <ActivityIndicator size="small" color={theme.colors.accent} />
                        ) : (
                          <Text style={styles.entrySaveBtnText}>Save entry</Text>
                        )}
                      </Pressable>
                    </>
                  ) : null}
                  <Pressable
                    style={styles.shareInviteBtn}
                    onPress={() =>
                      router.push({
                        pathname: '/(lms)/share/[competitionId]',
                        params: { competitionId },
                      } as any)
                    }
                    accessibilityRole="button"
                    accessibilityLabel="Share competition invite"
                  >
                    <Ionicons name="share-outline" size={18} color={theme.colors.white} />
                    <Text style={styles.shareInviteBtnText}>Share</Text>
                  </Pressable>
                </View>

                {canManage ? (
                  <View style={styles.adminSubTabs}>
                    {(
                      [
                        { key: 'joins' as const, label: 'Join requests' },
                        { key: 'pool' as const, label: 'Team pool' },
                        { key: 'users' as const, label: 'Manage user' },
                        { key: 'picks' as const, label: 'Picks' },
                        { key: 'notify' as const, label: 'Notify' },
                      ] as const
                    ).map((t) => {
                      const active = adminSubTab === t.key;
                      return (
                        <Pressable
                          key={t.key}
                          style={[styles.adminSubTab, active && styles.adminSubTabActive]}
                          onPress={() => setAdminSubTab(t.key)}
                          accessibilityRole="tab"
                          accessibilityState={{ selected: active }}
                        >
                          <Text
                            style={[
                              styles.adminSubTabText,
                              active && styles.adminSubTabTextActive,
                            ]}
                          >
                            {t.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : isCompManager ? (
                  <View style={styles.adminSubTabs}>
                    {(
                      [
                        { key: 'joins' as const, label: 'Join requests' },
                        { key: 'picks' as const, label: 'Picks' },
                      ] as const
                    ).map((t) => {
                      const active = adminSubTab === t.key;
                      return (
                        <Pressable
                          key={t.key}
                          style={[styles.adminSubTab, active && styles.adminSubTabActive]}
                          onPress={() => setAdminSubTab(t.key)}
                          accessibilityRole="tab"
                          accessibilityState={{ selected: active }}
                        >
                          <Text
                            style={[
                              styles.adminSubTabText,
                              active && styles.adminSubTabTextActive,
                            ]}
                          >
                            {t.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}

                {adminSubTab === 'joins' ? (
                  <>
                    <Text style={styles.sectionIntro}>
                      Confirm or reject players who have requested to join this competition with a
                      code.
                    </Text>
                    <View style={styles.adminRow}>
                      <View style={styles.adminRowBody}>
                        <Text style={styles.adminRowTitle}>Notify me on join requests</Text>
                        <Text style={styles.adminRowMeta}>
                          Only affects this device. Creators and managers default on; Owners
                          default off.
                        </Text>
                      </View>
                      <Pressable
                        style={[
                          styles.adminToggle,
                          joinNotifyEnabled ? styles.adminToggleOn : styles.adminToggleOff,
                        ]}
                        disabled={joinNotifyBusy}
                        onPress={() => void onToggleJoinNotify(!joinNotifyEnabled)}
                        accessibilityRole="switch"
                        accessibilityState={{ checked: joinNotifyEnabled, disabled: joinNotifyBusy }}
                        accessibilityLabel="Notify me on join requests"
                      >
                        <Text
                          style={
                            joinNotifyEnabled
                              ? styles.adminToggleTextOn
                              : styles.adminToggleTextOff
                          }
                        >
                          {joinNotifyEnabled ? 'On' : 'Off'}
                        </Text>
                      </Pressable>
                    </View>
                    {canManage && managerUserIds.size > 0 ? (
                      <Text style={styles.muted}>
                        Managers · {managerUserIds.size}/3 · assign in Manage user
                      </Text>
                    ) : null}
                    <Text style={styles.poolTitle}>
                      Join requests · {pendingJoins.length} waiting
                    </Text>
                    {pendingJoins.length === 0 ? (
                      <Text style={styles.muted}>No users waiting for verification.</Text>
                    ) : (
                      pendingJoins.map((r) => {
                        const busy = joinBusyId === r.id;
                        const kindLabel =
                          r.request_kind === 're_entry' || r.is_reentry ? 're entry' : 'new';
                        return (
                          <View key={r.id} style={styles.adminRow}>
                            <View style={styles.adminRowBody}>
                              <Text style={styles.adminRowTitle}>
                                {r.username || 'User'}{' '}
                                <Text style={styles.adminRowMeta}>({kindLabel})</Text>
                              </Text>
                              <Text style={styles.adminRowMeta}>
                                {r.code_type === 'rejoin' ? 'Rejoin' : 'Join'} request
                                {r.created_at
                                  ? ` · ${new Date(r.created_at).toLocaleDateString()}`
                                  : ''}
                              </Text>
                              {r.payment_method ? (
                                <Text style={styles.adminRowMeta}>
                                  {r.payment_method === 'cash'
                                    ? 'Payment: cash at collection'
                                    : r.payment_method === 'online'
                                      ? 'Payment: online'
                                      : `Payment: ${r.payment_method}`}
                                </Text>
                              ) : null}
                              <View style={styles.adminJoinActions}>
                                <Pressable
                                  style={[styles.adminConfirmBtn, busy && styles.primaryBtnDisabled]}
                                  onPress={() => void onApproveJoin(r.id)}
                                  disabled={busy}
                                  accessibilityRole="button"
                                  accessibilityLabel={`Confirm ${r.username || 'user'}`}
                                >
                                  {busy ? (
                                    <ActivityIndicator size="small" color={theme.colors.white} />
                                  ) : (
                                    <Text style={styles.adminConfirmBtnText}>Confirm</Text>
                                  )}
                                </Pressable>
                                <Pressable
                                  style={[styles.adminRejectBtn, busy && styles.primaryBtnDisabled]}
                                  onPress={() => void onRejectJoin(r.id)}
                                  disabled={busy}
                                  accessibilityRole="button"
                                  accessibilityLabel={`Reject ${r.username || 'user'}`}
                                >
                                  <Text style={styles.adminRejectBtnText}>Reject</Text>
                                </Pressable>
                              </View>
                            </View>
                          </View>
                        );
                      })
                    )}
                  </>
                ) : adminSubTab === 'pool' && canManage ? (
                  <>
                    <Text style={styles.sectionIntro}>
                      Choose which clubs are eligible in this competition. Late-start or small
                      leagues can run with a reduced pool.
                    </Text>
                    <Text style={styles.poolTitle}>
                      Team pool · {poolTeamIds.length}/{teams.length} enabled
                    </Text>
                    {allTeamsAlphabetical.map((t) => {
                      const enabled = poolTeamIdSet.has(t.id);
                      return (
                        <View key={t.id} style={styles.adminRow}>
                          <TeamColourChip shortName={t.short_name} name={t.name} slug={t.slug} size={24} />
                          <View style={styles.adminRowBody}>
                            <Text style={styles.adminRowTitle}>{lmsDisplayTeamName(t.name)}</Text>
                            <Text style={styles.adminRowMeta}>
                              {enabled ? 'In pool' : 'Not in this competition'}
                            </Text>
                          </View>
                          <Pressable
                            style={[
                              styles.adminToggle,
                              enabled ? styles.adminToggleOn : styles.adminToggleOff,
                            ]}
                            disabled={adminBusy}
                            onPress={() => onTogglePoolTeam(t, !enabled)}
                            accessibilityRole="switch"
                            accessibilityState={{ checked: enabled, disabled: adminBusy }}
                          >
                            <Text
                              style={[
                                styles.adminToggleText,
                                enabled && styles.adminToggleTextOn,
                              ]}
                            >
                              {enabled ? 'In pool' : 'Add'}
                            </Text>
                          </Pressable>
                        </View>
                      );
                    })}
                  </>
                ) : adminSubTab === 'users' && canManage ? (
                  <>
                    <Text style={styles.sectionIntro}>
                      Select a player to assign them as a manager, submit or change a pick on their
                      behalf at any time (including after the deadline), or remove them from the
                      competition.
                    </Text>
                    <Text style={styles.poolTitle}>
                      Player · managers {managerUserIds.size}/3
                    </Text>
                    {manageUserPlayers.length === 0 ? (
                      <Text style={styles.muted}>
                        No players in this competition yet. Accept join requests first.
                      </Text>
                    ) : (
                      <View>
                        <Pressable
                          style={styles.manageDropdownTrigger}
                          onPress={() => setManageUserDropdownOpen((open) => !open)}
                          disabled={adminBusy || adminPickLoadingUser}
                          accessibilityRole="button"
                          accessibilityLabel="Select player"
                          accessibilityState={{ expanded: manageUserDropdownOpen }}
                        >
                          <View style={styles.playerNameRow}>
                            <Text
                              style={
                                selectedManageUser
                                  ? styles.manageDropdownValue
                                  : styles.manageDropdownPlaceholder
                              }
                              numberOfLines={1}
                            >
                              {selectedManageUser
                                ? `${selectedManageUser.username || selectedManageUser.user_id.slice(0, 8)}${
                                    selectedManageUser.user_id === userId ? ' (you)' : ''
                                  }`
                                : 'Select a player'}
                            </Text>
                            {selectedManageUser?.is_manager ? (
                              <Ionicons
                                name="star"
                                size={14}
                                color={theme.colors.accent}
                                accessibilityLabel="Manager"
                              />
                            ) : null}
                          </View>
                          <Ionicons
                            name={manageUserDropdownOpen ? 'chevron-up' : 'chevron-down'}
                            size={18}
                            color={theme.colors.textMuted}
                          />
                        </Pressable>
                        {manageUserDropdownOpen ? (
                          <View style={styles.manageDropdownMenu}>
                            <ScrollView
                              nestedScrollEnabled
                              keyboardShouldPersistTaps="handled"
                              style={styles.manageDropdownScroll}
                            >
                              {manageUserPlayers.map((p) => {
                                const active = adminPickUserId === p.user_id;
                                const label = p.username || p.user_id.slice(0, 8);
                                return (
                                  <Pressable
                                    key={p.user_id}
                                    style={[
                                      styles.manageDropdownOption,
                                      active && styles.manageDropdownOptionActive,
                                    ]}
                                    onPress={() => {
                                      setManageUserDropdownOpen(false);
                                      void onSelectAdminPickUser(p.user_id);
                                    }}
                                    accessibilityRole="button"
                                    accessibilityState={{ selected: active }}
                                    accessibilityLabel={label}
                                  >
                                    <View style={styles.playerNameRow}>
                                      <Text
                                        style={[
                                          styles.manageDropdownOptionText,
                                          active && styles.manageDropdownOptionTextActive,
                                        ]}
                                        numberOfLines={1}
                                      >
                                        {label}
                                        {p.user_id === userId ? ' (you)' : ''}
                                      </Text>
                                      {p.is_manager ? (
                                        <Ionicons
                                          name="star"
                                          size={14}
                                          color={theme.colors.accent}
                                          accessibilityLabel="Manager"
                                        />
                                      ) : null}
                                    </View>
                                    <Text style={styles.adminRowMeta}>
                                      {p.is_creator ? 'Creator' : p.is_manager ? 'Manager' : 'Player'}
                                    </Text>
                                  </Pressable>
                                );
                              })}
                            </ScrollView>
                          </View>
                        ) : null}
                      </View>
                    )}

                    {adminPickLoadingUser ? (
                      <ActivityIndicator color={theme.colors.accent} />
                    ) : selectedManageUser ? (
                      <>
                        <View style={styles.adminRow}>
                          <View style={styles.adminRowBody}>
                            <View style={styles.playerNameRow}>
                              <Text style={styles.adminRowTitle}>
                                {selectedManageUser.username || selectedManageUser.user_id.slice(0, 8)}
                                {selectedManageUser.user_id === userId ? ' (you)' : ''}
                              </Text>
                              {selectedManageUser.is_manager ? (
                                <Ionicons
                                  name="star"
                                  size={14}
                                  color={theme.colors.accent}
                                  accessibilityLabel="Manager"
                                />
                              ) : null}
                            </View>
                            <Text style={styles.adminRowMeta}>
                              {selectedManageUser.is_creator
                                ? 'Competition creator — already an admin'
                                : selectedManageUser.is_manager
                                  ? 'Can accept join requests and get join alerts'
                                  : 'Player — assign to handle join requests'}
                            </Text>
                          </View>
                          {selectedManageUser.is_creator ? (
                            <View style={[styles.adminToggle, styles.adminToggleOn]}>
                              <Text style={styles.adminToggleTextOn}>Creator</Text>
                            </View>
                          ) : (
                            <Pressable
                              style={[
                                styles.adminToggle,
                                selectedManageUser.is_manager
                                  ? styles.adminToggleOn
                                  : styles.adminToggleOff,
                              ]}
                              disabled={managerBusyId === selectedManageUser.user_id}
                              onPress={() =>
                                void onToggleManager(
                                  selectedManageUser.user_id,
                                  !selectedManageUser.is_manager
                                )
                              }
                              accessibilityRole="switch"
                              accessibilityState={{
                                checked: selectedManageUser.is_manager,
                                disabled: managerBusyId === selectedManageUser.user_id,
                              }}
                              accessibilityLabel="Assign as manager"
                            >
                              {managerBusyId === selectedManageUser.user_id ? (
                                <ActivityIndicator size="small" color={theme.colors.accent} />
                              ) : (
                                <Text
                                  style={
                                    selectedManageUser.is_manager
                                      ? styles.adminToggleTextOn
                                      : styles.adminToggleTextOff
                                  }
                                >
                                  {selectedManageUser.is_manager ? 'Manager' : 'Assign'}
                                </Text>
                              )}
                            </Pressable>
                          )}
                        </View>

                        <Text style={styles.poolTitle}>
                          Pick{currentGw ? ` · GW${currentGw.number}` : ''}
                          {currentGw && deadlinePassed ? ' · after deadline' : ''}
                        </Text>
                        {selectedManageUser.status !== 'active' ? (
                          <Text style={styles.muted}>
                            This player is not active, so you cannot submit a pick for them.
                          </Text>
                        ) : !currentGw ? (
                          <Text style={styles.muted}>No open gameweek for picks yet.</Text>
                        ) : adminPickTeams.length === 0 ? (
                          <Text style={styles.muted}>
                            No unused pool teams playing this gameweek for that player.
                          </Text>
                        ) : (
                          <>
                            {deadlinePassed ? (
                              <Text style={styles.muted}>
                                Player picks are locked, but as admin you can still set or change
                                this player’s selection.
                              </Text>
                            ) : null}
                            <View style={styles.teamGrid}>
                              {adminPickTeams.map((t) => {
                                const selected = adminPickTeamId === t.id;
                                const opponent = opponentByTeamId.get(t.id);
                                const opponentLabel =
                                  opponent?.short_name || opponent?.name || null;
                                const venue = venueByTeamId.get(t.id);
                                const opponentVenue = opponent
                                  ? venueByTeamId.get(opponent.id)
                                  : undefined;
                                const teamLabel = venue
                                  ? `${lmsDisplayTeamName(t.name)} (${venue})`
                                  : lmsDisplayTeamName(t.name);
                                const vsLabel =
                                  opponentLabel && opponentVenue
                                    ? `vs ${opponentLabel} (${opponentVenue})`
                                    : opponentLabel
                                      ? `vs ${opponentLabel}`
                                      : null;
                                return (
                                  <Pressable
                                    key={t.id}
                                    style={[
                                      styles.teamTile,
                                      selected && styles.teamTileSelected,
                                    ]}
                                    onPress={() => setAdminPickTeamId(t.id)}
                                    disabled={adminBusy}
                                  >
                                    <TeamColourChip
                                      shortName={t.short_name}
                                      name={t.name}
                                      slug={t.slug}
                                      size={28}
                                    />
                                    <View style={styles.teamTileTextCol}>
                                      <Text
                                        style={[
                                          styles.teamTileName,
                                          selected && styles.teamTileNameSelected,
                                        ]}
                                        numberOfLines={2}
                                      >
                                        {teamLabel}
                                      </Text>
                                      {vsLabel ? (
                                        <Text
                                          style={[
                                            styles.teamTileVs,
                                            selected && styles.teamTileVsSelected,
                                          ]}
                                          numberOfLines={1}
                                        >
                                          {vsLabel}
                                        </Text>
                                      ) : null}
                                      {opponent ? (
                                        <SelectionTeamFormDots
                                          teamResults={
                                            formByTeamId.get(t.id) ?? [
                                              null,
                                              null,
                                              null,
                                              null,
                                              null,
                                            ]
                                          }
                                          opponentResults={
                                            formByTeamId.get(opponent.id) ?? [
                                              null,
                                              null,
                                              null,
                                              null,
                                              null,
                                            ]
                                          }
                                        />
                                      ) : null}
                                    </View>
                                    {selected ? (
                                      <Ionicons
                                        name="checkmark-circle"
                                        size={18}
                                        color={theme.colors.accent}
                                      />
                                    ) : null}
                                  </Pressable>
                                );
                              })}
                            </View>
                            <Pressable
                              style={[
                                styles.primaryBtn,
                                (!adminPickTeamId || adminBusy) && styles.primaryBtnDisabled,
                              ]}
                              disabled={!adminPickTeamId || adminBusy}
                              onPress={() => void onAdminSubmitPick()}
                            >
                              {adminBusy ? (
                                <ActivityIndicator color={theme.colors.white} />
                              ) : (
                                <Text style={styles.primaryBtnText}>Submit pick</Text>
                              )}
                            </Pressable>
                          </>
                        )}

                        {!selectedManageUser.is_creator ? (
                          <View style={styles.removePlayerZone}>
                            <Text style={styles.poolTitle}>Remove player</Text>
                            <Text style={styles.muted}>
                              Use this if someone was accepted by mistake. Clears their picks and
                              manager role. Competition managers cannot do this.
                            </Text>
                            <Pressable
                              style={[styles.dangerBtn, adminBusy && styles.dangerBtnDisabled]}
                              disabled={adminBusy}
                              onPress={() => onRemoveParticipant(selectedManageUser)}
                              accessibilityRole="button"
                              accessibilityLabel={`Remove ${
                                selectedManageUser.username || 'player'
                              } from competition`}
                            >
                              {adminBusy ? (
                                <ActivityIndicator color={theme.colors.error} />
                              ) : (
                                <Text style={styles.dangerBtnText}>Remove from competition</Text>
                              )}
                            </Pressable>
                          </View>
                        ) : null}
                      </>
                    ) : manageUserPlayers.length > 0 ? (
                      <Text style={styles.muted}>Select a player above.</Text>
                    ) : null}
                  </>
                ) : adminSubTab === 'picks' && canHandleJoins ? (
                  <>
                    <Text style={styles.sectionIntro}>
                      See who has locked a pick for the current gameweek. Players without a pick
                      are listed first. After the deadline, use Manage user to set or change a
                      pick for them.
                    </Text>
                    {!currentGw ? (
                      <Text style={styles.muted}>No open gameweek for picks yet.</Text>
                    ) : (
                      <>
                        <Text style={styles.poolTitle}>
                          GW{currentGw.number} · {adminPickStatusLockedCount}/
                          {adminPickStatusRows.length} locked
                          {deadlinePassed ? ' · picks closed' : ''}
                        </Text>
                        {adminPickStatusRows.length === 0 ? (
                          <Text style={styles.muted}>No active players in this competition.</Text>
                        ) : (
                          adminPickStatusRows.map((row) => (
                            <View key={row.user_id} style={styles.adminRow}>
                              <View style={styles.adminRowBody}>
                                <Text style={styles.adminRowTitle}>
                                  {row.username || row.user_id.slice(0, 8)}
                                  {row.user_id === userId ? ' (you)' : ''}
                                </Text>
                                <Text style={styles.adminRowMeta}>
                                  {row.locked
                                    ? picksRevealed && row.teamLabel
                                      ? `Locked · ${row.teamLabel}`
                                      : 'Locked'
                                    : 'No pick yet'}
                                </Text>
                              </View>
                              <View
                                style={[
                                  styles.pickStatusBadge,
                                  row.locked
                                    ? styles.pickStatusBadgeLocked
                                    : styles.pickStatusBadgeMissing,
                                ]}
                              >
                                <Text
                                  style={
                                    row.locked
                                      ? styles.pickStatusBadgeTextLocked
                                      : styles.pickStatusBadgeTextMissing
                                  }
                                >
                                  {row.locked ? 'Locked' : 'Missing'}
                                </Text>
                              </View>
                            </View>
                          ))
                        )}
                      </>
                    )}
                  </>
                ) : adminSubTab === 'notify' && canManage ? (
                  <>
                    <Text style={styles.sectionIntro}>
                      Send a custom push to players in this competition — for example when a
                      fixture is removed, or a short gameweek summary.
                    </Text>
                    <Text style={styles.muted}>
                      Only reaches players with Deadline Alerts on. Max one send every few
                      minutes.
                    </Text>
                    <Text style={styles.poolTitle}>Title</Text>
                    <TextInput
                      style={styles.entryInput}
                      value={broadcastTitle}
                      onChangeText={setBroadcastTitle}
                      placeholder="e.g. Fixture update"
                      placeholderTextColor={theme.colors.textMuted}
                      maxLength={80}
                      editable={!broadcastSending}
                      accessibilityLabel="Notification title"
                    />
                    <Text style={styles.poolTitle}>Message</Text>
                    <TextInput
                      style={[styles.entryInput, styles.broadcastBodyInput]}
                      value={broadcastBody}
                      onChangeText={setBroadcastBody}
                      placeholder="Write a short update for the group…"
                      placeholderTextColor={theme.colors.textMuted}
                      maxLength={280}
                      multiline
                      textAlignVertical="top"
                      editable={!broadcastSending}
                      accessibilityLabel="Notification message"
                    />
                    <Text style={styles.joinCodeHint}>
                      {broadcastBody.trim().length}/280
                    </Text>
                    <Pressable
                      style={[
                        styles.primaryBtn,
                        (broadcastSending ||
                          !broadcastTitle.trim() ||
                          !broadcastBody.trim()) &&
                          styles.primaryBtnDisabled,
                      ]}
                      disabled={
                        broadcastSending ||
                        !broadcastTitle.trim() ||
                        !broadcastBody.trim()
                      }
                      onPress={onSendBroadcast}
                      accessibilityRole="button"
                      accessibilityLabel="Send notification to competition"
                    >
                      {broadcastSending ? (
                        <ActivityIndicator color={theme.colors.white} />
                      ) : (
                        <Text style={styles.primaryBtnText}>Send to competition</Text>
                      )}
                    </Pressable>
                  </>
                ) : null}

                {canManage ? (
                  <View style={styles.dangerZone}>
                    <Text style={styles.poolTitle}>Danger zone</Text>
                    <Text style={styles.muted}>
                      Permanently delete this competition and all related picks, players, and codes.
                    </Text>
                    <Pressable
                      style={[styles.dangerBtn, adminBusy && styles.dangerBtnDisabled]}
                      disabled={adminBusy}
                      onPress={onDeleteCompetition}
                      accessibilityRole="button"
                      accessibilityLabel="Delete competition"
                    >
                      {adminBusy ? (
                        <ActivityIndicator color={theme.colors.error} />
                      ) : (
                        <Text style={styles.dangerBtnText}>Delete competition</Text>
                      )}
                    </Pressable>
                  </View>
                ) : null}
              </>
            ) : null}

            <LmsTrademarkDisclaimer />
          </ScrollView>
        </>
      )}
    </View>
  );
}
