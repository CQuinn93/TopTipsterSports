/**
 * Instant Web Push when a player is assigned as an LMS competition manager.
 *
 * Preferred: client invokes after successful lms_set_competition_manager(..., true).
 *
 * Auth: service role / CRON_SECRET, OR signed-in creator/Owner of the competition.
 *
 * Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, optional VAPID_SUBJECT,
 * SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY.
 */
// @ts-nocheck
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { sendPushToUserIds } from "../_shared/sendPush.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function extractIds(payload: unknown): { competitionId: string | null; userId: string | null } {
  if (!payload || typeof payload !== "object") {
    return { competitionId: null, userId: null };
  }
  const p = payload as Record<string, unknown>;
  const competitionId =
    typeof p.competition_id === "string"
      ? p.competition_id
      : typeof p.record === "object" && p.record && typeof (p.record as { competition_id?: string }).competition_id === "string"
        ? (p.record as { competition_id: string }).competition_id
        : null;
  const userId =
    typeof p.user_id === "string"
      ? p.user_id
      : typeof p.record === "object" && p.record && typeof (p.record as { user_id?: string }).user_id === "string"
        ? (p.record as { user_id: string }).user_id
        : null;
  return { competitionId, userId };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const cronSecret = Deno.env.get("CRON_SECRET");
    const auth = req.headers.get("Authorization") ?? "";
    const headerSecret = req.headers.get("x-cron-secret") ?? "";
    const bearerToken = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";

    const isServiceRole =
      Boolean(serviceKey) && (auth === `Bearer ${serviceKey}` || bearerToken === serviceKey);
    const isCron = Boolean(cronSecret) && headerSecret === cronSecret;

    if (!isServiceRole && !isCron && !bearerToken) {
      return json(401, { error: "Unauthorized" });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
    const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
    const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@toptipster.ie";
    if (!vapidPublic || !vapidPrivate) {
      return json(500, { error: "VAPID keys not configured" });
    }
    if (vapidPublic === vapidPrivate) {
      return json(500, {
        error: "VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be different values",
      });
    }

    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
    const admin = createClient(supabaseUrl, serviceKey);

    let body: unknown = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const { competitionId, userId } = extractIds(body);
    if (!competitionId || !userId) {
      return json(400, { error: "missing_competition_or_user" });
    }

    const { data: assignment, error: asErr } = await admin
      .from("lms_competition_managers")
      .select("competition_id, user_id")
      .eq("competition_id", competitionId)
      .eq("user_id", userId)
      .maybeSingle();
    if (asErr) throw asErr;
    if (!assignment) {
      return json(200, { ok: true, skipped: "not_assigned" });
    }

    if (!isServiceRole && !isCron) {
      if (!anonKey) {
        return json(500, { error: "SUPABASE_ANON_KEY not configured" });
      }
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: `Bearer ${bearerToken}` } },
      });
      const { data: perm, error: permErr } = await userClient.rpc("lms_can_manage_competition", {
        p_competition_id: competitionId,
      });
      if (permErr || perm !== true) {
        return json(403, { error: "forbidden" });
      }
    }

    const { data: comp, error: compErr } = await admin
      .from("lms_competitions")
      .select("id, name")
      .eq("id", competitionId)
      .maybeSingle();
    if (compErr) throw compErr;

    const competitionName = (comp as { name?: string } | null)?.name || "the competition";

    const title = "Competition manager";
    const bodyText = `You have been assigned as a manager for ${competitionName}. ` +
      `You can accept join requests and get alerts when players ask to join.`;

    const result = await sendPushToUserIds({
      admin,
      webpush,
      userIds: [userId],
      title,
      body: bodyText,
      data: {
        competitionId: competitionId,
        url: `/${competitionId}`,
      },
      ttlSeconds: 86400,
    });

    if (result.devices === 0) {
      return json(200, {
        ok: true,
        skipped: "no_subscription",
        competition_id: competitionId,
        user_id: userId,
      });
    }

    return json(200, {
      ok: true,
      competition_id: competitionId,
      user_id: userId,
      recipients: result.devices,
      sent: result.sent,
      failed: result.failed,
      pruned: result.pruned,
    });
  } catch (e) {
    console.error(e);
    return json(500, { error: "Server error" });
  }
});
