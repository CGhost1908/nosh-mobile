# Nosh Mobile

Anonymous, end-to-end encrypted, and offline-first mobile companion for [Nosh](https://github.com/CGhost1908/nosh-source).

## Features
- **Read & Edit Code Anywhere:** Syntax-highlighted code blocks, task checklists, and fast mobile formatting dock.
- **Instant Offline Access:** Notes stay stored locally on your device with full `[[Wiki-Link]]` navigation.
- **Scan Once, Stay Synced:** Pair with your desktop Nosh vault via QR code—zero account or password required.
- **Pure OLED Theme:** Switch between Dark (`#0d0f12`) and True Black OLED (`#000000`).

## Download
Grab the latest signed Android APK from [Releases](https://github.com/CGhost1908/nosh-mobile/releases/latest).

## Development
```bash
npm install
npx expo start
```

### Build Signed Android APK
Triggered automatically via GitHub Actions on pushes to `main` or tags (`v*`) in `.github/workflows/build-android-apk.yml`.
