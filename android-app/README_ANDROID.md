# Molecule Builder Android Wrapper

This folder contains a standalone Android app that wraps the hosted Molecule Builder site in a mobile-friendly WebView shell.

## What the app includes

- A first-run consent screen before the app starts using the internet
- A configurable server URL for Cloudflare, ngrok, or LAN links
- Loading, retry, and offline states
- Pull-to-refresh support
- Back-button navigation inside the web app

## Build the APK

Run:

```bat
build_android_apk.bat
```

That script:

1. Downloads or reuses the portable JDK, Android SDK, and Gradle
2. Creates or reuses a local release signing key
3. Builds both debug and release APKs
4. Publishes the latest release APK into `..\static\downloads\MoleculeBuilder-android.apk`

## Output files

- Debug build output:
  `app\build\outputs\apk\debug\app-debug.apk`
- Release build output:
  `app\build\outputs\apk\release\app-release.apk`
- Published release copy:
  `..\static\downloads\MoleculeBuilder-android.apk`
- Named published copies:
  `..\static\downloads\MoleculeBuilder-android-debug.apk`
  `..\static\downloads\MoleculeBuilder-android-release.apk`

## Share the APK

If the public tunnel is running, share:

```text
https://<your-cloudflare-or-ngrok-url>/downloads/MoleculeBuilder-android.apk
```

The helper `..\start_public_tunnel.py` now also writes:

- `..\logs\public_url.txt`
- `..\logs\public_apk_url.txt`

## Signing files

The release keystore is created locally in:

- `signing\moleculebuilder-release.jks`
- `signing\keystore.properties`

Keep both files safe. You will need the same signing key for future app updates.

## Install on Android

Open the APK link on the phone, download it, and allow installation from that browser or file manager when Android prompts for it.
