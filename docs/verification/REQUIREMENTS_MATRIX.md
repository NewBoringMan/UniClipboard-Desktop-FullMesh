# Requirements traceability matrix

This is the authoritative requirement-to-evidence index. Status is one of `verified`, `partial`, `pending`, `external`, or `not-a-product`. A row may become `verified` only after its evidence file exists and names an executed command or manual acceptance record.

## Baseline and repository integrity

| ID | Requirement | Status | Implementation location | Verification | Evidence | Deliverable |
|---|---|---|---|---|---|---|
| B01 | Handoff exists, complete, untruncated | verified | uploaded handoff | line/byte/hash and section scan | `docs/audit/BASELINE.md` | source report |
| B02 | Audit three branches, SHAs, tags, licenses, LFS/submodules | verified | `upstreams.lock.json` | Git/API inspection | `docs/audit/BASELINE.md` | source bundle |
| B03 | Preserve three histories and reproducible checkout | verified | `.gitmodules`, network bootstrap, source-bundle offline bootstrap, four Git bundles and lock scripts | clean source extraction reconstructed all component repos and verified exact SHAs | `LOCAL_VERIFICATION_2026-08-23.md` | source bundle |
| B04 | Stable-to-main delta | verified | audit docs | `git rev-list` / `git diff --stat` | `docs/audit/BASELINE.md` | audit report |
| B05 | CI/toolchain/signing audit | verified | component workflows/manifests | workflow and manifest scan | `docs/audit/BASELINE.md` | audit report |

## Shared protocol and security

| ID | Requirement | Status | Implementation location | Verification | Evidence | Deliverable |
|---|---|---|---|---|---|---|
| P01 | Versioned ClipboardEvent complete field set | verified | `engine/crates/uc-core/src/clipboard/event.rs` | validation + v4 wire round-trip/tamper tests | `LOCAL_VERIFICATION_2026-08-23.md` | Engine source/AAR |
| P02 | UUIDv7 or equivalent globally unique event ID | verified | Engine event factory | UUID version/order/validation tests | `LOCAL_VERIFICATION_2026-08-23.md` | Engine source |
| P03 | Per-device monotonic sequence | verified | encrypted event repository allocation | concurrent/restart allocation tests | `LOCAL_VERIFICATION_2026-08-23.md` | Engine source |
| P04 | Event-ID deduplication | verified | durable event repository + receiver | duplicate/multipath/mailbox tests | `LOCAL_VERIFICATION_2026-08-23.md` | Engine source |
| P05 | Hash and local snapshot loop suppression | verified | capture/materialization active state | duplicate snapshot/active-state tests | `LOCAL_VERIFICATION_2026-08-23.md` | Engine source |
| P06 | Recent event LRU plus persistent window | verified | encrypted SQLite events/tombstones | eviction/restart/corruption tests | `LOCAL_VERIFICATION_2026-08-23.md` | Engine source |
| P07 | Last-observed/latest-valid convergence | verified | Engine active clipboard state | reorder/validity convergence tests | `LOCAL_VERIFICATION_2026-08-23.md` | Engine source |
| P08 | Unified text/image/file MIME representations | verified | event envelope/bindings | v4 wire fixtures and host suites | `LOCAL_VERIFICATION_2026-08-23.md` | Engine/AAR; XCFramework CI pending |
| P09 | Payload references decoupled from transport | verified | Engine content/blob/transport ports | direct/mailbox substitution tests | `LOCAL_VERIFICATION_2026-08-23.md` | Engine source |
| P10 | Sensitive persistence encrypted | verified | Engine MasterKey/AEAD stores | plaintext/corruption/restart tests | `LOCAL_VERIFICATION_2026-08-23.md`, security report | Engine source |
| P11 | No sensitive logging | verified | all components + root secret scan | seeded credential/log tests | relay/Engine tests, privacy report | redaction report |

## Connectivity, relay and mailbox

