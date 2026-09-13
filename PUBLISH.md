# Publishing: APK + TestFlight

## Prerequisites

- **Expo account**: Sign up at [expo.dev](https://expo.dev) if needed.
- **Apple Developer account** ($99/year) for TestFlight / App Store.
- **EAS CLI** installed: `npm install -g eas-cli`

Log in once:

```bash
eas login
```

---

## 1. Android APK (for testing / direct install)

Build an APK using the **preview** profile (outputs `.apk`):

```bash
eas build --platform android --profile preview
```

When the build finishes, EAS will show a link to download the APK. Use that link to install on devices or share with testers.

For a **production** Android build (Play Store uses AAB, not APK):

```bash
eas build --platform android --profile production
```

---

## 2. iOS build + TestFlight

### First-time setup (Apple credentials)

- Ensure your Apple Developer account is active and you have an App Store Connect app for this bundle ID: `com.toptipstersports.app`.
- Run a build once; EAS will prompt for Apple ID and help set up credentials:

```bash
eas build --platform ios --profile production
```

If you need to configure or fix credentials later:

```bash
eas credentials --platform ios
```

### Build and submit to TestFlight

**Option A – Build, then submit manually**

```bash
# Build
eas build --platform ios --profile production

# After build completes, submit the latest build to TestFlight
eas submit --platform ios --latest
```

**Option B – Build and auto-submit**

```bash
eas build --platform ios --profile production --auto-submit
```

EAS will build and then submit the build to TestFlight. You may be prompted for your Apple ID and App-Specific Password the first time.

### After submission

- In [App Store Connect](https://appstoreconnect.apple.com) → your app → **TestFlight**, wait for the build to finish processing (often 5–15 minutes).
- Add internal testers (team) or external testers (groups) and they’ll get the TestFlight invite.

---

## Build both platforms

```bash
# Android APK + iOS (no submit)
eas build --platform all --profile preview

# Or production iOS + production Android AAB
eas build --platform all --profile production
```

---

## Quick reference

| Goal              | Command |
|-------------------|--------|
| Android APK       | `eas build -p android --profile preview` |
| iOS for TestFlight| `eas build -p ios --profile production`  |
| Submit last iOS   | `eas submit -p ios --latest`             |
| Build + submit iOS| `eas build -p ios --profile production --auto-submit` |
