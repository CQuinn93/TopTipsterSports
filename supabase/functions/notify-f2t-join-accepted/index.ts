/**
 * Instant Web Push to the player when an admin accepts their F2T join request.
 *
 * Preferred: client invokes after successful f2t_admin_approve_join.
 *
 * Auth: service role / CRON_SECRET, OR signed-in user who can handle joins
 * (creator / Owner / assigned competition manager).
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

function extractJoinRequestId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.join_request_id === "string") return p.join_request_id;
  if (typeof p.record === "object" && p.record && typeof (p.record as { id?: string }).id === "string") {
    return (p.record as { id: string }).id;
  }
  return null;
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

    const joinRequestId = extractJoinRequestId(body);
    if (!joinRequestId) {
      return json(400, { error: "missing_join_request_id" });
    }

    const { data: jr, error: jrErr } = await admin
      .from("f2t_join_requests")
      .select("id, competition_id, user_id, status")
      .eq("id", joinRequestId)
      .maybeSingle();
    if (jrErr) throw jrErr;
    if (!jr) return json(404, { error: "join_request_not_found" });
    if (jr.status !== "approved") {
      return json(200, { ok: true, skipped: "not_approved" });
    }

    if (!isServiceRole && !isCron) {
      if (!anonKey) {
        return json(500, { error: "SUPABASE_ANON_KEY not configured" });
      }
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: `Bearer ${bearerToken}` } },
      });
      const { data: userData, error: userErr } = await userClient.auth.getUser();
      if (userErr || !userData?.user) {
        return json(401, { error: "Unauthorized" });
      }
      const { data: canHandle, error: permErr } = await userClient.rpc("f2t_can_handle_joins", {
        p_competition_id: jr.competition_id,
      });
      if (permErr || canHandle !== true) {
        return json(403, { error: "forbidden" });
      }
    }

    const { data: comp, error: compErr } = await admin
      .from("f2t_competitions")
      .select("id, name")
      .eq("id", jr.competition_id)
      .maybeSingle();
    if (compErr) throw compErr;

    const competitionName = (comp as { name?: string } | null)?.name || "the competition";

    const title = "Join request accepted";
    const bodyText = `Your request to join ${competitionName} has been accepted. ` +
      `You can open the competition and start playing.`;

    const result = await sendPushToUserIds({
      admin,
      webpush,
      userIds: [jr.user_id],
      title,
      body: bodyText,
      data: {
        competitionId: jr.competition_id,
        url: `/(f2t)/${jr.competition_id}`,
      },
      ttlSeconds: 86400,
    });

    if (result.devices === 0) {
      return json(200, {
        ok: true,
        skipped: "no_subscription",
        join_request_id: joinRequestId,
      });
    }

    return json(200, {
      ok: true,
      join_request_id: joinRequestId,
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
