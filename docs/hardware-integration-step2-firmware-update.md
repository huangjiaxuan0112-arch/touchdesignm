# Step 2.2：更新实体 Nano 至最新 simulation-only 固件

2026-10-27（日本时间）。**上传、Flash 校验及本步必要的实体回归通过。** 本次没有启用真实气动控制，也不代表完整 Step 2 的所有剩余验收已完成。

## 1. 结论：旧固件解释了此前差异

此前实体 Nano 在 6720 ms 无主机请求后仍报告 RUNNING、elapsedMs=6745、faultCode=null。Git HEAD `8e2df49` 中的旧统一程序确实没有 `HOST_TIMEOUT`、`lastHostContactAt` 或 `processSafety` 实现，但 IDENTIFY 固件名与新程序相同。

当前工作区新版具有 5000 ms 主机租约；本次重新编译与上传后，同一类真实 USB 静默测试实际返回 FAULT/HOST_TIMEOUT、elapsedMs=5001。**这与“代码只在本地更新，板上仍是旧程序”的判断吻合，并已通过更新解决该行为差异。** 上传前未读取旧 Flash，因此无法确定旧板上二进制的精确版本或哈希，不能声称已证明它逐字等于 Git HEAD。

## 2. 上传前确认及构建

用户本次明确确认：抽气泵、充气泵、电磁阀均已与电源物理断开，且任何外部或 USB 衍生供电路径都无法使其通电；同时明确批准上传和隔离状态下的模拟协议测试。没有用固件状态或界面勾选替代该确认。

源文件：

- `firmware/unified/nature_touch_unified/nature_touch_unified.ino`
- `simulated-actuators.h`、`experience-timelines.h`（同目录）

三份文件均未为本次更新修改。固件只使用模拟意图记录：`initializeOutputs()/inflate()/deflate()/stopAll()` 不配置管脚、不写 GPIO、不绑定 Servo，也没有实体 OFF 脉宽映射。`processSafety()` 在运行且有效主机请求间隔达到 5000 ms 时调用 `enterFault("HOST_TIMEOUT")`；故障路径先取消调度、清待发动作、执行 `stopAll()`，再锁存 FAULT。主循环及协作式串口输出期间均检查调度／安全条件。

| 项目 | 结果 |
|---|---|
| Arduino CLI / AVR core | 已有 CLI 1.5.1 / arduino:avr 1.8.8 |
| 编译目标 | `arduino:avr:nano:cpu=atmega328`，ATmega328P |
| Flash | 10,770 / 30,720 字节，35% |
| 静态 SRAM | 1,379 / 2,048 字节，67%，剩余 669 字节供栈／局部变量等使用 |
| 现有自动测试 | 56/56 PASS，含无输出代码守卫及校准时间线核对 |
| TypeScript 检查 | PASS，包含新增的实体复测脚本 |
| 定向虚拟执行 | 仅重跑已有 HOST_TIMEOUT 场景，1/1 PASS；无效轮询／历史 PWM 场景未重复 |
| 定向虚拟软件意图 | INFLATING → STOPPED，记录的 millis 差 5000 ms |
| 定向虚拟 D5/D6/D7 | 0 次输出方向启用，0 个 GPIO 边沿 |

本次编译 HEX SHA-256：

```text
1033aa59cb4b8ec21a5ac913c1fca5c813978c3dffab171875e53847858d708b
```

它与此前 Step 4 完整 11 项场景通过时的 HEX 哈希一致。定向检查仍使用已说明的 AVR8js 0.21.1 测试侧 RXC 兼容处理，不能把该虚拟结果称为未修正模型或实体管脚测量。

## 3. 端口与实际上传

通过 SerialPort 和 Arduino CLI 重新发现 Nano 所连接的 CH340 USB 串口；蓝牙端口未选用。先正常关闭本项目的 Electron 窗口以释放串口；没有强杀其他应用。

本次实际执行的上传命令等价于以下 PowerShell（已经执行成功，不是等待执行的指令）：

```powershell
arduino-cli upload --fqbn 'arduino:avr:nano:cpu=atmega328' --port <DISCOVERED_PORT> --input-file <FIRMWARE_HEX> --verify --verbose
```

标准 Nano ATmega328P 配置、115200 baud 成功完成 bootloader 通信，器件签名 `1E 95 0F`，日志确认 **10770 bytes of flash verified**，退出码 0。因此没有切换 `atmega328old`／57600，也没有烧写 bootloader、修改 fuse、尝试旧草图或修改程序绕过错误。该成功确认标准上传配置适用于此板，不等于读取了 bootloader 的完整版本或源码。

## 4. 真实串口回包与必要回归

