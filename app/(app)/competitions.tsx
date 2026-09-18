import { useEffect, useState, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  Alert,
  TextInput,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/contexts/ThemeContext';
import { lightTheme } from '@/constants/theme';
import { clearAvailableRacesCache } from '@/lib/availableRacesCache';
import { clearSelectionsBulkCache } from '@/lib/selectionsBulkCache';
import { getCompetitionDisplayStatus } from '@/lib/appUtils';
import { joinCompetitionWithAccessCode } from '@/lib/joinCompetitionWithAccessCode';
import { INVALID_JOIN_CODE_TITLE, invalidJoinCodeMessage } from '@/lib/joinCodeMessages';
import { confirmJoinLimitDisclaimer } from '@/lib/joinLimitDisclaimer';
import { FundraiserForClub } from '@/components/FundraiserForClub';
import {
  fetchCompetitionsFundraiserBranding,
  fundraiserKey,
  type FundraiserBranding,
} from '@/lib/fundraiserBranding';
import { useNarrowWebCompact, cfs } from '@/lib/narrowWebTypography';
import { getProfileRole, isOwnerRole, canCreateCompetitions } from '@/lib/adminSession';
import { CreateCompetitionUpgradeCta } from '@/components/CreateCompetitionUpgradeCta';
import {
  racingAdminListCompetitions,
  racingCreateCompetition,
} from '@/lib/racingAdminApi';

type UserCompetition = {
  competition_id: string;
  name: string;
  status: string;
  festival_start_date: string;
  festival_end_date: string;
  display_name: string;
  position: number | null; // 1-based rank in that competition, null if no scores yet
  created_by_user_id: string | null;
};

type PendingCompetition = {
  competition_id: string;
  name: string;
  festival_start_date: string;
  festival_end_date: string;
};

export default function MyCompetitionsScreen() {
  const theme = useTheme();
  const compact = useNarrowWebCompact();
  const { userId } = useAuth();
  const params = useLocalSearchParams<{ join?: string }>();
  const [fundraiserByComp, setFundraiserByComp] = useState<Record<string, FundraiserBranding>>({});
  const [list, setList] = useState<UserCompetition[]>([]);
  const [pendingList, setPendingList] = useState<PendingCompetition[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [newlyApprovedNames, setNewlyApprovedNames] = useState<string[]>([]);
  const [compFilter, setCompFilter] = useState<'live' | 'upcoming' | 'complete'>('live');
  const pendingListRef = useRef<PendingCompetition[]>([]);

  const [joinExpanded, setJoinExpanded] = useState(() => params.join === '1' || params.join === 'true');
  const [joinCode, setJoinCode] = useState('');
  const [joinDisplayName, setJoinDisplayName] = useState('');
  const [joinProfileUsername, setJoinProfileUsername] = useState<string | null>(null);
  const [joinLoading, setJoinLoading] = useState(false);

  const [isStaff, setIsStaff] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [creatorByCompId, setCreatorByCompId] = useState<Record<string, string | null>>({});
  const [createExpanded, setCreateExpanded] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createStartDate, setCreateStartDate] = useState('');
  const [createEndDate, setCreateEndDate] = useState('');
  const [createAccessCode, setCreateAccessCode] = useState('');
  const [createLoading, setCreateLoading] = useState(false);

  const displayNameToUse = joinProfileUsername?.length ? joinProfileUsername : joinDisplayName.trim();

  useEffect(() => {
    if (!userId) return;
    supabase
      .from('profiles')
      .select('username')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        setJoinProfileUsername(data?.username ?? null);
        if (data?.username) setJoinDisplayName(data.username);
      });
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setIsStaff(false);
      setIsOwner(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const role = await getProfileRole(userId);
        if (cancelled) return;
        setIsStaff(await canCreateCompetitions(userId));
        setIsOwner(isOwnerRole(role));
      } catch {
        if (!cancelled) {
          setIsStaff(false);
          setIsOwner(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    if (params.join === '1' || params.join === 'true') {
      setJoinExpanded(true);
    }
  }, [params.join]);

  const listFiltered = useMemo(
    () => list.filter((c) => c.status.toLowerCase() === compFilter),
    [list, compFilter]
  );

  useEffect(() => {
    pendingListRef.current = pendingList;
  }, [pendingList]);

  const load = async () => {
    if (!userId) return;
    const prevPendingIds = new Set(pendingListRef.current.map((c) => c.competition_id));
    setRefreshing(true);
    try {
      const staff = isStaff;
      const [participantsRes, pendingRes, adminList] = await Promise.all([
        supabase
          .from('competition_participants')
          .select('competition_id, display_name')
          .eq('user_id', userId),
        supabase
          .from('competition_join_requests')
          .select('competition_id')
          .eq('user_id', userId)
          .eq('status', 'pending'),
        staff
          ? racingAdminListCompetitions().catch(() => [])
          : Promise.resolve([] as Awaited<ReturnType<typeof racingAdminListCompetitions>>),
      ]);
      if (participantsRes.error) throw participantsRes.error;

      let creatorMap: Record<string, string | null> = {};
      if (staff && Array.isArray(adminList)) {
        for (const row of adminList) {
          creatorMap[row.id] = row.created_by_user_id ?? null;
        }
        setCreatorByCompId(creatorMap);
      } else {
        setCreatorByCompId({});
      }

      if (!participantsRes.data?.length) {
        setList([]);
        setNewlyApprovedNames([]);
      } else {
        const compIds = (participantsRes.data as { competition_id: string }[]).map((p) => p.competition_id);
        const displayNameByComp = new Map(
          (participantsRes.data as { competition_id: string; display_name: string }[]).map((p) => [p.competition_id, p.display_name])
        );
        const { data: comps, error: compsError } = await supabase
          .from('competitions')
          .select('id, name, festival_start_date, festival_end_date, created_by_user_id')
          .in('id', compIds);
        if (compsError) throw compsError;
        const joined: UserCompetition[] = (comps ?? []).map((c) => {
            const displayStatus = getCompetitionDisplayStatus(c.festival_start_date, c.festival_end_date);
            const statusLabel = displayStatus === 'upcoming' ? 'Upcoming' : displayStatus === 'live' ? 'Live' : 'Complete';
            const fromRow = (c as { created_by_user_id?: string | null }).created_by_user_id ?? null;
            return {
              competition_id: c.id,
              name: c.name,
              status: statusLabel,
              festival_start_date: c.festival_start_date,
              festival_end_date: c.festival_end_date,
              display_name: displayNameByComp.get(c.id) ?? '',
              position: null,
              created_by_user_id: fromRow ?? creatorMap[c.id] ?? null,
            };
          });

        if (joined.length > 0 && compIds.length > 0) {
          // Use daily_selections only (no race-days fetch) to minimise egress. Position here is
          // approximate (odds-based); leaderboard uses full DB points (pos_points + sp_points).
          const { data: allSelections } = await supabase
            .from('daily_selections')
            .select('competition_id, user_id, selections')
            .in('competition_id', compIds);
          const totalByCompUser: Record<string, Record<string, number>> = {};
          for (const compId of compIds) totalByCompUser[compId] = {};
          for (const row of allSelections ?? []) {
            const sel = row.selections as Record<string, { oddsDecimal?: number }> | null;
            if (!sel) continue;
            const compId = row.competition_id as string;
            const uid = row.user_id as string;
            let sum = 0;
            for (const v of Object.values(sel)) {
              if (v?.oddsDecimal != null) sum += Math.round(v.oddsDecimal * 10);
            }
            totalByCompUser[compId][uid] = (totalByCompUser[compId][uid] ?? 0) + sum;
          }
          for (const c of joined) {
            const byUser = totalByCompUser[c.competition_id] ?? {};
            const sorted = Object.entries(byUser).sort((a, b) => b[1] - a[1]);
            const idx = sorted.findIndex(([uid]) => uid === userId);
            c.position = idx >= 0 ? idx + 1 : null;
          }
        }
        setList(joined);
        try {
          const branding = await fetchCompetitionsFundraiserBranding(
            (joined).map((c) => ({
              sport: 'racing' as const,
              competition_id: c.competition_id,
            }))
          );
          setFundraiserByComp(branding);
        } catch {
          setFundraiserByComp({});
        }

        const newlyApproved = joined.filter((c) => prevPendingIds.has(c.competition_id));
        setNewlyApprovedNames(newlyApproved.length > 0 ? newlyApproved.map((c) => c.name) : []);
      }

      if (pendingRes.error || !pendingRes.data?.length) {
        setPendingList([]);
      } else {
        const compIds = [...new Set((pendingRes.data as { competition_id: string }[]).map((r) => r.competition_id))];
        const { data: comps } = await supabase
          .from('competitions')
          .select('id, name, festival_start_date, festival_end_date')
          .in('id', compIds);
        const compMap = new Map((comps ?? []).map((c) => [c.id, c]));
        const pending: PendingCompetition[] = compIds.map((id) => {
          const c = compMap.get(id);
          return {
            competition_id: id,
            name: c?.name ?? 'Competition',
            festival_start_date: c?.festival_start_date ?? '',
            festival_end_date: c?.festival_end_date ?? '',
          };
        });
        setPendingList(pending);
      }
    } catch {
      setList([]);
      setPendingList([]);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
  }, [userId, isStaff]);

  useEffect(() => {
    if (newlyApprovedNames.length === 0 || !userId) return;
    const message =
      newlyApprovedNames.length === 1
        ? `${newlyApprovedNames[0]} entry has been approved.`
        : `${newlyApprovedNames.join(', ')} entries have been approved.`;
    Alert.alert('Approved', message, [
      {
        text: 'OK',
        onPress: () => {
          setNewlyApprovedNames([]);
          clearAvailableRacesCache(userId);
          clearSelectionsBulkCache(userId);
        },
      },
    ]);
  }, [newlyApprovedNames, userId]);

  const handleJoinSubmit = async () => {
    if (!userId) {
      Alert.alert('Error', 'You must be signed in.');
      return;
    }
    const confirmed = await confirmJoinLimitDisclaimer(joinCode);
    if (!confirmed) return;

    setJoinLoading(true);
    try {
      const outcome = await joinCompetitionWithAccessCode({
        userId,
        code: joinCode,
        displayNameToUse,
      });
      if (outcome.kind === 'error') {
        Alert.alert('Error', outcome.message);
        return;
      }
      if (outcome.kind === 'invalid_code') {
        Alert.alert(INVALID_JOIN_CODE_TITLE, invalidJoinCodeMessage('racing'));
        return;
      }
      if (outcome.kind === 'already_in') {
        Alert.alert('Already in', `You're already in "${outcome.competitionName}".`);
        await load();
        return;
      }
      Alert.alert(
        'Request sent',
        `Your request to join "${outcome.competitionName}" has been sent. An admin will approve you soon.`
      );
      setJoinCode('');
      await load();
    } finally {
      setJoinLoading(false);
    }
  };

  const handleCreateSubmit = async () => {
    const name = createName.trim();
    if (!name) {
      Alert.alert('Error', 'Please enter a competition name.');
      return;
    }
    const start = createStartDate.trim();
    const end = createEndDate.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      Alert.alert('Error', 'Enter start and end dates as YYYY-MM-DD.');
      return;
    }
    if (end < start) {
      Alert.alert('Error', 'End date must be on or after the start date.');
      return;
    }
    const code = createAccessCode.trim().toUpperCase().slice(0, 6) || null;
    setCreateLoading(true);
    try {
      const result = await racingCreateCompetition({
        name,
        festivalStartDate: start,
        festivalEndDate: end,
        accessCode: code,
      });
      if (!result.success) {
        Alert.alert('Error', result.error ?? 'Could not create competition');
        return;
      }
      Alert.alert('Created', code ? `Competition created. Access code: ${code}` : 'Competition created.');
      setCreateName('');
      setCreateStartDate('');
      setCreateEndDate('');
      setCreateAccessCode('');
      setCreateExpanded(false);
      await load();
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not create competition');
    } finally {
      setCreateLoading(false);
    }
  };

  const isCreatedByMe = (c: UserCompetition) => {
    const fromRow = c.created_by_user_id;
    const fromMap = creatorByCompId[c.competition_id];
    return (fromRow ?? fromMap) === userId;
  };

  const styles = useMemo(() => {
    const isLight = theme.colors.background === lightTheme.colors.background;
    const cardBorder = isLight ? theme.colors.white : theme.colors.border;
    const cardBorderWidth = isLight ? 2 : 1;
    return StyleSheet.create({
      container: { flex: 1, backgroundColor: theme.colors.background },
      content: {
        padding: compact ? theme.spacing.sm : theme.spacing.md,
        paddingBottom: theme.spacing.xxl,
      },
      title: {
        fontFamily: theme.fontFamily.regular,
        fontSize: cfs(20, compact),
        color: theme.colors.text,
        marginBottom: theme.spacing.xs,
      },
      subtitle: {
        fontFamily: theme.fontFamily.regular,
        fontSize: cfs(13, compact),
        color: theme.colors.textSecondary,
        marginBottom: theme.spacing.sm,
      },
      joinSection: {
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.md,
        borderWidth: cardBorderWidth,
        borderColor: cardBorder,
        marginBottom: theme.spacing.lg,
        overflow: 'hidden',
      },
      joinHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: compact ? theme.spacing.sm : theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
      },
      joinHeaderText: {
        fontFamily: theme.fontFamily.regular,
        fontSize: cfs(16, compact),
        fontWeight: '600',
        color: theme.colors.text,
        flex: 1,
      },
      joinPanel: {
        paddingHorizontal: theme.spacing.lg,
        paddingBottom: theme.spacing.md,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.border,
      },
      joinHint: {
        fontFamily: theme.fontFamily.regular,
        fontSize: cfs(12, compact),
        color: theme.colors.textMuted,
        marginBottom: theme.spacing.sm,
      },
      joinInput: {
        fontFamily: theme.fontFamily.input,
        fontSize: cfs(16, compact),
        color: theme.colors.text,
        backgroundColor: theme.colors.background,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: theme.radius.sm,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
        marginBottom: theme.spacing.sm,
        width: '100%',
      },
      createDateWrap: {
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
        marginBottom: theme.spacing.sm,
      },
      joinDisplayLabel: {
        fontFamily: theme.fontFamily.regular,
        fontSize: cfs(13, compact),
        color: theme.colors.textSecondary,
        marginBottom: theme.spacing.sm,
      },
      joinButton: {
        backgroundColor: theme.colors.accent,
        borderRadius: theme.radius.sm,
        paddingVertical: theme.spacing.md,
        alignItems: 'center',
        marginTop: theme.spacing.xs,
      },
      joinButtonDisabled: { opacity: 0.7 },
      joinButtonText: {
        fontFamily: theme.fontFamily.regular,
        fontSize: cfs(15, compact),
        color: theme.colors.background === '#fafafa' ? theme.colors.black : theme.colors.white,
        fontWeight: '600',
      },
      sectionTitle: {
        fontFamily: theme.fontFamily.regular,
        fontSize: cfs(15, compact),
        color: theme.colors.accent,
        marginTop: theme.spacing.md,
        marginBottom: theme.spacing.xs,
      },
      sectionSubtitle: {
        fontFamily: theme.fontFamily.regular,
        fontSize: cfs(11, compact),
        color: theme.colors.textMuted,
        marginBottom: theme.spacing.xs,
      },
      cardPending: {
        opacity: 0.9,
      },
      pendingBadge: {
        fontFamily: theme.fontFamily.regular,
        fontSize: cfs(12, compact),
        color: theme.colors.textMuted,
        marginTop: theme.spacing.xs,
        fontStyle: 'italic',
      },
      emptyMessage: {
        fontFamily: theme.fontFamily.regular,
        fontSize: cfs(13, compact),
        color: theme.colors.textMuted,
        textAlign: 'center',
        marginTop: theme.spacing.sm,
      },
      card: {
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.md,
        padding: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
        marginBottom: theme.spacing.md,
        borderWidth: cardBorderWidth,
        borderColor: cardBorder,
      },
      cardTitle: {
        fontFamily: theme.fontFamily.regular,
        fontSize: cfs(16, compact),
        color: theme.colors.text,
      },
      cardMeta: { fontFamily: theme.fontFamily.regular, fontSize: cfs(12, compact), color: theme.colors.textMuted, marginTop: theme.spacing.xs },
      cardFooter: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, marginTop: theme.spacing.sm, flexWrap: 'wrap' },
      cardStatus: { fontFamily: theme.fontFamily.regular, fontSize: cfs(12, compact), color: theme.colors.accent },
      cardPosition: { fontFamily: theme.fontFamily.regular, fontSize: cfs(12, compact), color: theme.colors.textSecondary },
      tapHint: {
        fontFamily: theme.fontFamily.regular,
        fontSize: cfs(12, compact),
        color: theme.colors.textMuted,
        marginTop: theme.spacing.sm,
      },
      adminBadge: {
        fontFamily: theme.fontFamily.regular,
        fontSize: cfs(11, compact),
        fontWeight: '700',
        color: theme.colors.accent,
        borderWidth: 1,
        borderColor: theme.colors.accent,
        borderRadius: theme.radius.sm,
        paddingHorizontal: 8,
        paddingVertical: 2,
        overflow: 'hidden',
      },
      titleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        flexWrap: 'wrap',
      },
      createLabel: {
        fontFamily: theme.fontFamily.regular,
        fontSize: cfs(12, compact),
        color: theme.colors.textSecondary,
        marginBottom: theme.spacing.xs,
      },
      compTabsRow: {
        flexDirection: 'row',
        width: '100%',
        marginBottom: theme.spacing.md,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.border,
      },
      compTab: {
        flex: 1,
        paddingVertical: 11,
        alignItems: 'center',
        borderBottomWidth: 2,
        borderBottomColor: 'transparent',
      },
      compTabActive: {
        borderBottomColor: theme.colors.accent,
      },
      compTabText: {
        fontFamily: theme.fontFamily.baiMedium,
        fontSize: cfs(13, compact),
        color: theme.colors.textMuted,
      },
      compTabTextActive: {
        color: theme.colors.accent,
      },
    });
  }, [theme, compact]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={theme.colors.accent} />}
    >
      <Text style={styles.title}>My Competitions</Text>
      <Text style={styles.subtitle}>Tap a competition to open its hub.</Text>

      {!isStaff ? <CreateCompetitionUpgradeCta modeLabel="Racing" /> : null}

      {isStaff ? (
        <View style={styles.joinSection}>
          <TouchableOpacity
            style={styles.joinHeader}
            onPress={() => setCreateExpanded((e) => !e)}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityState={{ expanded: createExpanded }}
          >
            <Text style={styles.joinHeaderText}>Create competition</Text>
            <Ionicons
              name={createExpanded ? 'chevron-up' : 'chevron-down'}
              size={22}
              color={theme.colors.textSecondary}
            />
          </TouchableOpacity>
          {createExpanded && (
            <View style={styles.joinPanel}>
              <Text style={styles.joinHint}>
                Name and festival dates are required. Access code is optional (up to 6 characters).
                {isOwner ? ' As Owner you can manage any competition.' : ' You will admin competitions you create.'}
              </Text>
              <Text style={styles.createLabel}>Competition name</Text>
              <TextInput
                style={styles.joinInput}
                placeholder="e.g. Pat Nutter 2027"
                placeholderTextColor={theme.colors.textMuted}
                value={createName}
                onChangeText={setCreateName}
                editable={!createLoading}
              />
              <Text style={styles.createLabel}>Start date (YYYY-MM-DD)</Text>
              {Platform.OS === 'web' ? (
                <View style={styles.createDateWrap}>
                  <input
                    type="date"
                    value={createStartDate}
                    onChange={(e) => setCreateStartDate(e.target.value)}
                    disabled={createLoading}
                    style={{
                      fontFamily: theme.fontFamily.input,
                      fontSize: 16,
                      color: theme.colors.text,
                      backgroundColor: theme.colors.background,
                      border: `1px solid ${theme.colors.border}`,
                      borderRadius: 8,
                      padding: '12px',
                      width: '100%',
                      maxWidth: '100%',
                      minWidth: 0,
                      boxSizing: 'border-box',
                      display: 'block',
                    }}
                  />
                </View>
              ) : (
                <TextInput
                  style={styles.joinInput}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={theme.colors.textMuted}
                  value={createStartDate}
                  onChangeText={setCreateStartDate}
                  autoCapitalize="none"
                  editable={!createLoading}
                />
              )}
              <Text style={styles.createLabel}>End date (YYYY-MM-DD)</Text>
              {Platform.OS === 'web' ? (
                <View style={styles.createDateWrap}>
                  <input
                    type="date"
                    value={createEndDate}
                    onChange={(e) => setCreateEndDate(e.target.value)}
                    disabled={createLoading}
                    min={createStartDate || undefined}
                    style={{
                      fontFamily: theme.fontFamily.input,
                      fontSize: 16,
                      color: theme.colors.text,
                      backgroundColor: theme.colors.background,
                      border: `1px solid ${theme.colors.border}`,
                      borderRadius: 8,
                      padding: '12px',
                      width: '100%',
                      maxWidth: '100%',
                      minWidth: 0,
                      boxSizing: 'border-box',
                      display: 'block',
                    }}
                  />
                </View>
              ) : (
                <TextInput
                  style={styles.joinInput}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={theme.colors.textMuted}
                  value={createEndDate}
                  onChangeText={setCreateEndDate}
                  autoCapitalize="none"
                  editable={!createLoading}
                />
              )}
              <Text style={styles.createLabel}>Access code (optional)</Text>
              <TextInput
                style={styles.joinInput}
                placeholder="e.g. PN2027"
                placeholderTextColor={theme.colors.textMuted}
                value={createAccessCode}
                onChangeText={setCreateAccessCode}
                maxLength={6}
                autoCapitalize="characters"
                editable={!createLoading}
              />
              <TouchableOpacity
                style={[styles.joinButton, createLoading && styles.joinButtonDisabled]}
                onPress={handleCreateSubmit}
                disabled={createLoading}
                activeOpacity={0.85}
              >
                {createLoading ? (
                  <ActivityIndicator color={theme.colors.black} />
                ) : (
                  <Text style={styles.joinButtonText}>Create competition</Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>
      ) : null}

      <View style={styles.joinSection}>
        <TouchableOpacity
          style={styles.joinHeader}
          onPress={() => setJoinExpanded((e) => !e)}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityState={{ expanded: joinExpanded }}
        >
          <Text style={styles.joinHeaderText}>Join a competition</Text>
          <Ionicons
            name={joinExpanded ? 'chevron-up' : 'chevron-down'}
            size={22}
            color={theme.colors.textSecondary}
          />
        </TouchableOpacity>
        {joinExpanded && (
          <View style={styles.joinPanel}>
            <Text style={styles.joinHint}>Enter the access code you were given. An admin may need to approve your request.</Text>
            <TextInput
              style={styles.joinInput}
              placeholder="Access code"
              placeholderTextColor={theme.colors.textMuted}
              value={joinCode}
              onChangeText={setJoinCode}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!joinLoading}
            />
            {joinProfileUsername ? (
              <Text style={styles.joinDisplayLabel}>{"You'll appear on the leaderboard as: "}{joinProfileUsername}</Text>
            ) : (
              <TextInput
                style={styles.joinInput}
                placeholder="Display name (for leaderboard)"
                placeholderTextColor={theme.colors.textMuted}
                value={joinDisplayName}
                onChangeText={setJoinDisplayName}
                editable={!joinLoading}
              />
            )}
            <TouchableOpacity
              style={[styles.joinButton, joinLoading && styles.joinButtonDisabled]}
              onPress={handleJoinSubmit}
              disabled={joinLoading}
              activeOpacity={0.85}
            >
              {joinLoading ? (
                <ActivityIndicator color={theme.colors.black} />
              ) : (
                <Text style={styles.joinButtonText}>Submit request</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>

      {pendingList.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Pending</Text>
          <Text style={styles.sectionSubtitle}>Waiting for admin approval. Pull down to refresh and see if you've been accepted.</Text>
          {pendingList.map((c) => (
            <View key={c.competition_id} style={[styles.card, styles.cardPending]}>
              <Text style={styles.cardTitle}>{c.name}</Text>
              <Text style={styles.cardMeta}>
                {c.festival_start_date ? new Date(c.festival_start_date).toLocaleDateString() : ''}
                {c.festival_end_date ? ` – ${new Date(c.festival_end_date).toLocaleDateString()}` : ''}
              </Text>
              <Text style={styles.pendingBadge}>Request pending</Text>
            </View>
          ))}
        </>
      )}

      {list.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Competitions</Text>
          <View style={styles.compTabsRow}>
            {(['complete', 'live', 'upcoming'] as const).map((tab) => {
              const isActive = compFilter === tab;
              const label = tab === 'complete' ? 'Complete' : tab === 'live' ? 'Live' : 'Upcoming';
              return (
                <TouchableOpacity
                  key={tab}
                  style={[styles.compTab, isActive && styles.compTabActive]}
                  onPress={() => setCompFilter(tab)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.compTabText, isActive && styles.compTabTextActive]}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      )}

      {list.length === 0 && pendingList.length === 0 ? (
        <Text style={styles.emptyMessage}>
          {"You're not part of any competitions yet. Open \"Join a competition\" above and enter your access code."}
        </Text>
      ) : list.length === 0 ? null : (
        listFiltered.map((c) => (
            <TouchableOpacity
              key={c.competition_id}
              style={styles.card}
              onPress={() =>
                router.push({
                  pathname: '/(app)/competition/[competitionId]',
                  params: { competitionId: c.competition_id },
                })
              }
              activeOpacity={0.8}
            >
              <View style={styles.titleRow}>
                <Text style={styles.cardTitle}>{c.name}</Text>
                {isCreatedByMe(c) ? <Text style={styles.adminBadge}>Admin</Text> : null}
              </View>
              {fundraiserByComp[fundraiserKey('racing', c.competition_id)] ? (
                <FundraiserForClub
                  clubName={fundraiserByComp[fundraiserKey('racing', c.competition_id)].club_name}
                  clubLogoUrl={fundraiserByComp[fundraiserKey('racing', c.competition_id)].club_logo_url}
                  size="compact"
                />
              ) : null}
              <Text style={styles.cardMeta}>
                {new Date(c.festival_start_date).toLocaleDateString()} – {new Date(c.festival_end_date).toLocaleDateString()}
              </Text>
              <View style={styles.cardFooter}>
                <Text style={styles.cardStatus}>{c.status}</Text>
                {c.position != null && (
                  <Text style={styles.cardPosition}>Your position: {c.position}{c.position === 1 ? 'st' : c.position === 2 ? 'nd' : c.position === 3 ? 'rd' : 'th'}</Text>
                )}
              </View>
              <Text style={styles.tapHint}>Tap to open competition</Text>
            </TouchableOpacity>
          ))
      )}
    </ScrollView>
  );
}

