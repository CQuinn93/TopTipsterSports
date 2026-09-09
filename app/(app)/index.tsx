import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  useWindowDimensions,
  Platform,
  Pressable,
  TextInput,
  Alert,
  Animated,
  Modal,
  FlatList,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/contexts/ThemeContext';
import { useSidebar } from '@/contexts/SidebarContext';
import { getAvailableRacesForUser } from '@/lib/availableRacesCache';
import { fetchHomeSummaryByComp, type HomeSummaryByComp } from '@/lib/homeSummary';
import { useForceRefresh } from '@/contexts/ForceRefreshContext';
import type { ParticipationRow } from '@/lib/availableRacesCache';
import type { AvailableRaceDay } from '@/lib/availableRacesForUser';
import { getCompetitionDisplayStatus } from '@/lib/appUtils';
import { joinCompetitionWithAccessCode } from '@/lib/joinCompetitionWithAccessCode';
import { confirmJoinLimitDisclaimer } from '@/lib/joinLimitDisclaimer';
import { FundraiserForClub } from '@/components/FundraiserForClub';
import {
  fetchCompetitionsFundraiserBranding,
  fundraiserKey,
  type FundraiserBranding,
} from '@/lib/fundraiserBranding';
import { racingCreateCompetition } from '@/lib/racingAdminApi';
import { canCreateCompetitions } from '@/lib/adminSession';
import { CreateCompetitionUpgradeCta } from '@/components/CreateCompetitionUpgradeCta';
import {
  coursesForRegion,
  displayRacingCourseName,
  festivalEndDateFromStart,
  type RacingCourseRegion,
} from '@/lib/racingCourses';
import { RacingPointsPanel } from '@/components/RacingPointsPanel';

const RACE_CYCLE_MS = 6500;
const RACE_SLIDE_MS = 380;

type HomeTab = 'competitions' | 'join' | 'points';

type PendingJoin = {
  competition_id: string;
  name: string;
};

