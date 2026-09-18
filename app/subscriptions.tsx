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
  canPurchaseInApp,
  GAMEMASTER_WEB_ENQUIRY_MESSAGE,
  isNativeStoreClient,
  NATIVE_UPGRADES_COMING_SOON_MESSAGE,
  openAccountManageOnWeb,
} from '@/lib/accountWebGate';
import { fetchMyEntitlements, type SubscriptionEntitlements } from '@/lib/subscriptionEntitlements';
import { GAMEMASTER_CONTACT_NOTE } from '@/lib/subscriptionPlans';
import { SubscriptionPlanList } from '@/components/SubscriptionPlanList';

type SubTab = 'player' | 'creator';

export default function SubscriptionsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const nativeStore = isNativeStoreClient();
  const iapReady = canPurchaseInApp();
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

  const openGamemasterEnquiry = () => {
    void openAccountManageOnWeb().catch(() => {
      Alert.alert('Could not open browser', GAMEMASTER_WEB_ENQUIRY_MESSAGE);
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
        comingSoonBanner: {
          padding: theme.spacing.md,
          borderRadius: theme.radius.md,
          borderWidth: 1,
          borderColor: accent,
          backgroundColor: theme.colors.surface,
          gap: 4,
        },
        comingSoonTitle: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 14,
          color: theme.colors.text,
        },
        comingSoonBody: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 13,
          lineHeight: 19,
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
        enquireBtn: {
          marginTop: 4,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          paddingVertical: 11,
          borderRadius: theme.radius.md,
          backgroundColor: accent,
        },
        enquireBtnText: {
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
        {nativeStore && !iapReady ? (
          <View style={styles.comingSoonBanner}>
            <Text style={styles.comingSoonTitle}>Purchases coming soon</Text>
            <Text style={styles.comingSoonBody}>{NATIVE_UPGRADES_COMING_SOON_MESSAGE}</Text>
          </View>
        ) : null}

        {nativeStore && iapReady ? (
          <View style={styles.comingSoonBanner}>
            <Text style={styles.comingSoonTitle}>In-app subscriptions</Text>
            <Text style={styles.comingSoonBody}>
              Pay securely through the App Store or Google Play. Gamemaster club packages stay as a
              website enquiry.
            </Text>
          </View>
        ) : null}

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
          <SubscriptionPlanList
            kind={tab}
            entitlements={entitlements}
            accent={accent}
            onPurchased={() => void load()}
          />
        )}

        <View style={styles.noteCard}>
          <Text style={styles.noteTitle}>Club or syndicate?</Text>
          <Text style={styles.noteBody}>{GAMEMASTER_CONTACT_NOTE}</Text>
          <Pressable
            style={styles.enquireBtn}
            onPress={openGamemasterEnquiry}
            accessibilityRole="button"
            accessibilityLabel={`Enquire on ${ACCOUNT_MANAGE_HOST_LABEL}`}
          >
            <Ionicons name="open-outline" size={16} color={theme.colors.white} />
            <Text style={styles.enquireBtnText}>Enquire on {ACCOUNT_MANAGE_HOST_LABEL}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
