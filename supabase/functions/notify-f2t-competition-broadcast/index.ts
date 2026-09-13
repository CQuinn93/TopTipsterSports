/**
 * Custom Web Push from F2T competition creator/Owner to all participants.
 *
 * Preferred: client invokes after composing title + body in Admin → Notify.
 *
 * Auth: signed-in creator/Owner via f2t_admin_authorize_broadcast.
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
    "authorization, x-client-info, apikey, content-type",
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
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const auth = req.headers.get("Authorization") ?? "";
    const bearerToken = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";

    if (!bearerToken || !serviceKey || !anonKey) {
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
    const titleIn = typeof p.title === "string" ? p.title : "";
    const bodyIn = typeof p.body === "string" ? p.body : "";

    if (!competitionId) {
      return json(400, { error: "missing_competition_id" });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${bearerToken}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json(401, { error: "Unauthorized" });
    }

    const { data: prepared, error: prepErr } = await userClient.rpc(
      "f2t_admin_authorize_broadcast",
      {
        p_competition_id: competitionId,
        p_title: titleIn,
        p_body: bodyIn,
      },
    );
    if (prepErr) throw prepErr;
    const authResult = (prepared ?? {}) as Record<string, unknown>;

    if (!authResult.success) {
      const err = typeof authResult.error === "string" ? authResult.error : "forbidden";
      const status =
        err === "unauthorized" || err === "not_authenticated"
          ? 403
          : err === "rate_limited" || err === "daily_limit"
            ? 429
            : 400;
      return json(status, { ok: false, error: err });
    }

    const userIds = Array.isArray(authResult.user_ids)
      ? (authResult.user_ids as string[]).filter((id) => typeof id === "string")
      : [];
    const competitionName =
      typeof authResult.competition_name === "string"
        ? authResult.competition_name
        : "the competition";
    const title =
      typeof authResult.title === "string" && authResult.title.trim()
        ? authResult.title.trim()
        : "Competition update";
    const bodyText =
      typeof authResult.body === "string" && authResult.body.trim()
        ? authResult.body.trim()
        : "";

    if (userIds.length === 0) {
      return json(200, {
        ok: true,
        skipped: "no_participants",
        competition_id: competitionId,
        broadcast_id: authResult.broadcast_id ?? null,
        sent: 0,
      });
    }

    const result = await sendPushToUserIds({
      admin,
      webpush,
      userIds,
      title,
      body: bodyText,
      data: {
        competitionId,
        url: `/(f2t)/${competitionId}`,
        competitionName,
      },
    });

    if (result.devices === 0) {
      return json(200, {
        ok: true,
        skipped: "no_subscriptions",
        competition_id: competitionId,
        broadcast_id: authResult.broadcast_id ?? null,
        participants: userIds.length,
        sent: 0,
      });
    }

    return json(200, {
      ok: true,
      competition_id: competitionId,
      broadcast_id: authResult.broadcast_id ?? null,
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
