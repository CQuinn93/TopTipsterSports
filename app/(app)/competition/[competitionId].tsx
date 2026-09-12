import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/contexts/ThemeContext';
import { lightTheme } from '@/constants/theme';
import { RacingAdminPanel } from '@/components/racing/RacingAdminPanel';
import { racingGetAdminContext } from '@/lib/racingAdminApi';
import { FundraiserForClub } from '@/components/FundraiserForClub';
import {
  fetchCompetitionsFundraiserBranding,
  fundraiserKey,
  type FundraiserBranding,
} from '@/lib/fundraiserBranding';
import { useNarrowWebCompact, cfs } from '@/lib/narrowWebTypography';

type HubTab = 'overview' | 'admin';

export default function RacingCompetitionHubScreen() {
  const theme = useTheme();
  const compact = useNarrowWebCompact();
  const params = useLocalSearchParams<{ competitionId: string }>();
  const competitionId = String(params.competitionId ?? '');

  const [name, setName] = useState('');
  const [fundraiser, setFundraiser] = useState<FundraiserBranding | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [canHandleJoins, setCanHandleJoins] = useState(false);
  const [isCompManager, setIsCompManager] = useState(false);
  const [entry, setEntry] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState<string | null>(null);
  const [tab, setTab] = useState<HubTab>('overview');

  const load = useCallback(async () => {
    if (!competitionId) {
      setLoading(false);
      return;
    }
    try {
      const ctx = await racingGetAdminContext(competitionId);
      setName(ctx.name ?? 'Competition');
      setCanManage(!!ctx.can_manage);
      setCanHandleJoins(!!ctx.can_handle_joins);
      setIsCompManager(!!ctx.is_manager);
      setEntry(ctx.entry ?? null);
      setJoinCode(ctx.join_code ?? ctx.access_code ?? null);
      try {
        const branding = await fetchCompetitionsFundraiserBranding([
          { sport: 'racing', competition_id: competitionId },
        ]);
        setFundraiser(branding[fundraiserKey('racing', competitionId)] ?? null);
      } catch {
        setFundraiser(null);
      }
      if (!ctx.can_handle_joins) {
        setTab((prev) => (prev === 'admin' ? 'overview' : prev));
      }
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to load competition');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [competitionId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    void load();
  };

  const styles = useMemo(() => {
    const isLight = theme.colors.background === lightTheme.colors.background;
    const cardBorder = isLight ? theme.colors.white : theme.colors.border;
    const cardBorderWidth = isLight ? 2 : 1;
    return StyleSheet.create({
      container: { flex: 1, backgroundColor: theme.colors.background },
      header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
        gap: theme.spacing.sm,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.border,
      },
      headerBtn: { padding: 6 },
      headerTitle: {
        flex: 1,
        fontFamily: theme.fontFamily.regular,
        fontSize: cfs(17, compact),
        fontWeight: '600',
        color: theme.colors.text,
      },
      content: {
        padding: compact ? theme.spacing.sm : theme.spacing.md,
        paddingBottom: theme.spacing.xxl,
      },
      tabsRow: {
        flexDirection: 'row',
        marginBottom: theme.spacing.md,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.border,
      },
      tab: {
        flex: 1,
        paddingVertical: 11,
        alignItems: 'center',
        borderBottomWidth: 2,
        borderBottomColor: 'transparent',
      },
      tabActive: { borderBottomColor: theme.colors.accent },
      tabText: {
        fontFamily: theme.fontFamily.baiMedium,
        fontSize: cfs(13, compact),
        color: theme.colors.textMuted,
      },
      tabTextActive: { color: theme.colors.accent },
      linkCard: {
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.md,
        borderWidth: cardBorderWidth,
        borderColor: cardBorder,
        padding: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
        marginBottom: theme.spacing.md,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
      },
      linkTitle: {
        flex: 1,
        fontFamily: theme.fontFamily.regular,
        fontSize: cfs(16, compact),
        color: theme.colors.text,
        fontWeight: '600',
      },
      linkHint: {
        fontFamily: theme.fontFamily.regular,
        fontSize: cfs(12, compact),
        color: theme.colors.textMuted,
        marginBottom: theme.spacing.md,
      },
      centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.lg },
    });
  }, [theme, compact]);

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerBtn}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={24} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {name || 'Competition'}
        </Text>
        <TouchableOpacity
          style={styles.headerBtn}
          onPress={onRefresh}
          accessibilityRole="button"
          accessibilityLabel="Refresh"
        >
          {refreshing ? (
            <ActivityIndicator size="small" color={theme.colors.accent} />
          ) : (
            <Ionicons name="refresh" size={20} color={theme.colors.textSecondary} />
          )}
        </TouchableOpacity>
      </View>

      {fundraiser ? (
        <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
          <FundraiserForClub
            clubName={fundraiser.club_name}
            clubLogoUrl={fundraiser.club_logo_url}
            size="header"
          />
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.accent} />
        }
      >
        <View style={styles.tabsRow}>
          {(
            [
              { key: 'overview' as const, label: 'Overview' },
              ...(canHandleJoins ? [{ key: 'admin' as const, label: 'Admin' }] : []),
            ] as const
          ).map((t) => {
            const active = tab === t.key;
            return (
              <TouchableOpacity
                key={t.key}
                style={[styles.tab, active && styles.tabActive]}
                onPress={() => setTab(t.key)}
                activeOpacity={0.8}
              >
                <Text style={[styles.tabText, active && styles.tabTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {tab === 'overview' ? (
          <>
            <Text style={styles.linkHint}>Open selections, the leaderboard, or results for this competition.</Text>
            <TouchableOpacity
              style={styles.linkCard}
              onPress={() =>
                router.push({ pathname: '/(app)/selections', params: { competitionId } })
              }
              activeOpacity={0.8}
            >
              <Ionicons name="checkbox-outline" size={22} color={theme.colors.accent} />
              <Text style={styles.linkTitle}>Selections</Text>
              <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.linkCard}
              onPress={() =>
                router.push({ pathname: '/(app)/leaderboard', params: { competitionId } })
              }
              activeOpacity={0.8}
            >
              <Ionicons name="trophy-outline" size={22} color={theme.colors.accent} />
              <Text style={styles.linkTitle}>Leaderboard</Text>
              <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.linkCard}
              onPress={() => router.push('/(app)/results')}
              activeOpacity={0.8}
            >
              <Ionicons name="list-outline" size={22} color={theme.colors.accent} />
              <Text style={styles.linkTitle}>Results</Text>
              <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
            </TouchableOpacity>
          </>
        ) : null}

        {tab === 'admin' && canHandleJoins ? (
          <RacingAdminPanel
            competitionId={competitionId}
            canManage={canManage}
            isCompManager={isCompManager}
            entry={entry}
            competitionName={name}
            initialJoinCode={joinCode}
            onEntrySaved={(next) => setEntry(next)}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}
