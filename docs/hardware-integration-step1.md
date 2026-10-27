# Hardware Integration Step 1：React → Electron → Nano 只读通信

2026-10-27：**本步通过，停止在 Step 1。** 测试前操作者明确确认电磁阀及两只气泵已与全部供能路径物理隔离；测试中由操作者实际拔下 USB。

## 实现

- 展览首页新增设备连接区，默认 **Mock Device**，可切换 **Real Arduino — read-only USB**。保留原展览卡片与 Mock 模式选择逻辑，不做视觉迭代。
- 复用既有 preload、IPC、`ArduinoFirmwareService` 和 `NativeSerialTransport`，没有新后端或依赖。动态列出 COM、制造商、VID/PID；不自动选端口、不自动连接。
- 连接前 UI 要求勾选物理隔离；主进程也验证 `loadsIsolated === true`。打开串口可能引起板子复位，不能以本地源码或设备自报输出禁用取代物理隔离。
- 9600 baud，沿用 2500 ms 复位等待；连接自动 IDENTIFY，身份通过后 STATUS_QUERY。界面显示真实固件名、协议版本、设备状态和错误，可主动查询、断开。
- 主进程创建只读固件服务，统一发送边界仅允许 IDENTIFY / STATUS_QUERY。SELECT、START、STOP、RECOVER 均不能写串口；旧文本 PING/STATUS 及诊断连接入口也封锁。仅在界面禁用按钮并不足够。
- 真实模式禁用体验卡片控制。切回 Mock 前主动断开真实串口，恢复 Mock 不会自动恢复体验。USB 错误／关闭经既有事件链推送到 React，无自动重连／启动。
- 本步没有编辑固件、校准表、D5/D6/D7 或原草图，没有编译／上传固件。

## 实体测试（不是 Mock）

通过实际 Electron 主进程、隔离 preload、React 页面与原生 SerialPort 执行；程序驱动真实页面控件并记录原生串口发送及接收字节。测试脚本对所有串口写入额外执行两命令白名单检查。

| 验收项 | 实测 |
|---|---|
| 动态端口发现 | PASS：COM5，wch.cn / CH340，VID 1A86、PID 7523；COM3/4 为 Microsoft 蓝牙端口，未打开 |
| UI 物理隔离确认 | PASS：未确认时连接按钮禁用 |
| 前端连接／IDENTIFY | PASS：真实 ACK，Protocol 2，`nature-touch-unified-simulation`，`hardwareOutputsEnabled:false` |
| STATUS_QUERY | PASS：连接时查询及按钮主动查询均收到真实 STATUS；状态 IDLE、无选定模式、无 operation、elapsedMs=0、faultCode=null |
| 控制隔离 | PASS：真实模式三卡片禁用；通过 preload 调用 SELECT、START、RECOVER 及旧诊断入口均拒绝，串口写入数不增加 |
| 界面主动断开 | PASS；随后测试脚本明确点击重新连接，以准备拔线测试，并非自动重连 |
| 实际 USB 拔线 | PASS：操作者拔线，React 显示 faulted / Not identified，服务 faultCode=CONNECTION_LOST |
| 拔线后行为 | PASS：额外观察 2500 ms，无新增请求，无自动重连；程序不包含自动重连策略 |

最终一次实体运行仅发送 **5 帧：2 × IDENTIFY、3 × STATUS_QUERY**。完整收发片段、界面文字及断线快照保存在本机验证记录中；出于隐私考虑，不将包含 USB 设备标识及本机信息的原始记录发布到仓库。设备自报身份不证明板上二进制与本地 Step 4 源码逐字一致，本步没有上传来改变它。

未发送实体 SELECT / START / STOP / RECOVER；负载保持操作者确认的物理隔离。没有进行气泵实测、管脚示波器测量或压力测量，不据此认定 RC 开关的真实 OFF 行为、安全停机或压力保护通过。

## 离线／Mock 验证

`npm run typecheck`、`npm test`（**52/52 PASS**）、`npm run build` 均通过。测试涵盖既有 Mock 协议、模式状态机及传输行为，新用例证明只读服务拒绝四种状态修改请求而不写串口、仍可查询，并在模拟连接丢失后不重连。它们与上述实体测试分别计数，未重跑已结束的旧 PWM 模拟。

两次早期 Electron 测试在连接的初始 STATUS 尚未完成时点击了仍禁用的查询按钮，测试断言失败；这是测试同步错误。脚本改为等待连接操作完成后再操作，最终全部通过。失败记录在本机保留，未覆盖为成功，也未发布到仓库。日志中的 IPC 拒绝堆栈来自主动验证封锁行为。初次沙箱内 Electron 无法启动，后续通过获准的沙箱外运行完成实体测试。

## 使用／复测

在项目的 `desktop` 目录运行：

```powershell
npm run typecheck
npm test
npm run build
npm run dev
```

首页选择 Real Arduino，刷新端口，选择当前 Nano 对应端口，保持泵／阀隔离并勾选确认，点击 Connect + IDENTIFY，然后 STATUS_QUERY；完成后 Disconnect Arduino。未知设备不能仅凭 CH340 芯片名认作 Nano，需核对实际设备与协议身份。使用 Mock 时切回 Mock Device。

需要重跑实体自动测试时，先由操作者再次确认全部负载物理隔离，关闭占用端口的应用；上面的 build 完成后执行（COM5 仅是本次端口，必须替换成当前发现并确认的端口）：

```powershell
node -e "require('serialport').SerialPort.list().then(console.log)"
$p = Start-Process -FilePath '.\node_modules\electron\dist\electron.exe' -ArgumentList '..\test\hardware-step1-electron.cjs','--loads-isolated','--port','COM5','--wait-for-unplug' -WindowStyle Hidden -PassThru
$p.Id
```

脚本仅在显式提供 `--loads-isolated` 和 `--port` 时运行，不在普通 `npm test` 内。机器记录出现 `WAITING_FOR_OPERATOR_USB_UNPLUG` 后，操作者拔掉 USB；最多等待 240 秒。省略 `--wait-for-unplug` 会明确标记实体拔线待测。脚本会写入当前机器记录，复测前先另存需保留的旧记录；看最终 JSON 的 `result` 与 `checks`，不能只凭进程退出判断通过。

本次测试结束 USB 已拔下，测试 Electron 已退出。下一步需另行明确授权；实体 RC 开关 OFF、独立断电与压力保护仍按 Phase 3B Step 5 清单验证。本次不进入 Step 2 或真实执行器整合。
