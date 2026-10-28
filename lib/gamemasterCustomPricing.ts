/**
 * Owner-only club League Bill — transparent build from per-player rates.
 *
 * Platform fee: charge at 75% of player cap.
 * €0.20 / player from a 50-cap baseline; −€0.01 per extra 50 on the cap, floor €0.15.
 * + €0.05 / planning player ads-off · cushion to next €5 (min +€5).
 */

export type LmsContinuationMode = 'none' | 'full_rollover' | 'mass_wipeout_revive';
export type Tipster20ContinuationMode = 'none' | 'allow_split_pot' | 'playoff_until_sole';
export type ClubFootballMode = 'lms' | 'tipster20';

export type CompetitionDraft = {
  id: string;
  footballMode: ClubFootballMode;
  maxPlayers: number;
  lmsContinuation: LmsContinuationMode;
  tipster20Continuation: Tipster20ContinuationMode;
};

export type LeagueBillInput = {
  competitions: CompetitionDraft[];
  competitionHubs: number;
  includeFestivalPass: boolean;
};

export type LeagueBillLine = {
  label: string;
  amount: number;
  /** Optional detail under the line (transparency). */
  detail?: string;
};

export type LeagueBillQuote = {
  seasonTotal: number;
  hubDepositTotal: number;
  hubMonthlyTotal: number;
  dueToday: number;
  assumedSeasonWeeks: number;
  lines: LeagueBillLine[];
  dueTodayLines: LeagueBillLine[];
  competitionSummaries: {
    id: string;
    title: string;
    planningPlayers: number;
    platformRate: number;
    amount: number;
    continuationLabel: string;
    notes: string[];
    breakdown: LeagueBillLine[];
  }[];
  recommendedCaps: {
    competitions: {
      football_mode: ClubFootballMode;
      max_participants: number;
      continuation: string;
    }[];
    max_concurrent_creates: number;
    kiosk_licenses_count: number;
    include_festival_pass: boolean;
    assumed_season_weeks: number;
  };
};

export const ASSUMED_SEASON_WEEKS = 8;

export const LEAGUE_BILL_RATES = {
  /** Starting platform rate at 50-cap baseline. */
  platformPerPlayerStart: 0.2,
  /** Floor after volume discounts. */
  platformPerPlayerFloor: 0.15,
  /** Cap step that unlocks −€0.01 on the platform rate. */
  platformDiscountEveryPlayers: 50,
  platformDiscountBaseline: 50,
  adsOffPerPlayer: 0.05,
  fullRollover: 10,
  massWipeoutRevive: 8,
  tipster20Premium: 5,
  allowSplitPot: 0,
  playoffUntilSole: 8,
  hubDeposit: 50,
  hubMonthly: 10,
  festivalPass: 39,
  planningFillRate: 0.75,
  multiCompFactor: 0.92,
  /** Minimum cushion before rounding up to €5. */
  minCushion: 5,
} as const;

export const LEAGUE_BILL_LIMITS = {
  maxPlayers: { min: 50, max: 250, step: 25 },
  maxCompetitions: 4,
  competitionHubs: { min: 0, max: 4 },
} as const;

export const FOOTBALL_MODE_OPTIONS: {
  key: ClubFootballMode;
  label: string;
  hint: string;
}[] = [
  {
    key: 'lms',
    label: 'Last Man Standing',
    hint: 'One pick per gameweek. Typical club fundraiser format.',
  },
  {
    key: 'tipster20',
    label: 'Tipster20',
    hint: 'Race to 20 goalscorers. Split pots are possible if several finish together.',
  },
];

export const LMS_CONTINUATION_OPTIONS: {
  key: LmsContinuationMode;
  label: string;
  hint: string;
}[] = [
  {
    key: 'none',
    label: 'No continuation',
    hint: 'If there is no sole winner, the competition ends.',
  },
  {
    key: 'full_rollover',
    label: 'Full rollover',
    hint: 'Wipeout → rejoin season for the same league. Covered by this League Bill.',
  },
  {
    key: 'mass_wipeout_revive',
    label: 'Mass wipeout revive',
    hint:
      'If all remaining players go out in the same GW, only they revive and play on. Used teams stay used — including the team that just lost.',
  },
];

export const TIPSTER20_CONTINUATION_OPTIONS: {
  key: Tipster20ContinuationMode;
  label: string;
  hint: string;
}[] = [
  {
    key: 'none',
    label: 'No special rule',
    hint: 'In-app ladder still applies: First-to-20 → private shootout → team difficulty → split if needed.',
  },
  {
    key: 'allow_split_pot',
    label: 'Allow split pot',
    hint: 'After shootout and team difficulty, any remaining tie splits the pot. Matches Tipster20 in-app resolution.',
  },
  {
    key: 'playoff_until_sole',
    label: 'Playoff until sole winner',
    hint: 'Shootout + team difficulty try for a sole winner first; only a true dead heat splits.',
  },
];

