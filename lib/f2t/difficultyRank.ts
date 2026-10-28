/**
 * Tipster20 Team Difficulty rank (1–5).
 * Mirrors public.f2t_difficulty_rank_from_stats in migration 129.
 * 1 = most likely to score, 5 = very rare.
 */

function numFromStats(
  stats: Record<string, unknown> | null | undefined,
  ...keys: string[]
): number | null {
  if (!stats) return null;
  for (const k of keys) {
    const v = stats[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '') {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function positionFloor(position: string | null | undefined): number {
  const pos = (position ?? '').trim().toUpperCase();
  if (pos === 'GK' || pos === 'GKP' || pos === '1') return 5;
  if (pos === 'DEF' || pos === '2') return 4;
  if (pos === 'MID' || pos === '3') return 3;
  if (pos === 'FWD' || pos === '4') return 2;
  return 3;
}

export function f2tDifficultyRankFromStats(
  stats: Record<string, unknown> | null | undefined,
  position?: string | null
): number {
  const xg90 = numFromStats(stats, 'expected_goals_per_90');
  const seasonXg = numFromStats(stats, 'expected_goals');
  const goals = numFromStats(stats, 'season_goals', 'goals_scored');
  const minutes = numFromStats(stats, 'minutes');
  const floor = positionFloor(position);

  let signal: number | null = null;
  if (xg90 != null) {
    signal = xg90;
  } else if (seasonXg != null && (minutes ?? 0) >= 90) {
    signal = seasonXg / (minutes! / 90);
  }

  if ((minutes ?? 0) < 180 && (signal ?? 0) < 0.2) {
    return floor;
  }

  if (signal == null) {
    const g = goals ?? 0;
    if (g >= 8) return 1;
    if (g >= 4) return 2;
    if (g >= 2) return 3;
    if (g >= 1) return 4;
    return floor;
  }

  if (signal >= 0.55) return 1;
  if (signal >= 0.35) return 2;
  if (signal >= 0.2) return 3;
  if (signal >= 0.08) return 4;
  return 5;
}

export function f2tDifficultyRankLabel(rank: number): string {
  switch (rank) {
    case 1:
      return 'Very likely';
    case 2:
      return 'Strong';
    case 3:
      return 'Occasional';
    case 4:
      return 'Rare';
    default:
      return 'Very rare';
  }
}
