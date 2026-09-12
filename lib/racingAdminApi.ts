import { supabase } from '@/lib/supabase';

const db = supabase as any;

export type RacingJoinRequestRow = {
  id: string;
  competition_id: string;
  competition_name?: string;
  user_id: string;
  display_name: string | null;
  username?: string | null;
  created_at: string;
  payment_method?: string | null;
  payment_note?: string | null;
};

export type RacingCompetitionListRow = {
  id: string;
  name: string;
  access_code: string | null;
  festival_start_date: string;
  festival_end_date: string;
  created_by_user_id: string | null;
  creator_username: string | null;
  display_status: 'upcoming' | 'live' | 'complete' | string;
};

export type RacingAssignableManager = {
  user_id: string;
  username: string | null;
  status: string;
  is_creator: boolean;
  is_manager: boolean;
};

export type RacingAdminContext = {
  success: boolean;
  error?: string;
  name?: string | null;
  entry?: string | null;
  join_code?: string | null;
  access_code?: string | null;
  festival_start_date?: string | null;
  festival_end_date?: string | null;
  can_manage: boolean;
  can_handle_joins: boolean;
  is_manager: boolean;
  is_creator: boolean;
  created_by_user_id?: string | null;
};

export async function racingAdminListCompetitions(): Promise<RacingCompetitionListRow[]> {
  const { data, error } = await db.rpc('admin_list_competitions', { p_code: '' });
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as RacingCompetitionListRow[];
}

export async function racingCreateCompetition(params: {
  name: string;
  festivalStartDate: string;
  festivalEndDate: string;
  accessCode?: string | null;
  courses?: string[];
}): Promise<{ success: boolean; error?: string; id?: string }> {
  const { data, error } = await db.rpc('admin_create_competition', {
    p_code: '',
    p_name: params.name,
    p_festival_start_date: params.festivalStartDate,
    p_festival_end_date: params.festivalEndDate,
    p_selection_open_utc: '10:00',
    p_selection_close_minutes_before_first_race: 60,
    p_access_code: params.accessCode ?? null,
    p_courses: params.courses?.length ? params.courses : ['Newcastle'],
  });
  if (error) throw error;
  return (data ?? { success: false, error: 'unknown' }) as {
    success: boolean;
    error?: string;
    id?: string;
  };
}

export async function racingGetAdminContext(
  competitionId: string
): Promise<RacingAdminContext> {
  const { data, error } = await db.rpc('racing_get_admin_context', {
    p_competition_id: competitionId,
  });
  if (error) throw error;
  const row = (data ?? {}) as RacingAdminContext;
  return {
    success: !!row.success,
    error: row.error,
    name: row.name ?? null,
    entry: row.entry ?? null,
    join_code: row.join_code ?? row.access_code ?? null,
    access_code: row.access_code ?? row.join_code ?? null,
    festival_start_date: row.festival_start_date ?? null,
    festival_end_date: row.festival_end_date ?? null,
    can_manage: !!row.can_manage,
    can_handle_joins: !!row.can_handle_joins,
    is_manager: !!row.is_manager,
    is_creator: !!row.is_creator,
    created_by_user_id: row.created_by_user_id ?? null,
  };
}

