import { useCallback, useMemo, useState, type ReactNode } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '@/contexts/ThemeContext';
import { formatSportCompetitionStatusLabel } from '@/lib/appUtils';
import {
  ACCOUNT_MANAGE_HOST_LABEL,
  GAMEMASTER_WEB_ENQUIRY_MESSAGE,
  isNativeStoreClient,
  NATIVE_UPGRADES_COMING_SOON_MESSAGE,
  NATIVE_UPGRADES_COMING_SOON_TITLE,
  openAccountManageOnWeb,
} from '@/lib/accountWebGate';
import {
  fetchMySubscriptionCreatedCompetitions,
  fetchMySubscriptionJoins,
  formatCreatorTier,
  formatSubscriptionSportLabel,
  type CreatorTier,
  type ParticipantTier,
  type SubscriptionEntitlements,
  type SubscriptionUsageCompetition,
} from '@/lib/subscriptionEntitlements';
import {
  CREATOR_PLAN_PRICES,
  PARTICIPANT_PLAN_PRICES,
} from '@/lib/subscriptionPlans';

type DetailKey = 'joins' | 'creates' | null;

const COMPETITION_HUB_INFO = {
  title: 'Competition hubs',
  message:
    '€50 deposit, €10 per month per hub.\n\nWe supply a tablet in a secure box, set up and locked to your club account. Players use it in the venue to make selections and join competitions.\n\nThe deposit is refundable when the hub is returned in good condition.',
};

function creatorPlanSubtitle(ent: SubscriptionEntitlements, tier: CreatorTier): string {
  if (ent.is_owner) return 'Full platform access';
  if (ent.lifetime_creator_tier && !ent.creator_tier) return 'Lifetime · no payment';
  if (tier === 'gamemaster') return 'Club plan · custom agreement';
  return CREATOR_PLAN_PRICES[tier as Exclude<CreatorTier, 'gamemaster'>];
}

function formatLimit(value: number | null | undefined): string {
  if (value == null) return 'Unlimited';
  return String(value);
}

function formatParticipantTierLabel(tier: ParticipantTier): string {
  if (tier === 'user_premium') return 'User Premium';
  if (tier === 'user_plus') return 'User Plus';
  return 'User';
}

/** Bundled player tier included with a creator subscription (matches DB). */
function bundledParticipantTier(creator: CreatorTier): ParticipantTier {
  if (creator === 'creator_pro' || creator === 'gamemaster') return 'user_premium';
  return 'user_plus';
}

function effectiveParticipantTier(ent: SubscriptionEntitlements): ParticipantTier {
  if (ent.is_owner) return 'user_premium';
  if (ent.lifetime_participant_tier) return ent.lifetime_participant_tier;
  return ent.participant_tier ?? 'user';
}

function effectiveCreatorTier(ent: SubscriptionEntitlements): CreatorTier | null {
  if (ent.is_owner) return null;
  return ent.creator_tier ?? ent.lifetime_creator_tier ?? null;
}

type PlanSummary = {
  title: string;
  subtitle: string;
  badge?: string;
  isCreatorPlan: boolean;
  bundledPlayerLabel?: string;
};

function planSummary(ent: SubscriptionEntitlements): PlanSummary {
  if (ent.is_owner) {
    return {
      title: 'Owner',
      subtitle: 'Full platform access',
      isCreatorPlan: true,
      bundledPlayerLabel: 'User Premium included',
    };
  }

  const creator = effectiveCreatorTier(ent);
  if (creator) {
    const bundled = formatParticipantTierLabel(bundledParticipantTier(creator));
    const lifetimeCreatorOnly = !!ent.lifetime_creator_tier && !ent.creator_tier;
    return {
      title: creator === 'gamemaster' ? 'Club plan' : formatCreatorTier(creator),
      subtitle: creatorPlanSubtitle(ent, creator),
      badge: lifetimeCreatorOnly ? 'Lifetime' : creator === 'gamemaster' ? 'Gamemaster' : undefined,
      isCreatorPlan: true,
      bundledPlayerLabel: `${bundled} included with subscription`,
    };
  }

  const player = effectiveParticipantTier(ent);
  const lifetimePlayer = ent.lifetime_participant_tier === 'user_premium';
  return {
    title: formatParticipantTierLabel(player),
    subtitle: lifetimePlayer ? 'Lifetime · no payment' : PARTICIPANT_PLAN_PRICES[player],
    badge: lifetimePlayer ? 'Lifetime' : undefined,
    isCreatorPlan: false,
  };
}

