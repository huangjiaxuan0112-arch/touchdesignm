# Nature Touch｜Arduino 10 秒预充气候选

2026-11-12（东京时间）。WIND、WAVE、BUBBLE 的 **30,000 ms 源码候选与离线验证已完成**。三种模式均只延长第一段预充气。原 15 秒触觉节奏逐段保留，末尾 5 秒抽气整体后移。

## 基线与回退

当前工作区位于 `integration/v3-friend-ui`，HEAD 为 `5356f28ee2850da49864c25aae0b923d9abcdb8b`，开始时已有未提交改动。上一轮通过 10 秒 Preparing 和 25 秒 Projector 验收的源码就在此处。R1–R5 历史基线 `aca535f253653fa8da84d92a5b7016efcb1188e7` 及其工作树与当前工作区是不同 Git 状态。修改前，两个工作树的 Unified 固件七份文件 SHA-256 全部一致。本轮在已验证的软件工作区只调整同一份 Unified 时间表及 TS 镜像。

已阅读本工作区的 10 秒 Preparing 报告、Git 历史中的 R1–R5 基线报告，以及下载目录和基线分支中的单一基线规范。两份基线文档在本工作区的 `docs/` 内没有副本。

原始 25 秒 Unified 固件七份文件及 TS 镜像按原字节保存在 `.handover-backups/20261112-before-10s-inflation/`，附 `sha256.json`。原三张动作表逐项与正式 RC5 封存动作表相同。回退源码时对应恢复 `experience-timelines.h`、`nature_touch_unified.ino`、`firmware-version.h` 和 `experience-definitions.ts` 四份副本。官方 RC5 Launcher、Bundle、Manifest 和固件资产继续使用原封存文件。

## 时间线与软件对照

| 阶段 | 原 25 秒 Arduino | 30 秒 Arduino 候选 | 当前软件 |
| --- | --- | --- | --- |
| INFLATE | 0–5 s | 0–10 s | Main Waiting / iPad Preparing 10,000 ms，Projector 从 ACK 后播放 |
| EXPERIENCE | 5–20 s | 10–25 s | 15,000 ms，Projector 连续播放至 T≈25 s |
| DEFLATE | 20–25 s | 25–30 s | Projector 回 Standby，Main 等待设备完成 |
| 设备完成 | T≈25 s | T≈30 s | Mock 30,000 ms，Main 核对当前操作的设备 `COMPLETED` 与 Projector `ended` |
| COOLDOWN / READY | 旧版正常约 T=28 s READY | 完成确认后冷却 3,000 ms，理想约 T=33 s READY | 冷却仍由 Main 管理 |

固件动作以本地调度开始为零点，Main 以收到 START ACK 为零点。表中对齐的是标称相位，实物测量仍需计入通信、调度和机械响应。固件继续在完成前请求执行器 OFF，再进入 `COMPLETED`。Marker 在 0、10,000、25,000 和 30,000 ms 发出，依次为 `INITIAL FILL`、`EXPERIENCE START`、`FINAL SHRINK` 和各模式原有的结束文案。TS 起点、区间和总时长与实际固件遥测一致。

## 三模式动作表

区间以 ms 计，左闭右开。充与抽表示调度动作方向。每列独立按时间顺序读。

| 段 | WIND | WAVE | BUBBLE |
| --- | --- | --- | --- |
| 预充 | 0–10000 充 | 0–10000 充 | 0–10000 充 |
| 体验 1 | 10000–11600 抽 | 10000–12000 抽 | 10000–11080 抽 |
| 体验 2 | 11600–13000 充 | 12000–14500 充 | 11080–12400 充 |
| 体验 3 | 13000–14550 抽 | 14500–16500 抽 | 12400–13615 抽 |
| 体验 4 | 14550–15700 充 | 16500–19000 充 | 13615–15100 充 |
| 体验 5 | 15700–17700 抽 | 19000–21000 抽 | 15100–16067 抽 |
| 体验 6 | 17700–19400 充 | 21000–23500 充 | 16067–17250 充 |
| 体验 7 | 19400–21250 抽 | 23500–24500 抽 | 17250–18532 抽 |
| 体验 8 | 21250–22800 充 | 24500–25000 充 | 18532–20100 充 |
| 体验 9 | 22800–23950 抽 | — | 20100–21202 抽 |
| 体验 10 | 23950–25000 充 | — | 21202–22550 充 |
| 体验 11 | — | — | 22550–23652 抽 |
| 体验 12 | — | — | 23652–25000 充 |
| 收尾 | 25000–30000 抽 | 25000–30000 抽 | 25000–30000 抽 |

