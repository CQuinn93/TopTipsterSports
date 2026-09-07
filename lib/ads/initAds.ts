import mobileAds from 'react-native-google-mobile-ads';

let initPromise: Promise<void> | null = null;

export function initMobileAds(): Promise<void> {
  if (!initPromise) {
    initPromise = mobileAds()
      .initialize()
      .then(() => undefined)
      .catch((e) => {
        console.warn('[ads] init failed', e);
      });
  }
  return initPromise;
}
