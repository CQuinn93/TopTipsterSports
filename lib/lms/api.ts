import { supabase } from '@/lib/supabase';
import { subscriptionErrorMessage } from '@/lib/subscriptionEntitlements';
import { invalidJoinCodeMessage } from '@/lib/joinCodeMessages';

/** Untyped client for LMS tables/RPCs not yet in generated Database types. */
const db = supabase as any;

export type LmsCompetitionRow = {
  competition_id: string;
  name: string;
  season: string;
  competition_status: string;
  participant_status: string;
  joined_at: string;
  rollover_count: number;
  start_gameweek_id?: string | null;
  start_gameweek_number?: number | null;
  created_by_user_id?: string | null;
  is_creator?: boolean;
  can_manage?: boolean;
};

export type LmsPendingJoin = {
  competition_id: string;
  name: string;
  season: string;
  requested_at: string;
};

export type LmsTeam = {
  id: string;
  name: string;
  short_name: string;
  slug: string;
  /** @deprecated UI uses colour chips; kept for a possible future crest restore. */
  crest_url?: string | null;
};

export type LmsGameweek = {
  id: string;
  season: string;
  number: number;
  deadline_at: string;
  starts_at: string;
  status: string;
};

export type LmsFixture = {
  id: string;
  gameweek_id: string;
  home_team_id: string;
  away_team_id: string;
  kickoff_at: string;
  home_goals: number | null;
  away_goals: number | null;
  status: string;
  home_team?: LmsTeam;
  away_team?: LmsTeam;
  gameweek_number?: number;
  excluded_from_lms?: boolean;
  excluded_reason?: string | null;
};

export type LmsParticipant = {
  id: string;
  competition_id: string;
  user_id: string;
  status: string;
  eliminated_gameweek_id: string | null;
  joined_at: string;
  rollover_count: number;
  username?: string | null;
  lives_remaining?: number;
};

export type LmsPick = {
  id: string;
  competition_id: string;
  user_id: string;
  gameweek_id: string;
  team_id: string;
  result: string;
  team?: LmsTeam;
};

export type LmsLeagueTableRow = {
  position: number;
  team_id: string;
  name: string;
  short_name: string;
  slug: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  gd: number;
  points: number;
};

export type LmsLeagueTable = {
  success: boolean;
  error?: string;
  season: string;
  computed_at: string;
  rows: LmsLeagueTableRow[];
};

function asArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  return [];
}

export async function lmsListMyCompetitions(): Promise<LmsCompetitionRow[]> {
  const { data, error } = await db.rpc('lms_list_my_competitions');
  if (error) throw error;
  return asArray<LmsCompetitionRow>(data);
}

export async function lmsListMyPendingJoins(): Promise<LmsPendingJoin[]> {
  const { data, error } = await db.rpc('lms_list_my_pending_joins');
  if (error) throw error;
  return asArray<LmsPendingJoin>(data);
}

export async function lmsRequestJoin(accessCode: string): Promise<{
  success: boolean;
  error?: string;
  competition_name?: string;
  competition_id?: string;
  status?: string;
  join_request_id?: string;
}> {
  const { data, error } = await db.rpc('lms_request_join', {
    p_access_code: accessCode.trim().toUpperCase(),
  });
  if (error) throw error;
  const result = (data ?? { success: false, error: 'unknown' }) as {
    success: boolean;
    error?: string;
    competition_name?: string;
    competition_id?: string;
    status?: string;
    join_request_id?: string;
  };

  if (result.success) {
    let joinRequestId = result.join_request_id ?? null;
    // Fallback if migration 074 not applied yet (RPC may omit join_request_id).
    if (!joinRequestId && result.competition_id) {
      const { data: sessionData } = await supabase.auth.getSession();
      const uid = sessionData.session?.user?.id;
      if (uid) {
        const { data: jr } = await db
          .from('lms_join_requests')
          .select('id')
          .eq('competition_id', result.competition_id)
          .eq('user_id', uid)
          .eq('status', 'pending')
          .maybeSingle();
        joinRequestId = (jr as { id?: string } | null)?.id ?? null;
      }
    }
    if (joinRequestId) {
      result.join_request_id = joinRequestId;
      void supabase.functions
        .invoke('notify-lms-join-request', {
          body: { join_request_id: joinRequestId },
        })
        .then(({ data: fnData, error: fnErr }) => {
          if (fnErr) console.warn('[lms] notify-lms-join-request', fnErr.message);
          else console.log('[lms] notify-lms-join-request', fnData);
        })
        .catch((e) => {
          console.warn('[lms] notify-lms-join-request failed', e);
        });
    } else {
      console.warn('[lms] join succeeded but no join_request_id to notify with');
    }
  }

  return result;
}

export async function lmsSubmitPick(params: {
  competitionId: string;
  gameweekId: string;
  teamId: string;
}): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await db.rpc('lms_submit_pick', {
    p_competition_id: params.competitionId,
    p_gameweek_id: params.gameweekId,
    p_team_id: params.teamId,
  });
  if (error) throw error;
  return (data ?? { success: false, error: 'unknown' }) as { success: boolean; error?: string };
}

export type LmsCompetition = {
  id: string;
  name: string;
  season: string;
  status: string;
  created_at: string;
  start_gameweek_id: string | null;
  entry?: string | null;
  extra_lives?: number;
};

export type LmsCompletedPick = {
  user_id: string;
  gameweek_id: string;
  gameweek_number: number;
  team_id: string;
  result: string;
  team?: LmsTeam;
};

export async function lmsGetCompetition(competitionId: string): Promise<LmsCompetition | null> {
  const { data, error } = await db
    .from('lms_competitions')
    .select('id, name, season, status, created_at, start_gameweek_id, entry, extra_lives')
    .eq('id', competitionId)
    .maybeSingle();
  if (error) throw error;
  return data as LmsCompetition | null;
}

async function resolveStartGameweekMeta(
  startGameweekId: string | null | undefined
): Promise<{ minNumber: number; startsAt: string | null }> {
  if (!startGameweekId) return { minNumber: 1, startsAt: null };
  const { data: startGw, error: startErr } = await supabase
    .from('lms_gameweeks')
    .select('number, starts_at')
    .eq('id', startGameweekId)
    .maybeSingle();
  if (startErr) throw startErr;
  if (!startGw) return { minNumber: 1, startsAt: null };
  return {
    minNumber: (startGw as { number: number }).number,
    startsAt: (startGw as { starts_at: string }).starts_at,
  };
}

