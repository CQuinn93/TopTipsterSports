/**
 * Web stub — IAP is native-only. Web keeps Stripe / coming-soon flows separately.
 */
import type { IapPlanId } from '@/lib/iap/products';

export function isIapConfigured(): boolean {
  return false;
}

export async function configureRevenueCat(): Promise<void> {}

export async function identifyRevenueCatUser(_userId: string): Promise<void> {}

export async function logOutRevenueCatUser(): Promise<void> {}

export async function getOfferingsForPlan(_planId: IapPlanId): Promise<null> {
  return null;
}

export async function purchasePlan(
  _planId: IapPlanId
): Promise<{ ok: false; error: string }> {
  return { ok: false, error: 'In-app purchases are only available in the iOS and Android apps.' };
}

export async function restorePurchases(): Promise<{ ok: false; error: string }> {
  return { ok: false, error: 'Restore is only available in the iOS and Android apps.' };
}

export async function syncCustomerInfoToBackend(): Promise<{ ok: true } | { ok: false; error: string }> {
  return { ok: true };
}
