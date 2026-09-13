/**
 * Expo config. Use app.config.js so we can set web baseUrl from env.
 * - EXPO_PUBLIC_WEB_BASE_URL="" or "/" → assets at root (for www.toptipster.ie)
 * - EXPO_PUBLIC_WEB_BASE_URL="/TopTipsterRacing" or unset → project path (for github.io/TopTipsterRacing)
 */
const baseUrl = process.env.EXPO_PUBLIC_WEB_BASE_URL ?? '/TopTipsterRacing';
const webBaseUrl = baseUrl === '/' ? '' : baseUrl;
// baseUrl is for web hosting only. On iOS it prefixes assets under a folder that
// collides with the app binary (ENOTDIR during "Bundle React Native code and images").
const isNativeEasBuild =
  process.env.EAS_BUILD_PLATFORM === 'ios' ||
  process.env.EAS_BUILD_PLATFORM === 'android';

module.exports = {
  expo: {
    name: 'Top Tipster Sports',
    slug: 'top-tipster-racing',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/logo/Dark_logo.png',
    scheme: 'toptipstersports',
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,
    splash: {
      image: './assets/logo/Dark_logo.png',
      resizeMode: 'contain',
      backgroundColor: '#0a0a0a',
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.toptipstersports.app',
      buildNumber: '1',
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        UIBackgroundModes: ['remote-notification'],
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/logo/Dark_logo.png',
        backgroundColor: '#0a0a0a',
      },
      package: 'com.toptipstersports.app',
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
        'expo-notifications',
        {
          color: '#059669',
          defaultChannel: 'competition-alerts',
        },
      ],
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
      ...(!isNativeEasBuild ? { baseUrl: webBaseUrl } : {}),
    },
    owner: 'cquinn93',
    extra: {
      router: {},
      eas: {
        projectId: '9d6838b4-6dbc-4688-a9a2-dd3b1b45417e',
      },
    },
  },
};
