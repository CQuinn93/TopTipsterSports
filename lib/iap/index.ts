/**
 * Platform entry: Metro resolves revenueCat.web.ts / revenueCat.native.ts.
 */
export {
  isIapConfigured,
  configureRevenueCat,
  identifyRevenueCatUser,
  logOutRevenueCatUser,
  getOfferingsForPlan,
  purchasePlan,
  restorePurchases,
  syncCustomerInfoToBackend,
} from './revenueCat';
