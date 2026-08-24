# UniClipboard FullMesh

UniClipboard FullMesh 将 UniClipboard Engine、桌面端和移动端锁定到可复现的跨平台发行版，目标覆盖 Windows、macOS、Linux、Android、iOS/iPadOS、Blind Relay 与短 TTL 加密离线邮箱。连接优先使用直连 QUIC；当 NAT 或网络策略阻断直连时，自动使用中继路径。

## 当前状态

冻结基线见 [`docs/audit/BASELINE.md`](docs/audit/BASELINE.md)，持续进度见 [`integration/STATUS.md`](integration/STATUS.md)。只有当 [`docs/verification/REQUIREMENTS_MATRIX.md`](docs/verification/REQUIREMENTS_MATRIX.md) 中相应条目同时给出实现位置、验证方法、证据和交付文件，能力才可标记完成。

精确 FullMesh Engine AAR 与五个 Android 测试签名包已在本地构建并完成
验证。Windows、macOS、Linux、iOS Simulator 与 Relay OCI 由专用交付仓库中
已提交的原生 Runner 矩阵负责构建。

## 一键初始化

```bash
git clone --recurse-submodules https://github.com/NewBoringMan/UniClipboard-FullMesh.git UniClipboard-FullMesh
cd UniClipboard-FullMesh
./integration/scripts/bootstrap.sh
./integration/scripts/verify-locks.sh
```

Engine 与 Desktop 固定 Rust 1.95.0；Mobile 固定 Node 22.22.1 和 Java 17。各原生平台 SDK 与构建说明见 [`docs/build/BUILDING.md`](docs/build/BUILDING.md)，安装、升级和卸载说明见 [`docs/build/INSTALLING.md`](docs/build/INSTALLING.md)。

## 安全与许可证

剪贴板数据保持端到端加密；Relay 只接触密文和必要路由元数据。签名私钥不得入库。直接继承桌面 AGPL 代码的组合交付物保持 AGPL-3.0 兼容；各上游组件继续保留原许可证声明。
