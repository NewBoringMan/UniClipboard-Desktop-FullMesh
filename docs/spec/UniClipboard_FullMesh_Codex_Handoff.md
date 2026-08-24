# UniClipboard FullMesh：Codex 本地接管执行提示词

你是本项目唯一文件执行窗口。请直接在用户的 Mac Studio 上执行，不要只输出方案，不要把本提示词当作事实源；所有事实必须通过 Git、文件和实际构建验证。

## 0. 最终目标

基于以下三个上游公开仓库，交付一个完整、可持续维护、可复现构建的跨平台剪贴板系统：

- `https://github.com/UniClipboard/Engine`
- `https://github.com/UniClipboard/UniClipboard`
- `https://github.com/UniClipboard/UniClip`

目标体验：

1. Windows、macOS、Linux、Android 之间复制后可直接在另一设备粘贴。
2. 不要求同一 Wi‑Fi；不同网络、手机热点、蜂窝网络、CGNAT 下自动连接。
3. 路由顺序为：LAN/IPv6 直连 → QUIC/NAT 穿透 → 加密 Relay；不得因直连失败而向用户显示“离线”并停止同步。
4. 每台设备都是一等节点；Windows↔Android 不依赖 Mac 或 iPhone 在线。
5. 其他在线可信设备可以参与机会型转发，但不是必需基础设施。
6. iPhone/iPad 是完整身份节点和收件节点，但不得虚假承诺锁屏时持续充当常驻 Relay；使用 APNs、Share Extension、自定义键盘、App Group 和前台恢复补足 iOS 限制。
7. 文本、图片、文件均支持；文本优先低延迟、可采用多路径竞速；大文件使用流式传输。
8. 全程端到端加密；Relay 只能看到密文与必要路由元数据。
9. 所有终端源码、构建脚本、CI、测试、签名配置模板和发布产物统一交付。
10. 项目继续开源；凡直接继承桌面 AGPL 代码的组合交付物，保持 AGPL-3.0 兼容，不得擅自改成闭源许可证。

## 1. 工作目录与仓库布局

优先使用：

`/Volumes/MacData/Projects/UniClipboard-FullMesh`

若该卷不存在，再使用：

`~/Projects/UniClipboard-FullMesh`

建立以下结构：

```text
UniClipboard-FullMesh/
├── engine/                 # UniClipboard/Engine
├── desktop/                # UniClipboard/UniClipboard
├── mobile/                 # UniClipboard/UniClip
├── relay/                  # Relay / rendezvous / mailbox 部署与配置
├── integration/            # 三仓版本锁、协议契约、集成测试与发布编排
├── packaging/              # 全平台签名、打包、校验与安装脚本
├── docs/                   # 架构、安全、隐私、发布、运维文档
├── dist/                   # 最终产物，按版本和平台分类
├── AGENTS.md
├── README.md
├── README_ZH.md
└── upstreams.lock.json
```

不要把上游三个仓库粗暴复制后丢失 Git 历史。首选保留三个独立 Git 仓库，再由根目录 integration 仓库记录不可变提交 SHA；如最终决定使用 submodule，必须提供一键初始化脚本并验证干净机器可重建。

## 2. 第一阶段：事实审计与基线冻结

执行并记录：

- 三仓默认分支、HEAD、tag、许可证、子模块、LFS、工作区结构。
- 当前稳定 Release 与 `main` 的功能差异。
- Engine 对 desktop、Android、iOS、HarmonyOS 的绑定和发布产物。
- desktop 当前 P2P、relay fallback、剪贴板 watcher、daemon、更新器和打包状态。
- mobile 当前是否已真正接入统一 Engine；识别遗留 LAN HTTP compatibility path。
- 所有 CI workflow、构建工具链版本和签名依赖。
- 当前可通过的测试、失败测试、警告和缺失的真机验收。

输出：

- `docs/audit/BASELINE.md`
- `docs/audit/REPOSITORY_MAP.md`
- `docs/audit/GAP_MATRIX.md`
- `upstreams.lock.json`

冻结基线前不得大范围重构。

## 3. 核心协议与数据模型

在 Engine 中统一实现并由所有平台复用，平台宿主不得各自复制协议逻辑：

```text
ClipboardEvent
- event_id: UUIDv7 或等价全局唯一 ID
- origin_device_id
- origin_sequence
- created_at
- expires_at / ttl
- content_hash
- mime representations
- payload/blob references
- target_device_ids（空表示空间内默认目标）
- hop_count
- schema_version
```

必须实现：

