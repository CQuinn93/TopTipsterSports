import { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';

export type CoachRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type F2tPickerCoachStep = {
  id: string;
  title: string;
  body: string;
};

type Props = {
  visible: boolean;
  stepIndex: number;
  steps: F2tPickerCoachStep[];
  target: CoachRect | null;
  onNext: () => void;
  onSkip: () => void;
};

const OUTLINE = '#ef4444';
const PAD = 6;

export function F2tPickerCoachOverlay({
  visible,
  stepIndex,
  steps,
  target,
  onNext,
  onSkip,
}: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const step = steps[stepIndex];
  const isLast = stepIndex >= steps.length - 1;

  const hole = useMemo(() => {
    if (!target || target.width <= 0 || target.height <= 0) return null;
    return {
      left: Math.max(8, target.x - PAD),
      top: Math.max(8, target.y - PAD),
      width: Math.min(winW - 16, target.width + PAD * 2),
      height: target.height + PAD * 2,
    };
  }, [target, winW]);

  const tooltipTop = useMemo(() => {
    if (!hole) return Math.max(insets.top + 80, winH * 0.35);
    const below = hole.top + hole.height + 16;
    const above = hole.top - 140;
    if (below + 160 < winH - insets.bottom) return below;
    if (above > insets.top + 12) return above;
    return Math.max(insets.top + 24, winH * 0.4);
  }, [hole, winH, insets]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: {
          ...StyleSheet.absoluteFillObject,
          zIndex: 100,
        },
        dim: {
          ...StyleSheet.absoluteFillObject,
          backgroundColor: 'rgba(0,0,0,0.62)',
        },
        hole: {
          position: 'absolute',
          borderRadius: 14,
          borderWidth: 2.5,
          borderColor: OUTLINE,
          backgroundColor: 'transparent',
          // No alpha on the outline — solid red ring over the live UI.
          ...(Platform.OS === 'ios'
            ? {
                shadowColor: OUTLINE,
                shadowOpacity: 0.35,
                shadowRadius: 6,
                shadowOffset: { width: 0, height: 0 },
              }
            : {}),
        },
        clearHole: {
          position: 'absolute',
          borderRadius: 12,
          backgroundColor: 'transparent',
        },
        tooltip: {
          position: 'absolute',
          left: theme.spacing.lg,
          right: theme.spacing.lg,
          borderRadius: theme.radius.md,
          backgroundColor: theme.colors.surface,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          padding: theme.spacing.lg,
          gap: theme.spacing.sm,
        },
        stepCount: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 11,
          letterSpacing: 0.4,
          textTransform: 'uppercase',
          color: OUTLINE,
        },
        title: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 18,
          color: theme.colors.text,
        },
        body: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 14,
          lineHeight: 20,
          color: theme.colors.textSecondary,
        },
        actions: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: theme.spacing.sm,
          gap: theme.spacing.sm,
        },
        skipBtn: {
          paddingVertical: 10,
          paddingHorizontal: 8,
        },
        skipText: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 14,
          color: theme.colors.textMuted,
        },
        nextBtn: {
          flexGrow: 1,
          maxWidth: 220,
          backgroundColor: theme.colors.accent,
          borderRadius: theme.radius.md,
          paddingVertical: 12,
          alignItems: 'center',
        },
        nextText: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 14,
          color: theme.colors.white,
        },
      }),
    [theme]
  );

  if (!visible || !step) return null;

  return (
    <View style={styles.root} pointerEvents="box-none">
      {/* Four dim panels around the hole so the target stays undimmed */}
      {hole ? (
        <>
          <View style={[styles.dim, { bottom: winH - hole.top }]} />
          <View style={[styles.dim, { top: hole.top + hole.height }]} />
          <View
            style={[
              styles.dim,
              {
                top: hole.top,
                height: hole.height,
                right: winW - hole.left,
              },
            ]}
          />
          <View
            style={[
              styles.dim,
              {
                top: hole.top,
                height: hole.height,
                left: hole.left + hole.width,
              },
            ]}
          />
          <View
            pointerEvents="none"
            style={[
              styles.hole,
              {
                left: hole.left,
                top: hole.top,
                width: hole.width,
                height: hole.height,
              },
            ]}
          />
          {/* Swallow taps on the spotlight so the card underneath isn’t selected mid-tour. */}
          <Pressable
            style={{
              position: 'absolute',
              left: hole.left,
              top: hole.top,
              width: hole.width,
              height: hole.height,
            }}
          />
        </>
      ) : (
        <View style={styles.dim} />
      )}

      <View style={[styles.tooltip, { top: tooltipTop }]}>
        <Text style={styles.stepCount}>
          Tip {stepIndex + 1} of {steps.length}
        </Text>
        <Text style={styles.title}>{step.title}</Text>
        <Text style={styles.body}>{step.body}</Text>
        <View style={styles.actions}>
          {!isLast ? (
            <Pressable style={styles.skipBtn} onPress={onSkip} hitSlop={8}>
              <Text style={styles.skipText}>Skip</Text>
            </Pressable>
          ) : (
            <View style={styles.skipBtn} />
          )}
          <Pressable style={styles.nextBtn} onPress={onNext}>
            <Text style={styles.nextText}>
              {isLast ? 'Select your Players' : 'Next'}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

export const F2T_PICKER_COACH_STEPS: F2tPickerCoachStep[] = [
  {
    id: 'playerInfo',
    title: 'Player info',
    body: 'This side of the card shows who the player is — their name, position and club.',
  },
  {
    id: 'statGoals',
    title: 'Goals',
    body: 'Season goals so far in the Premier League. Handy for spotting proven scorers.',
  },
  {
    id: 'statForm',
    title: 'Form',
    body: 'Recent Fantasy Premier League form. Higher usually means they’re in good scoring rhythm.',
  },
  {
    id: 'statXg',
    title: 'xG / 90',
    body: 'Expected goals per 90 minutes. A fairer “how likely to score” rate than raw season totals.',
  },
  {
    id: 'statDiff',
    title: 'Difficulty (Diff)',
    body: 'Our 1–5 scoring-likelihood rank for Tipster20 tiebreaks. 1 = most likely to score, 5 = very rare. Tap Diff anytime for a reminder.',
  },
  {
    id: 'filters',
    title: 'Search & filters',
    body: 'Search by name, or narrow by position and team. Sort by goals, form, xG/90 or difficulty to build your 20 faster.',
  },
];
