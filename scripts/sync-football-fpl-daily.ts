import 'dotenv/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  fplGet,
  loadLmsTeams,
  matchLmsTeam,
  normalizeFootballPosition,
} from './football-sync/helpers';
import { evaluateFplAutoExclude } from './football-sync/fplAutoExclude';

/**
 * Daily FPL bootstrap sync: picker_stats + injury/availability hints on football_players.
 *
 * Auto-excludes (owner_flagged) when:
 * - FPL status is "u" (Unavailable), or
 * - news has unknown return date and 0% chance this + next GW, or
 * - news expected return is 4+ weeks (28+ days) away.
 *
 * Every run re-reads FPL news/chances for all elements, updates picker_stats when
 * notes differ, and re-checks return dates so auto-flags can clear if a player
 * moves inside the 4-week window. Manual owner flags (owner_flagged_by set) are kept.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const UPSERT_CHUNK = 100;

type FplElement = {
  id: number;
  web_name: string;
  first_name: string;
  second_name: string;
  team: number;
  element_type: number;
  status: string;
  news: string;
  chance_of_playing_this_round?: number | null;
  chance_of_playing_next_round?: number | null;
  news_added?: string | null;
  minutes: number;
  starts: number;
  goals_scored: number;
  assists: number;
  form: string;
  selected_by_percent: string;
  ict_index: string;
  expected_goals?: string;
  expected_assists?: string;
  points_per_game: string;
  removed: boolean;
};

type FplBootstrap = {
  elements: FplElement[];
  teams: Array<{ id: number; name: string; short_name: string; code: number }>;
};

type PickerStats = Record<string, unknown>;

type DbPlayer = {
  id: string;
  fpl_element_id: number | null;
  team_id: string;
  display_name: string;
  full_name: string;
  position: string | null;
  is_active: boolean;
  picker_stats: PickerStats;
  owner_flagged: boolean;
  owner_flagged_at: string | null;
  owner_flagged_by: string | null;
};

type DesiredRow = {
  team_id: string;
  display_name: string;
  full_name: string;
  position: string | null;
  is_active: boolean;
  picker_stats: PickerStats;
  fpl_element_id: number;
  owner_flagged: boolean;
  owner_flagged_at?: string | null;
  owner_flagged_by?: string | null;
};

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function buildPickerStats(
  el: FplElement,
  decision: ReturnType<typeof evaluateFplAutoExclude>
): PickerStats {
  return {
    season_goals: el.goals_scored,
    season_assists: el.assists,
    form: el.form,
    minutes: el.minutes,
    starts: el.starts,
    selected_by_percent: el.selected_by_percent,
    ict_index: el.ict_index,
    expected_goals: el.expected_goals ?? null,
    expected_assists: el.expected_assists ?? null,
    points_per_game: el.points_per_game,
    news: el.news ?? '',
    fpl_status: el.status,
    chance_of_playing_this_round: el.chance_of_playing_this_round ?? null,
    chance_of_playing_next_round: el.chance_of_playing_next_round ?? null,
    news_added: el.news_added ?? null,
    expected_return_date: decision.expectedReturnDate,
    days_until_return: decision.daysUntilReturn,
    auto_exclude_reason: decision.reason,
  };
}

function buildDesired(el: FplElement, teamId: string, existing?: DbPlayer | null): DesiredRow {
  const display = el.web_name?.trim() || `${el.first_name} ${el.second_name}`.trim();
  const fullName = `${el.first_name} ${el.second_name}`.trim();
  const decision = evaluateFplAutoExclude({
    status: el.status,
    news: el.news,
    chance_of_playing_this_round: el.chance_of_playing_this_round,
    chance_of_playing_next_round: el.chance_of_playing_next_round,
  });

  const manuallyFlagged =
    existing?.owner_flagged === true && existing.owner_flagged_by != null;
  const ownerFlagged = manuallyFlagged || decision.exclude;

  const row: DesiredRow = {
    team_id: teamId,
    display_name: display,
    full_name: fullName,
    position: normalizeFootballPosition(null, el.element_type),
    is_active: !el.removed,
    picker_stats: buildPickerStats(el, decision),
    fpl_element_id: el.id,
    owner_flagged: ownerFlagged,
  };

  if (manuallyFlagged) {
    return row;
  }

  if (decision.exclude) {
    if (existing?.owner_flagged !== true) {
      row.owner_flagged_at = new Date().toISOString();
      row.owner_flagged_by = null;
    } else {
      // Already auto-flagged — keep timestamp, ensure by stays system/null.
      row.owner_flagged_by = null;
    }
  } else if (existing?.owner_flagged === true && existing.owner_flagged_by == null) {
    row.owner_flagged = false;
    row.owner_flagged_at = null;
    row.owner_flagged_by = null;
  }

  return row;
}

function nameKey(teamId: string, displayName: string): string {
  return `${teamId}::${displayName.trim().toLowerCase()}`;
}

function displayNameForMatch(el: FplElement): string {
  return el.web_name?.trim() || `${el.first_name} ${el.second_name}`.trim();
}

function rowNeedsUpdate(existing: DbPlayer, desired: DesiredRow): boolean {
  if (existing.team_id !== desired.team_id) return true;
  if (existing.display_name !== desired.display_name) return true;
  if (existing.full_name !== desired.full_name) return true;
  if (existing.position !== desired.position) return true;
  if (existing.is_active !== desired.is_active) return true;
  if (existing.fpl_element_id !== desired.fpl_element_id) return true;
  if (stableJson(existing.picker_stats) !== stableJson(desired.picker_stats)) return true;
  if (desired.owner_flagged !== existing.owner_flagged) return true;
  if (
    desired.owner_flagged_at !== undefined &&
    desired.owner_flagged_at !== existing.owner_flagged_at
  ) {
    return true;
  }
  if (
    desired.owner_flagged_by !== undefined &&
    desired.owner_flagged_by !== existing.owner_flagged_by
  ) {
    return true;
  }
  return false;
}

async function writeChunks<T extends Record<string, unknown>>(
  supabase: SupabaseClient,
  table: string,
  rows: T[],
  onConflict?: string
) {
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const q = supabase.from(table);
    const { error } = onConflict
      ? await q.upsert(chunk, { onConflict })
      : await q.insert(chunk);
    if (error) throw error;
  }
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY');
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const lmsTeams = await loadLmsTeams(supabase);

  console.log('[fpl-daily] Fetching bootstrap-static…');
  const boot = await fplGet<FplBootstrap>('/bootstrap-static/');

  const fplTeamToLms = new Map<number, string>();
  for (const ft of boot.teams ?? []) {
    const m = matchLmsTeam(lmsTeams, ft.name, ft.short_name);
    if (m) fplTeamToLms.set(ft.id, m.id);
  }

  console.log('[fpl-daily] Loading football_players (bulk read)…');
  const { data: dbRows, error: dbErr } = await supabase
    .from('football_players')
    .select(
      'id, fpl_element_id, team_id, display_name, full_name, position, is_active, picker_stats, owner_flagged, owner_flagged_at, owner_flagged_by'
    );
  if (dbErr) throw dbErr;

  const byFplId = new Map<number, DbPlayer>();
  const byName = new Map<string, DbPlayer>();
  for (const row of (dbRows ?? []) as DbPlayer[]) {
    if (row.fpl_element_id != null) byFplId.set(row.fpl_element_id, row);
    byName.set(nameKey(row.team_id, row.display_name), row);
  }

  const toInsert: DesiredRow[] = [];
  const toUpdate: Array<DesiredRow & { id: string; updated_at: string }> = [];
  let skipped = 0;
  let autoExcludeCount = 0;
  let autoCleared = 0;
  const reasonCounts = new Map<string, number>();

  for (const el of boot.elements ?? []) {
    const teamId = fplTeamToLms.get(el.team);
    if (!teamId) continue;

    const existing =
      byFplId.get(el.id) ?? byName.get(nameKey(teamId, displayNameForMatch(el)));
    const desired = buildDesired(el, teamId, existing);

    const reason =
      typeof desired.picker_stats.auto_exclude_reason === 'string'
        ? (desired.picker_stats.auto_exclude_reason as string)
        : null;
    if (reason) {
      autoExcludeCount += 1;
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    }
    if (
      existing?.owner_flagged === true &&
      existing.owner_flagged_by == null &&
      desired.owner_flagged === false
    ) {
      autoCleared += 1;
    }

    if (!existing) {
      toInsert.push(desired);
      continue;
    }

    if (!rowNeedsUpdate(existing, desired)) {
      skipped += 1;
      continue;
    }

    toUpdate.push({
      id: existing.id,
      ...desired,
      updated_at: new Date().toISOString(),
    });
  }

  if (toInsert.length > 0) {
    console.log(`[fpl-daily] Inserting ${toInsert.length} new players…`);
    await writeChunks(supabase, 'football_players', toInsert);
  }

  if (toUpdate.length > 0) {
    console.log(`[fpl-daily] Updating ${toUpdate.length} changed players…`);
    await writeChunks(supabase, 'football_players', toUpdate, 'id');
  }

  const reasonSummary = [...reasonCounts.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');

  console.log(
    `[fpl-daily] FPL elements: ${boot.elements?.length ?? 0}; ` +
      `inserted: ${toInsert.length}; updated: ${toUpdate.length}; ` +
      `unchanged: ${skipped}; auto-exclude: ${autoExcludeCount}` +
      (reasonSummary ? ` (${reasonSummary})` : '') +
      `; auto-cleared: ${autoCleared}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
