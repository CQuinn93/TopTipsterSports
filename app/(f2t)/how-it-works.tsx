import { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Platform } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';
import { useSidebar } from '@/contexts/SidebarContext';

export default function F2tHowItWorksScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { openSidebar } = useSidebar();

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
        content: {
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: insets.bottom + theme.spacing.xl,
          gap: theme.spacing.md,
        },
        step: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 15,
          color: theme.colors.accent,
        },
        body: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 15,
          color: theme.colors.textSecondary,
          lineHeight: 22,
        },
      }),
    [theme, insets]
  );

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.text} />
        </Pressable>
        <Text style={styles.title}>How it works</Text>
        <Pressable onPress={openSidebar} hitSlop={12}>
          <Ionicons name="menu" size={24} color={theme.colors.text} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.step}>1. Join a league</Text>
        <Text style={styles.body}>
          Get a join code from your organiser, request entry, and wait for approval.
        </Text>
        <Text style={styles.step}>2. Pick 20 + shootout</Text>
        <Text style={styles.body}>
          Use stats and news hints in the picker. Lock in your main 20 and three private shootout
          ranks (1–3) before the start gameweek deadline.
        </Text>
        <Text style={styles.step}>3. Team management</Text>
        <Text style={styles.body}>
          Track scored players and upcoming fixtures on your squad cards. Use substitutions when a
          pick is flagged or your regular sub unlocks. Shootout picks can only be moved if flagged.
        </Text>
        <Text style={styles.body}>
          Goals sync after Premier League matches. Your grid updates as players score.
        </Text>
        <Text style={styles.step}>4. Win with 20</Text>
        <Text style={styles.body}>
          Be first to check off all 20. If several tipsters hit 20 together, private shootouts
          decide, then team difficulty, then a split pot.
        </Text>
      </ScrollView>
    </View>
  );
}