- `event_id` 去重。
- `content_hash` + 本地剪贴板快照抑制回环。
- 每设备单调 sequence。
- recent event LRU/持久去重窗口。
- 冲突规则：默认 last-observed/latest valid event，不允许无限互相覆盖。
- 文本、图片、文件的统一 MIME 表示。
- payload 与 transport 解耦。
- 所有持久化敏感元数据默认加密。
- 日志不得出现剪贴板正文、文件名、完整路径、密码、密钥、令牌。

## 4. 连接层

实现并自动竞速，而不是长时间串行等待：

1. 同 LAN/本机可达地址直连。
2. IPv6 直连。
3. Iroh/QUIC NAT traversal。
4. 官方或自建 Blind Relay fallback。
5. 短 TTL 的加密离线 mailbox/store-and-forward。

策略要求：

- 文本事件可同时向 direct 与 relay 提交，接收端按 event_id 去重，以最低延迟路径获胜。
- 图片使用快速 fallback，不必永久三路并发。
- 大文件优先 direct，必要时 relay；支持断点/流式。
- 网络切换、睡眠唤醒、热点变化后自动恢复，无需重新配对。
- Mac、Windows、Android 等在线节点可以广告机会型 forwarding capability；不得让消息正确性依赖第三方个人设备。
- iPhone/iPad 后台 relay capability 评分必须低，锁屏后不得被视为稳定转发节点。
- Presence 必须区分：身份已配对、最近可达、实时连接、后台受限、真正离线，避免“已加入但显示永久离线”的误导。

## 5. 平台宿主

### Windows

- 使用原生剪贴板变化通知，后台 tray/daemon 自动启动。
- 处理文本、HTML/RTF、图片、文件列表。
- 收到远端事件后写系统剪贴板且触发 loop guard。
- x64 与 arm64。
- 产物：MSIX、安装型 EXE/MSI、portable ZIP。
- 支持 Authenticode；无正式证书时同时生成明确标记的 unsigned testing 产物，不得冒充正式签名。

### macOS

- 后台 agent/menu bar。
- NSPasteboard watcher、睡眠/唤醒、网络切换恢复。
- Apple Silicon 与 Intel；优先 universal binary。
- 可选 Apple Continuity Bridge 只作为增强，不作为 Windows↔Android 的依赖。
- 产物：`.app`、DMG、可选 PKG。
- 支持 Developer ID 签名与 notarization；无凭据时生成 ad-hoc/testing 产物并清晰标记。

### Linux

- X11 与 Wayland 能力检测。
- AppImage、deb、rpm；x86_64 与 aarch64。
- 后台自启动与 secret service/keyring。
- 明确处理 Wayland 下剪贴板读取限制。

### Android

- 统一 Engine 节点，不再把 LAN HTTP “服务器地址”作为主路径。
- 普通模式：Share Intent、Process Text、Quick Settings Tile、通知栏操作。
- 增强模式：前台服务、事件驱动监听。
- Power user：Shizuku/可用系统能力；权限状态可诊断、可恢复。
- 厂商省电与后台限制引导。
- 收到事件后可写系统剪贴板；防回环。
- 产物：arm64-v8a、armeabi-v7a、x86_64、universal APK，以及 AAB。
- 建立独立 release keystore；密钥只放本机安全存储或 CI Secrets，不得入库。

### iOS / iPadOS

- 接入统一 Engine 身份、加密空间、历史和收件逻辑。
- 主 App、Share Extension、自定义键盘、App Group。
- APNs/background notification 只作为机会型唤醒，不能当作必达保证。
- 锁屏后台不得承诺持续监听/转发系统剪贴板。
- 从远端收到内容后，可在合规入口中让用户快速写入/粘贴；研究并实现允许范围内的自动化。
- 产物：Simulator build、Development/Ad Hoc IPA、TestFlight archive。
- 采用用户 Apple Developer Team、明确 Bundle IDs、App Groups、Push entitlement 和 provisioning profile。

### HarmonyOS

- 先验证 Engine HAR/N-API 与验收宿主。
- 产品客户端若上游尚未完成，单列为后续平台，不得用 probe 工程冒充正式 App。
- 有 DevEco/签名环境时生成 HAR/HAP；否则输出可复现源码和未完成原因。

## 6. Relay 与离线邮箱

在 `relay/` 提供：

- 官方 Iroh relay 配置或兼容部署。
- Rendezvous/presence 必需最小服务。
- 可选 encrypted mailbox：只保存密文、短 TTL、按设备/空间限额、下载后删除。
- Dockerfile、Compose、健康检查、指标、日志脱敏、速率限制。
- 自托管和默认公共 relay 两种配置。
- 服务端绝无 MasterKey。
- 威胁模型与元数据泄漏说明。

