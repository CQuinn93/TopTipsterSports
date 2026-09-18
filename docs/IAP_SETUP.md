# In-app purchases (RevenueCat + App Store / Google Play)

Simple picture of how this works:

1. User taps **Subscribe** on a plan in the app  
2. Apple or Google takes payment (their sheet — we never see the card)  
3. RevenueCat tells us “this user bought Creator Plus”  
4. Our backend sets their plan in Supabase (`profiles.participant_tier` / `creator_tier`)  
5. The app already reads that via `get_my_entitlements` — limits / ads update automatically  

**Gamemaster is not an IAP** — clubs still enquire on www.toptipster.ie.

---

## What you need to give / set up

### A. Accounts (if you don’t already have them)
1. **Apple Developer** (you have this) — App Store Connect app for `com.toptipstersports.app`
2. **Google Play Console** developer account + app with package `com.toptipstersports.app`
3. Free **[RevenueCat](https://www.revenuecat.com)** account

### B. Create monthly subscriptions (same IDs on both stores)

| Product ID (exact) | Plan | Suggested price |
|---|---|---|
| `user_plus_monthly` | User Plus | €0.99 / month |
| `user_premium_monthly` | User Premium | €1.99 / month |
| `creator_monthly` | Creator | €4.99 / month |
| `creator_plus_monthly` | Creator Plus | €11.99 / month |
| `creator_pro_monthly` | Creator Pro | €21.99 / month |

Create these as **auto-renewable subscriptions** in:
- App Store Connect → Your app → Subscriptions (put them in one Subscription Group, e.g. `toptipster_plans`)
- Google Play Console → Monetize → Products → Subscriptions

### C. RevenueCat project setup
1. Create a project (e.g. **Top Tipster Sports**)
2. Add **iOS app** → bundle id `com.toptipstersports.app` → paste App Store Connect / In-App Purchase key (RevenueCat walks you through)
3. Add **Android app** → package `com.toptipstersports.app` → link Play service account
4. Add **Products** with the IDs above (link each to Apple + Google)
5. Add **Entitlements** named exactly:
   - `user_plus`
   - `user_premium`
   - `creator`
   - `creator_plus`
   - `creator_pro`  
   Attach each entitlement to its product.
6. Create an **Offering** (e.g. `default`) and add packages for each product. Mark it Current.
7. Copy **public SDK keys**:
   - iOS: `appl_...`
   - Android: `goog_...`

### D. Keys to put in your environment

**Expo / EAS (public — safe in the app):**
```
EXPO_PUBLIC_REVENUECAT_IOS_API_KEY=appl_xxxxx
EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY=goog_xxxxx
```

**Supabase Edge Function secret (private):**
```
REVENUECAT_WEBHOOK_AUTH=some-long-random-string-you-make-up
```

### E. Webhook (so renewals / cancels update the DB)
1. Deploy functions:
   ```bash
   supabase functions deploy sync-revenuecat-entitlements
   supabase functions deploy revenuecat-webhook
   ```
2. Apply migration `125_store_iap_subscriptions.sql`
3. In RevenueCat → Project settings → Integrations → Webhooks:
   - URL: `https://<YOUR_PROJECT>.supabase.co/functions/v1/revenuecat-webhook`
   - Authorization header: `Bearer <same REVENUECAT_WEBHOOK_AUTH value>`

### F. New app build
IAP only works in a real **EAS build** (TestFlight / Play internal). After adding the env keys, rebuild.

---

## What we added in the codebase

| Piece | Purpose |
|---|---|
| `react-native-purchases` | Talks to Apple/Google via RevenueCat |
| `lib/iap/*` | Configure, buy, restore, sync |
| `lib/iap/products.ts` | Product ID map (must match stores) |
| `SubscriptionPlanList` | **Subscribe** / **Restore** on native when keys exist |
| Auth login | Links RevenueCat user id = your Supabase user id |
| `sync-revenuecat-entitlements` | After buy → update `profiles` tiers |
| `revenuecat-webhook` | Renew / expire / cancel → update `profiles` |
| Migration `125_*` | Store columns + `apply_store_subscription` RPC |

Until the keys + store products exist, the app still shows **Coming soon** for purchases (safe for review).

---

## Send me when ready
1. RevenueCat iOS public key (`appl_…`)  
2. RevenueCat Android public key (`goog_…`)  
3. Confirm the five product IDs above were created (or tell me if you renamed any)  
4. (Optional) Webhook auth string you want to use  

I can then wire the keys into EAS secrets / `.env` guidance and help test a sandbox purchase.
