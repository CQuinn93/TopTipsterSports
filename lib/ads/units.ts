import { Platform } from 'react-native';

export type BannerPlacement = 'lms' | 't20';
export type RewardedPlacement = 'lmsStanding' | 't20Goalscorers';

const ANDROID = {
  lmsBanner: 'ca-app-pub-7584087980163456/3693589530',
  lmsRewarded: 'ca-app-pub-7584087980163456/5195936566',
  t20Banner: 'ca-app-pub-7584087980163456/7469183011',
  t20Rewarded: 'ca-app-pub-7584087980163456/8640357558',
} as const;

const IOS = {
  lmsBanner: 'ca-app-pub-7584087980163456/7574687894',
  lmsRewarded: 'ca-app-pub-7584087980163456/3388030871',
  t20Banner: 'ca-app-pub-7584087980163456/1009279544',
  t20Rewarded: 'ca-app-pub-7584087980163456/9903774660',
} as const;

/** Google sample IDs — used in __DEV__ so accounts are not flagged. */
const TEST = {
  banner: 'ca-app-pub-3940256099942544/6300978111',
  rewarded: 'ca-app-pub-3940256099942544/5224354917',
} as const;

function platformUnits() {
  return Platform.OS === 'ios' ? IOS : ANDROID;
}

export function bannerUnitId(placement: BannerPlacement): string {
  if (__DEV__) return TEST.banner;
  const u = platformUnits();
  return placement === 'lms' ? u.lmsBanner : u.t20Banner;
}

export function rewardedUnitId(placement: RewardedPlacement): string {
  if (__DEV__) return TEST.rewarded;
  const u = platformUnits();
  return placement === 'lmsStanding' ? u.lmsRewarded : u.t20Rewarded;
}