type LimitRowProps = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  hint?: string;
  expandable?: boolean;
  detailExpanded?: boolean;
  onToggleDetail?: () => void;
  detailLoading?: boolean;
  detail?: ReactNode;
  infoTitle?: string;
  infoMessage?: string;
};

function LimitRow({
  icon,
  label,
  value,
  hint,
  expandable,
  detailExpanded,
  onToggleDetail,
  detailLoading,
  detail,
  infoTitle,
  infoMessage,
}: LimitRowProps) {
  const theme = useTheme();
  const [infoOpen, setInfoOpen] = useState(false);

  const toggleInfo = () => {
    setInfoOpen((open) => !open);
  };

  const rowBody = (
    <View style={limitRowStyles.row}>
      <Ionicons name={icon} size={18} color={theme.colors.textMuted} style={limitRowStyles.icon} />
      <View style={limitRowStyles.body}>
        <Text style={[limitRowStyles.label, { color: theme.colors.textSecondary }]}>{label}</Text>
        {hint ? (
          <Text style={[limitRowStyles.hint, { color: theme.colors.textMuted }]}>{hint}</Text>
        ) : null}
      </View>
      <View style={limitRowStyles.valueWrap}>
        {infoMessage ? (
          <TouchableOpacity
            onPress={(e) => {
              e.stopPropagation?.();
              toggleInfo();
            }}
            activeOpacity={0.6}
            accessibilityRole="button"
            accessibilityState={{ expanded: infoOpen }}
            accessibilityLabel={`More about ${infoTitle ?? label}`}
            style={limitRowStyles.infoBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons
              name="information-circle-outline"
              size={20}
              color={infoOpen ? theme.colors.accent : theme.colors.textMuted}
            />
          </TouchableOpacity>
        ) : null}
        <Text style={[limitRowStyles.value, { color: theme.colors.text }]}>{value}</Text>
        {expandable ? (
          <Ionicons
            name={detailExpanded ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={theme.colors.textMuted}
          />
        ) : null}
      </View>
    </View>
  );

  return (
    <View>
      {expandable ? (
        <Pressable
          onPress={onToggleDetail}
          accessibilityRole="button"
          accessibilityState={{ expanded: detailExpanded ?? false }}
          accessibilityLabel={`${label}, ${value}`}
        >
          {rowBody}
        </Pressable>
      ) : (
        rowBody
      )}
      {infoOpen && infoMessage ? (
        <View
          style={[
            limitRowStyles.infoPanel,
            { backgroundColor: theme.colors.background, borderColor: theme.colors.border },
          ]}
        >
          <Text style={[limitRowStyles.infoPanelText, { color: theme.colors.textSecondary }]}>
            {infoMessage}
          </Text>
        </View>
      ) : null}
      {detailExpanded ? (
        <View style={[limitRowStyles.detail, { borderTopColor: theme.colors.border }]}>
          {detailLoading ? (
            <ActivityIndicator size="small" color={theme.colors.textMuted} style={limitRowStyles.detailLoader} />
          ) : (
            detail
          )}
        </View>
      ) : null}
    </View>
  );
}

function formatParticipantStatus(status?: string): string | null {
  if (!status) return null;
  const s = status.toLowerCase();
  if (s === 'eliminated') return 'Eliminated';
  if (s === 'winner') return 'Winner';
  if (s === 'active') return 'Active';
  return status;
}

function CompetitionUsageList({ items }: { items: SubscriptionUsageCompetition[] }) {
  const theme = useTheme();
  const counting = items.filter((c) => c.countsTowardLimit);
  const other = items.filter((c) => !c.countsTowardLimit);

  if (items.length === 0) {
    return (
      <Text style={[limitRowStyles.emptyDetail, { color: theme.colors.textMuted }]}>
        No competitions in this list.
      </Text>
    );
  }

  const renderRow = (c: SubscriptionUsageCompetition) => {
    const participantLabel = formatParticipantStatus(c.participantStatus);
    const metaParts = [
      formatSubscriptionSportLabel(c.sport),
      formatSportCompetitionStatusLabel(c.status),
    ];
    if (participantLabel) metaParts.push(participantLabel);
    if (!c.countsTowardLimit) metaParts.push('Does not count toward limit');

    return (
      <View
        key={`${c.sport}-${c.id}`}
        style={[limitRowStyles.compRow, { borderBottomColor: theme.colors.border }]}
      >
        <Text style={[limitRowStyles.compName, { color: theme.colors.text }]} numberOfLines={2}>
          {c.name}
        </Text>
        <Text style={[limitRowStyles.compMeta, { color: theme.colors.textMuted }]}>
          {metaParts.join(' · ')}
        </Text>
      </View>
    );
  };

  return (
    <View style={limitRowStyles.compList}>
      {counting.length > 0 ? (
        <>
          <Text style={[limitRowStyles.compSectionLabel, { color: theme.colors.textMuted }]}>
            Counts toward your limit
          </Text>
          {counting.map(renderRow)}
        </>
      ) : null}
      {other.length > 0 ? (
        <>
          <Text
            style={[
              limitRowStyles.compSectionLabel,
              { color: theme.colors.textMuted },
              counting.length > 0 ? limitRowStyles.compSectionLabelSpaced : null,
            ]}
          >
            Does not count
          </Text>
          {other.map(renderRow)}
        </>
      ) : null}
    </View>
  );
}

const limitRowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 10,
  },
  icon: { marginTop: 2 },
  body: { flex: 1, minWidth: 0 },
  label: { fontSize: 14, lineHeight: 20 },
  infoBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 2,
  },
  infoPanel: {
    marginLeft: 28,
    marginRight: 4,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  infoPanelText: {
    fontSize: 13,
    lineHeight: 19,
  },
  hint: { fontSize: 12, lineHeight: 16, marginTop: 2 },
  valueWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  value: { fontSize: 14, fontWeight: '600', textAlign: 'right' },
  detail: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginBottom: 4,
  },
  detailLoader: { paddingVertical: 12 },
  emptyDetail: { fontSize: 13, paddingVertical: 10, lineHeight: 18 },
  compList: { paddingBottom: 4 },
  compSectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    paddingTop: 8,
    paddingBottom: 4,
  },
  compSectionLabelSpaced: { marginTop: 8 },
  compRow: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  compName: { fontSize: 14, fontWeight: '600', lineHeight: 20 },
  compMeta: { fontSize: 12, marginTop: 2, lineHeight: 16 },
});

