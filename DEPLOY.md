# Deploying to TestFlight (iOS) and Android testing

This project uses [EAS Build](https://docs.expo.dev/build/introduction/) and EAS Submit. Follow these steps to get builds on TestFlight and to testers on Android.

## Prerequisites

- **Expo account** – [expo.dev](https://expo.dev) (sign up if needed).
- **Apple Developer Program** ($99/year) – for TestFlight and App Store.
- **Google Play Console** ($25 one-time) – optional for Play Store tracks; you can also share an APK for testing.

Install EAS CLI and log in:

```bash
npm install -g eas-cli
eas login
```

Link the project to EAS (first time only):

```bash
eas build:configure
```

(You already have `eas.json`; this will confirm or update it.)

---

## iOS – TestFlight

1. **Create the app in App Store Connect** (if not already):
   - [App Store Connect](https://appstoreconnect.apple.com) → Apps → + → New App.
   - Use bundle ID: `com.toptipstersports.app`.

2. **Build for iOS** (production build for TestFlight):
   ```bash
   eas build --platform ios --profile production
   ```
   - First run: EAS will prompt for Apple credentials and can create/use a distribution certificate and provisioning profile.
   - Wait for the build to finish on [expo.dev](https://expo.dev).

3. **Submit to TestFlight**  
   Either let EAS submit the last build:
   ```bash
   eas submit --platform ios --latest
   ```
   Or submit a specific build:
   ```bash
   eas submit --platform ios --id <build-id>
   ```
   When prompted, use your Apple ID and select the app. The build will appear in App Store Connect → TestFlight after processing.

4. **Add testers**
   - App Store Connect → your app → TestFlight.
   - **Internal testing**: add team members (no review).
   - **External testing**: add a group and submit the build for Beta App Review (first time); then add testers by email.

5. **Bump version for future builds**  
   In `app.json`, increase `expo.version` (e.g. `1.0.1`). EAS can auto-increment the iOS build number (see `eas.json` → `production` → `autoIncrement`).

---

## Android – testing

You can either use **Google Play internal testing** or **direct APK** for testers.

### Option A: Google Play Internal testing

1. **Create the app in Play Console** (if not already):
   - [Google Play Console](https://play.google.com/console) → Create app.
   - Use package name: `com.toptipstersports.app`.

2. **Build an AAB** (production profile):
   ```bash
   eas build --platform android --profile production
   ```

3. **Submit to the internal testing track**:
   ```bash
   eas submit --platform android --latest --track internal
   ```
   Or upload the AAB manually in Play Console → Release → Testing → Internal testing → Create new release.

4. **Add testers**
   - Play Console → your app → Testing → Internal testing → Testers.
   - Create a list and add emails; testers get a link to opt in and install from the Play Store.

### Option B: Direct APK for testers (no Play Store)

1. **Build an APK** (preview profile):
   ```bash
   eas build --platform android --profile preview
   ```

2. **Download and share**
   - In [expo.dev](https://expo.dev) → your project → Builds, download the APK.
   - Share the file (e.g. via link or email). Testers enable “Install from unknown sources” (or “Install unknown apps”) for the browser/app they use to install.

For each new version, bump `version` in `app.json` and increment `android.versionCode` in `app.json` (required for Play Store; good practice for APK too).

---

## Build profiles (eas.json)

- **development** – dev client / simulator (iOS) or APK (Android), internal only.
- **preview** – APK for both platforms; good for ad-hoc or direct Android testing.
- **production** – iOS: App Store/TestFlight; Android: AAB for Play Store (or internal track).

Use the same profile for build and submit when using `--auto-submit`:

```bash
eas build --platform all --profile production --auto-submit
```

(Configure Apple and optionally Google credentials in the submit step or in `eas.json` under `submit`.)

---

## Environment / secrets

- Store API keys and secrets in [EAS Secrets](https://docs.expo.dev/build-reference/variables/#using-secrets-in-environment-variables):  
  **expo.dev** → your project → Secrets.
- Your app already reads from `.env`; in EAS Build, use the “Secrets” tab or `env` in `eas.json` so those values are available at build time.

Once your first iOS build is submitted to TestFlight and (if you use Play) your first Android build is on the internal track, testers can install and use the app from TestFlight and the Play Store testing page (or via the APK link).
