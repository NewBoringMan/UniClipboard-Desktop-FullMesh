# Production signing requirements

All unsigned, ad-hoc or test-signed artifacts must remain labeled testing-only. Supply secrets through protected CI variables or runner keychains; never commit them.

- Windows: an Authenticode code-signing certificate/private key available to the Windows runner, its password, timestamp authority URL, and the expected publisher identity for MSIX.
- macOS: Apple Developer ID Application certificate/private key, Team ID, App Store Connect notarization key (issuer, key ID and private key), and approved bundle identifiers/entitlements.
- Android: dedicated release keystore, alias and both passwords. The test keystore is not a production identity.
- iOS/iPadOS: Team ID, distribution/development certificates, App IDs for the app/Share/Keyboard targets, matching App Group, provisioning profiles, export method and APNs entitlement/key where wake testing is required.
- HarmonyOS: application/bundle identity, signing certificate/profile/private key and compatible DevEco command-line environment for the acceptance probe.

No store publication is part of this delivery. After assets are provided, the minimum remaining operation is to place them in the documented protected CI secrets, rerun the release workflow and verify each platform signature/notarization report.