| ID | Requirement | Status | Implementation location | Verification | Evidence | Deliverable |
|---|---|---|---|---|---|---|
| N01 | LAN/IPv6/QUIC/relay route policy with fast fallback | partial | Engine Iroh transport and policy | route-forced multiprocess tests | pending | Engine source |
| N02 | Direct and relay race for text, ID dedupe wins | verified | Engine direct + encrypted mailbox coordinator | controlled completion/dedup tests | `LOCAL_VERIFICATION_2026-08-23.md` | Engine source |
| N03 | Image fast fallback | verified | Engine delivery coordinator races small text/image payloads with encrypted mailbox using the same EventId | delayed-live-path and mailbox race/dedupe tests | `LOCAL_VERIFICATION_2026-08-23.md` | Engine source |
| N04 | Large-file direct preference, relay, streaming/resume | partial | Engine blob transfer | interruption/resume/hash test | pending | Engine source |
| N05 | Network/sleep/process restart recovery without pairing | partial | Engine host lifecycle | platform lifecycle scenarios | pending | platform reports |
| N06 | Opportunity forwarding is optional, never correctness dependency | pending | Engine capability/routing | third-node removal test | pending | Engine source |
| N07 | iOS relay score low/background-limited | pending | Engine capability + iOS binding | capability contract test | pending | iOS build |
| N08 | Presence distinguishes paired/recent/realtime/restricted/offline | partial | Engine binding + client UIs | state transition tests | pending | apps |
| N09 | Blind relay deployment, public/self-host configs | pending | `relay/` | container health and forced relay test | pending | OCI/config bundle |
| N10 | Ciphertext-only short-TTL mailbox, quota, delete-on-download | verified | `relay/` plus Engine mailbox client | 11 service tests + multiprocess restart | `LOCAL_VERIFICATION_2026-08-23.md` | source; OCI pending CI |
| N11 | No MasterKey on service | verified | relay interfaces/config | protocol review + secret scan | `docs/security/THREAT_MODEL.md` | threat model |
| N12 | Health, metrics, rate limits, redacted logs | verified | `relay/` | service integration/abuse tests | `LOCAL_VERIFICATION_2026-08-23.md` | ops docs; OCI pending CI |

## Platform hosts and user experience

| ID | Requirement | Status | Implementation location | Verification | Evidence | Deliverable |
|---|---|---|---|---|---|---|
| W01 | Windows native watcher, tray/daemon/autostart, loop guard | partial | `desktop/` | Windows runner/e2e | pending | Windows packages |
| W02 | Windows text/HTML/RTF/image/file list | partial | `desktop/` platform crate | format roundtrip tests | pending | Windows packages |
| W03 | Windows x64/arm64 MSIX + EXE/MSI + portable | partial | desktop/root packaging | build/install/upgrade/uninstall | pending | Windows packages |
| M01 | macOS menu agent, NSPasteboard, lifecycle recovery | partial | `desktop/` | macOS runner/e2e | pending | app/DMG |
| M02 | Intel/Apple Silicon, universal preferred | partial | desktop release matrix | `file`, `lipo`, launch checks | pending | app/DMG |
| L01 | Linux X11/Wayland detection and restrictions | partial | desktop platform crate | Xvfb/Wayland runner scenarios | pending | Linux packages |
| L02 | Linux x86_64/aarch64 AppImage/deb/rpm, autostart/keyring | partial | desktop packaging | package/lifecycle checks | pending | Linux packages |
| A01 | Android shared Engine primary path and loop guard | partial | `mobile/` native module/services | emulator and binding tests | pending | APK/AAB |
| A02 | Share, Process Text, tile, notifications, foreground, Shizuku | partial | mobile Android host | Android instrumentation/UI tests | pending | APK/AAB |
| A03 | Background/power diagnostics and recovery | partial | mobile UI/services | permission state emulator tests | pending | APK/AAB |
| A04 | arm64, armv7, x86_64, universal APK and AAB | partial | Gradle/release workflow | local build/signature/ABI/Engine hash pass; emulator install pending | `LOCAL_VERIFICATION_2026-08-23.md` | five Android artifacts in `dist/` |
| I01 | iOS Engine identity/space/history/receive | partial | mobile iOS module | simulator tests | pending | simulator build/archive |
| I02 | Share Extension, keyboard, App Group | partial | mobile plugins/modules | Xcode build and extension tests | pending | simulator build/archive |
| I03 | APNs opportunistic; lock-screen limits truthful | partial | mobile lifecycle/docs | terminated/background behavior checklist | pending true-device acceptance | docs/archive |
| I04 | Simulator, Development/Ad Hoc IPA, TestFlight archive | external | mobile iOS workflows | Xcode build/archive/export | pending; signing assets required for IPA/TestFlight | iOS artifacts |
| H01 | Engine HAR/N-API and acceptance probe | partial | Engine Harmony binding/probes | HAR/HAP workflow and smoke test | pending | HAR/probe HAP |
| H02 | No fake Harmony product app | not-a-product | gap/release docs | manifest label check | pending | explicit limitation |
| U01 | Space creation and QR/invite join; no IP/port | partial | desktop/mobile onboarding | UI/e2e | pending | apps |
| U02 | Route diagnostics and understandable device states | partial | desktop/mobile diagnostics | UI tests/accessibility review | pending | apps |
| U03 | Pause/text-only/sensitive-app/TTL/history policies | partial | Engine settings + clients | policy contract/UI tests | pending | apps |

