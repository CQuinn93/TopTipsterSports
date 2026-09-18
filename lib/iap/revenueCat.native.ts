/**
 * RevenueCat (StoreKit + Google Play Billing) for native apps.
 *
 * Flow:
 * 1. App starts → configure with public SDK key
 * 2. User signs in → identify with Supabase user id
 * 3. User taps a plan → purchaseStoreProduct / purchasePackage
 * 4. After purchase → syncCustomerInfoToBackend (edge function updates profiles)
 * 5. RevenueCat webhook also updates profiles (source of truth for renew/cancel)
 */
import { Platform } from 'react-native';
import Purchases, {
  LOG_LEVEL,
  type PurchasesPackage,
  type CustomerInfo,
} from 'react-native-purchases';
import { supabase } from '@/lib/supabase';
import {
  IAP_PRODUCTS,
  type IapPlanId,
  iapProductByEntitlementId,
} from '@/lib/iap/products';

let configured = false;

function iosApiKey(): string | null {
  return process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY?.trim() || null;
}

function androidApiKey(): string | null {
  return process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY?.trim() || null;
}

export function isIapConfigured(): boolean {
  if (Platform.OS === 'ios') return Boolean(iosApiKey());
  if (Platform.OS === 'android') return Boolean(androidApiKey());
  return false;
}

export async function configureRevenueCat(): Promise<void> {
  if (configured || !isIapConfigured()) return;
  const apiKey = Platform.OS === 'ios' ? iosApiKey() : androidApiKey();
  if (!apiKey) return;

  if (__DEV__) {
    Purchases.setLogLevel(LOG_LEVEL.DEBUG);
  }

  Purchases.configure({ apiKey });
  configured = true;
}

export async function identifyRevenueCatUser(userId: string): Promise<void> {
  if (!userId) return;
  await configureRevenueCat();
  if (!configured) return;
  try {
    await Purchases.logIn(userId);
  } catch (e) {
    console.warn('[iap] logIn failed', e instanceof Error ? e.message : e);
  }
}

export async function logOutRevenueCatUser(): Promise<void> {
  if (!configured) return;
  try {
    await Purchases.logOut();
  } catch {
    // ignore — anonymous user after logout is fine
  }
}

async function findPackageForPlan(planId: IapPlanId): Promise<PurchasesPackage | null> {
  const def = IAP_PRODUCTS[planId];
  const offerings = await Purchases.getOfferings();
  const current = offerings.current;
  if (!current) return null;

  const allPackages = [
    ...current.availablePackages,
    ...Object.values(offerings.all).flatMap((o) => o.availablePackages),
  ];

  const match = allPackages.find(
    (p) =>
      p.product.identifier === def.productId ||
      p.identifier === def.planId ||
      p.identifier === `$${def.planId}` ||
      p.product.identifier === def.entitlementId
  );
  return match ?? null;
}

export async function getOfferingsForPlan(planId: IapPlanId): Promise<PurchasesPackage | null> {
  await configureRevenueCat();
  if (!configured) return null;
  try {
    return await findPackageForPlan(planId);
  } catch (e) {
    console.warn('[iap] getOfferings failed', e instanceof Error ? e.message : e);
    return null;
  }
}

export async function purchasePlan(
  planId: IapPlanId
): Promise<{ ok: true; customerInfo: CustomerInfo } | { ok: false; error: string; cancelled?: boolean }> {
  await configureRevenueCat();
  if (!configured) {
    return {
      ok: false,
      error: 'In-app purchases are not configured on this build yet.',
    };
  }

  try {
    const pkg = await findPackageForPlan(planId);
    if (!pkg) {
      return {
        ok: false,
        error:
          'This plan is not available in the store yet. Check App Store / Play Console product setup.',
      };
    }

    const { customerInfo } = await Purchases.purchasePackage(pkg);
    await syncCustomerInfoToBackend(customerInfo);
    return { ok: true, customerInfo };
  } catch (e: unknown) {
    const err = e as { userCancelled?: boolean; message?: string };
    if (err?.userCancelled) {
      return { ok: false, error: 'Purchase cancelled.', cancelled: true };
    }
    return {
      ok: false,
      error: err?.message || 'Purchase failed. Please try again.',
    };
  }
}

export async function restorePurchases(): Promise<
  { ok: true; customerInfo: CustomerInfo } | { ok: false; error: string }
> {
  await configureRevenueCat();
  if (!configured) {
    return { ok: false, error: 'In-app purchases are not configured on this build yet.' };
  }
  try {
    const customerInfo = await Purchases.restorePurchases();
    await syncCustomerInfoToBackend(customerInfo);
    return { ok: true, customerInfo };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Could not restore purchases.',
    };
  }
}

/**
 * Ask our backend to mirror RevenueCat entitlements onto profiles.*_tier.
 * Also safe to call after login / restore.
 */
export async function syncCustomerInfoToBackend(
  customerInfo?: CustomerInfo
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const info = customerInfo ?? (configured ? await Purchases.getCustomerInfo() : null);
    if (!info) return { ok: true };

    const activeEntitlementIds = Object.keys(info.entitlements.active);
    const activeProductIds = Object.values(info.entitlements.active).map(
      (e) => e.productIdentifier
    );

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) return { ok: false, error: 'Not signed in.' };

    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/$/, '');
    if (!supabaseUrl) return { ok: false, error: 'Missing Supabase URL.' };

    const res = await fetch(`${supabaseUrl}/functions/v1/sync-revenuecat-entitlements`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        entitlement_ids: activeEntitlementIds,
        product_ids: activeProductIds,
        // Helpful for debugging / mapping
        mapped: activeEntitlementIds
          .map((id) => iapProductByEntitlementId(id)?.planId)
          .filter(Boolean),
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: text || `Sync failed (${res.status})` };
    }
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Could not sync subscription.',
    };
  }
}
