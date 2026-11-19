# Nature Touch 最终 30 秒开发基线

2026-11-12（东京时间）。当前工作区 `integration/v3-friend-ui` 的唯一开发标准为 **30 秒设备动作 + 完成确认后 3 秒冷却**。沿用当前工作区已有的 10 秒 Preparing 和 25 秒静音影片，并将封存 RC5 的已确认控制逻辑接入当前 Unified Firmware。

| 阶段 | 标称时间 | 行为 |
| --- | --- | --- |
| INFLATE | T=0–10 秒 | 预充气，iPad 显示对应模式的 Preparing，投影从 START ACK 后播放 |
| EXPERIENCE | T=10–25 秒 | iPad 直接进入 Experience，投影连续播放，保持各模式原触觉节奏 |
| DEFLATE | T=25–30 秒 | 设备执行原 5 秒最终抽气动作，投影结束并回 Standby |
| COOLDOWN | 约 T=30–33 秒 | Main 确认同轮设备完成及媒体结束后冷却 3 秒 |
| READY | 理想约 T=33 秒 | 完成确认与冷却门禁都满足后允许下一轮 |

设备的 T=0 取本地调度开始，Main 的 T=0 取收到 START ACK。RC5 的设备侧 3 秒冷却从设备调度完成时开始，Main 冷却从完成确认后开始，两段计时重叠。设备独立拒绝冷却期 START，Main 同时维持原完成和媒体门禁。正常轮次不会把两个 3 秒相加。传输及事件到达时间会影响现场 READY 的实际时刻。

## 源码与身份

WIND、WAVE、BUBBLE 的 15 秒体验段分别为 10、8、12 段。三表与封存 RC5 原动作的顺序、方向、各段时长及 5 秒收尾逐项一致。首段延长 5 秒，其余各段绝对位置后移 5 秒。Arduino 在 0、10,000、25,000 和 30,000 ms 发出阶段 Marker，TS 镜像与固件遥测一致。Main Waiting、Experience、Mock 完成和 Projector 时长由同一组 TS 阶段数据推导。

现有 RC5 的驱动、Scheduler、驱动选择器和模拟驱动与封存源码逐字节一致。D6 充气、D7 抽气，D5 保留原充气／抽气／STOP 阀路。READY 预置、500/300 ms 换向等待、泵互斥、设备侧 Cooldown、STOP、FAULT 和 HOST_TIMEOUT 均按 RC5 执行。TS 的 D5 抽气诊断值由 180 修正为 0，与 RC5 遥测一致。虚拟 AVR 下，WAVE 的原 500 ms 充气段无泵 ON，最后抽气 ON 指令窗约 4.7 秒，WIND 和 BUBBLE 约 4.2 秒。

开发身份为 `3.0.0-30s`、`30s-2bcc1b95`、`5356f28e` 和 Protocol v2。Main 继续核对精确身份、连接状态、真实输出能力及部署授权。较短的新版本字符串使完整 16 字符 IDENTIFY 请求的响应符合既有 384 字符行限制。用户于 2026-11-12 确认现场条件并授权通过 30 秒构建的部署审核门禁。旧 RC5 发布身份及回退资源通过原清单验证。

## 本轮文件

| 路径 | 变更 |
| --- | --- |
| `firmware/unified/nature_touch_unified/nature_touch_unified.ino`、`experience-scheduler.h`、`real-actuators.h`、`simulated-actuators.h` | 接入 RC5 控制逻辑，使用现有 30 秒表、时长和 Marker |
| `firmware/unified/nature_touch_unified/firmware-version.h` | 冻结 30 秒固件身份 |
| `desktop/shared/experience-definitions.ts`、`exhibition-lifecycle.ts`、`projector.ts` | 统一 TS 阶段数据，修正 RC5 抽气诊断镜像 |
| `desktop/electron/exhibition-routing.ts`、`main.ts` | 对齐精确身份，将实体准入留在当前构建的审核门禁之后 |
| `desktop/package.json` | 固件测试入口切到当前 30 秒实现，旧测试源码保留供历史复核 |
| `test/experience-definitions.test.ts`、`firmware-timeline.test.ts`、`exhibition-routing.test.ts`、`owner-readonly-identity.test.ts`、`rc1-lan-integration.test.ts`、`rc3-offline-integration.test.ts` | 更新动作、映射和身份夹具，保留旧身份拒绝断言 |
| `test/unified-controller/verify.mjs`、`actuator-windows.cpp`、`test/rc5-valve/verify.mjs` | 增补 16 字符身份、设备冷却及 RC5 真实驱动的离线覆盖 |
| `test/electron-ipad-loopback.cjs`、`electron-projector-link.cjs` | 本轮证据可写入独立目录 |
| `README.md`、`docs/NATURE_TOUCH_SINGLE_BASELINE_DEVELOPMENT_POLICY.md`、本报告 | 固定单一 30 秒开发标准 |

