import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { fetchMyEntitlements } from '@/lib/subscriptionEntitlements';

/**
 * Free users may see ads (`show_ads === true`).
 * Owner / Gamemaster / web → never.
 */
export function useShowAds(): { showAds: boolean; loading: boolean; refresh: () => void } {
  const [showAds, setShowAds] = useState(false);
  const [loading, setLoading] = useState(Platform.OS !== 'web');

  const refresh = useCallback(() => {
    if (Platform.OS === 'web') {
      setShowAds(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    void fetchMyEntitlements()
      .then((ent) => {
        const isStaff = !!ent?.is_owner || !!ent?.is_gamemaster;
        setShowAds(!isStaff && ent?.show_ads === true);
      })
      .catch(() => setShowAds(false))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { showAds, loading, refresh };
}
