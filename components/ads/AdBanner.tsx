import { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { bannerUnitId, type BannerPlacement } from '@/lib/ads/units';
import { useShowAds } from '@/lib/ads/useShowAds';
import { initMobileAds } from '@/lib/ads/initAds';

type Props = {
  placement: BannerPlacement;
};

export function AdBanner({ placement }: Props) {
  const insets = useSafeAreaInsets();
  const { showAds } = useShowAds();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!showAds || Platform.OS === 'web') return;
    void initMobileAds().then(() => setReady(true));
  }, [showAds]);

  if (!showAds || !ready || Platform.OS === 'web') return null;

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 4) }]}>
      <BannerAd
        unitId={bannerUnitId(placement)}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        requestOptions={{ requestNonPersonalizedAdsOnly: true }}
        onAdFailedToLoad={(e) => {
          console.warn('[ads] banner failed', placement, e);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
});
