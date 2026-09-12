/**
 * F2T auto-exclusion rules from FPL bootstrap `news` + chance fields.
 *
 * Exclude when:
 * 1. FPL status is "u" (Unavailable / left PL pool), or
 * 2. News says unknown return date AND 0% chance this GW and next GW, or
 * 3. News has an expected return date 4+ weeks (28+ days) from today.
 *
 * Re-evaluated on every daily sync so return-date / news changes can clear
 * previous *auto* exclusions (manual owner flags are preserved separately).
 */

export const AUTO_EXCLUDE_MIN_DAYS = 28;

const UNKNOWN_RETURN_RE = /unknown\s+return\s+date/i;
const EXPECTED_BACK_RE = /expected\s+back\s+(\d{1,2})\s+([A-Za-z]{3})/i;

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

export type FplAvailabilityInput = {
  status: string;
  news?: string | null;
  chance_of_playing_this_round?: number | null;
  chance_of_playing_next_round?: number | null;
};

export type AutoExcludeDecision = {
  exclude: boolean;
  reason: string | null;
  /** ISO date (YYYY-MM-DD) when news names an expected return, else null. */
  expectedReturnDate: string | null;
  /** Whole days until expected return (null when unknown / unparseable). */
  daysUntilReturn: number | null;
};

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Parse "Expected back 10 Oct" relative to `now` (UTC calendar day). */
export function parseExpectedReturnDate(
  news: string,
  now: Date = new Date()
): { date: Date; iso: string; daysUntil: number } | null {
  const match = EXPECTED_BACK_RE.exec(news);
  if (!match) return null;
  const day = Number(match[1]);
  const month = MONTHS[match[2].toLowerCase()];
  if (!Number.isFinite(day) || month == null) return null;

  const today = startOfUtcDay(now);
  let year = today.getUTCFullYear();
  let candidate = new Date(Date.UTC(year, month - 1, day));
  // FPL omits the year; if the date is well in the past, roll to next year.
  const daysBehind =
    (today.getTime() - candidate.getTime()) / (24 * 60 * 60 * 1000);
  if (daysBehind > 60) {
    year += 1;
    candidate = new Date(Date.UTC(year, month - 1, day));
  }

  const daysUntil = Math.round(
    (candidate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000)
  );
  const iso = candidate.toISOString().slice(0, 10);
  return { date: candidate, iso, daysUntil };
}

function chanceIsZero(value: number | null | undefined): boolean {
  return value == null || value === 0;
}

export function evaluateFplAutoExclude(
  input: FplAvailabilityInput,
  now: Date = new Date()
): AutoExcludeDecision {
  const news = (input.news ?? '').trim();
  const parsed = news ? parseExpectedReturnDate(news, now) : null;

  if ((input.status ?? '').toLowerCase() === 'u') {
    return {
      exclude: true,
      reason: 'fpl_unavailable',
      expectedReturnDate: parsed?.iso ?? null,
      daysUntilReturn: parsed?.daysUntil ?? null,
    };
  }

  if (UNKNOWN_RETURN_RE.test(news)) {
    const zeroThis = chanceIsZero(input.chance_of_playing_this_round);
    const zeroNext = chanceIsZero(input.chance_of_playing_next_round);
    if (zeroThis && zeroNext) {
      return {
        exclude: true,
        reason: 'unknown_return_zero_chance',
        expectedReturnDate: null,
        daysUntilReturn: null,
      };
    }
  }

  if (parsed && parsed.daysUntil >= AUTO_EXCLUDE_MIN_DAYS) {
    return {
      exclude: true,
      reason: 'expected_return_4_weeks_plus',
      expectedReturnDate: parsed.iso,
      daysUntilReturn: parsed.daysUntil,
    };
  }

  return {
    exclude: false,
    reason: null,
    expectedReturnDate: parsed?.iso ?? null,
    daysUntilReturn: parsed?.daysUntil ?? null,
  };
}