export async function racingGetCompetitionJoinCodes(competitionId: string) {
  const { data, error } = await db.rpc('racing_get_competition_join_codes', {
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

export async function racingSetCompetitionEntry(competitionId: string, entry: string) {
  const { data, error } = await db.rpc('racing_set_competition_entry', {
    p_competition_id: competitionId,
    p_entry: entry,
  });
  if (error) throw error;
  return data as { success: boolean; entry?: string | null; error?: string };
}

export async function racingGetJoinNotifyPref(competitionId: string) {
  const { data, error } = await db.rpc('racing_get_join_notify_pref', {
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

export async function racingSetJoinNotifyPref(competitionId: string, enabled: boolean) {
  const { data, error } = await db.rpc('racing_set_join_notify_pref', {
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

export async function racingListAssignableManagers(competitionId: string) {
  const { data, error } = await db.rpc('racing_list_assignable_managers', {
    p_competition_id: competitionId,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as RacingAssignableManager[];
}

export async function racingListCompetitionManagers(competitionId: string) {
  const { data, error } = await db.rpc('racing_list_competition_managers', {
    p_competition_id: competitionId,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as Array<{
    user_id: string;
    username: string | null;
    assigned_at: string;
  }>;
}

export async function racingSetCompetitionManager(
  competitionId: string,
  userId: string,
  enabled: boolean
) {
  const { data, error } = await db.rpc('racing_set_competition_manager', {
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
      .invoke('notify-racing-manager-assigned', {
        body: { competition_id: competitionId, user_id: userId },
      })
      .then(({ data: fnData, error: fnErr }) => {
        if (fnErr) console.warn('[racing] notify-racing-manager-assigned', fnErr.message);
        else console.log('[racing] notify-racing-manager-assigned', fnData);
      })
      .catch((e) => {
        console.warn('[racing] notify-racing-manager-assigned failed', e);
      });
  }
  return result;
}

export async function racingAdminBroadcastPush(
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
  const { data, error } = await supabase.functions.invoke('notify-racing-competition-broadcast', {
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

export function racingBroadcastErrorMessage(code?: string): string {
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

function mapPendingJoinRow(row: Record<string, unknown>): RacingJoinRequestRow {
  const displayName =
    (typeof row.display_name === 'string' && row.display_name.trim()) ||
    (typeof row.username === 'string' && row.username.trim()) ||
    null;
  const username =
    (typeof row.username === 'string' && row.username.trim()) ||
    (typeof row.display_name === 'string' && row.display_name.trim()) ||
    null;
  return {
    id: String(row.id ?? ''),
    competition_id: String(row.competition_id ?? ''),
    competition_name: typeof row.competition_name === 'string' ? row.competition_name : undefined,
    user_id: String(row.user_id ?? ''),
    display_name: displayName,
    username,
    created_at: String(row.created_at ?? ''),
    payment_method: (row.payment_method as string | null | undefined) ?? null,
    payment_note: (row.payment_note as string | null | undefined) ?? null,
  };
}

export async function racingAdminListPendingForCompetition(
  competitionId: string
): Promise<RacingJoinRequestRow[]> {
  const preferred = await db.rpc('racing_admin_list_pending_for_competition', {
    p_competition_id: competitionId,
  });
  if (!preferred.error) {
    const rows = Array.isArray(preferred.data) ? preferred.data : [];
    return rows.map((r: Record<string, unknown>) => mapPendingJoinRow(r));
  }

  const { data, error } = await db.rpc('admin_list_pending_for_competition', {
    p_code: '',
    p_competition_id: competitionId,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data : []).map((r: Record<string, unknown>) =>
    mapPendingJoinRow(r)
  );
}

export async function racingApproveJoinRequest(
  requestId: string
): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await db.rpc('racing_admin_approve_join', {
    p_request_id: requestId,
  });
  if (error) throw error;
  const result = (data ?? { success: false }) as { success: boolean; error?: string };
  if (result?.success) {
    void supabase.functions
      .invoke('notify-racing-join-accepted', {
        body: { join_request_id: requestId },
      })
      .then(({ data: fnData, error: fnErr }) => {
        if (fnErr) console.warn('[racing] notify-racing-join-accepted', fnErr.message);
        else console.log('[racing] notify-racing-join-accepted', fnData);
      })
      .catch((e) => {
        console.warn('[racing] notify-racing-join-accepted failed', e);
      });
  }
  return result;
}

export async function racingRejectJoinRequest(
  requestId: string
): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await db.rpc('racing_admin_reject_join', {
    p_request_id: requestId,
  });
  if (error) throw error;
  return (data ?? { success: false }) as { success: boolean; error?: string };
}

export async function racingDeleteCompetition(
  competitionId: string
): Promise<{ success: boolean; error?: string; name?: string }> {
  const { data, error } = await db.rpc('racing_admin_delete_competition', {
    p_competition_id: competitionId,
  });
  if (error) throw error;
  return (data ?? { success: false }) as { success: boolean; error?: string; name?: string };
}

export async function racingCanManageCompetition(competitionId: string): Promise<boolean> {
  const { data, error } = await db.rpc('racing_can_manage_competition', {
    p_competition_id: competitionId,
  });
  if (error) throw error;
  return !!data;
}

export async function racingCanHandleJoins(competitionId: string): Promise<boolean> {
  const { data, error } = await db.rpc('racing_can_handle_joins', {
    p_competition_id: competitionId,
  });
  if (error) throw error;
  return !!data;
}
