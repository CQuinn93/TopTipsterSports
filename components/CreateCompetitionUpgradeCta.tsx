import { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, Platform } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/contexts/ThemeContext';

type Props = {
  /** Display name of the current game mode, e.g. Tipster20 / Last Man Standing / Racing. */
  modeLabel: string;
};

/**
 * Shown on My competitions for players who cannot create leagues.
 * Confirms leaving the mode, then opens Creator subscription options.
 */
export function CreateCompetitionUpgradeCta({ modeLabel }: Props) {
  const theme = useTheme();

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
      }),
    [theme]
  );

  const goToCreatorPlans = () => {
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
      accessibilityLabel="Want to create your own competition? Upgrade"
    >
      <Ionicons name="trophy-outline" size={18} color={theme.colors.accent} />
      <View style={styles.copy}>
        <Text style={styles.title}>Want to create your own competition?</Text>
        <Text style={styles.upgrade}>Upgrade</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={theme.colors.textMuted} />
    </Pressable>
  );
}
