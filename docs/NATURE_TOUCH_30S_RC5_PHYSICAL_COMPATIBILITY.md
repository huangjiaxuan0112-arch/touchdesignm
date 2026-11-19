# Nature Touch｜30 秒时间线与 RC5 实体兼容性核对

日期为 2026-11-12。**结论为暂不能进入受控固件部署准备。** 已完成时间数据的隔离迁移和默认模拟固件编译。身份、模拟协议帧长度、真实驱动的 30 秒回归及实体条件仍需解决。

## 依据与保留

本次对照 `NATURE_TOUCH_10S_INFLATION_FIRMWARE_CANDIDATE.md`、RC5 基线验收、正式入口记录和 `firmware/releases/nature_touch_v3_rc5_d5_routing_20261105/source/nature_touch_unified/`。RC5 正式入口的只读清单核验本次 PASS，24 项资源、Main 和 HEX 哈希符合封存清单。记录的固件身份为 `3.0.0-rc5-d5route`、Protocol v2、`25s-4c1e4167`、来源 `5356f28e`。这些记录不证明此刻现场安装的固件或接线。

本次隔离副本位于 `.validation/rc5-30s-compatibility/nature_touch_unified/`。它以 RC5 完整源码为基础，只替换动作表，并在 RC5 的主 sketch 中调整三个时长和两个阶段 Marker。指纹改为 `30s-2bcc1b95`，其他身份字段沿用 RC5。RC5 的驱动、Scheduler、驱动选择器及模拟驱动与封存文件逐字节相同。此副本用于评估，尚未批准用于实体设备。

## 实体映射与状态差异

| 项目 | 封存 RC5 源码及部署记录 | 当前开发区 30 秒候选 |
| --- | --- | --- |
| 充气泵 | D6，1800 µs | D7，1800 µs |
| 抽气泵 | D7，1800 µs | D6，1800 µs |
| D5 充气 | 1800 µs，记录为 P-A | 1800 µs |
| D5 抽气 | 1200 µs，记录为 A-R | 1800 µs，源码记为双向开放 |
| STOP / FAULT | 双泵 1200 µs，D5 STOP 1200 µs，取消 pending | 双泵及 D5 均请求 1200 µs，取消 pending |
| READY 预置 | 泵 OFF 后等待 500 ms，D5 置 1800 µs，再等 300 ms；START 检查预置就绪 | 无 RC5 的 READY 预置和对应 START 就绪检查 |
| 完成与冷却 | 先 STOP，固件保留 3 秒冷却拒绝 START，允许条件满足时预置 READY | 先 STOP，冷却由 Main 管理 |
| 空闲 lease | READY 预置期间 lease 超时停止预置 | 无相同的空闲预置机制 |
| START 调度 | 接受后提交首个动作，再发送 ACK | 在 ACK 输出后启动首个动作 |
| 诊断动作 D5 | 充 180、抽 0 | 两方向均 180 |
| 方向切换 | 泵 OFF 500 ms、阀稳定 300 ms，RC5 可复用已满足的 OFF 时间 | 保留 500/300 ms，但新方向请求重新开始等待 |

上述角色、阀位和 READY 行为来自各自源码及历史记录。当前实际气路和接线必须由现场负责人确认。两份源码都保留 Protocol v2 的 STOP、FAULT 和 HOST_TIMEOUT，但不能据此推断机械动作、残压或现场接线。

RC5 的历史 25 秒 AVR 仿真中，WAVE 末尾 500 ms 充气段没有发出充气泵 ON，最终抽气 ON 指令约 4.700 秒。当前开发驱动的离线模型得到约 4.200 秒。两者的 OFF 时间复用方式不同，这些结果应分别核对，不能互换成实体气流或压力测量。

## 时间数据迁移与验证

三模式首段为 0–10 秒，原 15 秒动作逐段后移至 10–25 秒，最终 5 秒抽气后移至 25–30 秒。原 25 秒动作表和 RC5 动作表逐项一致，旧固件及发布件保留。Marker 对应 0、10,000、25,000 和 30,000 ms。RC5 的设备侧冷却从完成的调度截止点计 3 秒，Main 仍有自己的完成确认与冷却门禁。