## Test, CI, packaging and delivery

| ID | Requirement | Status | Implementation location | Verification | Evidence | Deliverable |
|---|---|---|---|---|---|---|
| T01 | Engine unit/integration/migration/crypto gates | partial | Engine test suites | Linux CI full workspace | local baseline in `docs/audit/BASELINE.md`; CI pending | test report |
| T02 | Dedupe/loop/reorder/duplicate/multipath tests | verified | `integration/tests/` + Engine | Engine tests + four-process relay matrix | `LOCAL_VERIFICATION_2026-08-23.md` | test report |
| T03 | Windows↔Android isolated from Apple devices | pending | integration harness | Windows/Android cross-network run | pending | test report |
| T04 | Mac↔Android on iPhone hotspot | external | true-device checklist | user physical-device run | pending | acceptance record |
| T05 | UDP-blocked Windows↔Android relay | pending | integration network harness | firewall-forced CI/manual run | pending | test report |
| T06 | Sleep/network/restart/offline recovery | pending | platform harnesses | platform runner/true-device | pending | test report |
| T07 | Text/Unicode/HTML/image/file small/large | pending | fixtures/integration tests | hash and semantic roundtrip | pending | test report |
| T08 | Four-device conflict convergence | partial | Engine + four-process relay harness | four producers/idempotency pass; full UI clipboard convergence pending | `LOCAL_VERIFICATION_2026-08-23.md` | test report |
| T09 | iOS foreground/background/lock/terminate/force-quit | external | true-device checklist | user physical iPhone | pending | acceptance record |
| T10 | Install/upgrade/migrate/uninstall/clean removal | pending | `packaging/` | per-platform lifecycle jobs | pending | platform reports |
| C01 | Linux/Windows/macOS/Android/iOS CI matrix | external | root workflows | GitHub Actions | dedicated repository required | workflow reports |
| C02 | Engine AAR/XCFramework/HAR/manifest/hash/SBOM/licenses | partial | Engine release workflow | artifact manifest validation | upstream baseline; integrated build pending | Engine bundle |
| C03 | Desktop all platform/architecture packages | partial | desktop/root workflows | target runner builds/lifecycle | upstream baseline; integrated build pending | installers |
| C04 | Android APK variants and AAB, iOS archive | partial | mobile/root workflows | five Android artifacts verified; Xcode pending | `LOCAL_VERIFICATION_2026-08-23.md` | Android delivered; iOS pending CI |
| C05 | Multi-arch relay OCI | pending | relay/root workflow | container build/health/SBOM | pending | OCI archive/reference |
| C06 | Source bundle with locks and bootstrap | verified | root snapshot, integration/component Git bundles and offline bootstrap | clean extraction, offline reconstruction and SHA lock verification | `LOCAL_VERIFICATION_2026-08-23.md` | source archive |
| C07 | Unique manifest, checksums, provenance/signing/test metadata | partial | release orchestrator | local Android provenance pass; final manifest after cloud collection | Engine `provenance.json` | `dist/<version>/manifest.json` pending |
| C08 | Production secrets absent; unsigned status explicit | verified | workflows, signing requirements, artifact naming and manifest policy | repository secret scan and release-contract test passed; Android certificate independently inspected | `LOCAL_VERIFICATION_2026-08-23.md` | signing report/test packages |
| C09 | Install/start/upgrade/uninstall instructions per platform | partial | build/install docs | doc links and smoke tests | pending | manuals |
| C10 | True-device acceptance checklist | verified | `docs/verification/TRUE_DEVICE_ACCEPTANCE.md` | platform/scenario review | tracked checklist | acceptance checklist |
| C11 | Clean Git status and reproducible source archive | verified | all four repositories and source packaging script | clean statuses, clean extraction, offline reconstruction, bundle verification and lock check passed | `LOCAL_VERIFICATION_2026-08-23.md` | source archive |
| C12 | Persist source/packages/reports in accessible locations | external | GitHub + Library | download/hash recheck | pending | durable links |