本工作区没有根目录 `AGENTS.md`。迁移前的 Unified 源码备份在 `.handover-backups/20261112-before-final-30s/`。历史 25 秒源码、正式 RC5、RC4 回退与 Git 记录可继续追溯。

## 验证

| 项目 | 结果 |
| --- | --- |
| `npm.cmd run typecheck`、生产 Mock 构建、`npm.cmd run build:exhibition` | PASS |
| TS、Mock 生命周期、Protocol v2、FirmwareService、iPad HTTPS、身份与只读回归 | PASS 156/156 |
| RC3 历史包隔离检查 | PASS 2/2。历史包继续核对自身身份，开发目标为 30 秒 |
| `node test/rc5-valve/verify.mjs --active-30s` | PASS 9/9。实际编译的 RC5 真实驱动仅在 AVR8js 执行。三模式 30,000 ms 完成，覆盖动作、Marker、身份、冷却拒绝、READY、STOP、FAULT、HOST_TIMEOUT、pending 取消 |
| `node test/unified-controller/verify-actuator-windows.mjs` | PASS 7/7。用假的 Servo 验证三模式泵命令窗口，以及两个等待阶段的 STOP／FAULT 取消 |
| `node tools/official-rc5/verify.mjs` | PASS。正式 RC5 的 24 项资源、Main 及固件 HEX 哈希一致 |
| `node test/unified-controller/verify.mjs` | PASS 11/11。完整 16 字符 IDENTIFY 在 IDLE 和 COMPLETED 通过，三模式动作、Marker 和 30,000 ms 完成一致，模拟驱动未配置 GPIO 输出 |
| `npm.cmd run test:ipad-loopback` | PASS。真实 Electron 窗口、HTTPS 回环浏览器、三模式各一轮。投影第 10 秒持续播放，每轮一次加载、一次播放、一次 START，原生串口调用为零 |
| `npm.cmd run test:projector-link:faults` | PASS 7/7。覆盖预载错误、播放拒绝、关闭、重载、FAULT 和断连 |

Mock 浏览器三轮实测如下，单位为毫秒。Preparing 和影片列为显示／播放持续时间，完成和 READY 列以收到 START ACK 为起点。

| 模式 | Preparing | 影片 | Mock 完成 | READY |
| --- | ---: | ---: | ---: | ---: |
| WIND | 10,007 | 25,005 | 30,042 | 33,016 |
| WAVE | 10,001 | 25,005 | 30,026 | 33,052 |
| BUBBLE | 10,008 | 24,999 | 30,020 | 33,022 |

测试包含主机状态更新、请求和媒体故障，以及 RC5 调度与输出的虚拟验证。实体 Exhibition 的开发产物编译通过。已执行范围内没有未解决的软件错误。上一轮的 16 字符身份帧失败已复测通过。证据见 [Mock 三模式](../.validation/final-30s/loopback-mock-results.json)、[模拟固件](../.validation/final-30s/avr8js/results.json) 和 [RC5 驱动虚拟 AVR](../.validation/final-30s/rc5-driver/summary.json)。

## 现场确认与实测状态

用户于 2026-11-12 确认现场接线、压力、泄压和断电保护条件，并授权通过审核门禁。真实 10 秒预充气的压力曲线、泵启停、故障停机及投影与设备完成的现场相对时间尚未由本工作区的测试测量。软件验收使用 Mock、虚拟 UART 与虚拟 AVR。实体串口、上传、START、气泵及气囊均未使用。

本次授权后，30 秒 Exhibition 开发构建重新编译通过，TypeScript 检查及身份、固件时间表和设备服务回归 64/64 通过。正式 RC5 发布清单复核通过。上述现场条件来自用户确认。