export default function HomeScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { openSidebar } = useSidebar();
  const { userId, session } = useAuth();
  const params = useLocalSearchParams<{ tab?: string }>();
  const [displayName, setDisplayName] = useState('');
  const [participations, setParticipations] = useState<ParticipationRow[]>([]);
  const [availableRaces, setAvailableRaces] = useState<AvailableRaceDay[]>([]);
  const [summaryByComp, setSummaryByComp] = useState<HomeSummaryByComp | null>(null);
  const [pending, setPending] = useState<PendingJoin[]>([]);
  const [compStatusByCompId, setCompStatusByCompId] = useState<
    Record<string, 'upcoming' | 'live' | 'complete'>
  >({});
  const [compDateRangeByCompId, setCompDateRangeByCompId] = useState<
    Record<string, { start: string; end: string }>
  >({});
  const [creatorByCompId, setCreatorByCompId] = useState<Record<string, string | null>>({});
  const [fundraiserByComp, setFundraiserByComp] = useState<Record<string, FundraiserBranding>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<HomeTab>('competitions');
  const [homePanelExpanded, setHomePanelExpanded] = useState(true);
  const [joinCode, setJoinCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [isStaff, setIsStaff] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createCourse, setCreateCourse] = useState('');
  const [createStartDate, setCreateStartDate] = useState('');
  const [createDays, setCreateDays] = useState(4);
  const [createAccessCode, setCreateAccessCode] = useState('');
  const [creating, setCreating] = useState(false);
  const [coursePickerOpen, setCoursePickerOpen] = useState(false);
  const [courseSearch, setCourseSearch] = useState('');
  const [courseRegion, setCourseRegion] = useState<RacingCourseRegion>('all');
  const [raceIndex, setRaceIndex] = useState(0);
  const [raceCardWidth, setRaceCardWidth] = useState(0);
  const raceSlideX = useRef(new Animated.Value(0)).current;
  const raceCycleRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { width: windowWidth } = useWindowDimensions();
  const isNarrowWeb = Platform.OS === 'web' && windowWidth < 768;
  const isWideWeb = Platform.OS === 'web' && windowWidth >= 768;
  const isWeb = Platform.OS === 'web';

  useEffect(() => {
    const next = String(params.tab ?? '').trim();
    if (next === 'join' || next === 'points' || next === 'competitions') {
      setTab(next);
      setHomePanelExpanded(true);
    }
  }, [params.tab]);

  useEffect(() => {
    if (!userId) {
      setIsStaff(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const canCreate = await canCreateCompetitions(userId);
        if (!cancelled) setIsStaff(canCreate);
      } catch {
        if (!cancelled) setIsStaff(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      try {
        const { data } = await supabase
          .from('profiles')
          .select('username')
          .eq('id', userId)
          .maybeSingle();
        if (cancelled) return;
        const name = (data as { username?: string } | null)?.username ?? null;
        if (name) setDisplayName(name);
        else setDisplayName(session?.user?.email?.split('@')[0] ?? 'there');
      } catch {
        if (!cancelled) setDisplayName(session?.user?.email?.split('@')[0] ?? 'there');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, session?.user?.email]);

  const load = useCallback(
    async (forceRefresh = false, isPullRefresh = false) => {
      if (!userId) return;
      if (isPullRefresh) setRefreshing(true);
      try {
        const [{ participations: p, availableRaces: r }, pendingRes] = await Promise.all([
          getAvailableRacesForUser(supabase, userId, forceRefresh),
          supabase
            .from('competition_join_requests')
            .select('competition_id')
            .eq('user_id', userId)
            .eq('status', 'pending'),
        ]);
        setParticipations(p);
        setAvailableRaces(r);

        const pendingIds = (pendingRes.data ?? []).map(
          (row) => (row as { competition_id: string }).competition_id
        );
        if (pendingIds.length > 0) {
          const { data: pendingComps } = await supabase
            .from('competitions')
            .select('id, name')
            .in('id', pendingIds);
          const nameById = new Map(
            (pendingComps ?? []).map((c) => {
              const row = c as { id: string; name: string };
              return [row.id, row.name] as const;
            })
          );
          setPending(
            pendingIds.map((id) => ({
              competition_id: id,
              name: nameById.get(id) ?? 'Competition',
            }))
          );
        } else {
          setPending([]);
        }

        if (p.length === 0) {
          setSummaryByComp(null);
          setCompStatusByCompId({});
          setCompDateRangeByCompId({});
          setCreatorByCompId({});
          setFundraiserByComp({});
          return;
        }

        const compIds = p.map((x) => x.competition_id);
        const [summary, compsRes] = await Promise.all([
          fetchHomeSummaryByComp(supabase, userId, compIds),
          supabase
            .from('competitions')
            .select('id, festival_start_date, festival_end_date, created_by_user_id')
            .in('id', compIds),
        ]);
        setSummaryByComp(summary);

        const statusByComp: Record<string, 'upcoming' | 'live' | 'complete'> = {};
        const dateRangeByComp: Record<string, { start: string; end: string }> = {};
        const creatorByComp: Record<string, string | null> = {};
        for (const c of compsRes.data ?? []) {
          const row = c as {
            id: string;
            festival_start_date: string;
            festival_end_date: string;
            created_by_user_id: string | null;
          };
          statusByComp[row.id] =
            getCompetitionDisplayStatus(row.festival_start_date, row.festival_end_date) ?? 'live';
          dateRangeByComp[row.id] = {
            start: new Date(row.festival_start_date).toLocaleDateString(undefined, {
              day: 'numeric',
              month: 'short',
            }),
            end: new Date(row.festival_end_date).toLocaleDateString(undefined, {
              day: 'numeric',
              month: 'short',
            }),
          };
          creatorByComp[row.id] = row.created_by_user_id;
        }
        setCompStatusByCompId(statusByComp);
        setCompDateRangeByCompId(dateRangeByComp);
        setCreatorByCompId(creatorByComp);
        try {
          const branding = await fetchCompetitionsFundraiserBranding(
            Object.keys(creatorByComp).map((id) => ({
              sport: 'racing' as const,
              competition_id: id,
            }))
          );
          setFundraiserByComp(branding);
        } catch {
          setFundraiserByComp({});
        }
      } finally {
        if (isPullRefresh) setRefreshing(false);
      }
    },
    [userId]
  );

  const onRefresh = useCallback(() => {
    if (refreshing) return;
    void load(true, true);
  }, [load, refreshing]);

  useFocusEffect(
    useCallback(() => {
      if (userId) void load(false);
    }, [userId, load])
  );

  const { homeTrigger } = useForceRefresh();
  useEffect(() => {
    if (userId && homeTrigger > 0) void load(true);
  }, [userId, homeTrigger, load]);

  const nowMs = Date.now();
  const upcomingRaces = useMemo(
    () =>
      availableRaces
        .filter((d) => new Date(d.lastRaceUtc).getTime() > nowMs)
        .sort((a, b) => a.firstRaceUtc.localeCompare(b.firstRaceUtc)),
    [availableRaces, nowMs]
  );

  const dayNumberByKey = useMemo(() => {
    const map = new Map<string, number>();
    const byComp = new Map<string, string[]>();
    for (const d of availableRaces) {
      const list = byComp.get(d.competitionId) ?? [];
      if (!list.includes(d.raceDate)) list.push(d.raceDate);
      byComp.set(d.competitionId, list);
    }
    for (const [compId, dates] of byComp) {
      const sorted = [...dates].sort();
      sorted.forEach((date, i) => map.set(`${compId}:${date}`, i + 1));
    }
    return map;
  }, [availableRaces]);

  useEffect(() => {
    if (raceIndex >= upcomingRaces.length) setRaceIndex(0);
  }, [upcomingRaces.length, raceIndex]);

  const goToRace = useCallback(
    (next: number, opts?: { direction?: 'left' | 'right' }) => {
      if (upcomingRaces.length === 0) return;
      const target = ((next % upcomingRaces.length) + upcomingRaces.length) % upcomingRaces.length;
      if (target === raceIndex) return;
      const width = raceCardWidth > 0 ? raceCardWidth : 280;
      const dir = opts?.direction === 'right' ? 1 : -1;
      raceSlideX.setValue(-dir * width);
      setRaceIndex(target);
      Animated.timing(raceSlideX, {
        toValue: 0,
        duration: RACE_SLIDE_MS,
        useNativeDriver: true,
      }).start();
    },
    [upcomingRaces.length, raceIndex, raceCardWidth, raceSlideX]
  );

  useEffect(() => {
    if (raceCycleRef.current) clearInterval(raceCycleRef.current);
    if (upcomingRaces.length <= 1) return;
    raceCycleRef.current = setInterval(() => {
      goToRace(raceIndex + 1, { direction: 'left' });
    }, RACE_CYCLE_MS);
    return () => {
      if (raceCycleRef.current) clearInterval(raceCycleRef.current);
    };
  }, [upcomingRaces.length, raceIndex, goToRace]);

  const activeRace = upcomingRaces[raceIndex] ?? null;
  const comps = participations.map((p) => {
    const id = p.competition_id;
    const name = summaryByComp?.byComp[id]?.name ?? id;
    const status = compStatusByCompId[id] ?? 'live';
    const range = compDateRangeByCompId[id];
    const nextDay = upcomingRaces.find((d) => d.competitionId === id);
    return {
      id,
      name,
      status,
      range,
      isCreator: creatorByCompId[id] === userId,
      pickHint: nextDay
        ? nextDay.hasAllPicks
          ? nextDay.isLocked
            ? 'Selections locked'
            : 'Picks complete'
          : nextDay.isLocked
            ? 'Selections locked'
            : 'Pick available'
        : status === 'complete'
          ? 'Festival complete'
          : null,
    };
  });

  const onJoin = async () => {
    if (!userId) {
      Alert.alert('Error', 'You must be signed in.');
      return;
    }
    const confirmed = await confirmJoinLimitDisclaimer(joinCode);
    if (!confirmed) return;

    setJoining(true);
    try {
      const outcome = await joinCompetitionWithAccessCode({
        userId,
        code: joinCode,
        displayNameToUse: displayName.trim() || 'Tipster',
      });
      if (outcome.kind === 'error') {
        Alert.alert('Error', outcome.message);
        return;
      }
      if (outcome.kind === 'invalid_code') {
        Alert.alert('Invalid code', 'This access code is not recognised.');
        return;
      }
      if (outcome.kind === 'already_in') {
        Alert.alert('Already in', `You're already in "${outcome.competitionName}".`);
        setTab('competitions');
        await load(true);
        return;
      }
      Alert.alert(
        'Request sent',
        `Your request to join "${outcome.competitionName}" has been sent. An admin will approve you soon.`
      );
      setJoinCode('');
      setTab('competitions');
      await load(true);
    } finally {
      setJoining(false);
    }
  };

  const filteredCourses = useMemo(() => {
    const base = coursesForRegion(courseRegion);
    const q = courseSearch.trim().toLowerCase();
    if (!q) return base;
    return base.filter((c) => c.toLowerCase().includes(q));
  }, [courseRegion, courseSearch]);

  const createEndPreview =
    /^\d{4}-\d{2}-\d{2}$/.test(createStartDate.trim()) && createDays >= 1
      ? festivalEndDateFromStart(createStartDate.trim(), createDays)
      : null;

  const onCreateCompetition = async () => {
    const name = createName.trim();
    if (!name) {
      Alert.alert('Error', 'Please enter a competition name.');
      return;
    }
    if (!createCourse.trim()) {
      Alert.alert('Error', 'Please select a course.');
      return;
    }
    const start = createStartDate.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) {
      Alert.alert('Error', 'Enter a start date as YYYY-MM-DD.');
      return;
    }
    if (createDays < 1 || createDays > 14) {
      Alert.alert('Error', 'Festival length must be between 1 and 14 days.');
      return;
    }
    const end = festivalEndDateFromStart(start, createDays);
    const code = createAccessCode.trim().toUpperCase().slice(0, 6) || null;
    setCreating(true);
    try {
      const result = await racingCreateCompetition({
        name,
        festivalStartDate: start,
        festivalEndDate: end,
        accessCode: code,
        courses: [createCourse.trim()],
      });
      if (!result.success) {
        Alert.alert('Error', result.error ?? 'Could not create competition');
        return;
      }
      Alert.alert(
        'Created',
        code
          ? `Competition created at ${createCourse}. Access code: ${code}`
          : `Competition created at ${createCourse}.`
      );
      setCreateName('');
      setCreateCourse('');
      setCreateStartDate('');
      setCreateDays(4);
      setCreateAccessCode('');
      setShowCreate(false);
      setTab('competitions');
      await load(true);
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not create competition');
    } finally {
      setCreating(false);
    }
  };

  const styles = useMemo(
    () =>
      StyleSheet.create({
        wrapper: { flex: 1, backgroundColor: theme.colors.background },
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
        headerMenu: { padding: 4 },
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
        cardTap: { paddingVertical: 6, overflow: 'hidden', minHeight: 88, justifyContent: 'center' },
        cardSlide: { width: '100%' },
        cardRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          minHeight: 76,
        },
        cardEmptyBody: {
          minHeight: 76,
          alignItems: 'center',
          justifyContent: 'center',
          paddingVertical: 8,
        },
        cardSide: { flex: 1, alignItems: 'center', gap: 6, minWidth: 0 },
        cardCourse: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 13,
          color: theme.colors.text,
          textAlign: 'center',
        },
        cardComp: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 11,
          color: theme.colors.textMuted,
          textAlign: 'center',
        },
        cardMid: { alignItems: 'center', minWidth: 64, gap: 4 },
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
        cardRaceName: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 12,
          color: theme.colors.text,
          textAlign: 'center',
        },
        cardHint: {
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
        mainScroll: { flex: 1 },
        mainScrollContent: {
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: insets.bottom + theme.spacing.xl,
          gap: theme.spacing.md,
          flexGrow: 1,
          ...(isWideWeb ? { maxWidth: 960, width: '100%', alignSelf: 'center' as const } : null),
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
        tabs: { flex: 1, flexDirection: 'row', backgroundColor: theme.colors.surface },
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
          fontSize: isNarrowWeb ? 11 : 12,
          color: theme.colors.textMuted,
          textAlign: 'center',
        },
        tabTextActive: { color: theme.colors.accent },
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
        sectionLabel: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 11,
          letterSpacing: 1.1,
          textTransform: 'uppercase',
          color: theme.colors.textMuted,
          marginBottom: 8,
        },
        joinRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
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
          color: theme.colors.black,
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
        rowTitleRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
        },
        rowTitle: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 15,
          color: theme.colors.text,
        },
        rowMeta: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 12,
          color: theme.colors.textMuted,
        },
        rowPickHint: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 12,
          color: theme.colors.accent,
        },
        manageChip: {
          paddingVertical: 2,
          paddingHorizontal: 6,
          borderRadius: theme.radius.sm,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.accent,
        },
        manageChipText: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 10,
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          color: theme.colors.accent,
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
          fontFamily: theme.fontFamily.baiMedium,
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
          backgroundColor: theme.colors.background,
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
          backgroundColor: theme.colors.surface,
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
        createSubmit: {
          backgroundColor: theme.colors.accent,
          borderRadius: theme.radius.sm,
          paddingVertical: 10,
          alignItems: 'center',
        },
        createSubmitText: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 13,
          color: theme.colors.black,
        },
        createSelect: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.sm,
          paddingHorizontal: 12,
          paddingVertical: 10,
          backgroundColor: theme.colors.surface,
        },
        createSelectText: {
          flex: 1,
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 14,
          color: theme.colors.text,
        },
        createSelectPlaceholder: {
          color: theme.colors.textMuted,
        },
        createDaysRow: {
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 8,
        },
        createDayChip: {
          minWidth: 40,
          paddingVertical: 8,
          paddingHorizontal: 12,
          borderRadius: theme.radius.sm,
          backgroundColor: theme.colors.surface,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          alignItems: 'center',
        },
        createDayChipActive: {
          backgroundColor: theme.colors.accentMuted,
          borderColor: theme.colors.accent,
        },
        createDayChipText: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 13,
          color: theme.colors.textSecondary,
        },
        createDayChipTextActive: {
          color: theme.colors.accent,
        },
        modalOverlay: {
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.5)',
          justifyContent: 'center',
          padding: theme.spacing.lg,
        },
        modalContent: {
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.lg,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          maxHeight: '80%',
          overflow: 'hidden',
        },
        modalHeader: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.sm,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.border,
        },
        modalTitle: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 16,
          color: theme.colors.text,
        },
        modalDone: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 14,
          color: theme.colors.accent,
        },
        courseSearchInput: {
          fontFamily: theme.fontFamily.input,
          fontSize: 14,
          color: theme.colors.text,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.sm,
          paddingHorizontal: 12,
          paddingVertical: 8,
          marginHorizontal: theme.spacing.md,
          marginTop: theme.spacing.sm,
          backgroundColor: theme.colors.background,
        },
        courseFilterRow: {
          flexDirection: 'row',
          gap: 8,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.sm,
        },
        courseFilterChip: {
          paddingVertical: 6,
          paddingHorizontal: 12,
          borderRadius: theme.radius.sm,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.background,
        },
        courseFilterChipActive: {
          borderColor: theme.colors.accent,
          backgroundColor: theme.colors.accentMuted,
        },
        courseFilterChipText: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 12,
          color: theme.colors.textMuted,
        },
        courseFilterChipTextActive: {
          color: theme.colors.accent,
        },
        courseList: { maxHeight: 320 },
        courseItem: {
          paddingVertical: 12,
          paddingHorizontal: theme.spacing.md,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.border,
        },
        courseItemActive: {
          backgroundColor: theme.colors.accentMuted,
        },
        courseItemText: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 14,
          color: theme.colors.text,
        },
        courseItemTextActive: {
          color: theme.colors.accent,
        },
        courseListEmpty: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 13,
          color: theme.colors.textMuted,
          padding: theme.spacing.md,
          textAlign: 'center',
        },
        badge: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 11,
          color: theme.colors.textMuted,
        },
        empty: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 13,
          color: theme.colors.textMuted,
          lineHeight: 18,
        },
        emptyBlock: { gap: 10 },
        emptyAction: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          alignSelf: 'flex-start',
        },
        emptyActionText: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 13,
          color: theme.colors.accent,
        },
        emptyRacesBanner: {
          backgroundColor: theme.colors.accentMuted,
          borderRadius: theme.radius.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.accent,
          paddingVertical: 12,
          paddingHorizontal: 14,
          gap: 6,
        },
        emptyRacesTitle: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 13,
          color: theme.colors.accent,
        },
        emptyRacesBody: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 13,
          lineHeight: 18,
          color: theme.colors.text,
        },
        selectionsPanel: {
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.lg,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          overflow: 'hidden',
          paddingHorizontal: theme.spacing.md,
          paddingTop: theme.spacing.md,
          paddingBottom: theme.spacing.md,
        },
        selectionsHeadRow: {
          flexDirection: 'row',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 8,
        },
        selectionsScope: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 12,
          color: theme.colors.textMuted,
        },
      }),
    [theme, insets.top, insets.bottom, isNarrowWeb, isWideWeb]
  );

  const raceSlideStyle = { transform: [{ translateX: raceSlideX }] };

  const renderNextRace = () => {
    const inPlay =
      !!activeRace &&
      new Date(activeRace.firstRaceUtc).getTime() <= nowMs &&
      new Date(activeRace.lastRaceUtc).getTime() > nowMs;

    return (
      <View style={styles.spotlightWrap}>
        <View style={styles.spotlight}>
          <View style={styles.spotlightHead}>
            <Text style={styles.spotlightTitle}>Next up for you</Text>
            <Text style={styles.spotlightMeta} numberOfLines={1}>
              {upcomingRaces.length
                ? `${raceIndex + 1}/${upcomingRaces.length}`
                : 'No active races'}
            </Text>
          </View>

          {activeRace ? (
            <Pressable
              style={styles.cardTap}
              onLayout={(e) => {
                const w = e.nativeEvent.layout.width;
                if (w > 0 && Math.abs(w - raceCardWidth) > 1) setRaceCardWidth(w);
              }}
              onPress={() => {
                if (upcomingRaces.length > 1) {
                  goToRace(raceIndex + 1, { direction: 'left' });
                } else {
                  router.push('/(app)/selections' as any);
                }
              }}
              accessibilityRole="button"
              accessibilityLabel="Next race"
            >
              <Animated.View style={[styles.cardSlide, raceSlideStyle]}>
                <View style={styles.cardRow}>
                  <View style={styles.cardSide}>
                    <Text style={styles.cardCourse} numberOfLines={2}>
                      {displayRacingCourseName(activeRace.course)}
                    </Text>
                    <Text style={styles.cardComp} numberOfLines={1}>
                      {activeRace.competitionName}
                    </Text>
                  </View>
                  <View style={styles.cardMid}>
                    {inPlay ? (
                      <>
                        <Text style={styles.cardVs}>Live</Text>
                        <Text style={styles.cardHint}>In play</Text>
                      </>
                    ) : (
                      <>
                        <Text style={styles.cardVs}>starts</Text>
                        <Text style={styles.cardTime}>
                          {new Date(activeRace.firstRaceUtc).toLocaleString(undefined, {
                            weekday: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </Text>
                      </>
                    )}
                  </View>
                  <View style={styles.cardSide}>
                    <Text style={styles.cardRaceName} numberOfLines={2}>
                      {activeRace.firstRaceName ?? 'Racecard'}
                    </Text>
                    <Text style={styles.cardComp}>
                      {activeRace.firstRaceRunnerCount
                        ? `${activeRace.firstRaceRunnerCount} runners`
                        : activeRace.hasAllPicks
                          ? 'Picks in'
                          : `${activeRace.pendingCount} to pick`}
                    </Text>
                  </View>
                </View>
              </Animated.View>
            </Pressable>
          ) : (
            <View style={styles.cardEmptyBody}>
              <Text style={styles.empty}>No active races right now.</Text>
            </View>
          )}

          {upcomingRaces.length > 1 ? (
            <View style={styles.dots}>
              {upcomingRaces.map((d, i) => (
                <Pressable
                  key={`${d.competitionId}:${d.raceDayId}`}
                  onPress={() => goToRace(i)}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={`Show race day ${i + 1}`}
                >
                  <View style={[styles.dot, i === raceIndex && styles.dotActive]} />
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.wrapper}>
      <View style={styles.header}>
        <Pressable
          style={styles.headerMenu}
          onPress={openSidebar}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Open menu"
        >
          <Ionicons name="menu" size={24} color={theme.colors.text} />
        </Pressable>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>Top Tipster Racing</Text>
          <Text style={styles.sub}>Racing festivals</Text>
        </View>
        <Pressable
          style={styles.headerRefresh}
          onPress={onRefresh}
          disabled={refreshing}
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

      {renderNextRace()}

      <ScrollView
        style={styles.mainScroll}
        contentContainerStyle={styles.mainScrollContent}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.accent}
            colors={[theme.colors.accent]}
          />
        }
      >
        {upcomingRaces.length === 0 ? (
          <View
            style={styles.emptyRacesBanner}
            accessibilityRole="text"
            accessibilityLabel="No races available"
          >
            <Text style={styles.emptyRacesTitle}>You've no races available</Text>
            <Text style={styles.emptyRacesBody}>
              Once races become available for your competitions, they will show here.
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
                  { key: 'points' as const, label: 'Points system' },
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
                    <Text style={[styles.tabText, active && styles.tabTextActive]}>{t.label}</Text>
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
                      <CreateCompetitionUpgradeCta modeLabel="Racing" />
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
                            <Text style={styles.createFieldLabel}>Name</Text>
                            <TextInput
                              style={styles.createInput}
                              value={createName}
                              onChangeText={setCreateName}
                              placeholder="e.g. Cheltenham office league"
                              placeholderTextColor={theme.colors.textMuted}
                              autoCorrect={false}
                              editable={!creating}
                            />

                            <Text style={styles.createFieldLabel}>Course</Text>
                            <Pressable
                              style={styles.createSelect}
                              onPress={() => {
                                setCourseSearch('');
                                setCoursePickerOpen(true);
                              }}
                              disabled={creating}
                              accessibilityRole="button"
                              accessibilityLabel="Select course"
                            >
                              <Text
                                style={[
                                  styles.createSelectText,
                                  !createCourse && styles.createSelectPlaceholder,
                                ]}
                                numberOfLines={1}
                              >
                                {createCourse || 'Select racecourse'}
                              </Text>
                              <Ionicons name="chevron-down" size={16} color={theme.colors.textMuted} />
                            </Pressable>

                            <Text style={styles.createFieldLabel}>Festival start</Text>
                            {Platform.OS === 'web' ? (
                              // @ts-expect-error web date input
                              <input
                                type="date"
                                value={createStartDate}
                                onChange={(e: { target: { value: string } }) =>
                                  setCreateStartDate(e.target.value)
                                }
                                disabled={creating}
                                style={{
                                  fontFamily: theme.fontFamily.input,
                                  fontSize: 14,
                                  color: theme.colors.text,
                                  backgroundColor: theme.colors.surface,
                                  border: `1px solid ${theme.colors.border}`,
                                  borderRadius: 6,
                                  padding: 10,
                                  width: '100%',
                                }}
                              />
                            ) : (
                              <TextInput
                                style={styles.createInput}
                                value={createStartDate}
                                onChangeText={setCreateStartDate}
                                placeholder="YYYY-MM-DD"
                                placeholderTextColor={theme.colors.textMuted}
                                autoCapitalize="none"
                                editable={!creating}
                              />
                            )}

                            <Text style={styles.createFieldLabel}>Festival length</Text>
                            <View style={styles.createDaysRow}>
                              {[1, 2, 3, 4, 5, 6, 7].map((n) => {
                                const active = createDays === n;
                                return (
                                  <Pressable
                                    key={n}
                                    style={[styles.createDayChip, active && styles.createDayChipActive]}
                                    onPress={() => setCreateDays(n)}
                                    disabled={creating}
                                  >
                                    <Text
                                      style={[
                                        styles.createDayChipText,
                                        active && styles.createDayChipTextActive,
                                      ]}
                                    >
                                      {n}d
                                    </Text>
                                  </Pressable>
                                );
                              })}
                            </View>
                            {createEndPreview ? (
                              <Text style={styles.createHint}>
                                Runs {createStartDate} – {createEndPreview} ({createDays} day
                                {createDays === 1 ? '' : 's'}).
                              </Text>
                            ) : (
                              <Text style={styles.createHint}>
                                Pick a start date and how many days the festival lasts.
                              </Text>
                            )}

                            <Text style={styles.createFieldLabel}>Access code (optional)</Text>
                            <TextInput
                              style={styles.createInput}
                              value={createAccessCode}
                              onChangeText={setCreateAccessCode}
                              placeholder="e.g. PN2027"
                              placeholderTextColor={theme.colors.textMuted}
                              maxLength={6}
                              autoCapitalize="characters"
                              editable={!creating}
                            />

                            <Pressable
                              style={styles.createSubmit}
                              onPress={() => void onCreateCompetition()}
                              disabled={creating}
                            >
                              {creating ? (
                                <ActivityIndicator color={theme.colors.black} size="small" />
                              ) : (
                                <Text style={styles.createSubmitText}>Create</Text>
                              )}
                            </Pressable>

                            <Modal
                              visible={coursePickerOpen}
                              transparent
                              animationType="fade"
                              onRequestClose={() => setCoursePickerOpen(false)}
                            >
                              <Pressable
                                style={styles.modalOverlay}
                                onPress={() => setCoursePickerOpen(false)}
                              >
                                <Pressable
                                  style={styles.modalContent}
                                  onPress={(e) => e.stopPropagation()}
                                >
                                  <View style={styles.modalHeader}>
                                    <Text style={styles.modalTitle}>Select course</Text>
                                    <Pressable onPress={() => setCoursePickerOpen(false)}>
                                      <Text style={styles.modalDone}>Done</Text>
                                    </Pressable>
                                  </View>
                                  <TextInput
                                    style={styles.courseSearchInput}
                                    placeholder="Search courses..."
                                    placeholderTextColor={theme.colors.textMuted}
                                    value={courseSearch}
                                    onChangeText={setCourseSearch}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                  />
                                  <View style={styles.courseFilterRow}>
                                    {(
                                      [
                                        { key: 'all' as const, label: 'All' },
                                        { key: 'ireland' as const, label: 'Ireland' },
                                        { key: 'england' as const, label: 'Britain' },
                                      ] as const
                                    ).map((f) => {
                                      const active = courseRegion === f.key;
                                      return (
                                        <Pressable
                                          key={f.key}
                                          style={[
                                            styles.courseFilterChip,
                                            active && styles.courseFilterChipActive,
                                          ]}
                                          onPress={() => setCourseRegion(f.key)}
                                        >
                                          <Text
                                            style={[
                                              styles.courseFilterChipText,
                                              active && styles.courseFilterChipTextActive,
                                            ]}
                                          >
                                            {f.label}
                                          </Text>
                                        </Pressable>
                                      );
                                    })}
                                  </View>
                                  <FlatList
                                    data={filteredCourses}
                                    keyExtractor={(item) => item}
                                    style={styles.courseList}
                                    keyboardShouldPersistTaps="handled"
                                    ListEmptyComponent={
                                      <Text style={styles.courseListEmpty}>No courses match</Text>
                                    }
                                    renderItem={({ item }) => (
                                      <Pressable
                                        style={[
                                          styles.courseItem,
                                          item === createCourse && styles.courseItemActive,
                                        ]}
                                        onPress={() => {
                                          setCreateCourse(item);
                                          setCoursePickerOpen(false);
                                        }}
                                      >
                                        <Text
                                          style={[
                                            styles.courseItemText,
                                            item === createCourse && styles.courseItemTextActive,
                                          ]}
                                        >
                                          {item}
                                        </Text>
                                      </Pressable>
                                    )}
                                  />
                                </Pressable>
                              </Pressable>
                            </Modal>
                          </View>
                        ) : null}
                      </>
                    ) : null}
                    {comps.length === 0 ? (
                      <View style={styles.emptyBlock}>
                        <Text style={styles.empty}>
                          No competitions yet. Got a competition code? Enter it on the Join tab to
                          get started.
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
                        {comps.map((c, i) => (
                          <Pressable
                            key={c.id}
                            style={[styles.row, i === comps.length - 1 && styles.rowLast]}
                            onPress={() =>
                              router.push({
                                pathname: '/(app)/competition/[competitionId]',
                                params: { competitionId: c.id },
                              } as any)
                            }
                          >
                            <View style={styles.rowCopy}>
                              <View style={styles.rowTitleRow}>
                                <Text style={styles.rowTitle}>{c.name}</Text>
                                {c.isCreator ? (
                                  <View style={styles.manageChip}>
                                    <Text style={styles.manageChipText}>Admin</Text>
                                  </View>
                                ) : null}
                              </View>
                              <Text style={styles.rowMeta}>
                                {c.range
                                  ? `${c.status} · ${c.range.start} – ${c.range.end}`
                                  : c.status}
                              </Text>
                              {fundraiserByComp[fundraiserKey('racing', c.id)] ? (
                                <FundraiserForClub
                                  clubName={fundraiserByComp[fundraiserKey('racing', c.id)].club_name}
                                  clubLogoUrl={fundraiserByComp[fundraiserKey('racing', c.id)].club_logo_url}
                                  size="compact"
                                />
                              ) : null}
                              {c.pickHint ? (
                                <Text
                                  style={
                                    c.pickHint === 'Pick available'
                                      ? styles.rowPickHint
                                      : styles.rowMeta
                                  }
                                >
                                  {c.pickHint}
                                </Text>
                              ) : null}
                            </View>
                            <View style={styles.rowTrailing}>
                              {c.status === 'upcoming' ? (
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
                        ))}
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
                      value={joinCode}
                      onChangeText={setJoinCode}
                      placeholder="CODE"
                      placeholderTextColor={theme.colors.textMuted}
                      autoCapitalize="characters"
                      maxLength={12}
                      autoCorrect={false}
                    />
                    <Pressable style={styles.joinBtn} onPress={() => void onJoin()} disabled={joining}>
                      {joining ? (
                        <ActivityIndicator color={theme.colors.black} size="small" />
                      ) : (
                        <Text style={styles.joinBtnText}>Join</Text>
                      )}
                    </Pressable>
                  </View>
                  <Text style={styles.joinHint}>
                    Ask the competition organiser for the access code, then enter it here. You’ll
                    appear in My competitions once they approve you.
                  </Text>
                </View>
              ) : null}

              {tab === 'points' ? <RacingPointsPanel compact /> : null}
            </View>
          ) : null}
        </View>

        <View style={styles.selectionsPanel}>
          <View style={styles.selectionsHeadRow}>
            <Text style={[styles.sectionLabel, { marginBottom: 0 }]}>Selections</Text>
            <Text style={styles.selectionsScope}>
              {upcomingRaces.length > 0 ? 'upcoming race days' : 'no open days'}
            </Text>
          </View>
          {upcomingRaces.length === 0 ? (
            <Text style={styles.empty}>
              {participations.length === 0
                ? 'Join a competition to make daily picks.'
                : 'No upcoming race days with open or live cards yet.'}
            </Text>
          ) : (
            <View style={styles.list}>
              {upcomingRaces.map((day, i) => {
                const dayNum = dayNumberByKey.get(`${day.competitionId}:${day.raceDate}`);
                const status = day.isLocked
                  ? day.hasAllPicks
                    ? 'Locked · picks in'
                    : 'Locked'
                  : day.hasAllPicks
                    ? 'Picks complete'
                    : `${day.pendingCount} pick${day.pendingCount === 1 ? '' : 's'} left`;
                const timeLabel = new Date(day.firstRaceUtc).toLocaleString(undefined, {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                });
                return (
                  <Pressable
                    key={`${day.competitionId}:${day.raceDayId}`}
                    style={[styles.row, i === upcomingRaces.length - 1 && styles.rowLast]}
                    onPress={() =>
                      router.push({
                        pathname: '/(app)/selections',
                        params: {
                          competitionId: day.competitionId,
                          raceDate: day.raceDate,
                        },
                      } as any)
                    }
                  >
                    <View style={styles.rowCopy}>
                      <View style={styles.rowTitleRow}>
                        <Text style={styles.rowTitle} numberOfLines={1}>
                          {displayRacingCourseName(day.course)}
                        </Text>
                        {dayNum != null ? (
                          <View style={styles.manageChip}>
                            <Text style={styles.manageChipText}>Day {dayNum}</Text>
                          </View>
                        ) : null}
                      </View>
                      <Text style={styles.rowMeta}>
                        {day.competitionName} · {timeLabel}
                      </Text>
                      <Text
                        style={
                          !day.isLocked && !day.hasAllPicks ? styles.rowPickHint : styles.rowMeta
                        }
                      >
                        {status}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={theme.colors.textMuted} />
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
