# Installation, upgrade and removal

Release `0.1.0-alpha.1` is a testing candidate. Verify every file against
`dist/0.1.0-alpha.1/checksums/SHA256SUMS` before use. Test/ad-hoc signatures
are deliberately not presented as production trust.

## Windows 10 1809 or newer

- MSIX: import the adjacent `-testing.cer` into the current user's **Trusted
  People** store, then run `Add-AppxPackage <package.msix>`. Upgrade with a
  higher-version package and the same publisher. Remove with
  `Get-AppxPackage UniClipboard.FullMesh | Remove-AppxPackage`.
- MSI: run `msiexec /i <package.msi>`; upgrade by installing the newer MSI;
  remove with Apps & Features or `msiexec /x <package.msi>`.
- NSIS EXE: launch the installer as the target user and use its uninstaller or
  Apps & Features for removal.
- Portable ZIP: extract the complete archive and run `UniClipboard.exe` beside
  `uniclipd.exe` and `portable.dat`. Upgrade by replacing the extracted folder
  while the app is stopped; remove the folder to uninstall.

Windows packages are produced separately for x64 and ARM64. The test MSIX uses
a 30-day ephemeral certificate; its private key is deleted by the build.

## macOS 12.5 or newer

Open the DMG and copy UniClipboard.app to Applications. Testing builds are
ad-hoc signed; inspect them with `codesign --verify --deep --strict --verbose=2
UniClipboard.app`. Upgrade by quitting the app and replacing the bundle. To
remove it, disable its login item, move the app to Trash and stop/remove any
remaining UniClipboard login helper selected by the user.

Artifacts are built for Apple Silicon and Intel; a universal archive, when
present, contains both slices and must pass `lipo -verify_arch arm64 x86_64`.

## Linux

- AppImage: `chmod +x <file>.AppImage` and run it; replace the file to upgrade
  and delete it to remove the app.
- Debian/Ubuntu: `sudo apt install ./<file>.deb`; use a newer package to upgrade;
  `sudo apt remove uniclipboard` removes the package.
- RPM-family: `sudo dnf install ./<file>.rpm`; repeat with a newer package to
  upgrade; `sudo dnf remove uniclipboard` removes it.

Packages are produced for x86_64 and aarch64 on the corresponding native Linux
runner. Wayland may restrict unattended clipboard reads; the diagnostics page
must report that limitation instead of claiming background access.

## Android 7.0 (API 24) or newer

Choose `arm64-v8a` for most current devices, `armeabi-v7a` for 32-bit ARM,
`x86_64` for an emulator/compatible device, or the larger universal APK.

```bash
adb install UniClipboard-FullMesh-0.1.0-alpha.1-android-universal-test-signed.apk
adb install -r <newer-test-apk>
adb uninstall app.uniclipboard.android
```

The APKs use Android Debug testing identity SHA-256
`fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`
and APK Signature Scheme v2. The AAB is for bundle tooling/store ingestion and
is not directly installable. Production upgrade compatibility begins only
after the dedicated release keystore is supplied and held stable.

## iOS and iPadOS 16.4 or newer

The unsigned Simulator ZIP installs with `xcrun simctl install booted
<path-to-UniClip.app>`. A Development/Ad Hoc IPA requires the matching Team,
App IDs, App Group and provisioning profiles described in
`SIGNING_REQUIREMENTS.md`; install it through Xcode/Apple Configurator or the
authorized distribution channel. Upgrade with the same application identity
and signing team. Remove the app normally from the device or Simulator.

The unsigned Simulator build cannot validate APNs, lock-screen scheduling or
real pasteboard policy. Those remain true-device checks.

## HarmonyOS

The deliverable is the Engine HAR/N-API source and an explicitly labeled probe,
not a product client. Build/install the probe HAP only with a compatible DevEco
and testing signing profile. Removal uses the normal HarmonyOS app management
flow. No probe HAP may be described as the UniClipboard product application.

## Relay

For local evaluation use `docker compose up --build` under `relay/`. Production
operators must configure TLS, hashed per-space bearer tokens and the pinned Iroh
relay as described in `relay/README.md`; remove the deployment with the same
Compose project after backing up only the encrypted mailbox data that policy
requires.
