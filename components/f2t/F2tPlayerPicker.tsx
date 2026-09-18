import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  Modal,
  FlatList,
  ActivityIndicator,
  Platform,
  Alert,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';
import { TeamColourChip } from '@/components/lms/TeamColourChip';
import type { F2tSelectablePlayer, F2tSelectionRow } from '@/lib/f2t/api';
import {
  formatFplAvailability,
  fplStatusAccentColor,
} from '@/lib/f2t/fplAvailability';

type PositionFilter = 'ALL' | 'GK' | 'DEF' | 'MID' | 'FWD';
type SortKey = 'name' | 'goals' | 'assists' | 'form' | 'xg';
type DropdownKey = 'position' | 'team' | 'sort' | null;

const POSITION_OPTIONS: { value: PositionFilter; label: string }[] = [
  { value: 'ALL', label: 'All positions' },
  { value: 'GK', label: 'GK' },
  { value: 'DEF', label: 'DEF' },
  { value: 'MID', label: 'MID' },
  { value: 'FWD', label: 'FWD' },
];

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'goals', label: 'Goals' },
  { value: 'assists', label: 'Assists' },
  { value: 'form', label: 'Form' },
  { value: 'xg', label: 'xG' },
  { value: 'name', label: 'Name' },
];

const SEARCH_DEBOUNCE_MS = 200;

