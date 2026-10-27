# Hardware Integration Step 2：真实 USB 端到端模拟控制

日期：2026-10-27。**Hardware Integration Step 2 已完成：三模式控制、HOST_TIMEOUT 与实体 USB 拔线／重连验收均通过。** 首轮发现的固件租约差异已在 Step 2.2 更新 simulation-only 固件并完成 Flash 校验；本报告保留该问题及解决过程。实体执行器仍未接入或驱动。

## 改动与安全边界

- 复用已有 React 卡片、preload、Electron IPC、`ArduinoFirmwareService` 和 Native SerialPort，不增加后端、依赖或 UI 库，不改卡片外观与样式。
- 默认 Mock 不变，保留 Real Arduino 只读模式。真实连接仍需手动选择动态发现的端口并确认气泵、阀与全部供能路径物理隔离。
- 新增开发环境专用 **Arm Real Arduino Simulation Test**：必须成功 IDENTIFY（Protocol 2、指定模拟固件名、输出禁用），具备 WIND/WAVE/BUBBLE/SIMULATION_ONLY 能力列表，操作者同时确认负载物理隔离及已识别模拟固件是本次预期测试程序；主进程再读取当前 STATUS，要求 IDLE/COMPLETED 且输出禁用。
- 以上条件在主进程串口服务检查；未解锁时只允许 IDENTIFY / STATUS_QUERY。解锁后仅额外允许 SELECT / START / STOP，RECOVER 和旧文本诊断仍封锁。打包应用不能解锁此开发测试模式。
- 卡片只 SELECT，使用独立 Test START / Test STOP 按钮。首次连接、解锁、自然完成、重连均不会自动 START。SELECT 与测试按钮共享忙碌状态，避免并发命令；STOP 会等待已在途的 STATUS 心跳，然后发送并等待 STOPPED。
- 沿用运行中约 1000 ms STATUS_QUERY 心跳（前一查询传输完成后再调度，因此不是精确 1 Hz）。掉线、通信故障及 STATUS 报告 FAULT 会清除解锁；解锁期间若 STATUS 不再明确报告输出禁用，则关闭会话。运行中需先 STOP／完成，才允许普通解除解锁。
- 隔离确认与固件自报是两个条件，`hardwareOutputsEnabled:false` 不能证明电气隔离。本次 USB 拔线／重连未操作 GPIO／Servo、未修改或上传固件、未改 D5/D6/D7 或接线，也未进行气动控制。Step 2.2 的固件上传单独记录于其更新报告。

## 实体连接与三模式结果

操作者在本次测试前明确确认负载仍物理隔离、USB 已接回并授权模拟 SELECT / START / STOP。动态发现 COM5（CH340，1A86:7523），真实 IDENTIFY 返回 `nature-touch-unified-simulation`、Protocol 2、模拟能力及输出禁用；初始 STATUS 为 IDLE。

测试程序驱动真实 Electron 展览页面的卡片和按钮，经实际 preload/IPC/SerialPort 与 Nano 通信，记录真实串口 JSON 与主机接收时间。没有 Mock 回应或虚拟 CPU。每种模式执行一轮中途 STOP，再执行一轮自然完成。

| 模式 | SELECT / START / STOP | 自然完成 | 完整轮动作诊断数 | 主机收到 START ACK → COMPLETED |
|---|---|---|---:|---:|
| WIND | PASS | PASS | 12 | 24,148 ms |
| WAVE / WAVES 卡片 | PASS | PASS | 10 | 25,152 ms |
| BUBBLE / BUBBLES 卡片 | PASS | PASS | 31 | 27,568 ms |

三模式各自真实状态链：

- 取消轮：SELECT ACK（IDLE）→ START ACK 及实际 STATUS（RUNNING）→ STOP ACK（STOPPING）→ STOPPED → STATUS（IDLE、operationId=null）。
- 完整轮：SELECT ACK（IDLE）→ START ACK 及周期 STATUS（RUNNING）→ 唯一 COMPLETED 事件。随后观察 1500 ms，状态仍 COMPLETED，无额外 START。

53 个完整轮动作诊断的 `atMs/action/durationMs` 逐项匹配仓库原校准定义，BUBBLE 两次连续充气未合并。每轮完成事件一次，取消操作之后没有该 operationId 的后续动作或完成事件。三模式测试阶段恰好 6 次 START，均为明确测试操作、operationId 各不相同，没有意外重发；另有下文租约探针的一次 START。

