/**
 * RevenueCat server webhook → update profiles tiers.
 *
 * Configure in RevenueCat → Project → Integrations → Webhooks:
 *   URL: https://<project>.supabase.co/functions/v1/revenuecat-webhook
 *   Authorization: Bearer <REVENUECAT_WEBHOOK_AUTH>  (set same secret in Supabase)
 *
 * Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, REVENUECAT_WEBHOOK_AUTH
 */
// @ts-nocheck
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ENTITLEMENT_RANK: Record<string, number> = {
  user_plus: 1,
  user_premium: 2,
  creator: 10,
  creator_plus: 11,
  creator_pro: 12,
};

const CLEAR_EVENTS = new Set([
  "EXPIRATION",
  "SUBSCRIPTION_PAUSED",
]);

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function pickBest(entitlementIds: string[]) {
  let best: string | null = null;
  let bestRank = -1;
  for (const id of entitlementIds) {
    const rank = ENTITLEMENT_RANK[id] ?? -1;
    if (rank > bestRank) {
      bestRank = rank;
      best = id;
    }
  }
  if (!best) {
    return { participant_tier: "user", creator_tier: null as string | null, active: false };
  }
  if (best.startsWith("creator")) {
    const bundled = best === "creator_pro" ? "user_premium" : "user_plus";
    return { participant_tier: bundled, creator_tier: best, active: true };
  }
  return { participant_tier: best, creator_tier: null as string | null, active: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok");
  }

  try {
    const expected = Deno.env.get("REVENUECAT_WEBHOOK_AUTH")?.trim();
    const auth = req.headers.get("Authorization") ?? "";
    if (expected) {
      const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : auth.trim();
      if (bearer !== expected) {
        return json(401, { error: "Unauthorized" });
      }
    }

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    if (!serviceKey) return json(500, { error: "Missing service role" });

    const payload = await req.json();
    const event = payload?.event ?? payload;
    const type = String(event?.type ?? "");
    const appUserId = String(event?.app_user_id ?? "").trim();
    if (!appUserId || appUserId.startsWith("$RCAnonymousID")) {
      return json(200, { ok: true, skipped: "no_app_user" });
    }

    // UUID check — we identify RC users with Supabase user ids
    const uuidRe =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRe.test(appUserId)) {
      return json(200, { ok: true, skipped: "non_uuid_app_user" });
    }

    const entitlementIds: string[] = Array.isArray(event?.entitlement_ids)
      ? event.entitlement_ids.filter((x: unknown) => typeof x === "string")
      : event?.entitlement_id
        ? [String(event.entitlement_id)]
        : [];

    const productId =
      typeof event?.product_id === "string" ? event.product_id : null;
    const expiresAt =
      typeof event?.expiration_at_ms === "number"
        ? new Date(event.expiration_at_ms).toISOString()
        : null;

    const admin = createClient(supabaseUrl, serviceKey);
    const forceClear = CLEAR_EVENTS.has(type);
    const picked = forceClear
      ? { participant_tier: "user", creator_tier: null, active: false }
      : pickBest(entitlementIds);

    const { data, error } = await admin.rpc("apply_store_subscription", {
      p_user_id: appUserId,
      p_participant_tier: picked.participant_tier,
      p_creator_tier: picked.creator_tier,
      p_product_id: productId,
      p_expires_at: expiresAt,
      p_active: picked.active,
    });
    if (error) throw error;

    return json(200, { ok: true, type, applied: data });
  } catch (e) {
    console.error(e);
    return json(500, { error: "Server error" });
  }
});