/** €0.20 at 50-cap; −€0.01 per extra 50 on the max, floor €0.15. */
export function platformRateForCap(maxPlayers: number): number {
  const steps = Math.max(
    0,
    Math.floor(
      (maxPlayers - LEAGUE_BILL_RATES.platformDiscountBaseline) /
        LEAGUE_BILL_RATES.platformDiscountEveryPlayers
    )
  );
  return Math.max(
    LEAGUE_BILL_RATES.platformPerPlayerFloor,
    roundMoney(LEAGUE_BILL_RATES.platformPerPlayerStart - steps * 0.01)
  );
}

export function planningPlayersForCap(maxPlayers: number): number {
  return Math.round(maxPlayers * LEAGUE_BILL_RATES.planningFillRate);
}

/** Round up so there is at least minCushion, then to the next €5. */
export function applyCushion(subtotal: number): { total: number; cushion: number } {
  const withMin = subtotal + LEAGUE_BILL_RATES.minCushion;
  const total = Math.ceil(withMin / 5) * 5;
  return { total, cushion: roundMoney(total - subtotal) };
}

export function createEmptyCompetition(): CompetitionDraft {
  return {
    id: `comp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    footballMode: 'lms',
    maxPlayers: 100,
    lmsContinuation: 'full_rollover',
    tipster20Continuation: 'allow_split_pot',
  };
}

export function clampCompetition(c: CompetitionDraft): CompetitionDraft {
  return {
    ...c,
    maxPlayers: clamp(
      snap(c.maxPlayers, LEAGUE_BILL_LIMITS.maxPlayers.step),
      LEAGUE_BILL_LIMITS.maxPlayers.min,
      LEAGUE_BILL_LIMITS.maxPlayers.max
    ),
  };
}

export function clampLeagueBillInput(input: LeagueBillInput): LeagueBillInput {
  const competitions = input.competitions
    .slice(0, LEAGUE_BILL_LIMITS.maxCompetitions)
    .map(clampCompetition);
  return {
    competitions: competitions.length > 0 ? competitions : [],
    competitionHubs: clamp(
      input.competitionHubs,
      LEAGUE_BILL_LIMITS.competitionHubs.min,
      LEAGUE_BILL_LIMITS.competitionHubs.max
    ),
    includeFestivalPass: input.includeFestivalPass,
  };
}

function priceOneCompetition(
  c: CompetitionDraft,
  index: number,
  playerCount?: number | null
) {
  const rates = LEAGUE_BILL_RATES;
  const planning =
    playerCount != null ? Math.max(0, Math.round(playerCount)) : planningPlayersForCap(c.maxPlayers);
  const platformRate = platformRateForCap(c.maxPlayers);
  const factor = index === 0 ? 1 : rates.multiCompFactor;
  const modeLabel = FOOTBALL_MODE_OPTIONS.find((m) => m.key === c.footballMode)?.label ?? c.footballMode;

  const breakdown: LeagueBillLine[] = [];
  const notes: string[] = [];

  const platformFee = roundMoney(planning * platformRate);
  breakdown.push({
    label: 'Platform fee',
    amount: platformFee,
    detail:
      playerCount != null
        ? `${planning} actual players × ${formatEuro(platformRate)}/player`
        : `${planning} players (75% of ${c.maxPlayers}) × ${formatEuro(platformRate)}/player`,
  });

  const adsOff = roundMoney(planning * rates.adsOffPerPlayer);
  breakdown.push({
    label: 'Ads removed for this competition',
    amount: adsOff,
    detail: `${planning} × ${formatEuro(rates.adsOffPerPlayer)}/player`,
  });

  let continuationLabel = 'None';
  let continuationFee = 0;

  if (c.footballMode === 'tipster20') {
    continuationFee += rates.tipster20Premium;
    breakdown.push({
      label: 'Tipster20 mode',
      amount: rates.tipster20Premium,
      detail: 'Race to 20 goalscorers',
    });
    if (c.tipster20Continuation === 'allow_split_pot') {
      continuationLabel = 'Allow split pot';
      notes.push('Split pot allowed if several players reach 20 together.');
    } else if (c.tipster20Continuation === 'playoff_until_sole') {
      continuationLabel = 'Playoff until sole winner';
      continuationFee += rates.playoffUntilSole;
      breakdown.push({
        label: 'Playoff until sole winner',
        amount: rates.playoffUntilSole,
      });
      notes.push('Tied Tipster20 leaders continue until one sole winner.');
    } else {
      continuationLabel = 'No special rule';
    }
  } else if (c.lmsContinuation === 'full_rollover') {
    continuationLabel = 'Full rollover';
    continuationFee += rates.fullRollover;
    breakdown.push({
      label: 'Full rollover included',
      amount: rates.fullRollover,
      detail: 'One rejoin season covered if the field is wiped out',
    });
    notes.push('Full rollover rejoin included if the field is wiped out.');
  } else if (c.lmsContinuation === 'mass_wipeout_revive') {
    continuationLabel = 'Mass wipeout revive';
    continuationFee += rates.massWipeoutRevive;
    breakdown.push({
      label: 'Mass wipeout revive included',
      amount: rates.massWipeoutRevive,
      detail: 'Same-GW wipeout → those players revive; used teams stay locked',
    });
    notes.push(
      'Mass wipeout revive: only those eliminated together revive; used teams stay locked including the losing pick.'
    );
  } else {
    continuationLabel = 'No continuation';
    notes.push('No automatic LMS continuation after a wipeout.');
  }

  const preCushion = roundMoney(
    breakdown.reduce((sum, line) => sum + line.amount, 0)
  );
  const { total: afterCushion, cushion } = applyCushion(preCushion);
  if (cushion > 0) {
    breakdown.push({
      label: 'Package cushion',
      amount: cushion,
      detail: `Rounds to a clear club price (min +${formatEuro(rates.minCushion)}, then next €5)`,
    });
  }

  let amount = afterCushion;
  if (factor < 1) {
    const discounted = roundMoney(amount * factor);
    const saving = roundMoney(amount - discounted);
    breakdown.push({
      label: 'Extra competition discount',
      amount: -saving,
      detail: `${Math.round((1 - factor) * 100)}% off when this is not the first comp in the package`,
    });
    amount = discounted;
  }

  notes.push(
    `Platform rate ${formatEuro(platformRate)}/player (starts at ${formatEuro(rates.platformPerPlayerStart)}, −€0.01 per +50 on cap, floor ${formatEuro(rates.platformPerPlayerFloor)}).`
  );
  notes.push(`Assumed ${ASSUMED_SEASON_WEEKS}-week season for pricing.`);

  return {
    amount,
    planningPlayers: planning,
    platformRate,
    continuationLabel,
    notes,
    title: `${modeLabel} #${index + 1}`,
    breakdown,
    modeLabel,
  };
}