表中时间是 Windows 接收 ACK 与完成事件的实测间隔，包含串口传输、打印和主机调度开销，**不是内部动作的精确周期、GPIO 波形或气泵测量**。动作 `atMs` 是设备输出的时间线诊断字段，也不能作为实际动作时刻测量。

## 固件兼容性问题及 Step 2.2 解决记录

IDENTIFY 没有版本号／构建指纹，本步没有假定板上二进制与仓库相同。以下记录是 **Step 2.2 更新之前** 的首轮实体运行：普通三模式协议兼容，但当时板上程序不符合 Phase 3B Step 4 的 5000 ms 运行中主机租约要求：

1. 页面完成三模式测试后主动断开串口。独立租约探针复用同一个串口服务源文件和 NativeSerialTransport，明确重新连接、识别、确认并解锁，选择 WIND、启动 `leaseOperation`。
2. 探针将既有心跳间隔设为 15000 ms，保持 USB 连接与供电，仅等待 6500 ms，不伪造／丢弃回包、不关闭串口。发送记录证实 START 与下一 STATUS_QUERY 之间 **6720 ms 没有其他主机请求**。
3. 实际 STATUS 返回 **RUNNING、elapsedMs=6745、faultCode=null**，而非预期 FAULT/HOST_TIMEOUT。不能以相同固件名认定最新版功能已安装。
4. 发现差异后立即发送 STOP；收到 ACK STOPPING 和 STOPPED，然后关闭探针连接。没有自动恢复、RECOVER、上传或继续测试。

这证明板上程序至少在通信超时行为上不兼容所需版本；不能仅凭这一点判定其具体历史版本或内部代码。租约探针属于真实 Nano／现有服务测试，不是通过 React 发起的超时场景，也不是 USB 电气断线测试。

当时因该兼容性问题而停止实体 USB 拔线／重连测试。随后按 [Step 2.2 更新报告](hardware-integration-step2-firmware-update.md) 上传并验证 simulation-only 固件，真实 HOST_TIMEOUT 与必要回归通过；因此首轮租约异常现作为已解决的历史记录，不代表本次仍有固件阻断。

## 实体 USB 拔线／重连验收

2026-10-27，操作者在连接前再次确认抽气泵、充气泵、电磁阀均与所有供电路径（包括 USB 衍生供电）物理隔离，并在提示时实际拔下、重新插入 USB。仅执行协议握手及显式模拟授权；**未发送 SELECT、START、STOP 或 RECOVER**。

端口在测试开始前动态发现：COM5（wch.cn CH340，VID:PID 1A86:7523）；COM3 和 COM4 为 Microsoft 蓝牙串口。使用当时枚举到的 COM5，没有假设旧端口号固定。

| 阶段 | 实体观察与结果 |
|---|---|
| 初次连接 | PASS：通过 Electron UI 手动连接；实际 IDENTIFY 返回 Protocol 2、`nature-touch-unified-simulation`、`SIMULATION_ONLY`、`hardwareOutputsEnabled:false`；STATUS 为 IDLE，未选模式、无 operation、无 fault。 |
| 明确授权 | PASS：界面进入 `SIMULATION TEST ARMED`；没有因此发送 START 或 SELECT。 |
| USB 拔除 | PASS：操作者实际拔线；Electron 报告 `faulted` / `CONNECTION_LOST`，识别及模拟授权清除。随后观察 2500 ms，没有新增串口写入或自动重连。 |
| USB 重插与自动行为检查 | PASS：操作者插回 USB；动态枚举到 COM5 后再观察 2500 ms，应用仍未连接、没有串口写入，也没有自动重新授权。 |
| 明确手动重连 | PASS：测试通过应用的 Connect + IDENTIFY 操作重新连接；串口只记录 IDENTIFY、STATUS_QUERY。实际重新识别为 Protocol 2 simulation-only；新 STATUS 为 IDLE、无选定模式、无 operation、`faultCode:null`、输出禁用。没有恢复、选择或启动命令。 |
| 重新授权 | PASS：重连后必须再次勾选模拟固件确认并显式 Arm；授权变为 true，但没有发送 SELECT / START。随后显式 Disarm 并 Disconnect；最终连接断开且授权为 false。 |

实体 Nano 的实际 IDENTIFY 回包摘录：

```json
{"type":"ACK","command":"IDENTIFY","accepted":true,"requestId":"r1","state":"IDLE","protocol":2,"firmware":"nature-touch-unified-simulation","deviceId":"nature-touch-nano-simulation","hardwareOutputsEnabled":false,"capabilities":["WIND","WAVE","BUBBLE","SIMULATION_ONLY"]}
```