type PlanCardProps = {
  title: string;
  subtitle: string;
  accent: string;
  expanded: boolean;
  onPress: () => void;
  children: ReactNode;
  badge?: string;
};

function PlanCard({ title, subtitle, accent, expanded, onPress, children, badge }: PlanCardProps) {
  const theme = useTheme();
  return (
    <View
      style={[
        cardStyles.wrap,
        {
          borderColor: expanded ? accent : theme.colors.border,
          backgroundColor: theme.colors.surface,
        },
      ]}
    >
      <Pressable
        onPress={onPress}
        style={cardStyles.header}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${title}, ${subtitle}`}
      >
        <View style={[cardStyles.accentDot, { backgroundColor: accent }]} />
        <View style={cardStyles.headerText}>
          <View style={cardStyles.titleRow}>
            <Text style={[cardStyles.title, { color: theme.colors.text }]}>{title}</Text>
            {badge ? (
              <View style={[cardStyles.badge, { backgroundColor: accent + '22' }]}>
                <Text style={[cardStyles.badgeText, { color: accent }]}>{badge}</Text>
              </View>
            ) : null}
          </View>
          <Text style={[cardStyles.subtitle, { color: theme.colors.textMuted }]}>{subtitle}</Text>
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={theme.colors.textMuted}
        />
      </Pressable>
      {expanded ? (
        <View style={[cardStyles.body, { borderTopColor: theme.colors.border }]}>{children}</View>
      ) : null}
    </View>
  );
}

const cardStyles = StyleSheet.create({
  wrap: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    gap: 12,
  },
  accentDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  headerText: { flex: 1, minWidth: 0 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  subtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  body: {
    paddingHorizontal: 14,
    paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});

type Props = {
  displayName: string;
  userId: string | null;
  entitlements: SubscriptionEntitlements | null;
  loading: boolean;
  accent: string;
  children?: ReactNode;
};

export function AccountSubscriptionPanel({
  displayName,
  userId,
  entitlements,
  loading,
  accent,
  children,
}: Props) {
  const theme = useTheme();
  const nativeStore = isNativeStoreClient();
  const [expanded, setExpanded] = useState(false);
  const [detailExpanded, setDetailExpanded] = useState<DetailKey>(null);
  const [joinsList, setJoinsList] = useState<SubscriptionUsageCompetition[] | null>(null);
  const [createsList, setCreatesList] = useState<SubscriptionUsageCompetition[] | null>(null);
  const [joinsLoading, setJoinsLoading] = useState(false);
  const [createsLoading, setCreatesLoading] = useState(false);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: { gap: 16, width: '100%' },
        profile: {
          paddingVertical: 4,
          gap: 4,
        },
        profileName: {
          fontSize: 22,
          fontWeight: '700',
          color: theme.colors.text,
        },
        profileMeta: {
          fontSize: 14,
          color: theme.colors.textMuted,
        },
        sectionLabel: {
          fontSize: 12,
          fontWeight: '700',
          letterSpacing: 0.6,
          color: theme.colors.textMuted,
          marginBottom: 8,
          marginTop: 4,
        },
        includedNote: {
          fontSize: 13,
          fontWeight: '600',
          color: theme.colors.text,
          lineHeight: 18,
          marginTop: 4,
          marginBottom: 4,
        },
        upgradeNote: {
          fontSize: 13,
          color: theme.colors.textMuted,
          lineHeight: 18,
          marginTop: 4,
        },
        upgradeBox: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingVertical: 14,
          paddingHorizontal: 14,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: accent,
          backgroundColor: theme.colors.surface,
        },
        upgradeBoxCopy: { flex: 1, minWidth: 0, gap: 4 },
        upgradeBoxTitle: {
          fontSize: 16,
          fontWeight: '700',
          color: theme.colors.text,
        },
        upgradeBoxHint: {
          fontSize: 13,
          lineHeight: 18,
          color: theme.colors.textMuted,
        },
        securitySection: {
          gap: 12,
          marginTop: 8,
        },
      }),
    [theme, accent]
  );

  const loadJoins = useCallback(async () => {
    if (!userId) return;
    setJoinsLoading(true);
    try {
      const list = await fetchMySubscriptionJoins(userId);
      setJoinsList(list);
    } catch {
      setJoinsList([]);
    } finally {
      setJoinsLoading(false);
    }
  }, [userId]);

  const loadCreates = useCallback(async () => {
    if (!userId) return;
    setCreatesLoading(true);
    try {
      const list = await fetchMySubscriptionCreatedCompetitions(userId);
      setCreatesList(list);
    } catch {
      setCreatesList([]);
    } finally {
      setCreatesLoading(false);
    }
  }, [userId]);

  const toggleDetail = (key: DetailKey) => {
    setDetailExpanded((prev) => {
      const next = prev === key ? null : key;
      if (next === 'joins' && joinsList === null && userId) {
        void loadJoins();
      }
      if (next === 'creates' && createsList === null && userId) {
        void loadCreates();
      }
      return next;
    });
  };

  const ent = entitlements;
  const plan = ent ? planSummary(ent) : null;

  const showComingSoon = () => {
    Alert.alert(NATIVE_UPGRADES_COMING_SOON_TITLE, NATIVE_UPGRADES_COMING_SOON_MESSAGE);
  };

  const openGamemasterEnquiry = () => {
    void openAccountManageOnWeb().catch(() => {
      Alert.alert('Could not open browser', GAMEMASTER_WEB_ENQUIRY_MESSAGE);
    });
  };

  return (
    <View style={styles.root}>
      <View style={styles.profile}>
        <Text style={styles.profileName}>{displayName || 'Your account'}</Text>
        <Text style={styles.profileMeta}>
          {nativeStore
            ? 'View your plan here. Player and Creator upgrades are coming soon in the app.'
            : 'Manage your plan and account security'}
        </Text>
      </View>

      <Text style={styles.sectionLabel}>SUBSCRIPTION</Text>

      {loading ? (
        <ActivityIndicator size="small" color={theme.colors.textMuted} />
      ) : ent && plan ? (
        <PlanCard
          title={plan.title}
          subtitle={plan.subtitle}
          accent={accent}
          expanded={expanded}
          onPress={() => setExpanded((v) => !v)}
          badge={plan.badge}
        >
          {plan.bundledPlayerLabel ? (
            <Text style={styles.includedNote}>{plan.bundledPlayerLabel}</Text>
          ) : null}

          <LimitRow
            icon="enter-outline"
            label="Competition joins"
            value={`${ent.current_join_count ?? 0} / ${formatLimit(ent.max_concurrent_joins)}`}
            hint="Only alive in live competitions counts. Eliminated or completed leagues do not."
            expandable={
              (ent.current_join_count ?? 0) > 0 || (ent.current_eliminated_in_live_count ?? 0) > 0
            }
            detailExpanded={detailExpanded === 'joins'}
            onToggleDetail={() => toggleDetail('joins')}
            detailLoading={joinsLoading}
            detail={<CompetitionUsageList items={joinsList ?? []} />}
          />
          <LimitRow
            icon="megaphone-outline"
            label="In-app advertising"
            value={ent.show_ads ? 'Shown' : 'None'}
            hint={
              ent.show_ads
                ? 'Free User plan may show occasional banners in the app. Paid plans remove ads.'
                : 'Your plan does not show advertising.'
            }
          />

          {plan.isCreatorPlan ? (
            <>
              <LimitRow
                icon="trophy-outline"
                label="Active competitions"
                value={`${ent.current_create_count ?? 0} / ${formatLimit(ent.max_concurrent_creates)}`}
                hint="Open or running competitions you created"
                expandable={(ent.current_create_count ?? 0) > 0}
                detailExpanded={detailExpanded === 'creates'}
                onToggleDetail={() => toggleDetail('creates')}
                detailLoading={createsLoading}
                detail={<CompetitionUsageList items={createsList ?? []} />}
              />
              <LimitRow
                icon="people-outline"
                label="Players per competition"
                value={formatLimit(ent.max_participants_per_competition)}
              />
              <LimitRow
                icon="analytics-outline"
                label="Total players (all comps)"
                value={`${ent.current_aggregate_participants ?? 0} / ${formatLimit(
                  ent.max_aggregate_active_participants
                )}`}
                hint="Across your live competitions"
              />
              <LimitRow
                icon="football-outline"
                label="Sports"
                value={
                  ent.create_sport_scope === 'all'
                    ? 'Football, racing & more'
                    : 'One sport at a time'
                }
              />
              {ent.kiosk_purchase_allowed ? (
                <LimitRow
                  icon="storefront-outline"
                  label="Competition hubs"
                  value={String(ent.kiosk_licenses_count ?? 0)}
                  infoTitle={COMPETITION_HUB_INFO.title}
                  infoMessage={COMPETITION_HUB_INFO.message}
                />
              ) : null}
            </>
          ) : (
            <Text style={styles.upgradeNote}>
              {nativeStore
                ? NATIVE_UPGRADES_COMING_SOON_MESSAGE
                : effectiveParticipantTier(ent) === 'user'
                  ? 'Upgrade for more joins and no ads — or pick a Creator plan to run competitions.'
                  : 'Need a larger club setup? Ask about a Gamemaster package for clubs and syndicates.'}
            </Text>
          )}
        </PlanCard>
      ) : (
        <Text style={styles.upgradeNote}>Could not load subscription details. Pull to refresh.</Text>
      )}

      {!loading && ent && !ent.is_owner ? (
        nativeStore ? (
          <>
            <Pressable
              style={styles.upgradeBox}
              onPress={showComingSoon}
              accessibilityRole="button"
              accessibilityLabel="Upgrades coming soon"
            >
              <View style={styles.upgradeBoxCopy}>
                <Text style={styles.upgradeBoxTitle}>{NATIVE_UPGRADES_COMING_SOON_TITLE}</Text>
                <Text style={styles.upgradeBoxHint}>
                  Player and Creator plans will be available as in-app purchases soon.
                </Text>
              </View>
              <Ionicons name="time-outline" size={18} color={accent} />
            </Pressable>
            <Pressable
              style={[styles.upgradeBox, { borderColor: theme.colors.border }]}
              onPress={openGamemasterEnquiry}
              accessibilityRole="button"
              accessibilityLabel={`Enquire about Gamemaster on ${ACCOUNT_MANAGE_HOST_LABEL}`}
            >
              <View style={styles.upgradeBoxCopy}>
                <Text style={styles.upgradeBoxTitle}>Club or syndicate?</Text>
                <Text style={styles.upgradeBoxHint}>{GAMEMASTER_WEB_ENQUIRY_MESSAGE}</Text>
              </View>
              <Ionicons name="open-outline" size={18} color={accent} />
            </Pressable>
          </>
        ) : (
          <Pressable
            style={styles.upgradeBox}
            onPress={() => router.push('/subscriptions' as any)}
            accessibilityRole="button"
            accessibilityLabel="Upgrade subscription"
          >
            <View style={styles.upgradeBoxCopy}>
              <Text style={styles.upgradeBoxTitle}>Upgrade subscription</Text>
              <Text style={styles.upgradeBoxHint}>
                Compare Player and Creator plans. Checkout coming soon on the web.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={accent} />
          </Pressable>
        )
      ) : null}

      {children ? (
        <View style={styles.securitySection}>
          <Text style={styles.sectionLabel}>SECURITY</Text>
          {children}
        </View>
      ) : null}
    </View>
  );
}
