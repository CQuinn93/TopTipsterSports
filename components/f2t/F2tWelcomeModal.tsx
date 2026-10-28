import { useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/contexts/ThemeContext';

type Props = {
  visible: boolean;
  competitionName?: string;
  onContinue: () => void;
  onOpenHowItWorks: () => void;
  onOpenRules: () => void;
};

export function F2tWelcomeModal({
  visible,
  competitionName,
  onContinue,
  onOpenHowItWorks,
  onOpenRules,
}: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: {
          flex: 1,
          backgroundColor: theme.colors.background,
          paddingTop: insets.top + theme.spacing.md,
          paddingBottom: Math.max(insets.bottom, theme.spacing.md),
        },
        header: {
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: theme.spacing.md,
          gap: 6,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.border,
        },
        eyebrow: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 12,
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          color: theme.colors.accent,
        },
        title: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 26,
          color: theme.colors.text,
        },
        subtitle: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 14,
          color: theme.colors.textMuted,
          lineHeight: 20,
        },
        content: {
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.lg,
          paddingBottom: theme.spacing.md,
          gap: theme.spacing.lg,
        },
        section: { gap: theme.spacing.sm },
        sectionTitle: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 16,
          color: theme.colors.text,
        },
        body: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 14,
          color: theme.colors.textSecondary,
          lineHeight: 21,
        },
        stepRow: {
          flexDirection: 'row',
          gap: theme.spacing.sm,
          alignItems: 'flex-start',
        },
        stepNum: {
          width: 22,
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 14,
          color: theme.colors.accent,
          marginTop: 1,
        },
        stepText: {
          flex: 1,
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 14,
          color: theme.colors.textSecondary,
          lineHeight: 21,
        },
        linkRow: {
          flexDirection: 'row',
          gap: theme.spacing.sm,
          flexWrap: 'wrap',
        },
        linkBtn: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingVertical: 10,
          paddingHorizontal: 12,
          borderRadius: theme.radius.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface,
        },
        linkBtnText: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 13,
          color: theme.colors.text,
        },
        footer: {
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.sm,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: theme.colors.border,
          gap: 8,
        },
        primaryBtn: {
          backgroundColor: theme.colors.accent,
          borderRadius: theme.radius.md,
          paddingVertical: 14,
          alignItems: 'center',
        },
        primaryBtnText: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 15,
          color: theme.colors.white,
        },
      }),
    [theme, insets]
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
      onRequestClose={onContinue}
    >
      <View style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>Tipster20</Text>
          <Text style={styles.title}>Welcome to Tipster20</Text>
          <Text style={styles.subtitle}>
            {competitionName
              ? `You’re in ${competitionName}. Here’s how the game works before you pick.`
              : 'Here’s how the game works before you pick.'}
          </Text>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>How it works</Text>
            <View style={styles.stepRow}>
              <Text style={styles.stepNum}>1</Text>
              <Text style={styles.stepText}>
                Pick 20 Premier League players before the start gameweek deadline.
              </Text>
            </View>
            <View style={styles.stepRow}>
              <Text style={styles.stepNum}>2</Text>
              <Text style={styles.stepText}>
                Add 3 private Shootout players ranked 1, 2 and 3 — hidden from everyone else.
              </Text>
            </View>
            <View style={styles.stepRow}>
              <Text style={styles.stepNum}>3</Text>
              <Text style={styles.stepText}>
                When one of your main 20 scores after the league starts, that slot is checked off.
              </Text>
            </View>
            <View style={styles.stepRow}>
              <Text style={styles.stepNum}>4</Text>
              <Text style={styles.stepText}>
                First tipster to check off all 20 wins. Ties go to shootout, then team difficulty,
                then a split pot.
              </Text>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Key rules</Text>
            <Text style={styles.body}>
              One regular substitute on your main 20 is allowed later in the season if you still
              have more than three unscored players. Flagged injured or unavailable players get a
              free replacement — including shootout picks — but you don’t have to use it.
            </Text>
            <Text style={styles.body}>
              Extra goals from the same player don’t add extra points. Only the first goal after
              your league starts checks them off.
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Want the full detail?</Text>
            <View style={styles.linkRow}>
              <Pressable style={styles.linkBtn} onPress={onOpenHowItWorks}>
                <Ionicons name="book-outline" size={16} color={theme.colors.accent} />
                <Text style={styles.linkBtnText}>How it works</Text>
              </Pressable>
              <Pressable style={styles.linkBtn} onPress={onOpenRules}>
                <Ionicons name="list-outline" size={16} color={theme.colors.accent} />
                <Text style={styles.linkBtnText}>Full rules</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <Pressable style={styles.primaryBtn} onPress={onContinue}>
            <Text style={styles.primaryBtnText}>Got it — let’s play</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
