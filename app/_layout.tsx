import '../global.css';
import { useEffect } from 'react';
import { Platform, Text, TextInput } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '@/contexts/AuthContext';
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext';
import { darkTheme } from '@/constants/theme';
import { setNotificationHandler } from '@/lib/selectionReminderNotifications';
import { initMobileAds } from '@/lib/ads/initAds';

SplashScreen.preventAutoHideAsync();

setNotificationHandler();

function RootLayoutContent() {
  const theme = useTheme();

  useEffect(() => {
    if (Platform.OS === 'web') return;
    void initMobileAds();
  }, []);

  return (
    <>
      <StatusBar style={theme.colors.background === darkTheme.colors.background ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.background },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="competition-hub" />
        <Stack.Screen name="gamemaster-hub" />
        <Stack.Screen name="subscriptions" />
        <Stack.Screen name="kiosk" />
        <Stack.Screen name="getting-started" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(app)" />
        <Stack.Screen name="(lms)" />
        <Stack.Screen name="(f2t)" />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    'Laraz-Regular': require('../assets/fonts/LARAZ Regular.ttf'),
    'Laraz-Light': require('../assets/fonts/LARAZ Light.ttf'),
    'Swish-Regular': require('../assets/fonts/Swish-Regular.ttf'),
    'Polygon-Regular': require('../assets/fonts/Polygon-Regular.otf'),
    'Polygon-Italic': require('../assets/fonts/Polygon-Italic.otf'),
    'BaiJamjuree-ExtraLight': require('../assets/fonts/BaiJamjuree-ExtraLight.ttf'),
    'BaiJamjuree-Light': require('../assets/fonts/BaiJamjuree-Light.ttf'),
    'BaiJamjuree-Regular': require('../assets/fonts/BaiJamjuree-Regular.ttf'),
    'BaiJamjuree-Medium': require('../assets/fonts/BaiJamjuree-Medium.ttf'),
    'BaiJamjuree-SemiBold': require('../assets/fonts/BaiJamjuree-SemiBold.ttf'),
    'BaiJamjuree-Bold': require('../assets/fonts/BaiJamjuree-Bold.ttf'),
  });

  const isWeb = Platform.OS === 'web';

  useEffect(() => {
    if (isWeb) {
      // Keep web text sizing consistent with app styles (avoid browser/OS inflation).
      (Text as typeof Text & { defaultProps?: { allowFontScaling?: boolean } }).defaultProps = {
        ...((Text as typeof Text & { defaultProps?: { allowFontScaling?: boolean } }).defaultProps ?? {}),
        allowFontScaling: false,
      };
      (TextInput as typeof TextInput & { defaultProps?: { allowFontScaling?: boolean } }).defaultProps = {
        ...((TextInput as typeof TextInput & { defaultProps?: { allowFontScaling?: boolean } }).defaultProps ?? {}),
        allowFontScaling: false,
      };
    }
  }, [isWeb]);

  useEffect(() => {
    if (isWeb || fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [isWeb, fontsLoaded, fontError]);

  const ready = isWeb || fontsLoaded || fontError;
  if (!ready) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <ThemeProvider>
          <RootLayoutContent />
        </ThemeProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