| 离线检查 | 结果 |
| --- | --- |
| RC5 发布清单与哈希 | PASS，`node tools/official-rc5/verify.mjs`，未打开串口 |
| RC5 基础上迁移时间表 | PASS，四个驱动／Scheduler 文件与封存 RC5 逐字节相同 |
| 默认模拟固件 Arduino CLI 编译 | PASS，Flash 10,662 bytes，静态 SRAM 1,336 bytes |
| AVR8js、16 字符 IDENTIFY 请求 | **FAIL**，11 项中 8 项通过，三模式在身份响应长度断言失败，尚未到各自的完整运行断言 |
| AVR8js、14 字符 IDENTIFY 和 RC5 冷却预期 | **PASS 11/11**，三模式均在固件时钟 30,000 ms 完成，最大动作偏差 1 ms |
| STOP、FAULT、HOST_TIMEOUT | 上述模拟固件回归中对应项目通过。RC5 真实驱动的 30 秒版本尚缺虚拟执行回归 |

模拟 IDENTIFY 的 RC5 版本名较长。按当前字段计算，16 字符请求的模拟响应为 385 字节 JSON，加 CR 为 386 字节，超过 Main 当前 384 字符行限制。真实驱动身份响应按对应字段计算为 371 字节 JSON，加 CR 为 372 字节，实际编码仍需在隔离环境验证。16 字符测试断言及失败证据均保留。结果见 [AVR8js 结果](../.validation/rc5-30s-compatibility/avr8js/results.json) 和 [编译日志](../.validation/rc5-30s-compatibility/simulation-compile.log)。

使用 14 字符 IDENTIFY 的补充诊断中，三模式实际动作、Marker、30,000 ms 完成和完成后 OFF 断言已到达并通过。该次整组结果为 FAIL，因为原开发候选夹具预期过早 START 返回 `INVALID_STATE`，RC5 按其设备侧冷却返回 `COOLDOWN`。两者均拒绝 START，但结果码不同。证据见 [短请求诊断](../.validation/rc5-30s-compatibility/avr8js-short-id/results.json)。

调整补充夹具以断言 RC5 的 `COOLDOWN` 拒绝码，并等待其三秒设备侧冷却后，14 字符请求的整组模拟固件回归通过。三模式动作、Marker、完成前 OFF、STOP、FAULT 和 HOST_TIMEOUT 均在虚拟 UART 下验证。该结果保留原 16 字符失败作为独立阻塞项。见 [RC5 冷却诊断结果](../.validation/rc5-30s-compatibility/avr8js-rc5-cooldown/results.json) 及 [本次夹具源码](../.validation/rc5-30s-compatibility/avr8js-rc5-cooldown/test-source.mjs.txt)。

## 部署准备阻塞项

1. 30 秒指纹与现有正式 RC5 允许的 `25s-4c1e4167` 不一致。普通开发 Exhibition 还固定 RC2 身份。必须制定经审查的成套 Main、固件身份和发布校验方案，保持精确身份验证与旧 RC5 回退。
2. 现有正式 RC5 Main 和素材仍是 5 秒 Preparing、20 秒投影和 25 秒设备时间线。上一轮 10 秒／25 秒软件是开发 Mock 构建。需要证明将来使用的成套软件与 30 秒固件相互匹配。
3. 解决模拟 IDENTIFY 16 字符响应超限，并按完整 Protocol v2 边界重新验证。真实身份帧长度也需实测式离线编码验证。
4. 在不改变 RC5 输出门禁的前提下，对 RC5 真实驱动加 30 秒时间表进行虚拟三模式、READY、冷却、STOP、FAULT、HOST_TIMEOUT 和 pending 换向取消验证，确认与 Main 的完成与媒体双门禁配合。
5. 现场负责人确认实际 D5 P/A/R 接管、D6/D7 泵角色、STOP 和 READY 阀位。现有记录中的相反映射需要依据实物确认。
6. 确定允许压力、气囊和外壳负载范围，核实独立限压／泄压和断电能力。确认停止、故障、断电后的残压处置方式及可观测的安全状态。10 秒预充气的实际压力和泵运行时间仍待受控实体验证。

本轮没有访问 COM、上传固件或启动气泵，也没有修改正式 RC5 发布件或其身份和输出门禁。
