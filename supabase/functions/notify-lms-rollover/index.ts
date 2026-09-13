/**
 * Web Push to all LMS participants when a competition rolls over.
 *
 * Triggered by sync-lms-football after settle outcome === 'rollover'
 * (service role), or manually with service role / CRON_SECRET.
 *
 * Title: Rollover for <competition name>
 * Body: Visit the competition for more information.
 *
 * Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, optional VAPID_SUBJECT,
 * SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const cronSecret = Deno.env.get("CRON_SECRET");
    const auth = req.headers.get("Authorization") ?? "";
    const headerSecret = req.headers.get("x-cron-secret") ?? "";
    const bearerToken = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";

    const isServiceRole =
      Boolean(serviceKey) && (auth === `Bearer ${serviceKey}` || bearerToken === serviceKey);
    const isCron = Boolean(cronSecret) && headerSecret === cronSecret;

    if (!isServiceRole && !isCron) {
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

    const p = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    const competitionId = typeof p.competition_id === "string" ? p.competition_id : null;
    if (!competitionId) {
      return json(400, { error: "missing_competition_id" });
    }

    const { data: comp, error: compErr } = await admin
      .from("lms_competitions")
      .select("id, name")
      .eq("id", competitionId)
      .maybeSingle();
    if (compErr) throw compErr;
    if (!comp) return json(404, { error: "competition_not_found" });

    const competitionName =
      typeof (comp as { name?: string }).name === "string" && (comp as { name: string }).name.trim()
        ? (comp as { name: string }).name.trim()
        : "the competition";

    const { data: parts, error: partErr } = await admin
      .from("lms_participants")
      .select("user_id")
      .eq("competition_id", competitionId);
    if (partErr) throw partErr;

    const userIds = [
      ...new Set(
        ((parts ?? []) as { user_id: string }[])
          .map((r) => r.user_id)
          .filter((id) => typeof id === "string" && id.length > 0),
      ),
    ];

    if (userIds.length === 0) {
      return json(200, {
        ok: true,
        skipped: "no_participants",
        competition_id: competitionId,
        sent: 0,
      });
    }

    const title = `Rollover for ${competitionName}`;
    const bodyText = "Visit the competition for more information.";

    const result = await sendPushToUserIds({
      admin,
      webpush,
      userIds,
      title,
      body: bodyText,
      data: {
        competitionId,
        url: `/${competitionId}`,
        competitionName,
        kind: "lms_rollover",
      },
      ttlSeconds: 259200,
    });

    if (result.devices === 0) {
      return json(200, {
        ok: true,
        skipped: "no_subscriptions",
        competition_id: competitionId,
        participants: userIds.length,
        sent: 0,
      });
    }

    return json(200, {
      ok: true,
      competition_id: competitionId,
      participants: userIds.length,
      devices: result.devices,
      users_notified: result.users_notified,
      sent: result.sent,
      failed: result.failed,
      pruned: result.pruned,
    });
  } catch (e) {
    console.error(e);
    return json(500, { error: "Server error" });
  }
});
