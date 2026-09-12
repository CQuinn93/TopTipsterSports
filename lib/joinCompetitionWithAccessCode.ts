import { supabase } from '@/lib/supabase';
import { subscriptionErrorMessage } from '@/lib/subscriptionEntitlements';

export type JoinCompetitionOutcome =
  | { kind: 'invalid_code' }
  | { kind: 'already_in'; competitionName: string }
  | { kind: 'request_sent'; competitionName: string }
  | { kind: 'error'; message: string };

/**
 * Validates access code and creates a pending join request (or no-ops if already a participant).
 */
export async function joinCompetitionWithAccessCode(params: {
  userId: string;
  code: string;
  displayNameToUse: string;
}): Promise<JoinCompetitionOutcome> {
  const { userId, displayNameToUse } = params;
  const trimmed = params.code.trim().toUpperCase();
  if (!trimmed) {
    return { kind: 'error', message: 'Please enter the access code.' };
  }
  if (!displayNameToUse) {
    return { kind: 'error', message: 'Please enter your display name for the leaderboard.' };
  }

  try {
    const { data: banned } = await (supabase as any).rpc('is_profile_banned');
    if (banned) {
      return { kind: 'error', message: 'This account has been banned and cannot join competitions.' };
    }

    const { data, error } = await (supabase as any).rpc('racing_request_join', {
      p_access_code: trimmed,
      p_display_name: displayNameToUse,
    });

    if (error) throw error;

    const res = data as {
      success?: boolean;
      error?: string;
      competition_name?: string;
      join_request_id?: string;
    };

    if (!res?.success) {
      const code = res?.error;
      if (code === 'invalid_code') return { kind: 'invalid_code' };
      if (code === 'already_in') {
        return { kind: 'already_in', competitionName: res.competition_name ?? 'Competition' };
      }
      return {
        kind: 'error',
        message: subscriptionErrorMessage(code, 'Failed to join competition.'),
      };
    }

    if (res.join_request_id) {
      void supabase.functions
        .invoke('notify-racing-join-request', {
          body: { join_request_id: res.join_request_id },
        })
        .then(({ data: fnData, error: fnErr }) => {
          if (fnErr) console.warn('[racing] notify-racing-join-request', fnErr.message);
          else console.log('[racing] notify-racing-join-request', fnData);
        })
        .catch((e) => {
          console.warn('[racing] notify-racing-join-request failed', e);
        });
    }

    return { kind: 'request_sent', competitionName: res.competition_name ?? 'Competition' };
  } catch (e: unknown) {
    let msg = 'Failed to join competition';
    if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
      msg = (e as { message: string }).message;
    }
    if (e && typeof e === 'object' && 'details' in e && typeof (e as { details: unknown }).details === 'string') {
      msg = `${msg} (${(e as { details: string }).details})`;
    }
    return { kind: 'error', message: msg };
  }
}
