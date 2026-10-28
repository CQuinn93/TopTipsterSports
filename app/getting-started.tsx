import { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Platform } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';

export default function GettingStartedScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

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
          gap: theme.spacing.lg,
        },
        intro: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 15,
          color: theme.colors.textSecondary,
          lineHeight: 22,
        },
        section: { gap: theme.spacing.sm },
        sectionTitle: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 16,
          color: theme.colors.text,
        },
        label: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 13,
          color: theme.colors.accent,
          textTransform: 'uppercase',
          letterSpacing: 0.8,
        },
        body: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 15,
          color: theme.colors.textSecondary,
          lineHeight: 22,
        },
        note: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 14,
          color: theme.colors.textMuted,
          lineHeight: 20,
          paddingTop: theme.spacing.sm,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: theme.colors.border,
        },
      }),
    [theme, insets]
  );

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button">
          <Ionicons name="arrow-back" size={24} color={theme.colors.text} />
        </Pressable>
        <Text style={styles.title}>Getting started</Text>
        <View style={{ width: 24 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>
          Top Tipster Sports is a private competition platform for pubs, clubs, and groups. Pick a
          game mode from the home screen, join with a code from your organiser, and follow live
          standings together.
        </Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Join any competition</Text>
          <Text style={styles.label}>1. Get a code</Text>
          <Text style={styles.body}>
            Ask your pub, league admin, or organiser for a join code. Each competition has its own
            code.
          </Text>
          <Text style={styles.label}>2. Enter the code</Text>
          <Text style={styles.body}>
            Open the game mode (Last Man Standing, Tipster Twenty, or Top Tipster Racing) and use
            the Join tab. Enter the code and request to join.
          </Text>
          <Text style={styles.label}>3. Wait for approval</Text>
          <Text style={styles.body}>
            The organiser approves your request. You can then make picks and view standings.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Last Man Standing</Text>
          <Text style={styles.body}>
            Premier League survival. Each gameweek pick one team to win — each club only once. Wrong
            result and you're out. Last player standing wins. Open Rules and How it works from
            the menu inside LMS for deadlines and extra lives.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Tipster Twenty</Text>
          <Text style={styles.body}>
            Pick 20 players. As they score in real matches, your grid fills in. First to complete
            all 20 wins (ties use private shootouts, then team difficulty, then split). Use Team
            Management for substitutions when picks are flagged unavailable.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Top Tipster Racing</Text>
          <Text style={styles.body}>
            Built for big meetings — Cheltenham, Aintree, Ascot, and similar festival cards. One
            pick per race before the deadline, then climb the points leaderboard. Check Rules and
            Points in the racing menu for scoring.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Organisers</Text>
          <Text style={styles.body}>
            Competition creators manage join requests, set optional entry notes (display only), and
            share invite codes. Top Tipster does not collect entry fees or pay prizes — any cash
            entry or prizes are handled by the organiser directly.
          </Text>
        </View>

        <Text style={styles.note}>
          Need help? Use Account on the home screen for sign-out and privacy links, or contact your
          competition organiser for league-specific questions.
        </Text>
      </ScrollView>
    </View>
  );
}
