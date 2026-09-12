import { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, Platform } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/contexts/ThemeContext';
import {
  CREATE_COMP_WEB_ONLY_HINT,
  isAccountManagedOnWebOnly,
  openAccountManageOnWeb,
} from '@/lib/accountWebGate';

type Props = {
  /** Display name of the current game mode, e.g. Tipster20 / Last Man Standing / Racing. */
  modeLabel: string;
};

/**
 * Shown on My competitions for players who cannot create leagues.
 * On web: confirms leaving the mode, then opens Creator subscription options.
 * On native store apps: directs users to manage account / upgrades on the website.
 */
export function CreateCompetitionUpgradeCta({ modeLabel }: Props) {
  const theme = useTheme();
  const webOnly = isAccountManagedOnWebOnly();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        wrap: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          marginBottom: 12,
          paddingVertical: 10,
          paddingHorizontal: 12,
          borderRadius: theme.radius.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface,
        },
        copy: {
          flex: 1,
          minWidth: 0,
          gap: 2,
        },
        title: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 13,
          color: theme.colors.text,
          lineHeight: 18,
        },
        upgrade: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 13,
          color: theme.colors.accent,
        },
        mutedHint: {
          fontFamily: theme.fontFamily.regular,
          fontSize: 12,
          color: theme.colors.textMuted,
          lineHeight: 16,
        },
      }),
    [theme]
  );

  const goToCreatorPlans = () => {
    if (webOnly) {
      void openAccountManageOnWeb().catch(() => {
        Alert.alert('Could not open browser', CREATE_COMP_WEB_ONLY_HINT);
      });
      return;
    }

    const title = 'Leave this mode?';
    const message = `You'll leave ${modeLabel} to view Creator subscription options. You can return from the Competition Hub anytime.`;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      if (window.confirm(`${title}\n\n${message}`)) {
        router.push('/subscriptions?tab=creator' as any);
      }
      return;
    }
    Alert.alert(title, message, [
      { text: 'Stay', style: 'cancel' },
      {
        text: 'Continue',
        onPress: () => router.push('/subscriptions?tab=creator' as any),
      },
    ]);
  };

  return (
    <Pressable
      style={styles.wrap}
      onPress={goToCreatorPlans}
      accessibilityRole="button"
      accessibilityLabel={
        webOnly
          ? 'Want to create your own competition? Visit www.toptipster.ie'
          : 'Want to create your own competition? Upgrade'
      }
    >
      <Ionicons
        name={webOnly ? 'globe-outline' : 'trophy-outline'}
        size={18}
        color={theme.colors.accent}
      />
      <View style={styles.copy}>
        <Text style={styles.title}>Want to create your own competition?</Text>
        {webOnly ? (
          <Text style={styles.mutedHint}>{CREATE_COMP_WEB_ONLY_HINT}</Text>
        ) : (
          <Text style={styles.upgrade}>Upgrade</Text>
        )}
      </View>
      <Ionicons
        name={webOnly ? 'open-outline' : 'chevron-forward'}
        size={16}
        color={theme.colors.textMuted}
      />
    </Pressable>
  );
}
