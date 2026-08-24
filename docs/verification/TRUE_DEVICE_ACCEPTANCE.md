# True-device acceptance checklist

Record device model, OS version, installer filename, SHA-256 and pass/fail notes for every run. Use a test space and non-sensitive fixtures.

## Common two-device flow

- Install independently on both devices; create a space on device A and join device B using the invitation/QR flow without entering an IP address or port.
- Send plain ASCII, CJK/emoji/RTL Unicode, HTML/rich text, a PNG, a JPEG, one small file, multiple files and a file larger than 1 GiB in both directions. Verify rendered semantics and the SHA-256 of every file.
- Copy the same value repeatedly and confirm one history item/activation rather than a loop. Disconnect during an image and large-file transfer, reconnect, and confirm retry/resume without duplicate history rows.
- Put one device offline, copy text, reconnect inside the configured TTL and confirm mailbox delivery. Repeat after expiry and confirm the stale item is not applied.
- Make near-simultaneous copies on four devices, reconnect them in different orders, and confirm all devices converge to the same active clipboard while retaining the other valid items in history.
- Remove one device from the space and confirm it can neither receive new content nor use relay/mailbox data. Rotate the space mailbox token after removal when using a self-hosted service.

## Windows 10/11

- Install MSIX and EXE/MSI test packages separately on clean x64 hardware; repeat the portable ZIP without installation. On ARM64 hardware, repeat with the ARM64 package.
- Verify tray/menu, hidden-window background operation, start-at-login, clipboard watcher recovery after Explorer restart, sleep/wake and Wi-Fi switching.
- Round-trip plain text, HTML, RTF, DIB/PNG image and Explorer multi-file clipboard formats. Confirm remote writes do not immediately echo back.
- Upgrade over the previous test build, then uninstall. Confirm the app, autostart entry and protocol integration are removed; user data is retained or removed exactly as selected.

## macOS

- On Apple Silicon and Intel hardware, open the DMG, drag the app to Applications, launch it, and confirm the ad-hoc/test-signing warning is accurate. If a universal build is supplied, verify the same file launches on both.
- Verify menu-bar operation, login item, NSPasteboard text/HTML/RTF/image/file URLs, sleep/wake, user fast-switch and network changes.
- Upgrade by replacing the app bundle; then remove the app and login item. Confirm no helper remains running.

## Linux

- Test AppImage, deb and rpm on representative x86_64 systems; test aarch64 packages on native ARM64 hardware.
- Under X11 and Wayland separately, verify text/image/file capabilities and that unsupported global/background clipboard behavior is explained rather than silently claimed.
- Verify tray/background launch, desktop autostart, Secret Service/keyring storage, suspend/resume, network changes, package upgrade and package removal.

## Android

- Install the ABI-specific APK matching the device and the universal APK. Verify the displayed version/signature status before joining a space.
- Test Share, Process Text, Quick Settings tile, foreground-service notification, notification permission, battery-optimization guidance and Shizuku-assisted background mode where supported.
- Reboot, force-stop, swipe away, enable battery saver, switch Wi-Fi/mobile data/hotspot and leave the device idle for at least 30 minutes. Record which clipboard operations Android permits in each state.
- Upgrade using the next test APK with the same test key, then uninstall and confirm foreground services, tiles and notification channels no longer run.

## iPhone/iPad

- Install a Development/Ad Hoc IPA only when matching Apple signing assets are supplied. Otherwise run the signed-on-device Xcode build produced from the archive.
- Verify main-app identity/space/history/receive, Share Extension, custom keyboard, App Group sharing and pasteboard permission prompts.
- Test foreground, background, locked screen, terminated, force-quit and Low Power Mode. Treat force-quit delivery as unavailable until the user reopens the app; do not report this as a background guarantee.
- Test Mac ↔ iPhone and Android ↔ iPhone while all devices use an iPhone hotspot. Record APNs wake behavior separately from actual clipboard delivery.

## HarmonyOS acceptance probe

- Install the explicitly labeled probe HAP with test signing, load the HAR/N-API module, start/stop Engine, create/recover a space and exercise one clipboard read/write callback.
- Do not treat the probe as a finished HarmonyOS product app; record DevEco, emulator/device and signing versions used.

## Relay and hostile-network checks

- Block direct UDP between Windows and Android while allowing the configured relay; confirm text and image transfer and route diagnostics report relay rather than direct.
- Stop the relay/mailbox while direct LAN remains available and confirm direct correctness. Then isolate the devices and confirm failure is explicit, bounded and recoverable after service restart.
- Verify service storage contains no fixture plaintext, MIME name, filename, stable device ID, bearer token or MasterKey; acknowledge downloads and confirm ciphertext files disappear.

