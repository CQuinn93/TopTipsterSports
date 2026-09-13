/**
 * Instant Web Push when a Racing join request is pending.
 *
 * Preferred: client invokes after successful racing_request_join.
 * Optional: Database Webhook on INSERT with service role.
 *
 * Auth: service role / CRON_SECRET, OR signed-in user who owns the pending request
 * (or competition creator / Owner).
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
  if (typeof p.payload === "object" && p.payload) {
    const inner = p.payload as Record<string, unknown>;
    if (typeof inner.record === "object" && inner.record && typeof (inner.record as { id?: string }).id === "string") {
      return (inner.record as { id: string }).id;
    }
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
      .from("competition_join_requests")
      .select("id, competition_id, user_id, status")
      .eq("id", joinRequestId)
      .maybeSingle();
    if (jrErr) throw jrErr;
    if (!jr) return json(404, { error: "join_request_not_found" });
    if (jr.status !== "pending") {
      return json(200, { ok: true, skipped: "not_pending" });
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
      const uid = userData.user.id;
      if (uid !== jr.user_id) {
        const { data: compRow } = await admin
          .from("competitions")
          .select("created_by_user_id")
          .eq("id", jr.competition_id)
          .maybeSingle();
        const { data: profileRow } = await admin
          .from("profiles")
          .select("role")
          .eq("id", uid)
          .maybeSingle();
        const isManager =
          (compRow as { created_by_user_id?: string } | null)?.created_by_user_id === uid ||
          (profileRow as { role?: string } | null)?.role === "Owner";
        if (!isManager) {
          return json(403, { error: "forbidden" });
        }
      }
    }

    const { data: comp, error: compErr } = await admin
      .from("competitions")
      .select("id, name")
      .eq("id", jr.competition_id)
      .maybeSingle();
    if (compErr) throw compErr;

    const { data: profile } = await admin
      .from("profiles")
      .select("username")
      .eq("id", jr.user_id)
      .maybeSingle();

    const username = (profile as { username?: string | null } | null)?.username?.trim() || "Someone";
    const competitionName = (comp as { name?: string } | null)?.name || "your competition";

    const { data: recipients, error: recErr } = await admin.rpc(
      "racing_list_join_notify_recipients",
      { p_competition_id: jr.competition_id },
    );
    if (recErr) throw recErr;

    const recipientIds = [
      ...new Set(
        ((recipients ?? []) as { user_id: string }[])
          .map((r) => r.user_id)
          .filter((id) => typeof id === "string" && id !== jr.user_id),
      ),
    ];

    const title = isReentry ? "Rejoin request" : "New join request";
    const bodyText = isReentry
      ? `${username} wants to rejoin ${competitionName}. Please visit the admin panel within the app to accept or reject them.`
      : `${username} has requested to join ${competitionName}. Please visit the admin panel within the app to accept or reject them.`;

    if (recipientIds.length === 0) {
      return json(200, {
        ok: true,
        skipped: "no_recipients",
        join_request_id: joinRequestId,
        sent: 0,
      });
    }

    const result = await sendPushToUserIds({
      admin,
      webpush,
      userIds: recipientIds,
      title,
      body: bodyText,
      data: {
        competitionId: jr.competition_id,
        url: `/${jr.competition_id}`,
        kind: isReentry ? "racing_rejoin_request" : "racing_join_request",
      },
      ttlSeconds: 60 * 60,
    });

    return json(200, {
      ok: true,
      join_request_id: joinRequestId,
      recipients: recipientIds.length,
      devices: result.devices,
      sent: result.sent,
      failed: result.failed,
      pruned: result.pruned,
    });
  } catch (e) {
    console.error(e);
    return json(500, { error: "Server error" });
  }
});
