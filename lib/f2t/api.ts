import { supabase } from '@/lib/supabase';
import { subscriptionErrorMessage } from '@/lib/subscriptionEntitlements';
import { invalidJoinCodeMessage } from '@/lib/joinCodeMessages';

const db = supabase as any;

export type F2tCompetitionHomeSummary = {
  competition_id: string;
  name: string;
  season: string;
  competition_status: string;
  participant_status: string;
  entry: string | null;
  joined_at: string;
  start_gameweek_id: string;
  start_gameweek_number: number;
  scored_count: number;
  selection_count: number;
  selections_locked: boolean;
  can_manage: boolean;
  is_manager: boolean;
  /** Present for organisers / managers only. */
  join_code?: string | null;
};

export type F2tPendingJoin = {
  competition_id: string;
  name: string;
  season: string;
  requested_at: string;
};

export type F2tSelectablePlayer = {
  id: string;
  display_name: string;
  full_name: string;
  position: string | null;
  team_id: string;
  team_name: string;
  team_short_name: string;
  team_slug: string;
  picker_stats: Record<string, unknown>;
  owner_flagged: boolean;
  already_scored_for_comp: boolean;
};

export type F2tNextMatch = {
  kickoff_at: string;
  is_home: boolean;
  opponent_short_name: string;
  opponent_name: string;
  opponent_slug: string;
  gameweek_number: number | null;
};

export type F2tSelectionRow = {
  slot: number;
  player_id: string;
  display_name: string;
  team_id: string;
  team_name: string;
  team_short_name: string;
  team_slug: string;
  scored_at: string | null;
  scored_gameweek_id: string | null;
  scored_gameweek_number: number | null;
  owner_flagged: boolean;
  next_match: F2tNextMatch | null;
};

export function f2tJoinErrorMessage(code?: string): string {
  switch (code) {
    case 'invalid_code':
      return invalidJoinCodeMessage('f2t');
    case 'entries_closed':
      return 'Entries are closed for this competition.';
    case 'already_in':
      return 'You are already in this competition.';
    case 'account_banned':
      return 'Your account cannot join competitions.';
    case 'competition_completed':
      return 'This competition has finished.';
    case 'join_limit_reached':
      return subscriptionErrorMessage(code);
    default:
      return subscriptionErrorMessage(code, code ?? 'Could not join.');
  }
}

export async function f2tGetHome(season = '2026/27') {
  const { data, error } = await db.rpc('f2t_get_home', { p_season: season });
  if (error) throw error;
  return data as {
    competitions: F2tCompetitionHomeSummary[];
    pending: F2tPendingJoin[];
  };
}

export async function f2tRequestJoin(accessCode: string) {
  const { data, error } = await db.rpc('f2t_request_join', {
    p_access_code: accessCode,
  });
  if (error) throw error;
  const result = data as {
    success: boolean;
    error?: string;
    competition_name?: string;
    competition_id?: string;
    join_request_id?: string;
  };
  if (result?.success && result.join_request_id) {
    void supabase.functions
      .invoke('notify-f2t-join-request', {
        body: { join_request_id: result.join_request_id },
      })
      .then(({ data: fnData, error: fnErr }) => {
        if (fnErr) console.warn('[f2t] notify-f2t-join-request', fnErr.message);
        else console.log('[f2t] notify-f2t-join-request', fnData);
      })
      .catch((e) => {
        console.warn('[f2t] notify-f2t-join-request failed', e);
      });
  }
  return result;
}

export async function f2tGetCompetition(competitionId: string) {
  const { data, error } = await db.rpc('f2t_get_competition', {
    p_competition_id: competitionId,
  });
  if (error) throw error;
  return data as {
    success: boolean;
    error?: string;
    competition?: {
      id: string;
      name: string;
      season: string;
      status: string;
      entry: string | null;
      start_gameweek_id: string;
      start_gameweek_number: number;
      start_gameweek_deadline: string;
      join_open: boolean;
      /** Present for organisers / managers only. */
      join_code?: string | null;
    };
    participant?: {
      status: string;
      regular_sub_used: boolean;
      completed_at: string | null;
      scored_count: number;
      unscored_count: number;
      selection_count: number;
      sub_eligible_regular: boolean;
    };
    selections?: F2tSelectionRow[];
    leaderboard?: Array<{
      user_id: string;
      username: string | null;
      status: string;
      scored_count: number;
      completed_at: string | null;
    }>;
    permissions?: {
      can_manage: boolean;
      can_handle_joins: boolean;
      is_creator: boolean;
      is_manager: boolean;
    };
  };
}

export async function f2tListSelectablePlayers(competitionId: string) {
  const { data, error } = await db.rpc('f2t_list_selectable_players', {
    p_competition_id: competitionId,
  });
  if (error) throw error;
  const row = data as { success: boolean; players?: F2tSelectablePlayer[]; error?: string };
  if (row && row.success === false) {
    throw new Error(row.error ?? 'Could not load players');
  }
  return row.players ?? [];
}

