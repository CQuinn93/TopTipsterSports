import { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, Platform } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/contexts/ThemeContext';
import {
  canPurchaseInApp,
  CREATE_COMP_COMING_SOON_HINT,
  CREATE_COMP_IAP_HINT,
  isNativeStoreClient,
  NATIVE_UPGRADES_COMING_SOON_MESSAGE,
  NATIVE_UPGRADES_COMING_SOON_TITLE,
} from '@/lib/accountWebGate';

type Props = {
  /** Display name of the current game mode, e.g. Tipster20 / Last Man Standing / Racing. */
  modeLabel: string;
};

/**
 * Shown on My competitions for players who cannot create leagues.
 * Web → Creator plans screen.
 * Native + IAP configured → Creator plans (in-app purchase).
 * Native without IAP keys → Coming soon.
 */
export function CreateCompetitionUpgradeCta({ modeLabel }: Props) {
  const theme = useTheme();
  const nativeStore = isNativeStoreClient();
  const iapReady = canPurchaseInApp();

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
    if (nativeStore && !iapReady) {
      Alert.alert(NATIVE_UPGRADES_COMING_SOON_TITLE, NATIVE_UPGRADES_COMING_SOON_MESSAGE);
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
        nativeStore && !iapReady
          ? 'Want to create your own competition? Coming soon'
          : 'Want to create your own competition? Upgrade'
      }
    >
      <Ionicons
        name={nativeStore && !iapReady ? 'time-outline' : 'trophy-outline'}
        size={18}
        color={theme.colors.accent}
      />
      <View style={styles.copy}>
        <Text style={styles.title}>Want to create your own competition?</Text>
        {nativeStore && !iapReady ? (
          <Text style={styles.mutedHint}>{CREATE_COMP_COMING_SOON_HINT}</Text>
        ) : nativeStore ? (
          <Text style={styles.mutedHint}>{CREATE_COMP_IAP_HINT}</Text>
        ) : (
          <Text style={styles.upgrade}>Upgrade</Text>
        )}
      </View>
      <Ionicons
        name={nativeStore && !iapReady ? 'hourglass-outline' : 'chevron-forward'}
        size={16}
        color={theme.colors.textMuted}
      />
    </Pressable>
  );
}
