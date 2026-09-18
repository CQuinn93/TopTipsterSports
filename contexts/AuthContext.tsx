import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { cancelAllSelectionReminders } from '@/lib/selectionReminderNotifications';
import { bindWebPushDeviceToCurrentUser, unbindAllWebPushDevices, unbindWebPushDevice } from '@/lib/webPush';
import {
  configureRevenueCat,
  identifyRevenueCatUser,
  logOutRevenueCatUser,
  syncCustomerInfoToBackend,
} from '@/lib/iap';

type AuthContextType = {
  session: Session | null;
  userId: string | null;
  isLoading: boolean;
  signOut: () => Promise<void>;
  signOutAllDevices: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const timeoutId = setTimeout(() => {
      if (!cancelled) setIsLoading(false);
    }, 10000);

    const clearTimeoutAndDone = () => {
      clearTimeout(timeoutId);
    };

    supabase.auth.getSession().then(
      ({ data: { session: s } }) => {
        if (!cancelled) {
          setSession(s ?? null);
          setIsLoading(false);
          if (s?.user?.id) {
            void bindWebPushDeviceToCurrentUser();
            void configureRevenueCat().then(async () => {
              await identifyRevenueCatUser(s.user!.id);
              await syncCustomerInfoToBackend();
            });
          }
        }
        clearTimeoutAndDone();
      },
      () => {
        if (!cancelled) setIsLoading(false);
        clearTimeoutAndDone();
      }
    );

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s ?? null);
      if (s?.user?.id) {
        void bindWebPushDeviceToCurrentUser();
        void configureRevenueCat().then(async () => {
          await identifyRevenueCatUser(s.user!.id);
          await syncCustomerInfoToBackend();
        });
      }
    });

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    await unbindWebPushDevice();
    await logOutRevenueCatUser();
    await cancelAllSelectionReminders();
    await supabase.auth.signOut({ scope: 'local' });
  };

  const signOutAllDevices = async () => {
    await unbindAllWebPushDevices();
    await logOutRevenueCatUser();
    await cancelAllSelectionReminders();
    await supabase.auth.signOut({ scope: 'global' });
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        userId: session?.user?.id ?? null,
        isLoading,
        signOut,
        signOutAllDevices,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