逐段比较结果为 WIND 10/10、WAVE 8/8、BUBBLE 12/12 个体验段的方向、顺序及标称持续时间完全一致。各模式体验段合计 15,000 ms。除首段从 5,000 改为 10,000 ms，其余每段开始和结束均平移 5,000 ms。详见 [动作表对照和校验结果](../.validation/10s-inflation-firmware/timeline-comparison.json)。

## 500/300 ms 对执行窗口的影响

对当前开发源码中的驱动，改变方向时先请求两泵 OFF，等待 500 ms，再请求阀位置并等待 300 ms。调度截止点继续按动作表计算。用假的 Servo 和毫秒时钟执行原驱动代码，三模式验证了每段前 800 ms 无泵 ON。首段 10,000 ms 的理论 ON 指令窗口为 T=800–10,000 ms，约 9,200 ms，原 5 秒首段在同一驱动下约 4,200 ms。最后 5 秒抽气的理论 ON 指令窗口为 T=25,800–30,000 ms，约 4,200 ms。

三模式 15 秒体验内的理论泵 ON 指令总窗分别为 WIND 7,000 ms、WAVE 8,900 ms、BUBBLE 5,400 ms。WAVE 的 T=24,500–25,000 ms 原有充气动作只有 500 ms，下一段抽气会替换尚未放行的充气请求，这段充气产生 0 ms 泵 ON 指令。STOP 与 FAULT 分别在等待泵停及等待阀稳定时均取消了 pending，之后持续请求 OFF。上述时间是软件命令窗口，实体泵启停、压力与流量待测。

## 修改文件

| 文件 | 内容 |
| --- | --- |
| `firmware/unified/nature_touch_unified/experience-timelines.h` | 三张表首段改为 10,000 ms，其余段保留并更新绝对区间 |
| `firmware/unified/nature_touch_unified/nature_touch_unified.ino` | 三模式时长声明改为 30,000 ms，体验和收尾 Marker 后移 |
| `firmware/unified/nature_touch_unified/firmware-version.h` | 时间表指纹更新为 `30s-2bcc1b95`，固件版本和来源基线保持原值 |
| `desktop/shared/experience-definitions.ts` | 同步动作表、Marker 与总时长 |
| `test/experience-definitions.test.ts`、`test/firmware-timeline.test.ts`、`test/mock-experience-controller.test.ts` | 校验全部动作及偏移、软件边界与 Mock 30 秒完成 |
| `test/exhibition-lifecycle-controller.test.ts`、`test/arduino-firmware-service.test.ts`、`test/exhibition-routing.test.ts` | 校正时间夹具，验证 30 秒完成、冷却和候选身份仍被既有门禁拒绝 |
| `test/unified-controller/verify.mjs` | 实际 Nano 模拟固件检查 Marker、时长、完成及回归边界 |
| `test/unified-controller/actuator-windows.cpp`、`test/unified-controller/verify-actuator-windows.mjs` | 对原驱动链接假的 Servo，离线验证命令窗口及 pending 取消 |
| `docs/NATURE_TOUCH_10S_INFLATION_FIRMWARE_CANDIDATE.md` | 本报告 |

## 离线验证