复测使用原有 `ArduinoFirmwareService`、`NativeSerialTransport`，所有回包均来自实体 Nano；没有 Mock、虚拟 CPU 或前端替代回包。为准确验证主机静默，将本次测试服务已有的心跳间隔设为 15000 ms，保持 USB 供电和串口连接，不丢弃／伪造通信数据。没有改变产品默认心跳。

实际 IDENTIFY：

```json
{"type":"ACK","command":"IDENTIFY","accepted":true,"requestId":"r1","state":"IDLE","protocol":2,"firmware":"nature-touch-unified-simulation","deviceId":"nature-touch-nano-simulation","hardwareOutputsEnabled":false,"capabilities":["WIND","WAVE","BUBBLE","SIMULATION_ONLY"]}
```

| 检查 | 实体结果 |
|---|---|
| IDENTIFY + 初始 STATUS | PASS：Protocol 2、IDLE、simulation-only 能力、输出禁用 |
| 一轮 WIND 取消 | PASS：SELECT ACK → START ACK／STATUS RUNNING → STOP ACK STOPPING → STOPPED → STATUS IDLE |
| 主机静默 | START 之后等 6500 ms 再查询；实际相邻主机写入相隔 **6708 ms**，中间无其他请求，USB 始终连接供电 |
| 主动超时事件 | PASS：在后续 STATUS_QUERY 发送前即收到 `EVENT FAULT`，operationId=`updatedLease`，code=`HOST_TIMEOUT` |
| 超时后实际 STATUS | PASS：FAULT，elapsedMs=**5001**，durationMs=24000，faultCode=HOST_TIMEOUT，hardwareOutputsEnabled=false |
| 故障锁存／无自动重启 | PASS：再等 3000 ms 后 STATUS 仍为 HOST_TIMEOUT；无新增 START、动作事件或 COMPLETED |
| 主机解锁状态 | FAULT 后解锁清除，尝试新的 START 在主机边界拒绝，未写串口 |
| 结束 | PASS：显式关闭测试串口连接，不自动重连／恢复；没有发送 RECOVER |

实际故障事件：

```json
{"type":"EVENT","name":"FAULT","operationId":"updatedLease","code":"HOST_TIMEOUT"}
```

实际故障 STATUS 内的 snapshot：

```json
{"state":"FAULT","selectedExperienceId":"WIND","operationId":"updatedLease","elapsedMs":5001,"durationMs":24000,"faultCode":"HOST_TIMEOUT","hardwareOutputsEnabled":false}
```

主机从 START 写入到收到 FAULT 的间隔为 5225 ms，包含请求、回应和事件传输及主机调度；不能用它代替内部 5000 ms 租约计时或宣称电气停机响应时间。

### STOPPED 与输出确认的证据边界

实体协议直接观察到的是 FAULT/HOST_TIMEOUT、冻结的运行时间、后续无动作事件和故障锁存。**当前 Protocol v2 不直接序列化故障时的 `ActuatorSimulation::intent` SRAM 值**，因此没有声称从实体串口直接读取了 `STOPPED`。

软件 STOPPED 的依据是：实际写入并逐字节校验的 HEX 对应已审阅故障路径，它在进入 FAULT 前无条件调用 `ActuatorSimulation::stopAll()`；相同编译 HEX 的定向虚拟执行也记录 STOPPED。此处属于已验证代码路径推断，并有虚拟执行佐证，不能伪装为实体 SRAM 实测。

D5/D6/D7 未被固件有意配置为控制输出：源码守卫、编译 HEX 一致性及虚拟管脚记录支持这一结论。实体复测未使用示波器／逻辑分析仪，也不证明外部 RC 开关电气 OFF；供能隔离仍依据本次操作者实际检查。没有定义或发送物理 ON/OFF 脉宽。

## 5. 记录与剩余工作

- 编译、上传／校验、实体收发、测试和类型检查的机器记录保存在本机验证目录，未发布到仓库；原始记录包含 USB 设备标识及本机路径。
- `test/hardware-step2-firmware-update.ts` 为显式 opt-in 实体脚本，普通 `npm test` 不执行；需要重新确认物理隔离并指定重新发现的 COM 端口才可运行。

本次只修复并复测原来的超时阻断项和一模式取消，没有重跑三模式自然完成或历史 PWM 测试。此前 Step 2 的失败记录原样保留。完整 Step 2 中新版固件下的前端 USB 拔线／重连、重新解锁及无自动启动等尚需另行完成，不能由本次串口服务复测代替。

Nano 现在装有经 Flash 校验的最新 simulation-only 程序，测试连接已断开；最后一次实体查询仍为 HOST_TIMEOUT 故障锁存，没有发送恢复命令，断开后的板上状态没有再次读取。USB 仍连接时可能继续供电，本步没有要求拔线。RC 开关真实 OFF、独立关断与压力保护仍待硬件清单验证。**本次不进入真实气泵／电磁阀整合。**