function numStat(stats: Record<string, unknown> | undefined, ...keys: string[]): number | null {
  if (!stats) return null;
  for (const k of keys) {
    const v = stats[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '') {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function formatStat(value: number | null, decimals = 0): string {
  if (value == null) return '—';
  return decimals > 0 ? value.toFixed(decimals) : String(Math.round(value));
}

/** FPL form bands: low / mid / strong recent points. */
function formTone(form: number | null): { fg: string; bg: string } | null {
  if (form == null) return null;
  if (form < 3) return { fg: '#ef4444', bg: 'rgba(239, 68, 68, 0.18)' };
  if (form < 7) return { fg: '#f97316', bg: 'rgba(249, 115, 22, 0.18)' };
  return { fg: '#15803d', bg: 'rgba(21, 128, 61, 0.2)' };
}

type IndexedPlayer = {
  id: string;
  display_name: string;
  position: string | null;
  team_id: string;
  team_name: string;
  team_short_name: string;
  team_slug: string;
  searchText: string;
  positionUpper: string;
  goals: number | null;
  assists: number | null;
  form: number | null;
  xg: number | null;
  sortGoals: number;
  sortAssists: number;
  sortForm: number;
  sortXg: number;
  goalsLabel: string;
  assistsLabel: string;
  formLabel: string;
  xgLabel: string;
  metaLabel: string;
  availability: ReturnType<typeof formatFplAvailability>;
  showNewsIcon: boolean;
  newsColor: string;
  formColors: { fg: string; bg: string } | null;
};

function indexPlayers(players: F2tSelectablePlayer[]): IndexedPlayer[] {
  return players.map((p) => {
    const stats = p.picker_stats;
    const goals = numStat(stats, 'season_goals', 'goals_scored');
    const assists = numStat(stats, 'season_assists', 'assists');
    const form = numStat(stats, 'form');
    const xg = numStat(stats, 'expected_goals');
    const availability = formatFplAvailability(stats);
    const showNewsIcon =
      Boolean(availability.news) ||
      (availability.statusCode !== 'a' && availability.statusCode !== '');
    const positionUpper = (p.position ?? '').toUpperCase();
    const searchText = [
      p.display_name,
      p.full_name ?? '',
      p.team_name,
      p.team_short_name,
      p.position ?? '',
    ]
      .join(' ')
      .toLowerCase();

    return {
      id: p.id,
      display_name: p.display_name,
      position: p.position,
      team_id: p.team_id,
      team_name: p.team_name,
      team_short_name: p.team_short_name,
      team_slug: p.team_slug,
      searchText,
      positionUpper,
      goals,
      assists,
      form,
      xg,
      sortGoals: goals ?? -1,
      sortAssists: assists ?? -1,
      sortForm: form ?? -1,
      sortXg: xg ?? -1,
      goalsLabel: formatStat(goals),
      assistsLabel: formatStat(assists),
      formLabel: formatStat(form, 1),
      xgLabel: formatStat(xg, 1),
      metaLabel: [p.position, p.team_short_name].filter(Boolean).join(' · '),
      availability,
      showNewsIcon,
      newsColor: fplStatusAccentColor(availability.statusCode),
      formColors: formTone(form),
    };
  });
}

function sortValue(p: IndexedPlayer, key: SortKey): number {
  switch (key) {
    case 'goals':
      return p.sortGoals;
    case 'assists':
      return p.sortAssists;
    case 'form':
      return p.sortForm;
    case 'xg':
      return p.sortXg;
    default:
      return 0;
  }
}

type RowStyles = {
  card: StyleProp<ViewStyle>;
  cardSelected: StyleProp<ViewStyle>;
  cardInSquad: StyleProp<ViewStyle>;
  cardPress: StyleProp<ViewStyle>;
  cardMain: StyleProp<ViewStyle>;
  nameRow: StyleProp<ViewStyle>;
  name: StyleProp<TextStyle>;
  nameMuted: StyleProp<TextStyle>;
  meta: StyleProp<TextStyle>;
  inSquadBadge: StyleProp<ViewStyle>;
  inSquadBadgeText: StyleProp<TextStyle>;
  statsRow: StyleProp<ViewStyle>;
  statCell: StyleProp<ViewStyle>;
  statValue: StyleProp<TextStyle>;
  statValueMuted: StyleProp<TextStyle>;
  formBadge: StyleProp<ViewStyle>;
  formBadgeText: StyleProp<TextStyle>;
  statLabel: StyleProp<TextStyle>;
  checkSlot: StyleProp<ViewStyle>;
};

type PlayerRowProps = {
  player: IndexedPlayer;
  selected: boolean;
  inSquad: boolean;
  styles: RowStyles;
  accent: string;
  textColor: string;
  surfaceFallback: string;
  onToggle: (playerId: string) => void;
};

const PlayerRow = memo(function PlayerRow({
  player: p,
  selected,
  inSquad,
  styles,
  accent,
  textColor,
  surfaceFallback,
  onToggle,
}: PlayerRowProps) {
  const showNews = (e?: { stopPropagation?: () => void }) => {
    e?.stopPropagation?.();
    const body = [p.availability.chanceSummary, p.availability.news].filter(Boolean).join('\n\n');
    const title = p.availability.statusLabel || 'Player update';
    const message = body || p.availability.statusLabel || 'No further details.';
    if (Platform.OS === 'web') {
      window.alert(`${title}\n\n${message}`);
    } else {
      Alert.alert(title, message);
    }
  };

  const onPressRow = () => {
    if (inSquad) {
      const message = `${p.display_name} is already in your squad and cannot be selected again.`;
      if (Platform.OS === 'web') {
        window.alert(message);
      } else {
        Alert.alert('Already in your squad', message);
      }
      return;
    }
    onToggle(p.id);
  };

  return (
    <View
      style={[
        styles.card,
        selected && styles.cardSelected,
        inSquad && !selected && styles.cardInSquad,
      ]}
    >
      <Pressable
        style={styles.cardPress}
        onPress={onPressRow}
        accessibilityState={{ selected, disabled: inSquad }}
      >
        <TeamColourChip
          shortName={p.team_short_name}
          name={p.team_name}
          slug={p.team_slug}
          size={36}
        />
        <View style={styles.cardMain}>
          <View style={styles.nameRow}>
            <Text style={[styles.name, inSquad && styles.nameMuted]} numberOfLines={1}>
              {p.display_name}
            </Text>
            {inSquad ? (
              <View style={styles.inSquadBadge}>
                <Text style={styles.inSquadBadgeText}>In squad</Text>
              </View>
            ) : null}
            {p.showNewsIcon ? (
              <Pressable
                hitSlop={10}
                onPress={showNews}
                accessibilityRole="button"
                accessibilityLabel={
                  p.availability.news || p.availability.statusLabel || 'Player availability'
                }
              >
                <Ionicons name="information-circle" size={20} color={p.newsColor} />
              </Pressable>
            ) : null}
          </View>
          <Text style={styles.meta} numberOfLines={1}>
            {p.metaLabel}
          </Text>
        </View>
        <View style={styles.statsRow}>
          <View style={styles.statCell}>
            <Text style={[styles.statValue, inSquad && styles.statValueMuted]}>{p.goalsLabel}</Text>
            <Text style={styles.statLabel}>Goals</Text>
          </View>
          <View style={styles.statCell}>
            <Text style={[styles.statValue, inSquad && styles.statValueMuted]}>
              {p.assistsLabel}
            </Text>
            <Text style={styles.statLabel}>Assists</Text>
          </View>
          <View style={styles.statCell}>
            <View
              style={[
                styles.formBadge,
                { backgroundColor: p.formColors?.bg ?? surfaceFallback },
              ]}
            >
              <Text
                style={[styles.formBadgeText, { color: p.formColors?.fg ?? textColor }]}
              >
                {p.formLabel}
              </Text>
            </View>
            <Text style={styles.statLabel}>Form</Text>
          </View>
          <View style={styles.statCell}>
            <Text style={[styles.statValue, inSquad && styles.statValueMuted]}>{p.xgLabel}</Text>
            <Text style={styles.statLabel}>xG</Text>
          </View>
        </View>
        <View style={styles.checkSlot}>
          {selected ? <Ionicons name="checkmark-circle" size={22} color={accent} /> : null}
          {inSquad && !selected ? (
            <Ionicons name="lock-closed" size={16} color={accent} />
          ) : null}
        </View>
      </Pressable>
    </View>
  );
});

type Props = {
  visible: boolean;
  title: string;
  players: F2tSelectablePlayer[];
  loading?: boolean;
  /** Seed selection when the modal opens. Draft toggles stay inside the picker. */
  initialSelectedIds: string[];
  submitting?: boolean;
  subMode?: boolean;
  /** Player being substituted out — shown at top of the picker in sub mode. */
  outPlayer?: F2tSelectionRow | null;
  /** Current squad player ids — marked in sub mode so replacements aren’t confused with owned picks. */
  squadPlayerIds?: string[];
  onClose: () => void;
  onSubmit: (selectedIds: string[]) => void;
};

export function F2tPlayerPicker({
  visible,
  title,
  players,
  loading,
  initialSelectedIds,
  submitting,
  subMode,
  outPlayer,
  squadPlayerIds,
  onClose,
  onSubmit,
}: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [positionFilter, setPositionFilter] = useState<PositionFilter>('ALL');
  const [teamFilterId, setTeamFilterId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('goals');
  const [openDropdown, setOpenDropdown] = useState<DropdownKey>(null);
  const [draftIds, setDraftIds] = useState<string[]>([]);

  useEffect(() => {
    if (!visible) return;
    setSearchInput('');
    setSearch('');
    setPositionFilter('ALL');
    setTeamFilterId(null);
    setSortKey('goals');
    setOpenDropdown(null);
    setDraftIds(initialSelectedIds);
    // Seed only when the modal opens — draft toggles must not reset from parent re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: visible edge only
  }, [visible]);

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const indexedPlayers = useMemo(() => indexPlayers(players), [players]);

  const selectedSet = useMemo(() => new Set(draftIds), [draftIds]);
  const selectedSetRef = useRef(selectedSet);
  selectedSetRef.current = selectedSet;

  const squadSet = useMemo(() => {
    if (!subMode) return new Set<string>();
    return new Set(squadPlayerIds ?? []);
  }, [subMode, squadPlayerIds]);

  const teamOptions = useMemo(() => {
    const byId = new Map<
      string,
      { id: string; name: string; short_name: string; slug: string }
    >();
    for (const p of indexedPlayers) {
      if (!byId.has(p.team_id)) {
        byId.set(p.team_id, {
          id: p.team_id,
          name: p.team_name,
          short_name: p.team_short_name,
          slug: p.team_slug,
        });
      }
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [indexedPlayers]);

  const filteredPlayers = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = indexedPlayers.filter((p) => {
      if (positionFilter !== 'ALL' && p.positionUpper !== positionFilter) return false;
      if (teamFilterId && p.team_id !== teamFilterId) return false;
      if (!q) return true;
      return p.searchText.includes(q);
    });
    list = [...list].sort((a, b) => {
      // In sub mode, keep already-owned squad players below available ones.
      if (subMode && squadSet.size > 0) {
        const aOwned = squadSet.has(a.id) ? 1 : 0;
        const bOwned = squadSet.has(b.id) ? 1 : 0;
        if (aOwned !== bOwned) return aOwned - bOwned;
      }
      if (sortKey === 'name') {
        return a.display_name.localeCompare(b.display_name, undefined, { sensitivity: 'base' });
      }
      const diff = sortValue(b, sortKey) - sortValue(a, sortKey);
      if (diff !== 0) return diff;
      return a.display_name.localeCompare(b.display_name, undefined, { sensitivity: 'base' });
    });
    return list;
  }, [indexedPlayers, search, positionFilter, teamFilterId, sortKey, subMode, squadSet]);

  const positionLabel =
    POSITION_OPTIONS.find((o) => o.value === positionFilter)?.label ?? 'Position';
  const teamLabel = teamFilterId
    ? teamOptions.find((t) => t.id === teamFilterId)?.short_name ?? 'Team'
    : 'All teams';
  const sortLabel = SORT_OPTIONS.find((o) => o.value === sortKey)?.label ?? 'Sort';

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: {
          flex: 1,
          backgroundColor: theme.colors.background,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        },
        header: {
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing.sm,
          gap: theme.spacing.md,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.border,
        },
        title: {
          flex: 1,
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 18,
          color: theme.colors.text,
        },
        outWrap: {
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.md,
          paddingBottom: theme.spacing.sm,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.border,
          gap: theme.spacing.sm,
        },
        outLabel: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 11,
          letterSpacing: 0.3,
          textTransform: 'uppercase',
          color: theme.colors.textMuted,
        },
        outCard: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.md,
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          padding: theme.spacing.md,
        },
        outMain: {
          flex: 1,
          minWidth: 0,
          gap: 4,
        },
        outName: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 16,
          color: theme.colors.text,
        },
        outTeamRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
        },
        outTeam: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 12,
          color: theme.colors.textMuted,
        },
        outBadge: {
          flexShrink: 0,
          paddingVertical: 4,
          paddingHorizontal: 8,
          borderRadius: theme.radius.sm,
          backgroundColor: 'rgba(239, 68, 68, 0.15)',
        },
        outBadgeText: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 11,
          color: '#ef4444',
        },
        controls: {
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.md,
          paddingBottom: theme.spacing.sm,
          gap: theme.spacing.sm,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.border,
          zIndex: 20,
        },
        search: {
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.md,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: Platform.OS === 'web' ? 10 : 11,
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 14,
          color: theme.colors.text,
          backgroundColor: theme.colors.surface,
        },
        dropdownRow: {
          flexDirection: 'row',
          alignItems: 'stretch',
          gap: 8,
        },
        dropdownWrap: {
          flex: 1,
          minWidth: 0,
        },
        dropdownBtn: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 4,
          paddingVertical: 10,
          paddingHorizontal: 10,
          borderRadius: theme.radius.sm,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface,
          minHeight: 42,
        },
        dropdownBtnOpen: {
          borderColor: theme.colors.accent,
        },
        dropdownBtnText: {
          flex: 1,
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 12,
          color: theme.colors.text,
        },
        dropdownPanel: {
          maxHeight: 220,
          borderRadius: theme.radius.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface,
          overflow: 'hidden',
        },
        dropdownOption: {
          paddingVertical: 11,
          paddingHorizontal: 12,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.border,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        },
        dropdownOptionActive: {
          backgroundColor: theme.colors.accentMuted,
        },
        dropdownOptionText: {
          flex: 1,
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 13,
          color: theme.colors.text,
        },
        list: {
          flex: 1,
        },
        listContent: {
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.md,
          paddingBottom: theme.spacing.lg,
          gap: 10,
        },
        card: {
          borderRadius: theme.radius.md,
          borderWidth: 1.5,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface,
          overflow: 'hidden',
        },
        cardSelected: {
          borderColor: theme.colors.accent,
          backgroundColor: theme.colors.accentMuted,
        },
        cardInSquad: {
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.background,
          opacity: 0.72,
        },
        cardPress: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.sm,
          paddingVertical: 10,
          paddingHorizontal: theme.spacing.md,
        },
        cardMain: {
          flex: 1,
          minWidth: 0,
          gap: 2,
        },
        nameRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
        },
        name: {
          flexShrink: 1,
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 14,
          color: theme.colors.text,
        },
        nameMuted: {
          color: theme.colors.textMuted,
        },
        meta: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 11,
          color: theme.colors.textMuted,
        },
        inSquadBadge: {
          flexShrink: 0,
          paddingVertical: 2,
          paddingHorizontal: 6,
          borderRadius: 4,
          backgroundColor: theme.colors.accentMuted,
        },
        inSquadBadgeText: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 10,
          letterSpacing: 0.2,
          textTransform: 'uppercase',
          color: theme.colors.accent,
        },
        statsRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
        },
        statCell: {
          minWidth: 36,
          alignItems: 'center',
        },
        statValue: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 13,
          color: theme.colors.text,
          lineHeight: 16,
        },
        statValueMuted: {
          color: theme.colors.textMuted,
        },
        formBadge: {
          minWidth: 36,
          paddingHorizontal: 6,
          paddingVertical: 2,
          borderRadius: 6,
          alignItems: 'center',
          justifyContent: 'center',
        },
        formBadgeText: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 12,
          lineHeight: 15,
        },
        statLabel: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 9,
          letterSpacing: 0.2,
          textTransform: 'uppercase',
          color: theme.colors.accent,
          marginTop: 1,
        },
        checkSlot: {
          width: 22,
          alignItems: 'center',
        },
        empty: {
          paddingVertical: 40,
          alignItems: 'center',
        },
        emptyText: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 13,
          color: theme.colors.textMuted,
        },
        subHint: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 12,
          color: theme.colors.textMuted,
          textAlign: 'center',
          lineHeight: 16,
        },
        footer: {
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.sm,
          paddingBottom: theme.spacing.md,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: theme.colors.border,
          gap: 8,
        },
        pickCount: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 13,
          color: theme.colors.textSecondary,
          textAlign: 'center',
        },
        primaryBtn: {
          backgroundColor: theme.colors.accent,
          borderRadius: theme.radius.md,
          paddingVertical: 13,
          alignItems: 'center',
        },
        primaryBtnText: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 14,
          color: theme.colors.white,
        },
      }),
    [theme, insets]
  );

  const rowStyles = useMemo(
    () => ({
      card: styles.card,
      cardSelected: styles.cardSelected,
      cardInSquad: styles.cardInSquad,
      cardPress: styles.cardPress,
      cardMain: styles.cardMain,
      nameRow: styles.nameRow,
      name: styles.name,
      nameMuted: styles.nameMuted,
      meta: styles.meta,
      inSquadBadge: styles.inSquadBadge,
      inSquadBadgeText: styles.inSquadBadgeText,
      statsRow: styles.statsRow,
      statCell: styles.statCell,
      statValue: styles.statValue,
      statValueMuted: styles.statValueMuted,
      formBadge: styles.formBadge,
      formBadgeText: styles.formBadgeText,
      statLabel: styles.statLabel,
      checkSlot: styles.checkSlot,
    }),
    [styles]
  );

  const teamDropdownOptions = useMemo(() => {
    if (openDropdown !== 'team') return [] as { value: string; label: string; icon?: ReactNode }[];
    return [
      { value: '', label: 'All teams' },
      ...teamOptions.map((t) => ({
        value: t.id,
        label: t.short_name,
        icon: (
          <TeamColourChip shortName={t.short_name} name={t.name} slug={t.slug} size={18} />
        ) as ReactNode,
      })),
    ];
  }, [openDropdown, teamOptions]);

  const activeDropdownOptions =
    openDropdown === 'position'
      ? POSITION_OPTIONS.map((o) => ({ value: o.value, label: o.label }))
      : openDropdown === 'team'
        ? teamDropdownOptions
        : openDropdown === 'sort'
          ? SORT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))
          : [];
  const activeDropdownValue =
    openDropdown === 'position'
      ? positionFilter
      : openDropdown === 'team'
        ? teamFilterId ?? ''
        : openDropdown === 'sort'
          ? sortKey
          : '';

  const onSelectDropdownValue = useCallback(
    (value: string) => {
      if (openDropdown === 'position') setPositionFilter(value as PositionFilter);
      else if (openDropdown === 'team') setTeamFilterId(value || null);
      else if (openDropdown === 'sort') setSortKey(value as SortKey);
      setOpenDropdown(null);
    },
    [openDropdown]
  );

  const toggleDraft = useCallback(
    (playerId: string) => {
      setOpenDropdown(null);
      if (subMode) {
        if (squadSet.has(playerId)) {
          Alert.alert(
            'Already in your squad',
            'That player is already in your squad. Choose someone else as the replacement.'
          );
          return;
        }
        setDraftIds([playerId]);
        return;
      }
      const selected = selectedSetRef.current;
      if (selected.has(playerId)) {
        setDraftIds((prev) => prev.filter((id) => id !== playerId));
        return;
      }
      if (selected.size >= 20) {
        Alert.alert(
          'Selections',
          'You already have 20 players. Uncheck one before adding another.'
        );
        return;
      }
      setDraftIds((prev) => [...prev, playerId]);
    },
    [subMode, squadSet]
  );

  const handleSubmit = useCallback(() => {
    onSubmit(draftIds);
  }, [draftIds, onSubmit]);

  const renderPlayer = useCallback(
    ({ item }: { item: IndexedPlayer }) => {
      const inSquad = squadSet.has(item.id);
      return (
        <PlayerRow
          player={item}
          selected={selectedSet.has(item.id)}
          inSquad={inSquad}
          styles={rowStyles}
          accent={theme.colors.accent}
          textColor={theme.colors.text}
          surfaceFallback={theme.colors.background}
          onToggle={toggleDraft}
        />
      );
    },
    [
      selectedSet,
      squadSet,
      rowStyles,
      theme.colors.accent,
      theme.colors.text,
      theme.colors.background,
      toggleDraft,
    ]
  );

  const renderDropdownTrigger = (
    key: Exclude<DropdownKey, null>,
    label: string
  ) => {
    const open = openDropdown === key;
    return (
      <View style={styles.dropdownWrap}>
        <Pressable
          style={[styles.dropdownBtn, open && styles.dropdownBtnOpen]}
          onPress={() => setOpenDropdown(open ? null : key)}
        >
          <Text style={styles.dropdownBtnText} numberOfLines={1}>
            {label}
          </Text>
          <Ionicons
            name={open ? 'chevron-up' : 'chevron-down'}
            size={14}
            color={theme.colors.textMuted}
          />
        </Pressable>
      </View>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={26} color={theme.colors.text} />
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
        </View>

        {subMode && outPlayer ? (
          <View style={styles.outWrap}>
            <Text style={styles.outLabel}>Substituting out</Text>
            <View style={styles.outCard}>
              <View style={styles.outMain}>
                <Text style={styles.outName} numberOfLines={1}>
                  {outPlayer.display_name}
                </Text>
                <View style={styles.outTeamRow}>
                  <TeamColourChip
                    shortName={outPlayer.team_short_name}
                    name={outPlayer.team_name}
                    slug={outPlayer.team_slug}
                    size={22}
                  />
                  <Text style={styles.outTeam}>{outPlayer.team_short_name}</Text>
                </View>
              </View>
              <View style={styles.outBadge}>
                <Text style={styles.outBadgeText}>Out</Text>
              </View>
            </View>
          </View>
        ) : null}

        <View style={styles.controls}>
          <TextInput
            style={styles.search}
            value={searchInput}
            onChangeText={(text) => {
              setSearchInput(text);
              setOpenDropdown(null);
            }}
            placeholder="Search by player name"
            placeholderTextColor={theme.colors.textMuted}
            autoCorrect={false}
            autoCapitalize="none"
            clearButtonMode="while-editing"
          />
          <View style={styles.dropdownRow}>
            {renderDropdownTrigger('position', positionLabel)}
            {renderDropdownTrigger('team', teamLabel)}
            {renderDropdownTrigger('sort', `Sort: ${sortLabel}`)}
          </View>
          {openDropdown ? (
            <View style={styles.dropdownPanel}>
              <FlatList
                data={activeDropdownOptions}
                keyExtractor={(item) => item.value}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
                renderItem={({ item }) => {
                  const active = item.value === activeDropdownValue;
                  return (
                    <Pressable
                      style={[styles.dropdownOption, active && styles.dropdownOptionActive]}
                      onPress={() => onSelectDropdownValue(item.value)}
                    >
                      {'icon' in item ? item.icon : null}
                      <Text style={styles.dropdownOptionText} numberOfLines={1}>
                        {item.label}
                      </Text>
                      {active ? (
                        <Ionicons name="checkmark" size={16} color={theme.colors.accent} />
                      ) : null}
                    </Pressable>
                  );
                }}
              />
            </View>
          ) : null}
        </View>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={theme.colors.accent} />
        ) : (
          <FlatList
            style={styles.list}
            contentContainerStyle={styles.listContent}
            data={filteredPlayers}
            extraData={[draftIds, squadPlayerIds]}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            onScrollBeginDrag={() => setOpenDropdown(null)}
            initialNumToRender={14}
            maxToRenderPerBatch={10}
            windowSize={7}
            removeClippedSubviews={Platform.OS !== 'web'}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyText}>No players match these filters.</Text>
              </View>
            }
            renderItem={renderPlayer}
          />
        )}

        <View style={styles.footer}>
          {!subMode ? (
            <Text style={styles.pickCount}>{draftIds.length} / 20 selected</Text>
          ) : (
            <Text style={styles.subHint}>
              Players marked In squad are already yours — pick someone new as the replacement.
            </Text>
          )}
          <Pressable style={styles.primaryBtn} onPress={handleSubmit} disabled={submitting}>
            {submitting ? (
              <ActivityIndicator color={theme.colors.white} size="small" />
            ) : (
              <Text style={styles.primaryBtnText}>
                {subMode ? 'Confirm substitution' : 'Save selections'}
              </Text>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