初次连接与 USB 重连后的实际 STATUS snapshot 均为：

```json
{"state":"IDLE","selectedExperienceId":null,"operationId":null,"elapsedMs":0,"durationMs":null,"faultCode":null,"hardwareOutputsEnabled":false}
```

实体拔线／重连的完整机器记录保存在本机验证目录，未发布到仓库；原始端口枚举包含 USB 设备标识。全程串口写入共 6 帧：首次连接的 IDENTIFY、STATUS_QUERY、授权时 STATUS_QUERY；人工重连后的 IDENTIFY、STATUS_QUERY、重新授权时 STATUS_QUERY。没有 SELECT、START、STOP、RECOVER。证据由真实 Electron、preload、IPC、Native SerialPort 和物理 Nano 生成，不是 Mock 或虚拟执行。

### USB 断电、MCU 复位与 FAULT 的边界

拔线期间 Electron 的 `CONNECTION_LOST` 是主机连接状态，不是从 Nano 收到的持久 FAULT；USB 断开时无法继续查询板上状态。当前已确认的单 USB 供电配置下，重新插入后 Nano 重新启动，实际 IDENTIFY / STATUS 表现为 IDLE、无 operation、无 fault，符合易失运行状态在掉电复位后重新初始化的表现。此次测试开始时设备本来就是 IDLE，因此**没有测试一个已存在的 MCU FAULT 是否能跨掉电保存**；不据此声称故障记忆具有掉电持久性。Step 2.2 的 HOST_TIMEOUT 锁存证据仅证明 USB 仍连接时的故障锁存。

本次串口／UI 验收通过不证明 D5/D6/D7 或 RC 开关的电气 OFF、安全停机、供电裕量或压力保护；这些仍按 [Phase 3B Step 5 硬件清单](phase-3b-step5-hardware-checklist.md) 待合格人员实测。没有进行气动执行器测试。

## 问题、修正与回归

- 初次脚本有选择器引号错误，没有串口写入；保留 `hardware-step2-initial-test.json`。
- 第二次测试暴露当前模式重复 SELECT 与 START 的并发竞争，主进程拒绝并发 START，没有意外重复执行。已共享卡片／测试控件忙碌状态，最终三模式实体测试通过。失败记录保留 `hardware-step2-before-busy-fix.json`。
- 修正 STOP 与在途心跳的竞争，离线新增覆盖该行为。解锁缺少隔离确认、固件确认、能力列表、开发许可或当前输出禁用状态时均拒绝；运行中不能普通解除解锁，RECOVER 不因解锁而开放，掉线／重连不保留解锁。
- 最终 `npm test` **56/56 PASS**；`npm run typecheck`、`npm run build` **PASS**。这些是离线／Mock 回归，不计作实体协议通过数量。
- 没有修改原始草图、统一固件、模拟执行器头文件或校准表；没有重跑历史 PWM 仿真，也没有覆盖 Step 1、Phase 3B 的验证证据。

## 记录与复跑

- 真实串口消息、命令、状态、离线测试、类型检查和构建记录保存在本机验证目录，未发布到仓库；原始机器记录包含 USB 设备标识及本机路径。
- 实体测试脚本：`test/hardware-step2-electron.cjs`；只读分析器：`test/hardware-step2-analyze.cjs`。它们不进入普通 `npm test`。启动日志中的首次 START 拒绝来自主动验证只读边界。

固件租约差异已由 Step 2.2 解决，本次没有重复已完成的三模式、超时或 PWM 测试。新增的实体拔线／重连验收使用 `--reconnection-only` 路径，仅测试本节列出的剩余项目。

离线复跑（从 `desktop` 目录）：

```powershell
npm run typecheck
npm test
npm run build
node ..\test\hardware-step2-analyze.cjs
```

如需单独复跑本项，必须先重新确认负载物理隔离并动态发现 COM 端口；使用现有 `test/hardware-step2-electron.cjs --loads-isolated --port COMn --reconnection-only`，并由操作者按提示手动拔插 USB。该路径只握手／查询并操作本机模拟授权，不运行任何体验；验证记录保存在本机目录。以 JSON 的 `result`、`checks` 和实际串口帧为准，不凭进程退出码判定。

## 后续边界

本次测试连接已显式断开，模拟授权未保留。**Hardware Integration Step 2 验收完成；不批准也不自动开始物理执行器整合。** RC 开关真实 OFF、无信号／复位／供电异常行为、独立负载关断、USB-only 电气裕量及压力保护仍须按既有硬件清单另行验证。