export async function f2tSubmitSelections(competitionId: string, playerIds: string[]) {
  const { data, error } = await db.rpc('f2t_submit_selections', {
    p_competition_id: competitionId,
    p_player_ids: playerIds,
  });
  if (error) throw error;
  return data as { success: boolean; error?: string };
}

export async function f2tUseSubstitution(
  competitionId: string,
  outPlayerId: string,
  inPlayerId: string,
  type: 'regular' | 'owner_flag' = 'regular'
) {
  const { data, error } = await db.rpc('f2t_use_substitution', {
    p_competition_id: competitionId,
    p_out_player_id: outPlayerId,
    p_in_player_id: inPlayerId,
    p_type: type,
  });
  if (error) throw error;
  return data as { success: boolean; error?: string };
}

export async function f2tCreateCompetition(
  name: string,
  startGameweekId: string,
  season = '2026/27',
  entry?: string,
  options?: { gamemasterQuoteId?: string | null }
) {
  const { data, error } = await db.rpc('f2t_admin_create_competition', {
    p_code: '',
    p_name: name,
    p_start_gameweek_id: startGameweekId,
    p_season: season,
    p_entry: entry ?? null,
    p_gamemaster_quote_id: options?.gamemasterQuoteId ?? null,
  });
  if (error) throw error;
  return data as {
    success: boolean;
    error?: string;
    competition_id?: string;
    access_code?: string;
  };
}

export async function f2tAdminDeleteCompetition(competitionId: string) {
  const { data, error } = await db.rpc('f2t_admin_delete_competition', {
    p_competition_id: competitionId,
  });
  if (error) throw error;
  return (data ?? { success: false }) as {
    success: boolean;
    error?: string;
    name?: string;
  };
}

export async function f2tApproveJoin(requestId: string) {
  const { data, error } = await db.rpc('f2t_admin_approve_join', {
    p_code: '',
    p_request_id: requestId,
  });
  if (error) throw error;
  const result = data as { success: boolean; error?: string };
  if (result?.success) {
    void supabase.functions
      .invoke('notify-f2t-join-accepted', {
        body: { join_request_id: requestId },
      })
      .then(({ data: fnData, error: fnErr }) => {
        if (fnErr) console.warn('[f2t] notify-f2t-join-accepted', fnErr.message);
        else console.log('[f2t] notify-f2t-join-accepted', fnData);
      })
      .catch((e) => {
        console.warn('[f2t] notify-f2t-join-accepted failed', e);
      });
  }
  return result;
}

export async function f2tRejectJoin(requestId: string) {
  const { data, error } = await db.rpc('f2t_admin_reject_join', {
    p_code: '',
    p_request_id: requestId,
  });
  if (error) throw error;
  return data as { success: boolean; error?: string };
}

