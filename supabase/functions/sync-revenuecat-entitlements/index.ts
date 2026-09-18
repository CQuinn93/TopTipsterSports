/**
 * Sync RevenueCat entitlements onto profiles for the signed-in user.
 * Called from the app after purchase / restore / login.
 *
 * Auth: user JWT.
 * Body: { entitlement_ids: string[], product_ids?: string[] }
 */
// @ts-nocheck
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const ENTITLEMENT_RANK: Record<string, number> = {
  user_plus: 1,
  user_premium: 2,
  creator: 10,
  creator_plus: 11,
  creator_pro: 12,
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
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
    const bundled =
      best === "creator_pro" ? "user_premium" : "user_plus";
    return { participant_tier: bundled, creator_tier: best, active: true };
  }
  return { participant_tier: best, creator_tier: null as string | null, active: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const auth = req.headers.get("Authorization") ?? "";
    const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";

    if (!bearer || !anonKey || !serviceKey) {
      return json(401, { error: "Unauthorized" });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${bearer}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json(401, { error: "Unauthorized" });
    }

    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const entitlementIds = Array.isArray(body.entitlement_ids)
      ? (body.entitlement_ids as unknown[]).filter((x) => typeof x === "string") as string[]
      : [];
    const productIds = Array.isArray(body.product_ids)
      ? (body.product_ids as unknown[]).filter((x) => typeof x === "string") as string[]
      : [];

    const picked = pickBest(entitlementIds);
    const admin = createClient(supabaseUrl, serviceKey);

    const { data, error } = await admin.rpc("apply_store_subscription", {
      p_user_id: userData.user.id,
      p_participant_tier: picked.participant_tier,
      p_creator_tier: picked.creator_tier,
      p_product_id: productIds[0] ?? null,
      p_expires_at: null,
      p_active: picked.active,
    });
    if (error) throw error;

    return json(200, { ok: true, applied: data, entitlements: entitlementIds });
  } catch (e) {
    console.error(e);
    return json(500, { error: "Server error" });
  }
});
