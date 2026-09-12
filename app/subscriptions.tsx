import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Platform,
  Alert,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';
import {
  ACCOUNT_MANAGE_HOST_LABEL,
  ACCOUNT_WEB_ONLY_MESSAGE,
  ACCOUNT_WEB_ONLY_TITLE,
  isAccountManagedOnWebOnly,
  openAccountManageOnWeb,
} from '@/lib/accountWebGate';
import { fetchMyEntitlements, type SubscriptionEntitlements } from '@/lib/subscriptionEntitlements';
import { GAMEMASTER_CONTACT_NOTE } from '@/lib/subscriptionPlans';
import { SubscriptionPlanList } from '@/components/SubscriptionPlanList';

type SubTab = 'player' | 'creator';

export default function SubscriptionsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const webOnly = isAccountManagedOnWebOnly();
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<SubTab>('player');
  const [entitlements, setEntitlements] = useState<SubscriptionEntitlements | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (tabParam === 'creator' || tabParam === 'player') {
      setTab(tabParam);
    }
  }, [tabParam]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const ent = await fetchMyEntitlements();
      setEntitlements(ent);
    } catch {
      setEntitlements(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const accent = theme.colors.accent;

  const openWebAccount = () => {
    void openAccountManageOnWeb().catch(() => {
      Alert.alert(ACCOUNT_WEB_ONLY_TITLE, ACCOUNT_WEB_ONLY_MESSAGE);
    });
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
        title: {
          flex: 1,
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 20,
          color: theme.colors.text,
        },
        tabs: {
          flexDirection: 'row',
          marginHorizontal: theme.spacing.lg,
          marginBottom: theme.spacing.md,
          borderRadius: theme.radius.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          overflow: 'hidden',
          backgroundColor: theme.colors.surface,
        },
        tab: {
          flex: 1,
          paddingVertical: 12,
          alignItems: 'center',
          borderBottomWidth: 2,
          borderBottomColor: 'transparent',
        },
        tabActive: {
          borderBottomColor: accent,
          backgroundColor: theme.colors.accentMuted,
        },
        tabText: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 14,
          color: theme.colors.textMuted,
        },
        tabTextActive: { color: accent },
        scroll: { flex: 1 },
        content: {
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: insets.bottom + theme.spacing.xl,
          gap: theme.spacing.md,
        },
        intro: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 14,
          lineHeight: 20,
          color: theme.colors.textMuted,
        },
        noteCard: {
          marginTop: theme.spacing.sm,
          padding: theme.spacing.md,
          borderRadius: theme.radius.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface,
          gap: 6,
        },
        noteTitle: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 14,
          color: theme.colors.text,
        },
        noteBody: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 13,
          lineHeight: 19,
          color: theme.colors.textMuted,
        },
        webGateCard: {
          padding: theme.spacing.lg,
          borderRadius: theme.radius.md,
          borderWidth: 1,
          borderColor: accent,
          backgroundColor: theme.colors.surface,
          gap: theme.spacing.sm,
        },
        webGateTitle: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 18,
          color: theme.colors.text,
        },
        webGateBody: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 14,
          lineHeight: 20,
          color: theme.colors.textMuted,
        },
        webGateBtn: {
          marginTop: theme.spacing.sm,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          paddingVertical: 12,
          borderRadius: theme.radius.md,
          backgroundColor: accent,
        },
        webGateBtnText: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 14,
          color: theme.colors.white,
        },
        center: {
          paddingVertical: 40,
          alignItems: 'center',
        },
      }),
    [theme, insets, accent]
  );

  if (webOnly) {
    return (
      <View style={styles.root}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button">
            <Ionicons name="arrow-back" size={24} color={theme.colors.text} />
          </Pressable>
          <Text style={styles.title}>Subscriptions</Text>
        </View>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          <View style={styles.webGateCard}>
            <Text style={styles.webGateTitle}>{ACCOUNT_WEB_ONLY_TITLE}</Text>
            <Text style={styles.webGateBody}>{ACCOUNT_WEB_ONLY_MESSAGE}</Text>
            <Pressable
              style={styles.webGateBtn}
              onPress={openWebAccount}
              accessibilityRole="button"
              accessibilityLabel={`Open ${ACCOUNT_MANAGE_HOST_LABEL}`}
            >
              <Ionicons name="open-outline" size={18} color={theme.colors.white} />
              <Text style={styles.webGateBtnText}>Open {ACCOUNT_MANAGE_HOST_LABEL}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button">
          <Ionicons name="arrow-back" size={24} color={theme.colors.text} />
        </Pressable>
        <Text style={styles.title}>Subscriptions</Text>
      </View>

      <View style={styles.tabs}>
        {(
          [
            { key: 'player' as const, label: 'Player' },
            { key: 'creator' as const, label: 'Creator' },
          ] as const
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

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={styles.intro}>
          {tab === 'player'
            ? 'Player plans cover how many competitions you can join and whether ads are shown.'
            : 'Creator plans let you run competitions. Higher tiers unlock more comps, players, and sports.'}
        </Text>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={accent} />
          </View>
        ) : (
          <SubscriptionPlanList kind={tab} entitlements={entitlements} accent={accent} />
        )}

        <View style={styles.noteCard}>
          <Text style={styles.noteTitle}>Club or syndicate?</Text>
          <Text style={styles.noteBody}>{GAMEMASTER_CONTACT_NOTE}</Text>
        </View>
      </ScrollView>
    </View>
  );
}