export async function f2tListPendingForCompetition(competitionId: string) {
  const { data, error } = await db.rpc('f2t_admin_list_pending_for_competition', {
    p_competition_id: competitionId,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as Array<{
    id: string;
    user_id: string;
    username: string | null;
    created_at: string;
    payment_method?: string | null;
    payment_note?: string | null;
  }>;
}

export async function f2tGetCompetitionJoinCodes(competitionId: string) {
  const { data, error } = await db.rpc('f2t_get_competition_join_codes', {
    p_competition_id: competitionId,
  });
  if (error) throw error;
  const row = (data ?? {}) as {
    success?: boolean;
    join_code?: string | null;
    error?: string;
  };
  const code = typeof row.join_code === 'string' ? row.join_code.trim() : null;
  return {
    success: !!row.success,
    join_code: code || null,
    error: row.error,
  };
}

export async function f2tSetCompetitionEntry(competitionId: string, entry: string) {
  const { data, error } = await db.rpc('f2t_set_competition_entry', {
    p_competition_id: competitionId,
    p_entry: entry,
  });
  if (error) throw error;
  return data as { success: boolean; entry?: string | null; error?: string };
}

export async function f2tGetJoinNotifyPref(competitionId: string) {
  const { data, error } = await db.rpc('f2t_get_join_notify_pref', {
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

export async function f2tSetJoinNotifyPref(competitionId: string, enabled: boolean) {
  const { data, error } = await db.rpc('f2t_set_join_notify_pref', {
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

export type F2tAssignableManager = {
  user_id: string;
  username: string | null;
  status: string;
  is_creator: boolean;
  is_manager: boolean;
};

export async function f2tListAssignableManagers(competitionId: string) {
  const { data, error } = await db.rpc('f2t_list_assignable_managers', {
    p_competition_id: competitionId,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as F2tAssignableManager[];
}

export async function f2tListCompetitionManagers(competitionId: string) {
  const { data, error } = await db.rpc('f2t_list_competition_managers', {
    p_competition_id: competitionId,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as Array<{
    user_id: string;
    username: string | null;
    assigned_at: string;
  }>;
}

export async function f2tSetCompetitionManager(
  competitionId: string,
  userId: string,
  enabled: boolean
) {
  const { data, error } = await db.rpc('f2t_set_competition_manager', {
    p_competition_id: competitionId,
    p_user_id: userId,
    p_enabled: enabled,
  });
  if (error) throw error;
  const result = (data ?? { success: false }) as {
    success: boolean;
    enabled?: boolean;
    error?: string;
    max?: number;
  };
  if (result.success && enabled) {
    void supabase.functions
      .invoke('notify-f2t-manager-assigned', {
        body: { competition_id: competitionId, user_id: userId },
      })
      .then(({ data: fnData, error: fnErr }) => {
        if (fnErr) console.warn('[f2t] notify-f2t-manager-assigned', fnErr.message);
        else console.log('[f2t] notify-f2t-manager-assigned', fnData);
      })
      .catch((e) => {
        console.warn('[f2t] notify-f2t-manager-assigned failed', e);
      });
  }
  return result;
}

export async function f2tAdminBroadcastPush(
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
  const { data, error } = await supabase.functions.invoke('notify-f2t-competition-broadcast', {
    body: {
      competition_id: competitionId,
      title,
      body,
    },
  });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try {
        const errBody = (await ctx.json()) as { error?: string };
        if (errBody?.error) return { success: false, error: errBody.error };
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
  if (!row.ok) return { success: false, error: row.error ?? 'send_failed' };
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

export function f2tBroadcastErrorMessage(code?: string): string {
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
      return 'Daily notification limit reached for this competition.';
    case 'no_subscriptions':
      return 'No players have push notifications enabled yet.';
    case 'no_participants':
      return 'There are no players in this competition yet.';
    default:
      return code ?? 'Could not send notification.';
  }
}

export async function ownerListFootballPlayers(teamId?: string, search?: string) {
  const { data, error } = await db.rpc('owner_list_football_players', {
    p_team_id: teamId ?? null,
    p_search: search ?? null,
  });
  if (error) throw error;
  const row = data as { success: boolean; players?: Array<Record<string, unknown>>; error?: string };
  return row.players ?? [];
}

export async function ownerListFootballPlayersFplAlerts() {
  const { data, error } = await db.rpc('owner_list_football_players_fpl_alerts');
  if (error) throw error;
  const row = data as { success: boolean; players?: Array<Record<string, unknown>>; error?: string };
  if (!row.success) throw new Error(row.error ?? 'Could not load FPL alerts');
  return row.players ?? [];
}

export async function ownerSetFootballPlayerFlagged(playerId: string, flagged: boolean) {
  const { data, error } = await db.rpc('owner_set_football_player_flagged', {
    p_player_id: playerId,
    p_flagged: flagged,
  });
  if (error) throw error;
  return data as { success: boolean; error?: string };
}

export type OwnerSyncFootballPlayersResult = {
  success: boolean;
  upserted?: number;
  fetched?: number;
  skipped_no_team?: number;
  skipped_no_name?: number;
  teams_mapped?: number;
  bbs_teams_fetched?: number;
  error?: string;
  hint?: string;
};

export async function ownerSyncFootballPlayersBbs(): Promise<OwnerSyncFootballPlayersResult> {
  const { data, error } = await supabase.functions.invoke('sync-football-players-bbs', {
    body: {},
  });
  if (data && typeof data === 'object' && 'success' in (data as object)) {
    return data as OwnerSyncFootballPlayersResult;
  }
  if (error) throw error;
  return { success: false, error: 'empty_response' };
}

export type F2tGoalscorerRow = {
  player_id: string;
  display_name: string;
  team_name: string;
  team_short_name: string;
  team_slug: string;
  goals: number;
};

/** Goalscorers for a Premier League gameweek (Tipster20 home panel). */
export async function f2tListGameweekGoalscorers(
  gameweekId: string
): Promise<F2tGoalscorerRow[]> {
  const { data, error } = await db
    .from('football_player_gameweek_goals')
    .select('player_id, goals')
    .eq('gameweek_id', gameweekId)
    .order('goals', { ascending: false });
  if (error) throw error;

  const goalRows = (data ?? []) as { player_id: string; goals: number }[];
  if (goalRows.length === 0) return [];

  const ids = goalRows.map((r) => r.player_id);
  const { data: players, error: pErr } = await db
    .from('football_players')
    .select('id, display_name, team:lms_teams!team_id(name, short_name, slug)')
    .in('id', ids);
  if (pErr) throw pErr;

  const byId = new Map<
    string,
    {
      display_name: string;
      team_name: string;
      team_short_name: string;
      team_slug: string;
    }
  >();
  for (const p of players ?? []) {
    const team = (p as { team?: { name?: string; short_name?: string; slug?: string } | null })
      .team;
    byId.set(p.id, {
      display_name: String((p as { display_name?: string }).display_name ?? 'Unknown'),
      team_name: team?.name ?? '',
      team_short_name: team?.short_name ?? '',
      team_slug: team?.slug ?? '',
    });
  }

  return goalRows
    .map((r) => {
      const meta = byId.get(r.player_id);
      return {
        player_id: r.player_id,
        display_name: meta?.display_name ?? 'Unknown',
        team_name: meta?.team_name ?? '',
        team_short_name: meta?.team_short_name ?? '',
        team_slug: meta?.team_slug ?? '',
        goals: r.goals,
      };
    })
    .sort((a, b) => b.goals - a.goals || a.display_name.localeCompare(b.display_name));
}