| 命令与范围 | 结果 |
| --- | --- |
| `node test/unified-controller/verify.mjs`，在仓库根目录执行，`UNIFIED_RESULTS` 指向 `.validation/10s-inflation-firmware/avr8js` | **PASS 11/11**。默认模拟配置编译通过。Flash 10,526 bytes，静态 SRAM 1,321 bytes。三模式固件毫秒计数均在 30,000 ms 完成，记录的各段最大标称偏差为 0 ms |
| `node test/unified-controller/verify-actuator-windows.mjs` | **PASS 7/7**。三模式泵命令窗口、互斥、完成后 OFF，以及 STOP / FAULT 在两个等待阶段取消 |
| 在 `desktop` 执行 `tsx --test --test-timeout=15000`，文件列表见下方 | **PASS 152/152**。包括 Protocol v2、单次 START、STOP / STOPPED、HOST_TIMEOUT、迟到 ACK/状态、双完成门禁、冷却及 iPad HTTPS 鉴权与恢复 |
| 在 `desktop` 执行 `npm.cmd run typecheck` | **PASS**，Node 与 Web |
| 在 `desktop` 执行 `electron-vite build --mode production` | **PASS**，产物核对 `EXHIBITION_DEVICE_SOURCE = "mock"`，输出到开发目录 `desktop/out` |

Node 测试文件均位于 `../test/`，分别为 `experience-definitions.test.ts`、`firmware-timeline.test.ts`、`mock-experience-controller.test.ts`、`exhibition-lifecycle-controller.test.ts`、`arduino-firmware-service.test.ts`、`firmware-protocol.test.ts`、`exhibition-routing.test.ts`、`ipad-lan-server.test.ts`、`rc1-lan-integration.test.ts`。

首轮 Node 回归发现两处固件适配器的内存夹具仍把 25 秒作为完成点，已改为验证 T=25 继续等待、T=30 完成后进入冷却。首次 AVR 编译在 Windows 沙箱内遭遇 DLL 重定位错误，使用本机工具链重新离线编译后通过。总计 **170 项通过**，另有 TypeScript 和 Mock Build 通过。证据见 [Node 测试日志](../.validation/10s-inflation-firmware/node-tests.log)、[AVR8js 测试结果](../.validation/10s-inflation-firmware/avr8js/results.json) 和 [驱动窗口日志](../.validation/10s-inflation-firmware/driver-windows.log)。

## 兼容性和实体确认

当前 Mock 软件的 10 秒 Preparing、15 秒 Experience、25 秒 Projector、30 秒设备完成和 3 秒冷却与候选一致。Main 生命周期、iPad、Projector、媒体和正式 RC5 相关资产的 75 份保护文件通过 SHA-256 复核。真实驱动、Scheduler、默认驱动选择和模拟驱动也与回退副本逐字节一致。

实体兼容仍有两个待确认的前提。其一，候选时间表 `30s-2bcc1b95` 会被现有普通 Exhibition 的 25 秒身份允许列表拒绝，正式 RC5 仍走独立的身份与发布门禁。其二，当前开发驱动的源代码使用 D7 充气、D6 抽气，D5 双向打开指令为 1800 µs，STOP 为 1200 µs。封存 RC5 源码则使用 D6 充气、D7 抽气和不同的 D5 P/A/R 路由，包含 READY 预置行为。两者原先就不同，30 秒候选没有改动它们。TS 的 D5/D6/D7 诊断镜像沿用现有协议语义，不能用来确认现场接线。

真实预充气测试前，需由现场负责人确认以下条件。

- 实际气路、D5 阀的充／抽／STOP 位置、D6/D7 泵角色及现场准备策略，与拟验证的驱动和设备身份相符。
- 气囊、连接件和外壳的允许压力与负载范围，以及独立限压、泄压和断电保护的实际可用性。
- 延长预充气后的峰值压力、外壳受力、实际泵启停和换向间隔，以及 STOP、FAULT、HOST_TIMEOUT 后的停泵和残压释放。
- 真实设备完成确认与 Projector `ended` 的现场顺序，以及确认后 3 秒冷却的整轮表现。

本轮只做离线验证。实体 COM、固件上传、实体 START、气泵和气囊负载均未使用。没有创建发布版本或执行 Commit、Merge、Push、Deploy。
