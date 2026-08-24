# Spec-027：FullMesh 剪贴板事件与短 TTL 密文邮箱

## 目标

让桌面、Android、iOS/iPadOS 和 HarmonyOS 宿主通过同一 Engine 事件与协议完成 direct、Iroh relay 和
短 TTL 邮箱投递，在多路径重复、乱序、重启和历史删除后仍保持幂等与回环安全。

## 事件契约

`ClipboardEventEnvelope` 固定包含：

| 字段 | 规则 |
| --- | --- |
| `event_id` | UUIDv7；同一次多路径投递逐字节相同 |
| `origin_device_id` | 当前 Space 中已认证的发送设备 |
| `origin_sequence` | 每设备持久、严格单调、非零 |
| `created_at_ms` | 发送事件创建时间，非历史条目原始捕获时间 |
| `expires_at_ms` | 晚于创建时间，TTL 不超过二十四小时 |
| `content_hash` | 与外层 `snapshot_hash` 相同 |
| `mime_representations` | 至少一项，最多 64 项，只含规范 MIME 与长度 |
| `payload_references` | 最多 256 项，只含内容寻址标识、摘要和长度 |
| `target_device_ids` | 空表示当前 Space 内默认合格目标；非空只能缩小范围 |
| `hop_count` | 初始为零，最大八；转发前递增 |
| `schema_version` | 当前为 1；未知版本拒绝 |

普通剪贴板 wire 使用版本 4，目录 manifest 使用版本 5。接收端继续解码 v1、v2、v3；旧版本没有
FullMesh 事件时继续使用现有内容摘要与自写账本兼容路径。新发送端只产生 v4/v5。

## 序号与持久重放窗口

SQLite 表 `clipboard_origin_sequence` 是每设备发送序号的唯一事实来源。分配在一个写事务中完成，取
`max(last + 1, now_ms * 1_000_000)`；系统时钟回拨、并发发送和进程重启均不能复用或降低序号。

SQLite 表 `clipboard_recent_event` 保存 `event_id` 与到期时间，不保存正文。事件落库时在同一事务写入窗口；
删除用户历史不会删除窗口 tombstone。查询只接受尚未到期的条目；维护保留到期时间最新的 10,000 条并清理
过期行。

## 出站流程

1. 应用层完成目标筛选和发送许可检查。
2. 从持久序号仓库分配 `origin_sequence`；失败则本次发送失败，不降级到可能重复的进程内序号。
3. 构造并验证一个事件信封及 v4/v5 header。
4. 负载只加密一次作为实时路径的内层密文。
5. 非文件小负载把 header 与内层密文编码为邮箱帧，再用同一 Space 传输密钥进行外层 AEAD。
6. 对每个目标并行启动实时 Iroh/QUIC 投递与邮箱上传；任一路径失败不取消另一条。
7. 文件和目录跳过邮箱，继续走 direct/relay 与 Blob 流式协议。

## 邮箱客户端契约

邮箱地址必须是 HTTPS；只有回环地址允许 HTTP 供本地测试。token 使用秘密类型持有并在 drop 时清零，
不得进入 Debug、日志、错误正文或序列化配置。

客户端派生：

```text
mailbox_id = HMAC-SHA256(space_token, "mailbox-v1|" || device_id)
event_key  = HMAC-SHA256(space_token, "event-v1|" || event_id)
```

服务端因此看不到原始设备标识和事件编号。上传包括目标 mailbox、派生 event key、TTL 与外层密文。领取返回
有界租约；只有应用层得到 Applied、Duplicate 或明确 Rejected 终态后确认，确认幂等并删除消息。暂时错误、
Engine 锁定或进程退出不确认，租约到期后可再次领取。

## 入站流程

1. 实时与邮箱接收器合并为一个应用层输入流。
2. 邮箱先解外层 AEAD并解析完整帧，再交给统一入站运行期解内层负载。
3. 校验 Space 成员、目标、TTL、跳数、schema、header 与事件的 origin/hash 一致性。
4. 在内容身份锁内查询持久 `event_id` 窗口。
5. 已见事件且历史仍在时返回重复；历史已删但 tombstone 仍在时返回重放跳过。
6. 未见事件才执行 MIME 解码、Blob 物化、加密持久化与系统剪贴板写入。
7. 活动寄存器只在合法的最新观察胜出时前进；较旧观察可以保留历史，但不得覆盖系统剪贴板。
8. 系统写入继续登记自写账本，阻止 watcher 把远端内容再次发送。

## 服务端要求

- 文件存储只能保存密文与派生键，写入必须原子且权限为仅服务用户可读写。
- 单消息、单 mailbox、总存储、TTL、租约和请求速率全部有显式上限。
- 上传按密文 SHA-256 和派生 event key 幂等；相同键不同密文拒绝。
- 领取损坏消息时返回稳定损坏结果，不把不完整内容交给客户端。
- 提供存活、就绪、Prometheus 指标与脱敏结构化日志。
- Presence 分为 `paired`、`recently-reachable`、`connected`、`background-limited`、`offline`；
  `background-limited` 不广告转发能力。
- 生产部署由 TLS 反向代理保护；服务进程不得记录 bearer token、Authorization header 或密文正文。

## 兼容与失败规则

- v1-v3 继续接收，但没有邮箱竞速和持久 `event_id` 保证。
- 未知未来 wire/schema、无效 UUIDv7、过期、目标不符、序号为零、跳数超限或摘要不一致均拒绝。
- 邮箱不可达不使实时 Iroh 路径失败；实时路径不可达也不阻止已授权邮箱上传。
- token 轮换后旧 token 不能领取新邮箱；运维方按明确迁移窗口处理旧密文，不尝试解密。
- 应用锁定时不丢弃邮箱消息，不确认租约，等待下次解锁轮询。

## 验证矩阵

- v1-v3 解码与 v4/v5 往返；header/event origin 和摘要篡改拒绝。
- 同毫秒并发序号唯一，时钟回拨与数据库重开后继续单调。
- direct 与邮箱同 `event_id` 同时到达，只创建一条历史、只写一次系统剪贴板。
- 用户删除历史后同事件重放仍被 tombstone 拒绝。
- TTL 到期、错误目标、重复上传、租约超时、重复确认、损坏密文和配额拒绝。
- Engine 锁定、进程重启、网络切换和暂时断线后消息保留并在终态后删除。
- 日志扫描确认没有正文、文件名、路径、token、MasterKey 或原始邮箱凭据。
