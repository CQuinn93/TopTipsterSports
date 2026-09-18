import { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Alert,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/contexts/ThemeContext';
import {
  SUBSCRIPTION_PLAN_CATALOG,
  type SubscriptionPlanItem,
  type SubscriptionPlanKind,
} from '@/lib/subscriptionPlans';
import type { CreatorTier, ParticipantTier, SubscriptionEntitlements } from '@/lib/subscriptionEntitlements';
import { canPurchaseInApp } from '@/lib/accountWebGate';
import { iapProductByPlanCatalogId } from '@/lib/iap/products';
import { purchasePlan, restorePurchases } from '@/lib/iap';

function effectiveParticipantTier(ent: SubscriptionEntitlements): ParticipantTier {
  if (ent.is_owner) return 'user_premium';
  if (ent.lifetime_participant_tier) return ent.lifetime_participant_tier;
  return ent.participant_tier ?? 'user';
}

function effectiveCreatorTier(ent: SubscriptionEntitlements): CreatorTier | null {
  if (ent.is_owner) return null;
  return ent.creator_tier ?? ent.lifetime_creator_tier ?? null;
}

export function isCurrentSubscriptionPlan(
  ent: SubscriptionEntitlements,
  item: SubscriptionPlanItem
): boolean {
  if (ent.is_owner) return false;
  const creator = effectiveCreatorTier(ent);
  if (item.kind === 'creator') {
    return creator === item.creatorTier;
  }
  if (creator) return false;
  return effectiveParticipantTier(ent) === item.participantTier;
}

type CatalogPlanCardProps = {
  item: SubscriptionPlanItem;
  accent: string;
  current: boolean;
  expanded: boolean;
  busy: boolean;
  ctaLabel: string;
  hint: string | null;
  onToggle: () => void;
  onSelect: () => void;
};

function CatalogPlanCard({
  item,
  accent,
  current,
  expanded,
  busy,
  ctaLabel,
  hint,
  onToggle,
  onSelect,
}: CatalogPlanCardProps) {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.wrap,
        {
          borderColor: current || expanded ? accent : theme.colors.border,
          backgroundColor: theme.colors.surface,
        },
      ]}
    >
      <Pressable
        onPress={onToggle}
        style={styles.header}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${item.title}, ${item.price}`}
      >
        <View style={styles.headerText}>
          <View style={styles.titleRow}>
            <Text style={[styles.title, { color: theme.colors.text }]}>{item.title}</Text>
            {current ? (
              <View style={[styles.badge, { backgroundColor: accent + '22' }]}>
                <Text style={[styles.badgeText, { color: accent }]}>Current</Text>
              </View>
            ) : null}
          </View>
          <Text style={[styles.price, { color: theme.colors.text }]}>{item.price}</Text>
          <Text style={[styles.summary, { color: theme.colors.textMuted }]}>{item.summary}</Text>
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={theme.colors.textMuted}
        />
      </Pressable>
      {expanded ? (
        <View style={[styles.body, { borderTopColor: theme.colors.border }]}>
          {item.features.map((f) => (
            <View key={f} style={styles.featureRow}>
              <Ionicons name="checkmark-circle" size={16} color={accent} />
              <Text style={[styles.featureText, { color: theme.colors.textSecondary }]}>{f}</Text>
            </View>
          ))}
          <Pressable
            style={[
              styles.cta,
              {
                backgroundColor: current ? theme.colors.border : accent,
                opacity: current || busy ? 0.7 : 1,
              },
            ]}
            onPress={onSelect}
            disabled={current || busy}
            accessibilityRole="button"
            accessibilityState={{ disabled: current || busy }}
          >
            {busy ? (
              <ActivityIndicator color={theme.colors.white} />
            ) : (
              <Text
                style={[
                  styles.ctaText,
                  { color: current ? theme.colors.textMuted : theme.colors.white },
                ]}
              >
                {ctaLabel}
              </Text>
            )}
          </Pressable>
          {hint && !current ? (
            <Text style={[styles.comingSoon, { color: theme.colors.textMuted }]}>{hint}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

type Props = {
  kind: SubscriptionPlanKind;
  entitlements: SubscriptionEntitlements | null;
  accent: string;
  onPurchased?: () => void;
};

export function SubscriptionPlanList({ kind, entitlements, accent, onPurchased }: Props) {
  const theme = useTheme();
  const iapReady = canPurchaseInApp();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  const items = useMemo(
    () => SUBSCRIPTION_PLAN_CATALOG.filter((p) => p.kind === kind),
    [kind]
  );

  const onSelect = async (item: SubscriptionPlanItem) => {
    // Free User — nothing to buy
    if (item.id === 'user') {
      const msg = 'User is the free plan — no purchase needed.';
      if (Platform.OS === 'web' && typeof window !== 'undefined') window.alert(msg);
      else Alert.alert(item.title, msg);
      return;
    }

    if (Platform.OS === 'web' || !iapReady) {
      const message =
        Platform.OS === 'web'
          ? `${item.title} checkout is not live on the web yet. Native apps will use in-app purchase.`
          : `${item.title} will be available as an in-app purchase once store products are connected.`;
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.alert(`${item.title}\n\n${message}`);
      } else {
        Alert.alert(item.title, message);
      }
      return;
    }

    const product = iapProductByPlanCatalogId(item.id);
    if (!product) {
      Alert.alert(item.title, 'This plan is not available for in-app purchase.');
      return;
    }

    setBusyId(item.id);
    const result = await purchasePlan(product.planId);
    setBusyId(null);

    if (result.ok) {
      Alert.alert('Thank you', `${item.title} is now active on your account.`);
      onPurchased?.();
      return;
    }
    if (result.cancelled) return;
    Alert.alert('Purchase failed', result.error);
  };

  const onRestore = async () => {
    if (!iapReady) return;
    setRestoring(true);
    const result = await restorePurchases();
    setRestoring(false);
    if (result.ok) {
      Alert.alert('Restored', 'Your purchases have been restored.');
      onPurchased?.();
      return;
    }
    Alert.alert('Restore failed', result.error);
  };

  return (
    <View style={styles.list}>
      {items.map((item) => {
        const current = entitlements ? isCurrentSubscriptionPlan(entitlements, item) : false;
        const purchasable = item.id !== 'user' && iapReady;
        const ctaLabel = current
          ? 'Current plan'
          : purchasable
            ? 'Subscribe'
            : Platform.OS === 'web'
              ? 'Coming soon'
              : iapReady
                ? 'Subscribe'
                : 'Coming soon';
        const hint = current
          ? null
          : purchasable
            ? 'Secure payment via the App Store / Google Play.'
            : Platform.OS === 'web'
              ? 'Web checkout coming soon. Browse plans for now.'
              : 'In-app purchase coming soon (connect RevenueCat keys).';

        return (
          <CatalogPlanCard
            key={item.id}
            item={item}
            accent={accent}
            current={current}
            expanded={expandedId === item.id}
            busy={busyId === item.id}
            ctaLabel={ctaLabel}
            hint={hint}
            onToggle={() => setExpandedId((prev) => (prev === item.id ? null : item.id))}
            onSelect={() => void onSelect(item)}
          />
        );
      })}
      {iapReady ? (
        <Pressable
          style={styles.restoreBtn}
          onPress={() => void onRestore()}
          disabled={restoring}
          accessibilityRole="button"
          accessibilityLabel="Restore purchases"
        >
          {restoring ? (
            <ActivityIndicator color={accent} />
          ) : (
            <Text style={[styles.restoreText, { color: accent }]}>Restore purchases</Text>
          )}
        </Pressable>
      ) : null}
      {items.length === 0 ? (
        <Text style={[styles.empty, { color: theme.colors.textMuted }]}>No plans in this tab.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 10 },
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
  headerText: { flex: 1, minWidth: 0, gap: 2 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  title: {
    fontSize: 16,
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
  price: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: 2,
  },
  summary: {
    fontSize: 13,
    lineHeight: 18,
  },
  body: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  featureText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  cta: {
    marginTop: 6,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  ctaText: {
    fontSize: 14,
    fontWeight: '700',
  },
  comingSoon: {
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
  },
  restoreBtn: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  restoreText: {
    fontSize: 14,
    fontWeight: '600',
  },
  empty: {
    fontSize: 13,
    lineHeight: 18,
    paddingVertical: 8,
  },
});