export function calculateLeagueBill(raw: LeagueBillInput): LeagueBillQuote {
  const input = clampLeagueBillInput(raw);
  const rates = LEAGUE_BILL_RATES;
  const lines: LeagueBillLine[] = [];
  const competitionSummaries: LeagueBillQuote['competitionSummaries'] = [];

  input.competitions.forEach((c, index) => {
    const priced = priceOneCompetition(c, index);
    competitionSummaries.push({
      id: c.id,
      title: priced.title,
      planningPlayers: priced.planningPlayers,
      platformRate: priced.platformRate,
      amount: priced.amount,
      continuationLabel: priced.continuationLabel,
      notes: priced.notes,
      breakdown: priced.breakdown,
    });
    lines.push({
      label: `${priced.modeLabel} · cap ${c.maxPlayers} · ${priced.continuationLabel}`,
      amount: priced.amount,
      detail: `75% = ${priced.planningPlayers} × ${formatEuro(priced.platformRate)} + ads-off + cushion`,
    });
  });

  if (input.includeFestivalPass) {
    lines.push({
      label: '1 racing festival pass (named meeting)',
      amount: rates.festivalPass,
    });
  }

  const seasonTotal = roundMoney(lines.reduce((sum, line) => sum + line.amount, 0));
  const hubDepositTotal = input.competitionHubs * rates.hubDeposit;
  const hubMonthlyTotal = input.competitionHubs * rates.hubMonthly;

  const dueTodayLines: LeagueBillLine[] = [];
  if (input.competitionHubs > 0) {
    dueTodayLines.push({
      label: `${input.competitionHubs} competition hub${input.competitionHubs === 1 ? '' : 's'} · deposit (refundable)`,
      amount: hubDepositTotal,
    });
    dueTodayLines.push({
      label: `${input.competitionHubs} hub${input.competitionHubs === 1 ? '' : 's'} · first month rental`,
      amount: hubMonthlyTotal,
    });
  }

  return {
    seasonTotal,
    hubDepositTotal,
    hubMonthlyTotal,
    dueToday: roundMoney(seasonTotal + hubDepositTotal + hubMonthlyTotal),
    assumedSeasonWeeks: ASSUMED_SEASON_WEEKS,
    lines,
    dueTodayLines,
    competitionSummaries,
    recommendedCaps: {
      competitions: input.competitions.map((c) => ({
        football_mode: c.footballMode,
        max_participants: c.maxPlayers,
        continuation:
          c.footballMode === 'lms' ? c.lmsContinuation : c.tipster20Continuation,
      })),
      max_concurrent_creates: 1,
      kiosk_licenses_count: input.competitionHubs,
      include_festival_pass: input.includeFestivalPass,
      assumed_season_weeks: ASSUMED_SEASON_WEEKS,
    },
  };
}