/** First incomplete gameweek at or after the competition start week. */
export async function lmsGetCompetitionCurrentGameweek(
  competitionId: string,
  /** Pass a preloaded competition to avoid a duplicate REST fetch. */
  preloadedCompetition?: LmsCompetition | null
): Promise<{ gameweek: LmsGameweek | null; startGameweekNumber: number | null; startsAt: string | null }> {
  const comp = preloadedCompetition ?? (await lmsGetCompetition(competitionId));
  if (!comp) return { gameweek: null, startGameweekNumber: null, startsAt: null };

  const { minNumber, startsAt } = await resolveStartGameweekMeta(comp.start_gameweek_id);

  const { data, error } = await supabase
    .from('lms_gameweeks')
    .select('*')
    .eq('season', comp.season)
    .gte('number', minNumber)
    .neq('status', 'complete')
    .order('number', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return {
    gameweek: (data as LmsGameweek | null) ?? null,
    startGameweekNumber: comp.start_gameweek_id ? minNumber : null,
    startsAt,
  };
}

export async function lmsListCompetitionGameweeks(
  competitionId: string,
  preloadedCompetition?: LmsCompetition | null
): Promise<LmsGameweek[]> {
  const comp = preloadedCompetition ?? (await lmsGetCompetition(competitionId));
  if (!comp) return [];

  const { minNumber } = await resolveStartGameweekMeta(comp.start_gameweek_id);

  const { data, error } = await supabase
    .from('lms_gameweeks')
    .select('*')
    .eq('season', comp.season)
    .gte('number', minNumber)
    .order('number', { ascending: true });
  if (error) throw error;
  return (data ?? []) as LmsGameweek[];
}

function mapEmbeddedTeam(row: unknown): LmsTeam | undefined {
  if (!row || typeof row !== 'object') return undefined;
  return row as LmsTeam;
}

/** True when cached fixtures may be missing live/finished scores. */
export function lmsFixturesNeedRefresh(fixtures: LmsFixture[]): boolean {
  if (!fixtures.length) return true;
  const now = Date.now();
  return fixtures.some((f) => {
    if (f.excluded_from_lms) return false;
    const ko = new Date(f.kickoff_at).getTime();
    const kickedOff = !Number.isNaN(ko) && ko <= now;
    if (f.status === 'live') return true;
    if (f.status !== 'finished' && kickedOff) return true;
    if (f.status === 'finished' && (f.home_goals == null || f.away_goals == null)) return true;
    return false;
  });
}

/** Gameweeks tab default: last completed week between GWs, otherwise live/current. */
export function lmsDefaultGameweekFilterId(
  gameweeks: LmsGameweek[],
  currentId: string | null
): string | null {
  const current = currentId ? gameweeks.find((g) => g.id === currentId) ?? null : null;
  if (current?.status === 'live') return current.id;
  const lastComplete = [...gameweeks]
    .filter((g) => g.status === 'complete')
    .sort((a, b) => b.number - a.number)[0];
  if (current?.status === 'upcoming' && lastComplete) return lastComplete.id;
  return current?.id ?? lastComplete?.id ?? gameweeks[0]?.id ?? null;
}

function mapFixtureWithTeams(row: Record<string, unknown>): LmsFixture {
  const home = mapEmbeddedTeam(row.home_team);
  const away = mapEmbeddedTeam(row.away_team);
  const gw = row.gameweek as { number?: number } | null | undefined;
  const { home_team: _h, away_team: _a, gameweek: _g, ...rest } = row;
  return {
    ...(rest as unknown as LmsFixture),
    home_team: home,
    away_team: away,
    gameweek_number: gw?.number ?? (rest as { gameweek_number?: number }).gameweek_number,
  };
}

export async function lmsGetMyParticipant(competitionId: string, userId: string) {
  const { data, error } = await supabase
    .from('lms_participants')
    .select('*')
    .eq('competition_id', competitionId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data as LmsParticipant | null;
}

export async function lmsListParticipants(competitionId: string): Promise<LmsParticipant[]> {
  const { data, error } = await supabase
    .from('lms_participants')
    .select('id, competition_id, user_id, status, eliminated_gameweek_id, joined_at, rollover_count, lives_remaining')
    .eq('competition_id', competitionId)
    .order('joined_at', { ascending: true });
  if (error) throw error;
  const rows = (data ?? []) as LmsParticipant[];
  if (!rows.length) return [];

  const userIds = rows.map((r) => r.user_id);
  const { data: profiles } = await db.from('profiles').select('id, username').in('id', userIds);
  const nameById = new Map<string, string | null>(
    ((profiles ?? []) as { id: string; username: string | null }[]).map((p) => [p.id, p.username])
  );
  return rows.map((r) => ({ ...r, username: nameById.get(r.user_id) ?? null }));
}

export async function lmsListTeams(): Promise<LmsTeam[]> {
  const { data, error } = await db.from('lms_teams').select('*').order('name');
  if (error) throw error;
  return (data ?? []) as LmsTeam[];
}

/** Fixtures from gameweeks that matter for form dots (complete / live / current).
 * Avoids `order by number desc limit 6`, which early in the season returns GW33–38
 * with no finished matches while GW1 already has results. */
export async function lmsListRecentFinishedFixtures(
  season = '2026/27',
  gameweekLimit = 6
): Promise<LmsFixture[]> {
  type GwRow = { id: string; number: number; status: string };
  const byId = new Map<string, GwRow>();

  const { data: playedGws, error: playedErr } = await supabase
    .from('lms_gameweeks')
    .select('id, number, status')
    .eq('season', season)
    .in('status', ['complete', 'live'])
    .order('number', { ascending: false })
    .limit(gameweekLimit);
  if (playedErr) throw playedErr;
  for (const g of (playedGws ?? []) as GwRow[]) byId.set(g.id, g);

  // Mid-week / first week: include the open upcoming GW so FT results count before settle.
  if (byId.size < gameweekLimit) {
    const { data: openGw, error: openErr } = await supabase
      .from('lms_gameweeks')
      .select('id, number, status')
      .eq('season', season)
      .eq('status', 'upcoming')
      .order('number', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (openErr) throw openErr;
    if (openGw) byId.set((openGw as GwRow).id, openGw as GwRow);
  }

  // Fallback: start of season before any week is live/complete — take earliest weeks.
  if (byId.size === 0) {
    const { data: earlyGws, error: earlyErr } = await supabase
      .from('lms_gameweeks')
      .select('id, number, status')
      .eq('season', season)
      .order('number', { ascending: true })
      .limit(gameweekLimit);
    if (earlyErr) throw earlyErr;
    for (const g of (earlyGws ?? []) as GwRow[]) byId.set(g.id, g);
  }

  const gws = [...byId.values()].sort((a, b) => b.number - a.number).slice(0, gameweekLimit);
  if (!gws.length) return [];

  const gwIds = gws.map((g) => g.id);
  const numberById = new Map(gws.map((g) => [g.id, g.number]));
  const fixtures = await lmsListFixturesForGameweekIds(gwIds);
  return fixtures.map((f) => ({
    ...f,
    gameweek_number: numberById.get(f.gameweek_id) ?? f.gameweek_number,
  }));
}

async function lmsListFixturesForGameweekIds(gwIds: string[]): Promise<LmsFixture[]> {
  if (!gwIds.length) return [];
  const embedded = await db
    .from('lms_fixtures')
    .select(
      '*, home_team:lms_teams!home_team_id(*), away_team:lms_teams!away_team_id(*)'
    )
    .in('gameweek_id', gwIds)
    .order('kickoff_at', { ascending: true });

  if (!embedded.error) {
    return ((embedded.data ?? []) as Record<string, unknown>[]).map(mapFixtureWithTeams);
  }

  const { data, error } = await supabase
    .from('lms_fixtures')
    .select('*')
    .in('gameweek_id', gwIds)
    .order('kickoff_at', { ascending: true });
  if (error) throw error;
  const fixtures = (data ?? []) as LmsFixture[];
  if (!fixtures.length) return [];
  const teamIds = Array.from(
    new Set(fixtures.flatMap((f) => [f.home_team_id, f.away_team_id]))
  );
  const { data: teams } = await db.from('lms_teams').select('*').in('id', teamIds);
  const byId = new Map(((teams ?? []) as LmsTeam[]).map((t) => [t.id, t]));
  return fixtures.map((f) => ({
    ...f,
    home_team: byId.get(f.home_team_id),
    away_team: byId.get(f.away_team_id),
  }));
}

export async function lmsListUsedTeamIds(competitionId: string, userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('lms_used_teams')
    .select('team_id')
    .eq('competition_id', competitionId)
    .eq('user_id', userId);
  if (error) throw error;
  return ((data ?? []) as { team_id: string }[]).map((r) => r.team_id);
}

export async function lmsListCompetitionTeamIds(competitionId: string): Promise<string[]> {
  const { data, error } = await db
    .from('lms_competition_teams')
    .select('team_id')
    .eq('competition_id', competitionId);
  if (error) throw error;
  return ((data ?? []) as { team_id: string }[]).map((r) => r.team_id);
}

export async function lmsIsProfileAdmin(userId: string): Promise<boolean> {
  const { data, error } = await db
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  const role = (data as { role?: string | null } | null)?.role;
  return role === 'Admin' || role === 'Owner';
}

export async function lmsAdminSetCompetitionTeam(
  competitionId: string,
  teamId: string,
  enabled: boolean
): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await db.rpc('lms_admin_set_competition_team', {
    p_competition_id: competitionId,
    p_team_id: teamId,
    p_enabled: enabled,
  });
  if (error) throw error;
  return (data ?? { success: false, error: 'unknown' }) as { success: boolean; error?: string };
}

export async function lmsAdminSetFixtureExcluded(
  fixtureId: string,
  excluded: boolean,
  reason?: string | null
): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await db.rpc('lms_admin_set_fixture_excluded', {
    p_fixture_id: fixtureId,
    p_excluded: excluded,
    p_reason: reason ?? null,
  });
  if (error) throw error;
  return (data ?? { success: false, error: 'unknown' }) as { success: boolean; error?: string };
}

export async function lmsAdminDeleteCompetition(
  competitionId: string
): Promise<{ success: boolean; error?: string; name?: string }> {
  const { data, error } = await db.rpc('lms_admin_delete_competition', {
    p_competition_id: competitionId,
  });
  if (error) throw error;
  return (data ?? { success: false, error: 'unknown' }) as {
    success: boolean;
    error?: string;
    name?: string;
  };
}

export type LmsStandingBoard = {
  success: boolean;
  competition_id?: string;
  pool_teams: LmsTeam[];
  picks: LmsCompletedPick[];
  error?: string;
};

/** Between-gameweek Standing: pool + all players’ completed picks in one RPC (with client fallback). */
export async function lmsGetStandingBoard(
  competitionId: string,
  preloadedCompetition?: LmsCompetition | null
): Promise<LmsStandingBoard> {
  try {
    const { data, error } = await db.rpc('lms_get_standing_board', {
      p_competition_id: competitionId,
    });
    if (!error && data) {
      const raw = data as {
        success?: boolean;
        competition_id?: string;
        error?: string;
        pool_teams?: LmsTeam[];
        picks?: Array<LmsCompletedPick & { team?: LmsTeam | null }>;
      };
      if (raw.success !== false) {
        return {
          success: true,
          competition_id: raw.competition_id ?? competitionId,
          pool_teams: (raw.pool_teams ?? []) as LmsTeam[],
          picks: (raw.picks ?? []).map((p) => ({
            user_id: p.user_id,
            gameweek_id: p.gameweek_id,
            gameweek_number: Number(p.gameweek_number ?? 0),
            team_id: p.team_id,
            result: p.result,
            team: p.team ?? undefined,
          })),
          error: raw.error,
        };
      }
    }
  } catch {
    /* fall through to composed queries if RPC not applied yet */
  }

  const [picks, poolIds, allTeams] = await Promise.all([
    lmsListCompletedPicks(competitionId, preloadedCompetition),
    lmsListCompetitionTeamIds(competitionId),
    lmsListTeams(),
  ]);
  const byId = new Map(allTeams.map((t) => [t.id, t]));
  return {
    success: true,
    competition_id: competitionId,
    pool_teams: poolIds
      .map((id) => byId.get(id))
      .filter((t): t is LmsTeam => !!t)
      .sort((a, b) =>
        (a.short_name || a.name).localeCompare(b.short_name || b.name, undefined, {
          sensitivity: 'base',
        })
      ),
    picks,
  };
}

/** Picks from completed gameweeks for the whole competition (for leaderboard history drawers). */
export async function lmsListCompletedPicks(
  competitionId: string,
  preloadedCompetition?: LmsCompetition | null
): Promise<LmsCompletedPick[]> {
  const comp = preloadedCompetition ?? (await lmsGetCompetition(competitionId));
  if (!comp) return [];

  const { data: completeGws, error: gwErr } = await supabase
    .from('lms_gameweeks')
    .select('id, number')
    .eq('season', comp.season)
    .eq('status', 'complete')
    .order('number', { ascending: true });
  if (gwErr) throw gwErr;
  const gws = (completeGws ?? []) as { id: string; number: number }[];
  if (!gws.length) return [];

  const gwIds = gws.map((g) => g.id);
  const numberById = new Map(gws.map((g) => [g.id, g.number]));

  const { data, error } = await db
    .from('lms_picks')
    .select('user_id, gameweek_id, team_id, result, team:lms_teams(*)')
    .eq('competition_id', competitionId)
    .in('gameweek_id', gwIds);
  if (error) throw error;
  const rows = (data ?? []) as {
    user_id: string;
    gameweek_id: string;
    team_id: string;
    result: string;
    team?: LmsTeam | null;
  }[];
  if (!rows.length) return [];

  return rows
    .map((r) => ({
      user_id: r.user_id,
      gameweek_id: r.gameweek_id,
      gameweek_number: numberById.get(r.gameweek_id) ?? 0,
      team_id: r.team_id,
      result: r.result,
      team: r.team ?? undefined,
    }))
    .sort((a, b) => a.gameweek_number - b.gameweek_number);
}

/** Completed-gameweek picks for one player (Selection previous chips / lazy leaderboard drawer). */
export async function lmsListCompletedPicksForUser(
  competitionId: string,
  userId: string,
  preloadedCompetition?: LmsCompetition | null
): Promise<LmsCompletedPick[]> {
  const comp = preloadedCompetition ?? (await lmsGetCompetition(competitionId));
  if (!comp) return [];

  const { data: completeGws, error: gwErr } = await supabase
    .from('lms_gameweeks')
    .select('id, number')
    .eq('season', comp.season)
    .eq('status', 'complete')
    .order('number', { ascending: true });
  if (gwErr) throw gwErr;
  const gws = (completeGws ?? []) as { id: string; number: number }[];
  if (!gws.length) return [];

  const gwIds = gws.map((g) => g.id);
  const numberById = new Map(gws.map((g) => [g.id, g.number]));

  const { data, error } = await db
    .from('lms_picks')
    .select('user_id, gameweek_id, team_id, result, team:lms_teams(*)')
    .eq('competition_id', competitionId)
    .eq('user_id', userId)
    .in('gameweek_id', gwIds);
  if (error) throw error;

  const rows = (data ?? []) as {
    user_id: string;
    gameweek_id: string;
    team_id: string;
    result: string;
    team?: LmsTeam | null;
  }[];

  return rows
    .map((r) => ({
      user_id: r.user_id,
      gameweek_id: r.gameweek_id,
      gameweek_number: numberById.get(r.gameweek_id) ?? 0,
      team_id: r.team_id,
      result: r.result,
      team: r.team ?? undefined,
    }))
    .sort((a, b) => a.gameweek_number - b.gameweek_number);
}


export async function lmsGetCurrentGameweek(season = '2026/27'): Promise<LmsGameweek | null> {
  const { data, error } = await supabase
    .from('lms_gameweeks')
    .select('*')
    .eq('season', season)
    .neq('status', 'complete')
    .order('number', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as LmsGameweek | null;
}

export async function lmsListGameweeks(season = '2026/27'): Promise<LmsGameweek[]> {
  const { data, error } = await supabase
    .from('lms_gameweeks')
    .select('*')
    .eq('season', season)
    .order('number', { ascending: true });
  if (error) throw error;
  return (data ?? []) as LmsGameweek[];
}

export async function lmsListFixturesForGameweek(gameweekId: string): Promise<LmsFixture[]> {
  const { data: gwMeta, error: gwMetaErr } = await supabase
    .from('lms_gameweeks')
    .select('number')
    .eq('id', gameweekId)
    .maybeSingle();
  if (gwMetaErr) throw gwMetaErr;
  const gameweekNumber = (gwMeta as { number?: number } | null)?.number;

  const stamp = (fixtures: LmsFixture[]): LmsFixture[] =>
    fixtures.map((f) => ({
      ...f,
      gameweek_number: f.gameweek_number ?? gameweekNumber,
    }));

  const embedded = await db
    .from('lms_fixtures')
    .select(
      '*, home_team:lms_teams!home_team_id(*), away_team:lms_teams!away_team_id(*), gameweek:lms_gameweeks(number)'
    )
    .eq('gameweek_id', gameweekId)
    .order('kickoff_at', { ascending: true });

  if (!embedded.error) {
    return stamp(
      ((embedded.data ?? []) as Record<string, unknown>[]).map(mapFixtureWithTeams)
    );
  }

  // Fallback if relationship hints are unavailable in this schema cache.
  const { data, error } = await supabase
    .from('lms_fixtures')
    .select('*')
    .eq('gameweek_id', gameweekId)
    .order('kickoff_at', { ascending: true });
  if (error) throw error;
  const fixtures = (data ?? []) as LmsFixture[];
  if (!fixtures.length) return [];

  const teamIds = Array.from(
    new Set(fixtures.flatMap((f) => [f.home_team_id, f.away_team_id]))
  );
  const { data: teams } = await db.from('lms_teams').select('*').in('id', teamIds);
  const byId = new Map(((teams ?? []) as LmsTeam[]).map((t) => [t.id, t]));
  return stamp(
    fixtures.map((f) => ({
      ...f,
      home_team: byId.get(f.home_team_id),
      away_team: byId.get(f.away_team_id),
    }))
  );
}

/** All fixtures for a season, with team + gameweek number attached. */
export async function lmsListSeasonFixtures(season = '2026/27'): Promise<LmsFixture[]> {
  const { data: gws, error: gwErr } = await supabase
    .from('lms_gameweeks')
    .select('id, number')
    .eq('season', season)
    .order('number', { ascending: true });
  if (gwErr) throw gwErr;
  const gameweeks = (gws ?? []) as { id: string; number: number }[];
  if (!gameweeks.length) return [];

  const gwIds = gameweeks.map((g) => g.id);
  const numberById = new Map(gameweeks.map((g) => [g.id, g.number]));

  const { data, error } = await db
    .from('lms_fixtures')
    .select(
      '*, home_team:lms_teams!home_team_id(*), away_team:lms_teams!away_team_id(*)'
    )
    .in('gameweek_id', gwIds)
    .order('kickoff_at', { ascending: true });

  if (!error) {
    return ((data ?? []) as Record<string, unknown>[]).map((row) => {
      const mapped = mapFixtureWithTeams(row);
      return {
        ...mapped,
        gameweek_number: numberById.get(mapped.gameweek_id) ?? mapped.gameweek_number,
      };
    });
  }

  const { data: plain, error: plainErr } = await supabase
    .from('lms_fixtures')
    .select('*')
    .in('gameweek_id', gwIds)
    .order('kickoff_at', { ascending: true });
  if (plainErr) throw plainErr;
  const fixtures = (plain ?? []) as LmsFixture[];
  if (!fixtures.length) return [];

  const teamIds = Array.from(
    new Set(fixtures.flatMap((f) => [f.home_team_id, f.away_team_id]))
  );
  const { data: teams } = await db.from('lms_teams').select('*').in('id', teamIds);
  const byId = new Map(((teams ?? []) as LmsTeam[]).map((t) => [t.id, t]));

  return fixtures.map((f) => ({
    ...f,
    home_team: byId.get(f.home_team_id),
    away_team: byId.get(f.away_team_id),
    gameweek_number: numberById.get(f.gameweek_id),
  }));
}

export type FormResult = 'W' | 'D' | 'L' | null;

function fixtureResultRank(f: LmsFixture): number {
  if (f.status === 'finished' && f.home_goals != null && f.away_goals != null) return 3;
  if (f.status === 'live') return 2;
  return 1;
}

/** Merge fixture lists by id, preferring the row with the most complete result data. */
export function lmsMergeFixtures(...groups: LmsFixture[][]): LmsFixture[] {
  const byId = new Map<string, LmsFixture>();
  for (const group of groups) {
    for (const f of group) {
      const prev = byId.get(f.id);
      if (!prev) {
        byId.set(f.id, f);
        continue;
      }
      const prevRank = fixtureResultRank(prev);
      const nextRank = fixtureResultRank(f);
      if (nextRank > prevRank || (nextRank === prevRank && f !== prev)) {
        byId.set(f.id, f);
      }
    }
  }
  return [...byId.values()];
}

/** Last five finished results for a team (oldest → newest), padded with nulls. */
export function lmsTeamFormFromFixtures(
  fixtures: LmsFixture[],
  teamId: string
): FormResult[] {
  const finished = fixtures
    .filter(
      (f) =>
        f.status === 'finished' &&
        f.home_goals != null &&
        f.away_goals != null &&
        (f.home_team_id === teamId || f.away_team_id === teamId)
    )
    .sort((a, b) => new Date(a.kickoff_at).getTime() - new Date(b.kickoff_at).getTime());

  const lastFive: FormResult[] = finished.slice(-5).map((f) => {
    const home = f.home_team_id === teamId;
    const hg = f.home_goals as number;
    const ag = f.away_goals as number;
    if (hg === ag) return 'D';
    const won = home ? hg > ag : ag > hg;
    return won ? 'W' : 'L';
  });

  while (lastFive.length < 5) lastFive.unshift(null);
  return lastFive;
}

/**
 * Premier League table derived from finished `lms_fixtures` (no football-data call).
 * Prefer caching via `lmsSessionGet/SetLeagueTable` in the UI so revisits skip the DB.
 */
export async function lmsGetLeagueTable(season = '2026/27'): Promise<LmsLeagueTable> {
  const { data, error } = await db.rpc('lms_get_league_table', { p_season: season });
  if (error) throw error;

  const raw = (data ?? {}) as LmsLeagueTable;
  return {
    success: !!raw.success,
    error: raw.error,
    season: raw.season ?? season,
    computed_at: raw.computed_at ?? new Date().toISOString(),
    rows: Array.isArray(raw.rows) ? raw.rows : [],
  };
}

export async function lmsGetMyPick(
  competitionId: string,
  userId: string,
  gameweekId: string
): Promise<LmsPick | null> {
  const { data, error } = await db
    .from('lms_picks')
    .select('*, team:lms_teams(*)')
    .eq('competition_id', competitionId)
    .eq('user_id', userId)
    .eq('gameweek_id', gameweekId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as LmsPick & { team?: LmsTeam | null };
  return { ...row, team: row.team ?? undefined };
}

export type LmsCompetitionHomeSummary = LmsCompetitionRow & {
  aliveCount: number;
  totalCount: number;
  currentGameweekNumber: number | null;
  pickTeam: LmsTeam | null;
  pickAvailable: boolean;
  isCreator: boolean;
  isManager: boolean;
  canManage: boolean;
  canHandleJoins: boolean;
  hasActiveRejoin: boolean;
  hasPendingRejoin: boolean;
  showRolloverLabel: boolean;
  activeRejoinCode: string | null;
  rejoinValidForGameweekNumber: number | null;
};

export type LmsHomePayload = {
  competitions: LmsCompetitionHomeSummary[];
  pending: LmsPendingJoin[];
  nextUp: {
    gameweek: LmsGameweek | null;
    fixtures: LmsFixture[];
  };
};

/** Single RPC for LMS home: leagues + pending + next-up fixtures. */
export async function lmsGetHome(season = '2026/27'): Promise<LmsHomePayload> {
  const { data, error } = await db.rpc('lms_get_home', { p_season: season });
  if (error) throw error;

  const raw = (data ?? {}) as {
    competitions?: Array<
      LmsCompetitionRow & {
        alive_count?: number;
        total_count?: number;
        current_gameweek_number?: number | null;
        pick_team?: LmsTeam | null;
        pick_available?: boolean;
      }
    >;
    pending?: LmsPendingJoin[];
    next_up?: {
      gameweek?: LmsGameweek | null;
      fixtures?: LmsFixture[];
    };
  };

  const competitions: LmsCompetitionHomeSummary[] = (raw.competitions ?? []).map((c) => ({
    competition_id: c.competition_id,
    name: c.name,
    season: c.season,
    competition_status: c.competition_status,
    participant_status: c.participant_status,
    joined_at: c.joined_at,
    rollover_count: c.rollover_count,
    start_gameweek_id: c.start_gameweek_id,
    start_gameweek_number: c.start_gameweek_number,
    created_by_user_id: (c as { created_by_user_id?: string | null }).created_by_user_id ?? null,
    aliveCount: Number(c.alive_count ?? 0),
    totalCount: Number(c.total_count ?? 0),
    currentGameweekNumber: c.current_gameweek_number ?? null,
    pickTeam: c.pick_team ?? null,
    pickAvailable: !!c.pick_available,
    isCreator: !!(c as { is_creator?: boolean }).is_creator,
    isManager: !!(c as { is_manager?: boolean }).is_manager,
    canManage: !!(c as { can_manage?: boolean }).can_manage,
    canHandleJoins: !!(c as { can_handle_joins?: boolean }).can_handle_joins,
    hasActiveRejoin: !!(c as { has_active_rejoin?: boolean }).has_active_rejoin,
    hasPendingRejoin: !!(c as { has_pending_rejoin?: boolean }).has_pending_rejoin,
    showRolloverLabel: !!(c as { show_rollover_label?: boolean }).show_rollover_label,
    activeRejoinCode:
      typeof (c as { active_rejoin_code?: string | null }).active_rejoin_code === 'string'
        ? (c as { active_rejoin_code: string }).active_rejoin_code
        : null,
    rejoinValidForGameweekNumber:
      (c as { rejoin_valid_for_gameweek_number?: number | null }).rejoin_valid_for_gameweek_number ??
      null,
  }));

  return {
    competitions,
    pending: raw.pending ?? [],
    nextUp: {
      gameweek: raw.next_up?.gameweek ?? null,
      fixtures: raw.next_up?.fixtures ?? [],
    },
  };
}

/** @deprecated Prefer lmsGetHome — kept for callers that only need competition cards. */
export async function lmsListMyCompetitionSummaries(
  _userId: string
): Promise<LmsCompetitionHomeSummary[]> {
  const home = await lmsGetHome();
  return home.competitions;
}

export type LmsPickStatOutcome =
  | 'won'
  | 'lost'
  | 'draw'
  | 'pending'
  | 'excluded'
  | 'no_fixture';

export type LmsGameweekPickStatTeam = {
  team_id: string;
  name: string;
  short_name: string;
  slug: string;
  pick_count: number;
  pick_pct: number;
  outcome: LmsPickStatOutcome;
};

export type LmsGameweekPickStats = {
  success: boolean;
  revealed: boolean;
  gameweek_id?: string;
  gameweek_number?: number;
  competition_id?: string | null;
  total_picks: number;
  teams: LmsGameweekPickStatTeam[];
  error?: string;
};

/** Aggregated pick share + fixture outcome for a gameweek.
 *  Pass competitionId for one league; omit / null for all leagues. */
export async function lmsGetGameweekPickStats(
  gameweekId: string,
  competitionId?: string | null
): Promise<LmsGameweekPickStats> {
  const { data, error } = await db.rpc('lms_get_gameweek_pick_stats', {
    p_gameweek_id: gameweekId,
    p_competition_id: competitionId ?? null,
  });
  if (error) throw error;
  const raw = (data ?? {}) as LmsGameweekPickStats;
  return {
    success: !!raw.success,
    revealed: !!raw.revealed,
    gameweek_id: raw.gameweek_id,
    gameweek_number: raw.gameweek_number,
    competition_id: raw.competition_id ?? competitionId ?? null,
    total_picks: Number(raw.total_picks ?? 0),
    teams: (raw.teams ?? []).map((t) => ({
      ...t,
      pick_count: Number(t.pick_count ?? 0),
      pick_pct: Number(t.pick_pct ?? 0),
    })),
    error: raw.error,
  };
}

export type LmsEliminationSummaryGameweek = {
  gameweek_id: string;
  gameweek_number: number;
  eliminated_count: number;
  entrants_count: number;
  survival_pct: number;
};

export type LmsEliminationSummary = {
  success: boolean;
  season: string;
  competition_id: string | null;
  still_standing: number;
  gameweeks: LmsEliminationSummaryGameweek[];
  error?: string;
};

/** Eliminations per completed gameweek (home card when pick stats are hidden). */
export async function lmsGetEliminationSummary(
  season = '2026/27',
  competitionId?: string | null
): Promise<LmsEliminationSummary> {
  const { data, error } = await db.rpc('lms_get_elimination_summary', {
    p_season: season,
    p_competition_id: competitionId ?? null,
  });
  if (error) throw error;
  return mapEliminationSummary(data, season, competitionId);
}

function mapEliminationSummary(
  data: unknown,
  season: string,
  competitionId?: string | null
): LmsEliminationSummary {
  const raw = (data ?? {}) as LmsEliminationSummary & {
    gameweeks?: LmsEliminationSummaryGameweek[];
  };
  return {
    success: !!raw.success,
    season: raw.season ?? season,
    competition_id: raw.competition_id ?? competitionId ?? null,
    still_standing: Number(raw.still_standing ?? 0),
    gameweeks: (raw.gameweeks ?? []).map((g) => ({
      gameweek_id: g.gameweek_id,
      gameweek_number: Number(g.gameweek_number ?? 0),
      eliminated_count: Number(g.eliminated_count ?? 0),
      entrants_count: Number(g.entrants_count ?? 0),
      survival_pct: Number(g.survival_pct ?? 100),
    })),
    error: raw.error,
  };
}

export type LmsUserPoolTeam = {
  team_id: string;
  team: LmsTeam;
  used: boolean;
  gameweek_number: number | null;
};

export type LmsHomeInsights = {
  success: boolean;
  season: string;
  eliminations: {
    overall: LmsEliminationSummary | null;
    byCompetition: Record<string, LmsEliminationSummary>;
  };
  /** competition_id → pool teams (used + available). */
  pools: Record<string, LmsUserPoolTeam[]>;
  error?: string;
};

function mapPoolTeamRow(row: {
  team_id?: string;
  name?: string;
  short_name?: string;
  slug?: string;
  used?: boolean;
  gameweek_number?: number | null;
}): LmsUserPoolTeam | null {
  if (!row.team_id) return null;
  return {
    team_id: row.team_id,
    team: {
      id: row.team_id,
      name: row.name ?? '',
      short_name: row.short_name ?? '',
      slug: row.slug ?? '',
    } as LmsTeam,
    used: !!row.used,
    gameweek_number: row.gameweek_number != null ? Number(row.gameweek_number) : null,
  };
}

/** One RPC: survival summaries (overall + per league) and pools for all of the user’s competitions. */
export async function lmsGetHomeInsights(season = '2026/27'): Promise<LmsHomeInsights> {
  const { data, error } = await db.rpc('lms_get_home_insights', { p_season: season });
  if (error) throw error;
  const raw = (data ?? {}) as {
    success?: boolean;
    season?: string;
    error?: string;
    eliminations?: {
      overall?: unknown;
      by_competition?: Record<string, unknown>;
    };
    pools?: Record<
      string,
      Array<{
        team_id?: string;
        name?: string;
        short_name?: string;
        slug?: string;
        used?: boolean;
        gameweek_number?: number | null;
      }>
    >;
  };

  const byCompetition: Record<string, LmsEliminationSummary> = {};
  for (const [id, summary] of Object.entries(raw.eliminations?.by_competition ?? {})) {
    byCompetition[id] = mapEliminationSummary(summary, season, id);
  }

  const pools: Record<string, LmsUserPoolTeam[]> = {};
  for (const [id, rows] of Object.entries(raw.pools ?? {})) {
    pools[id] = (rows ?? [])
      .map(mapPoolTeamRow)
      .filter((t): t is LmsUserPoolTeam => t != null);
  }

  return {
    success: !!raw.success,
    season: raw.season ?? season,
    eliminations: {
      overall: raw.eliminations?.overall
        ? mapEliminationSummary(raw.eliminations.overall, season, null)
        : null,
      byCompetition,
    },
    pools,
    error: raw.error,
  };
}

/** @deprecated Prefer lmsGetHomeInsights — kept for callers that only need one pool. */
export async function lmsGetUserPoolForCompetition(
  competitionId: string,
  userId: string,
  opts?: {
    currentGameweekId?: string | null;
    currentGameweekNumber?: number | null;
  }
): Promise<LmsUserPoolTeam[]> {
  const insights = await lmsGetHomeInsights('2026/27');
  if (insights.pools[competitionId]) return insights.pools[competitionId];

  const [poolIds, allTeams, completedPicks, currentPick] = await Promise.all([
    lmsListCompetitionTeamIds(competitionId),
    lmsListTeams(),
    lmsListCompletedPicksForUser(competitionId, userId),
    opts?.currentGameweekId
      ? lmsGetMyPick(competitionId, userId, opts.currentGameweekId)
      : Promise.resolve(null),
  ]);

  const teamById = new Map(allTeams.map((t) => [t.id, t]));
  const usedGwByTeamId = new Map<string, number>();

  for (const p of completedPicks) {
    usedGwByTeamId.set(p.team_id, p.gameweek_number);
  }
  if (currentPick?.team_id && opts?.currentGameweekNumber != null) {
    usedGwByTeamId.set(currentPick.team_id, opts.currentGameweekNumber);
  }

  return poolIds
    .map((id) => {
      const team = teamById.get(id);
      if (!team) return null;
      const gwNum = usedGwByTeamId.get(id) ?? null;
      return {
        team_id: id,
        team,
        used: gwNum != null,
        gameweek_number: gwNum,
      };
    })
    .filter((row): row is LmsUserPoolTeam => row != null)
    .sort((a, b) =>
      (a.team.short_name || a.team.name).localeCompare(b.team.short_name || b.team.name, undefined, {
        sensitivity: 'base',
      })
    );
}

/** All picks for a competition gameweek (same-comp members can read via RLS). */
export async function lmsListPicksForGameweek(
  competitionId: string,
  gameweekId: string
): Promise<LmsPick[]> {
  const { data, error } = await db
    .from('lms_picks')
    .select('id, competition_id, user_id, gameweek_id, team_id, result, team:lms_teams(*)')
    .eq('competition_id', competitionId)
    .eq('gameweek_id', gameweekId);
  if (error) throw error;
  const rows = (data ?? []) as (LmsPick & { team?: LmsTeam | null })[];
  return rows.map((r) => ({ ...r, team: r.team ?? undefined }));
}

export async function lmsAdminCreateCompetition(
  adminCode: string,
  name: string,
  startGameweekId: string,
  season = '2026/27',
  extraLives = 0,
  options?: {
    continuationMode?: 'none' | 'full_rollover' | 'mass_wipeout_revive';
    gamemasterQuoteId?: string | null;
  }
) {
  const { data, error } = await db.rpc('lms_admin_create_competition', {
    p_code: adminCode,
    p_name: name,
    p_start_gameweek_id: startGameweekId,
    p_season: season,
    p_extra_lives: extraLives,
    p_continuation_mode: options?.continuationMode ?? 'full_rollover',
    p_gamemaster_quote_id: options?.gamemasterQuoteId ?? null,
  });
  if (error) throw error;
  return data as {
    success: boolean;
    error?: string;
    competition_id?: string;
    access_code?: string;
    start_gameweek_id?: string;
    start_gameweek_number?: number;
    continuation_mode?: string;
    gamemaster_quote_id?: string | null;
  };
}

export async function lmsAdminListCompetitions(adminCode: string) {
  const { data, error } = await db.rpc('lms_admin_list_competitions', { p_code: adminCode });
  if (error) throw error;
  return asArray<{
    id: string;
    name: string;
    season: string;
    status: string;
    created_at: string;
    start_gameweek_id: string | null;
    start_gameweek_number: number | null;
    join_code: string | null;
    active_rejoin_code: string | null;
    participant_count: number;
    active_count: number;
  }>(data);
}

export async function lmsAdminListPending(adminCode: string) {
  const { data, error } = await db.rpc('lms_admin_list_pending', { p_code: adminCode });
  if (error) throw error;
  return asArray<{
    id: string;
    competition_id: string;
    competition_name: string;
    user_id: string;
    username: string | null;
    code_type: string;
    created_at: string;
  }>(data);
}

export type LmsJoinRequestRow = {
  id: string;
  competition_id: string;
  competition_name?: string;
  user_id: string;
  username: string | null;
  code_type: string;
  created_at: string;
  is_reentry?: boolean;
  request_kind?: 'new' | 're_entry' | string;
  payment_method?: 'cash' | 'online' | string | null;
  payment_note?: string | null;
};

export async function lmsAdminListPendingForCompetition(
  competitionId: string
): Promise<LmsJoinRequestRow[]> {
  const { data, error } = await db.rpc('lms_admin_list_pending_for_competition', {
    p_competition_id: competitionId,
  });
  if (error) throw error;
  return asArray<LmsJoinRequestRow>(data);
}

export async function lmsCanManageCompetition(competitionId: string): Promise<{
  success: boolean;
  can_manage: boolean;
  can_handle_joins: boolean;
  is_creator: boolean;
  is_manager: boolean;
  created_by_user_id: string | null;
  error?: string;
}> {
  const { data, error } = await db.rpc('lms_can_manage_competition_rpc', {
    p_competition_id: competitionId,
  });
  if (error) throw error;
  const row = (data ?? {}) as {
    success?: boolean;
    can_manage?: boolean;
    can_handle_joins?: boolean;
    is_creator?: boolean;
    is_manager?: boolean;
    created_by_user_id?: string | null;
    error?: string;
  };
  return {
    success: !!row.success,
    can_manage: !!row.can_manage,
    can_handle_joins: !!row.can_handle_joins,
    is_creator: !!row.is_creator,
    is_manager: !!row.is_manager,
    created_by_user_id: row.created_by_user_id ?? null,
    error: row.error,
  };
}

export type LmsCompetitionManagerRow = {
  user_id: string;
  username: string | null;
  assigned_at?: string;
};

export type LmsAssignableManagerRow = {
  user_id: string;
  username: string | null;
  status?: string;
  is_creator?: boolean;
  is_manager?: boolean;
};

export async function lmsListCompetitionManagers(
  competitionId: string
): Promise<LmsCompetitionManagerRow[]> {
  const { data, error } = await db.rpc('lms_list_competition_managers', {
    p_competition_id: competitionId,
  });
  if (error) throw error;
  return asArray<LmsCompetitionManagerRow>(data);
}

export async function lmsListAssignableManagers(
  competitionId: string
): Promise<LmsAssignableManagerRow[]> {
  const { data, error } = await db.rpc('lms_list_assignable_managers', {
    p_competition_id: competitionId,
  });
  if (error) throw error;
  return asArray<LmsAssignableManagerRow>(data);
}

export async function lmsSetCompetitionManager(
  competitionId: string,
  userId: string,
  enabled: boolean
): Promise<{ success: boolean; enabled?: boolean; error?: string; max?: number }> {
  const { data, error } = await db.rpc('lms_set_competition_manager', {
    p_competition_id: competitionId,
    p_user_id: userId,
    p_enabled: enabled,
  });
  if (error) throw error;
  const result = (data ?? { success: false, error: 'unknown' }) as {
    success: boolean;
    enabled?: boolean;
    error?: string;
    max?: number;
  };

  if (result.success && enabled) {
    void supabase.functions
      .invoke('notify-lms-manager-assigned', {
        body: { competition_id: competitionId, user_id: userId },
      })
      .then(({ data: fnData, error: fnErr }) => {
        if (fnErr) console.warn('[lms] notify-lms-manager-assigned', fnErr.message);
        else console.log('[lms] notify-lms-manager-assigned', fnData);
      })
      .catch((e) => {
        console.warn('[lms] notify-lms-manager-assigned failed', e);
      });
  }

  return result;
}

export async function lmsGetJoinNotifyPref(competitionId: string): Promise<{
  success: boolean;
  enabled: boolean;
  error?: string;
}> {
  const { data, error } = await db.rpc('lms_get_join_notify_pref', {
    p_competition_id: competitionId,
  });
  if (error) throw error;
  const row = (data ?? {}) as { success?: boolean; enabled?: boolean; error?: string };
  return {
    success: !!row.success,
    enabled: !!row.enabled,
    error: row.error,
  };
}

export async function lmsGetCompetitionJoinCodes(competitionId: string): Promise<{
  success: boolean;
  join_code: string | null;
  active_rejoin_code: string | null;
  error?: string;
}> {
  const { data, error } = await db.rpc('lms_get_competition_join_codes', {
    p_competition_id: competitionId,
  });
  if (error) throw error;
  const row = (data ?? {}) as {
    success?: boolean;
    join_code?: string | null;
    active_rejoin_code?: string | null;
    error?: string;
  };
  return {
    success: !!row.success,
    join_code: row.join_code ?? null,
    active_rejoin_code: row.active_rejoin_code ?? null,
    error: row.error,
  };
}

/** Participant-safe active rejoin / rollover info for Standing + rejoin CTA. */
export async function lmsGetCompetitionRejoinInfo(competitionId: string): Promise<{
  success: boolean;
  has_active_rejoin: boolean;
  active_rejoin_code: string | null;
  rejoin_valid_for_gameweek_number: number | null;
  is_former_participant: boolean;
  participant_status: string | null;
  can_request_rejoin: boolean;
  has_pending_rejoin: boolean;
  error?: string;
}> {
  const { data, error } = await db.rpc('lms_get_competition_rejoin_info', {
    p_competition_id: competitionId,
  });
  if (error) throw error;
  const row = (data ?? {}) as {
    success?: boolean;
    has_active_rejoin?: boolean;
    active_rejoin_code?: string | null;
    rejoin_valid_for_gameweek_number?: number | null;
    is_former_participant?: boolean;
    participant_status?: string | null;
    can_request_rejoin?: boolean;
    has_pending_rejoin?: boolean;
    error?: string;
  };
  return {
    success: !!row.success,
    has_active_rejoin: !!row.has_active_rejoin,
    active_rejoin_code: row.active_rejoin_code ?? null,
    rejoin_valid_for_gameweek_number: row.rejoin_valid_for_gameweek_number ?? null,
    is_former_participant: !!row.is_former_participant,
    participant_status: row.participant_status ?? null,
    can_request_rejoin: !!row.can_request_rejoin,
    has_pending_rejoin: !!row.has_pending_rejoin,
    error: row.error,
  };
}

/** Former participant requests re-entry during rollover (no access code). */
export async function lmsRequestRejoin(competitionId: string): Promise<{
  success: boolean;
  error?: string;
  competition_name?: string;
  competition_id?: string;
  status?: string;
  join_request_id?: string;
  is_reentry?: boolean;
}> {
  const { data, error } = await db.rpc('lms_request_rejoin', {
    p_competition_id: competitionId,
  });
  if (error) throw error;
  const result = (data ?? { success: false, error: 'unknown' }) as {
    success: boolean;
    error?: string;
    competition_name?: string;
    competition_id?: string;
    status?: string;
    join_request_id?: string;
    is_reentry?: boolean;
  };

  if (result.success && result.join_request_id) {
    void supabase.functions
      .invoke('notify-lms-join-request', {
        body: { join_request_id: result.join_request_id, is_reentry: true },
      })
      .then(({ data: fnData, error: fnErr }) => {
        if (fnErr) console.warn('[lms] notify-lms-join-request (rejoin)', fnErr.message);
        else console.log('[lms] notify-lms-join-request (rejoin)', fnData);
      })
      .catch((e) => {
        console.warn('[lms] notify-lms-join-request (rejoin) failed', e);
      });
  }

  return result;
}

export async function lmsSetJoinNotifyPref(
  competitionId: string,
  enabled: boolean
): Promise<{ success: boolean; enabled: boolean; error?: string }> {
  const { data, error } = await db.rpc('lms_set_join_notify_pref', {
    p_competition_id: competitionId,
    p_enabled: enabled,
  });
  if (error) throw error;
  const row = (data ?? {}) as { success?: boolean; enabled?: boolean; error?: string };
  return {
    success: !!row.success,
    enabled: !!row.enabled,
    error: row.error,
  };
}

export async function lmsAdminSubmitPickForUser(
  competitionId: string,
  userId: string,
  gameweekId: string,
  teamId: string
): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await db.rpc('lms_admin_submit_pick_for_user', {
    p_competition_id: competitionId,
    p_user_id: userId,
    p_gameweek_id: gameweekId,
    p_team_id: teamId,
  });
  if (error) throw error;
  return (data ?? { success: false, error: 'unknown' }) as { success: boolean; error?: string };
}

/** Creator/Owner only — remove a player (and their picks) from the competition. */
export async function lmsAdminRemoveParticipant(
  competitionId: string,
  userId: string
): Promise<{ success: boolean; error?: string; username?: string | null }> {
  const { data, error } = await db.rpc('lms_admin_remove_participant', {
    p_competition_id: competitionId,
    p_user_id: userId,
  });
  if (error) throw error;
  return (data ?? { success: false, error: 'unknown' }) as {
    success: boolean;
    error?: string;
    username?: string | null;
  };
}

/** Creator/Owner: send a custom Web Push to all players in the competition. */
export async function lmsAdminBroadcastPush(
  competitionId: string,
  title: string,
  body: string
): Promise<{
  success: boolean;
  error?: string;
  sent?: number;
  users_notified?: number;
  participants?: number;
  skipped?: string;
}> {
  const { data, error } = await supabase.functions.invoke('notify-lms-competition-broadcast', {
    body: {
      competition_id: competitionId,
      title,
      body,
    },
  });
  if (error) {
    // Functions may return JSON error bodies with non-2xx status
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try {
        const errBody = (await ctx.json()) as { error?: string };
        if (errBody?.error) {
          return { success: false, error: errBody.error };
        }
      } catch {
        /* fall through */
      }
    }
    throw error;
  }
  const row = (data ?? {}) as {
    ok?: boolean;
    error?: string;
    sent?: number;
    users_notified?: number;
    participants?: number;
    skipped?: string;
  };
  if (!row.ok) {
    return { success: false, error: row.error ?? 'send_failed' };
  }
  if (row.skipped === 'no_subscriptions' || row.skipped === 'no_participants') {
    return {
      success: false,
      error: row.skipped,
      sent: 0,
      users_notified: 0,
      participants: row.participants,
      skipped: row.skipped,
    };
  }
  return {
    success: true,
    sent: row.sent ?? 0,
    users_notified: row.users_notified ?? 0,
    participants: row.participants,
    skipped: row.skipped,
  };
}

export function lmsBroadcastErrorMessage(code?: string): string {
  switch (code) {
    case 'unauthorized':
    case 'not_authenticated':
    case 'forbidden':
      return 'Only the competition creator or Owner can send notifications.';
    case 'invalid_title':
      return 'Enter a title up to 80 characters.';
    case 'invalid_body':
      return 'Enter a message up to 280 characters.';
    case 'rate_limited':
      return 'Please wait a few minutes before sending another notification.';
    case 'daily_limit':
      return 'Daily notification limit reached for this competition (20).';
    case 'invalid_competition':
      return 'Competition not found.';
    case 'no_subscriptions':
      return 'No players have push notifications enabled yet.';
    case 'no_participants':
      return 'There are no players in this competition yet.';
    default:
      return 'Could not send the notification.';
  }
}

export async function lmsSetCompetitionEntry(
  competitionId: string,
  entry: string
): Promise<{ success: boolean; entry?: string | null; error?: string }> {
  const { data, error } = await db.rpc('lms_set_competition_entry', {
    p_competition_id: competitionId,
    p_entry: entry,
  });
  if (error) throw error;
  return (data ?? { success: false, error: 'unknown' }) as {
    success: boolean;
    entry?: string | null;
    error?: string;
  };
}

/** Session-auth create (p_code ignored by tablet_code_admin_user_id). */
export async function lmsCreateCompetition(
  name: string,
  startGameweekId: string,
  season = '2026/27',
  entry?: string,
  extraLives = 0,
  options?: {
    continuationMode?: 'none' | 'full_rollover' | 'mass_wipeout_revive';
    gamemasterQuoteId?: string | null;
  }
) {
  const created = await lmsAdminCreateCompetition('', name, startGameweekId, season, extraLives, {
    continuationMode: options?.continuationMode,
    gamemasterQuoteId: options?.gamemasterQuoteId,
  });
  const trimmed = entry?.trim();
  if (created.success && created.competition_id && trimmed) {
    const setRes = await lmsSetCompetitionEntry(created.competition_id, trimmed);
    if (!setRes.success) {
      return { ...created, error: setRes.error ?? 'Could not save entry fee' };
    }
  }
  return created;
}

export async function lmsApproveJoinRequest(requestId: string) {
  return lmsAdminApproveJoin('', requestId);
}

export async function lmsRejectJoinRequest(requestId: string) {
  return lmsAdminRejectJoin('', requestId);
}

export async function lmsAdminApproveJoin(adminCode: string, requestId: string) {
  const { data, error } = await db.rpc('lms_admin_approve_join', {
    p_code: adminCode,
    p_request_id: requestId,
  });
  if (error) throw error;
  const result = (data ?? { success: false, error: 'unknown' }) as {
    success: boolean;
    error?: string;
  };

  if (result.success) {
    void supabase.functions
      .invoke('notify-lms-join-accepted', {
        body: { join_request_id: requestId },
      })
      .then(({ data: fnData, error: fnErr }) => {
        if (fnErr) console.warn('[lms] notify-lms-join-accepted', fnErr.message);
        else console.log('[lms] notify-lms-join-accepted', fnData);
      })
      .catch((e) => {
        console.warn('[lms] notify-lms-join-accepted failed', e);
      });
  }

  return result;
}

export async function lmsAdminRejectJoin(adminCode: string, requestId: string) {
  const { data, error } = await db.rpc('lms_admin_reject_join', {
    p_code: adminCode,
    p_request_id: requestId,
  });
  if (error) throw error;
  return data as { success: boolean; error?: string };
}

export async function lmsAdminSetFixtureResult(
  adminCode: string,
  fixtureId: string,
  homeGoals: number,
  awayGoals: number
) {
  const { data, error } = await db.rpc('lms_admin_set_fixture_result', {
    p_code: adminCode,
    p_fixture_id: fixtureId,
    p_home_goals: homeGoals,
    p_away_goals: awayGoals,
  });
  if (error) throw error;
  return data as { success: boolean; error?: string };
}

export async function lmsSettleGameweek(adminCode: string, gameweekId: string) {
  const { data, error } = await db.rpc('lms_settle_gameweek', {
    p_code: adminCode,
    p_gameweek_id: gameweekId,
  });
  if (error) throw error;
  return data as { success: boolean; error?: string; results?: unknown; remaining?: number };
}

export async function lmsAdminCreateRejoinCode(
  adminCode: string,
  competitionId: string,
  gameweekId: string
) {
  const { data, error } = await db.rpc('lms_admin_create_rejoin_code', {
    p_code: adminCode,
    p_competition_id: competitionId,
    p_gameweek_id: gameweekId,
  });
  if (error) throw error;
  return data as { success: boolean; error?: string; access_code?: string };
}

export function lmsPickErrorMessage(code?: string): string {
  switch (code) {
    case 'before_competition_start':
      return 'This competition has not started yet for that gameweek.';
    case 'deadline_passed':
      return 'The gameweek deadline has passed.';
    case 'team_already_used':
      return 'You have already used that team in this competition.';
    case 'team_not_playing':
      return 'That team is not available to pick this gameweek.';
    case 'team_not_in_pool':
      return 'That team is not in this competition’s team pool.';
    case 'not_active':
      return 'You are not an active participant.';
    case 'pick_locked':
      return 'This pick can no longer be changed.';
    case 'competition_unavailable':
      return 'This competition is not available.';
    default:
      return 'Could not save your pick.';
  }
}

export function lmsJoinErrorMessage(code?: string): string {
  switch (code) {
    case 'invalid_code':
      return invalidJoinCodeMessage('lms');
    case 'code_void':
      return 'This rejoin code is no longer valid for the gameweek.';
    case 'already_in':
      return 'You are already in this competition.';
    case 'competition_completed':
      return 'This competition has finished.';
    case 'entries_closed':
      return "Entries are closed — the pick deadline for this competition's starting gameweek has passed.";
    case 'account_banned':
      return 'This account has been banned and cannot join competitions.';
    case 'join_limit_reached':
      return subscriptionErrorMessage(code);
    default:
      return subscriptionErrorMessage(code, 'Could not send join request.');
  }
}
