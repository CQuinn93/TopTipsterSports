/**
 * Expo config. Use app.config.js so we can set web baseUrl from env.
 * - EXPO_PUBLIC_WEB_BASE_URL="" or "/" → assets at root (for www.toptipster.ie)
 * - EXPO_PUBLIC_WEB_BASE_URL="/TopTipsterRacing" or unset → project path (for github.io/TopTipsterRacing)
 */
const baseUrl = process.env.EXPO_PUBLIC_WEB_BASE_URL ?? '/TopTipsterRacing';
const webBaseUrl = baseUrl === '/' ? '' : baseUrl;

module.exports = {
  expo: {
    name: 'Top Tipster Racing',
    slug: 'cheltenham-top-tipster',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/logo/Dark_logo.png',
    scheme: 'cheltenhamtipster',
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,
    splash: {
      image: './assets/logo/Dark_logo.png',
      resizeMode: 'contain',
      backgroundColor: '#0a0a0a',
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.cheltenhamtoptipster.app',
      buildNumber: '1',
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/logo/Dark_logo.png',
        backgroundColor: '#0a0a0a',
      },
      package: 'com.cheltenhamtoptipster.app',
      versionCode: 1,
    },
    web: {
      bundler: 'metro',
      // SPA: dynamic routes like /[competitionId] must not require prebuilt HTML per id
      output: 'single',
      favicon: './assets/logo/Dark_logo.png',
      name: 'Top Tipster',
      shortName: 'Top Tipster',
      themeColor: '#0a0a0a',
      backgroundColor: '#0a0a0a',
    },
    plugins: [
      'expo-router',
      [
        'expo-font',
        {
          fonts: [
            './assets/fonts/LARAZ Regular.ttf',
            './assets/fonts/LARAZ Light.ttf',
          ],
        },
      ],
      '@react-native-community/datetimepicker',
      [
        'react-native-google-mobile-ads',
        {
          androidAppId: 'ca-app-pub-7584087980163456~8592256097',
          iosAppId: 'ca-app-pub-7584087980163456~6215811092',
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
      baseUrl: webBaseUrl,
    },
    extra: {
      router: {},
      eas: {
        projectId: '46f6a025-ceba-46ea-bd70-26cf8328c4d1',
      },
    },
  },
};
