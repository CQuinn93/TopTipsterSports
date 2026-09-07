import { useMemo, type ReactNode } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  useWindowDimensions,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';
import { getAdminAccent } from '@/constants/adminUi';
import { BrandLogo } from '@/components/BrandLogo';

const DESKTOP_BREAKPOINT = 900;
const COMPACT_BREAKPOINT = 420;

export type AdminTabItem = {
  key: string;
  label: string;
};

type AdminScreenLayoutProps = {
  sectionTitle: string;
  onExit: () => void;
  tabs: AdminTabItem[];
  activeTab: string;
  onTabChange: (key: string) => void;
  children: ReactNode;
  loading?: boolean;
};

function ContourDecor({ color, compact }: { color: string; compact: boolean }) {
  const rings = compact ? [140, 210, 280] : [200, 300, 400, 520];
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View
        style={{
          position: 'absolute',
          right: compact ? -100 : -160,
          top: compact ? -30 : -60,
          width: compact ? 340 : 580,
          height: compact ? 340 : 580,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {rings.map((size) => (
          <View
            key={size}
            style={{
              position: 'absolute',
              width: size,
              height: size,
              borderRadius: size / 2,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: color,
              opacity: 0.5,
            }}
          />
        ))}
      </View>
    </View>
  );
}

export function AdminScreenLayout({
  sectionTitle,
  onExit,
  tabs,
  activeTab,
  onTabChange,
  children,
  loading,
}: AdminScreenLayoutProps) {
  const theme = useTheme();
  const isDark = true;
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const admin = getAdminAccent(!!isDark);

  const isDesktop = width >= DESKTOP_BREAKPOINT;
  const isCompact = width < COMPACT_BREAKPOINT || height < 640;
  const isWeb = Platform.OS === 'web';
  const horizontalPad = isCompact ? theme.spacing.md : isDesktop ? theme.spacing.xxl : theme.spacing.lg;
  const contentMax = isDesktop ? 1080 : 720;

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: {
          flex: 1,
          backgroundColor: theme.colors.background,
        },
        layer: {
          ...StyleSheet.absoluteFillObject,
        },
        header: {
          paddingTop: isWeb
            ? Math.max(theme.spacing.md, insets.top + 6)
            : insets.top + theme.spacing.sm,
          paddingHorizontal: horizontalPad,
          paddingBottom: theme.spacing.sm,
          zIndex: 2,
        },
        headerInner: {
          width: '100%',
          maxWidth: contentMax,
          alignSelf: 'center',
          flexDirection: isDesktop ? 'row' : 'column',
          alignItems: isDesktop ? 'center' : 'stretch',
          justifyContent: 'space-between',
          gap: theme.spacing.md,
        },
        brandBlock: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          minWidth: 0,
        },
        brandTitle: {
          fontFamily: theme.fontFamily.swish,
          fontSize: isCompact ? 22 : 26,
          color: theme.colors.text,
          letterSpacing: 0.6,
        },
        brandSub: {
          fontFamily: theme.fontFamily.regular,
          fontSize: 10,
          fontWeight: '700',
          color: admin.accent,
          letterSpacing: 4.5,
          marginTop: 2,
        },
        headerRight: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.md,
          flexWrap: 'wrap',
          justifyContent: isDesktop ? 'flex-end' : 'space-between',
        },
        tabRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.lg,
          flexWrap: 'wrap',
          alignSelf: isDesktop ? 'auto' : 'flex-start',
          maxWidth: '100%',
        },
        tab: {
          paddingVertical: 8,
          borderBottomWidth: 2,
          borderBottomColor: 'transparent',
        },
        tabActive: {
          borderBottomColor: admin.accent,
        },
        tabLabel: {
          fontFamily: theme.fontFamily.regular,
          fontSize: 13,
          fontWeight: '600',
          letterSpacing: 0.4,
          color: theme.colors.textMuted,
        },
        tabLabelActive: {
          color: admin.accent,
        },
        exitBtn: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingVertical: 8,
          paddingHorizontal: 10,
          borderRadius: theme.radius.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
        },
        exitText: {
          fontFamily: theme.fontFamily.regular,
          fontSize: 12,
          fontWeight: '600',
          color: theme.colors.textSecondary,
        },
        sectionWrap: {
          paddingHorizontal: horizontalPad,
          paddingTop: theme.spacing.sm,
          paddingBottom: theme.spacing.xs,
          zIndex: 2,
        },
        sectionInner: {
          width: '100%',
          maxWidth: contentMax,
          alignSelf: 'center',
        },
        sectionTitle: {
          fontFamily: theme.fontFamily.regular,
          fontSize: isCompact ? 22 : 26,
          fontWeight: '700',
          color: theme.colors.text,
          letterSpacing: -0.4,
        },
        body: {
          flex: 1,
          zIndex: 1,
        },
        bodyInner: {
          width: '100%',
          maxWidth: contentMax,
          alignSelf: 'center',
          flex: 1,
        },
        loader: {
          marginTop: theme.spacing.xl,
        },
      }),
    [theme, admin.accent, isCompact, isDesktop, isWeb, horizontalPad, contentMax, insets.top]
  );

  return (
    <View style={styles.root}>
      <View style={styles.layer} pointerEvents="none">
        <LinearGradient colors={[...admin.bg]} style={StyleSheet.absoluteFill} />
        <ContourDecor color={admin.decor} compact={isCompact} />
      </View>

      <View style={styles.header}>
        <View style={styles.headerInner}>
          <View style={styles.brandBlock}>
            <BrandLogo size={isCompact ? 34 : 40} />
            <View>
              <Text style={styles.brandTitle}>Top Tipster</Text>
              <Text style={styles.brandSub}>ADMIN</Text>
            </View>
          </View>
          <View style={styles.headerRight}>
            <View style={styles.tabRow} accessibilityRole="tablist">
              {tabs.map((item) => {
                const active = activeTab === item.key;
                return (
                  <Pressable
                    key={item.key}
                    onPress={() => onTabChange(item.key)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    style={[styles.tab, active && styles.tabActive]}
                    hitSlop={6}
                  >
                    <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{item.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              style={styles.exitBtn}
              onPress={onExit}
              accessibilityRole="button"
              accessibilityLabel="Exit admin"
            >
              <Ionicons name="arrow-back-outline" size={16} color={theme.colors.textSecondary} />
              <Text style={styles.exitText}>Back</Text>
            </Pressable>
          </View>
        </View>
      </View>

      <View style={styles.sectionWrap}>
        <View style={styles.sectionInner}>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            {sectionTitle}
          </Text>
        </View>
      </View>

      <View style={styles.body}>
        <View style={styles.bodyInner}>
          {loading ? <ActivityIndicator style={styles.loader} color={admin.accent} /> : children}
        </View>
      </View>
    </View>
  );
}

export function useAdminAccent() {
  const isDark = true;
  return getAdminAccent(!!isDark);
}
