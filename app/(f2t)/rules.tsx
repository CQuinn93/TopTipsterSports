import { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Platform } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';
import { useSidebar } from '@/contexts/SidebarContext';

export default function F2tRulesScreen() {
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
        sectionLabel: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 15,
          color: theme.colors.text,
        },
        rule: {
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
        <Text style={styles.title}>Rules</Text>
        <Pressable onPress={openSidebar} hitSlop={12}>
          <Ionicons name="menu" size={24} color={theme.colors.text} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionLabel}>Objective</Text>
        <Text style={styles.rule}>
          Pick 20 Premier League players. Each time one of your players scores in a gameweek after
          your league starts, that slot is checked off. First to 20 scored players wins.
        </Text>
        <Text style={styles.sectionLabel}>Selections</Text>
        <Text style={styles.rule}>
          Submit exactly 20 different players before the start gameweek deadline, plus 3 private
          Shootout players ranked 1, 2 and 3. Shootout picks must be different from your main 20
          and stay hidden from other tipsters.
        </Text>
        <Text style={styles.sectionLabel}>Scoring</Text>
        <Text style={styles.rule}>
          Goals count from the start gameweek onward. Only one check-off per player — extra goals
          from the same pick do not add extra points. Shootout players also check off when they
          score, but only matter if the league ends in a First-to-20 tie.
        </Text>
        <Text style={styles.sectionLabel}>Substitutions</Text>
        <Text style={styles.rule}>
          One regular substitution is allowed on your main 20 if a picked player has not scored
          (after the competition is more than 3 weeks old and you still have more than 3 unscored
          players). Owner-flagged long-term absences grant a free replacement for unscored flagged
          players — including shootout picks. Flagged substitutes are optional; you do not have to
          move them if you believe they will return and score.
        </Text>
        <Text style={styles.sectionLabel}>Winning</Text>
        <Text style={styles.rule}>
          First tipster to 20 scored main players wins. If two or more reach 20 in the same window:
          sudden-death shootout (rank 1 vs rank 1, then 2, then 3 — anyone whose pick has not scored
          while another’s has is knocked out). If still tied, highest Team Difficulty sum on the
          original 20 wins (FPL-based 1–5 ranks frozen at lock; higher = rarer scorers). If still
          tied, the pot is split.
        </Text>
      </ScrollView>
    </View>
  );
}
