/**
 * In-app subscription product IDs.
 *
 * Create these EXACT product IDs in:
 * - App Store Connect → Subscriptions
 * - Google Play Console → Subscriptions
 * - RevenueCat → Products (linked to both stores)
 *
 * Entitlement identifiers in RevenueCat should match the `entitlementId` values.
 */
import type { CreatorTier, ParticipantTier } from '@/lib/subscriptionEntitlements';

export type IapPlanId =
  | 'user_plus'
  | 'user_premium'
  | 'creator'
  | 'creator_plus'
  | 'creator_pro';

export type IapProductDef = {
  planId: IapPlanId;
  /** Store / RevenueCat product identifier (monthly auto-renewing). */
  productId: string;
  /** RevenueCat entitlement identifier. */
  entitlementId: string;
  kind: 'player' | 'creator';
  participantTier?: ParticipantTier;
  creatorTier?: CreatorTier;
  /** Display price hint (stores show the real localized price). */
  priceHint: string;
  title: string;
};

export const IAP_PRODUCTS: Record<IapPlanId, IapProductDef> = {
  user_plus: {
    planId: 'user_plus',
    productId: 'user_plus_monthly',
    entitlementId: 'user_plus',
    kind: 'player',
    participantTier: 'user_plus',
    priceHint: '€0.99/mo',
    title: 'User Plus',
  },
  user_premium: {
    planId: 'user_premium',
    productId: 'user_premium_monthly',
    entitlementId: 'user_premium',
    kind: 'player',
    participantTier: 'user_premium',
    priceHint: '€1.99/mo',
    title: 'User Premium',
  },
  creator: {
    planId: 'creator',
    productId: 'creator_monthly',
    entitlementId: 'creator',
    kind: 'creator',
    creatorTier: 'creator',
    priceHint: '€4.99/mo',
    title: 'Creator',
  },
  creator_plus: {
    planId: 'creator_plus',
    productId: 'creator_plus_monthly',
    entitlementId: 'creator_plus',
    kind: 'creator',
    creatorTier: 'creator_plus',
    priceHint: '€11.99/mo',
    title: 'Creator Plus',
  },
  creator_pro: {
    planId: 'creator_pro',
    productId: 'creator_pro_monthly',
    entitlementId: 'creator_pro',
    kind: 'creator',
    creatorTier: 'creator_pro',
    priceHint: '€21.99/mo',
    title: 'Creator Pro',
  },
};

export const IAP_PRODUCT_LIST = Object.values(IAP_PRODUCTS);

export function iapProductByStoreId(productId: string): IapProductDef | null {
  return IAP_PRODUCT_LIST.find((p) => p.productId === productId) ?? null;
}

export function iapProductByEntitlementId(entitlementId: string): IapProductDef | null {
  return IAP_PRODUCT_LIST.find((p) => p.entitlementId === entitlementId) ?? null;
}

export function iapProductByPlanCatalogId(catalogId: string): IapProductDef | null {
  if (catalogId in IAP_PRODUCTS) {
    return IAP_PRODUCTS[catalogId as IapPlanId];
  }
  return null;
}