## 7. UI/体验

- 首次设备创建空间；其他设备扫码/邀请码加入。
- 用户不需要填写 IP、端口或判断网络。
- 显示“正在通过直连/中继”可放在诊断页，不打扰主流程。
- 设备状态用可理解文案：在线、后台受限、最近在线、等待该设备启动。
- 提供网络诊断：直连、hole punch、relay、APNs、系统权限、后台限制。
- 默认复制即同步；可按设备/类型/敏感 App 设置同步策略。
- 支持暂停、仅文本、排除密码管理器、TTL、剪贴板历史保留时间。

## 8. 测试关卡

任何平台不得只因“能编译”就标记完成。

必须覆盖：

- Engine 单元/集成/迁移/加密测试。
- event 去重、回环抑制、乱序、重复、多路径竞速。
- Windows↔Android，不同网络，Mac/iPhone 都离线。
- Mac↔Android，双方连接同一 iPhone 热点。
- Windows 公司网络/UDP blocked ↔ Android 5G，自动 relay。
- 睡眠/唤醒、网络切换、进程重启、设备短时离线。
- 文本、Unicode、HTML、图片、文件、小文件和大文件。
- 四台设备同时复制时的冲突与收敛。
- iPhone 前台、后台、锁屏、被系统终止、用户强退后的真实行为。
- 安装、升级、降级/迁移、卸载保留数据和彻底清除。
- 至少一台物理 Android、一台物理 iPhone、Mac、Windows 真机闭环。

在 `integration/tests/` 和 `docs/verification/` 保存脚本、结果和证据。

## 9. CI/CD 与最终产物

建立统一发布流水线：

- Engine Release：Rust、Android AAR、iOS XCFramework、HarmonyOS HAR、manifest、SHA-256、SBOM、许可证清单。
- Desktop：Windows/macOS/Linux 构建矩阵。
- Mobile：Android APK/AAB；iOS archive/TestFlight。
- Relay：OCI image，多架构。
- Source bundle：根集成仓库 + 三仓锁定 SHA + 一键 bootstrap。
- 所有产物生成 SHA-256、版本、源码提交、签名状态、构建 runner、测试结果。
- `dist/<version>/manifest.json` 是唯一发布清单。
- 签名凭据不存在时，不得失败后静默跳过；必须产出明确的 `unsigned-testing` 标识和阻断报告。

最终目录至少包括：

```text
dist/<version>/
├── source/
├── engine/
├── windows/
├── macos/
├── linux/
├── android/
├── ios/
├── harmonyos/
├── relay/
├── checksums/
├── sbom/
├── test-reports/
└── manifest.json
```

## 10. 执行纪律

- 每次修改前读取最近的 `AGENTS.md`、CONTEXT、贡献规范和目录级指令。
- 不得删除上游能力来“简化构建”。
- 不得用 mock、空实现、占位二进制或未运行测试冒充完成。
- 每修复一个问题后继续执行完整相关测试，防止引入新错误。
- 不把签名秘密、密码、证书私钥、keystore、App Store Connect API 私钥提交到 Git。
- 大改动采用小提交；提交信息说明范围和验证。
- 遇到架构漂移立即停止，回到本提示词的最终目标与 GAP_MATRIX 核验。
- 不询问已经能从仓库、系统或凭据状态中确认的信息。
- 缺少签名凭据时继续完成源码和 unsigned testing 构建，同时生成精确的凭据缺口，不得停在纯方案阶段。

## 11. 完成定义

只有同时满足以下条件才可宣布完成：

1. 全部源码已交付，并锁定三仓提交来源。
2. Windows、macOS、Linux、Android 的真实安装包构建成功并完成至少一轮真机互传。
3. iOS archive 成功；有签名凭据时已上传 TestFlight，否则 Development/Ad Hoc 阻断点明确且其余 iOS 构建通过。
4. 不同网络下 Windows↔Android 无需 Mac/iPhone 即可同步。
5. 直连失败时自动 relay，不要求用户输入 IP。
6. iPhone 锁屏限制被真实记录，不以虚假后台能力通过验收。
7. 所有测试报告、校验值、SBOM、签名状态和安装说明进入 `dist/<version>/`。
8. 根 README 提供一键安装/构建/配对说明。
9. `git status` 干净，CI 通过，没有秘密泄漏。
10. 给用户最终文件清单、版本号、各平台安装包路径和已知限制；不只给“完成了”的口头结论。

开始执行时，先输出基线审计结论和实际工作目录，然后直接进入实现。不要要求用户重复确认已经在本提示词中确定的目标。