/**
 * Estimate pricing using actual joined users instead of the “75% of cap” planning players.
 * Used by Owner admin to show expected cost for a gamemaster’s actual quota usage.
 */
export function estimateLeagueBillFromActualPlayers(
  raw: LeagueBillInput,
  playerCountFor: (c: CompetitionDraft, index: number) => number | null | undefined
): LeagueBillQuote {
  const input = clampLeagueBillInput(raw);
  const lines: LeagueBillLine[] = [];
  const competitionSummaries: LeagueBillQuote['competitionSummaries'] = [];

  input.competitions.forEach((c, index) => {
    const actualPlayers = playerCountFor(c, index);
    const priced = priceOneCompetition(c, index, actualPlayers);

    competitionSummaries.push({
      id: c.id,
      title: priced.title,
      planningPlayers: priced.planningPlayers,
      platformRate: priced.platformRate,
      amount: priced.amount,
      continuationLabel: priced.continuationLabel,
      notes: priced.notes,
      breakdown: priced.breakdown,
    });

    lines.push({
      label: `${priced.modeLabel} · cap ${c.maxPlayers} · ${priced.continuationLabel}`,
      amount: priced.amount,
      detail: `${priced.planningPlayers} actual × ${formatEuro(priced.platformRate)} + ads-off + cushion`,
    });
  });

  if (input.includeFestivalPass) {
    lines.push({
      label: '1 racing festival pass (named meeting)',
      amount: LEAGUE_BILL_RATES.festivalPass,
    });
  }

  const seasonTotal = roundMoney(lines.reduce((sum, line) => sum + line.amount, 0));
  const hubDepositTotal = input.competitionHubs * LEAGUE_BILL_RATES.hubDeposit;
  const hubMonthlyTotal = input.competitionHubs * LEAGUE_BILL_RATES.hubMonthly;

  const dueTodayLines: LeagueBillLine[] = [];
  if (input.competitionHubs > 0) {
    dueTodayLines.push({
      label: `${input.competitionHubs} competition hub${input.competitionHubs === 1 ? '' : 's'} · deposit (refundable)`,
      amount: hubDepositTotal,
    });
    dueTodayLines.push({
      label: `${input.competitionHubs} hub${input.competitionHubs === 1 ? '' : 's'} · first month rental`,
      amount: hubMonthlyTotal,
    });
  }

  return {
    seasonTotal,
    hubDepositTotal,
    hubMonthlyTotal,
    dueToday: roundMoney(seasonTotal + hubDepositTotal + hubMonthlyTotal),
    assumedSeasonWeeks: ASSUMED_SEASON_WEEKS,
    lines,
    dueTodayLines,
    competitionSummaries,
    recommendedCaps: {
      competitions: input.competitions.map((c) => ({
        football_mode: c.footballMode,
        max_participants: c.maxPlayers,
        continuation:
          c.footballMode === 'lms' ? c.lmsContinuation : c.tipster20Continuation,
      })),
      max_concurrent_creates: 1,
      kiosk_licenses_count: input.competitionHubs,
      include_festival_pass: input.includeFestivalPass,
      assumed_season_weeks: ASSUMED_SEASON_WEEKS,
    },
  };
}

export function formatEuro(amount: number): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '−' : '';
  return `${sign}€${abs.toFixed(2)}`;
}

export const PUBLIC_CREATOR_TIER_PRICES = {
  creator: 4.99,
  creator_plus: 11.99,
  creator_pro: 21.99,
} as const;

export function formatPublicCreatorPrice(tier: keyof typeof PUBLIC_CREATOR_TIER_PRICES): string {
  return `€${PUBLIC_CREATOR_TIER_PRICES[tier].toFixed(2)}/mo`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function snap(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
