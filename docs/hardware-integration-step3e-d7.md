# Step 3E：D7真实驱动接入准备与离线验证

2026-10-29。**实现及离线验证完成，停止在Step 3E。未访问COM、未上传、未驱动实体硬件，也没有重复实体测试。**

## 已采用的实测映射与RESET记录

- D7 OFF = `writeMicroseconds(1200)`。
- D7 ON = `writeMicroseconds(1800)`。
- 用户报告1800→1200成功关闭、单独丢PWM关闭、最新RESET泵停止，均作为用户实物观察保留。
- [早先RESET失败记录](evidence/d7-reset-user-report-20261029.json)原样保留；[最新通过记录](evidence/d7-reset-latest-pass-20261029.json)另存，没有覆盖失败记录。确切修复方法、测试固件哈希和波形／时延未提供，不假称本轮软件修复导致最新通过。
- 最新RESET通过只适用于用户已测条件，不推广为所有欠压、冷启动、长时间RESET、供电时序、失信号电平或复电情况均已通过。1200/1800结果不推广为旧544/2400端点或D5/D6已验证。

## 最小实现

更新 [real-actuators.h](../firmware/unified/nature_touch_unified/real-actuators.h)，复用现有Servo及`initializeOutputs / inflate / deflate / stopAll / service`接口，无新协议或架构。

| 路径 | D7行为（仅在另经审查开放的版本中） |
|---|---|
| 初始化 | 先预置1200µs，再attach D7；统一程序原有setup首先调用此接口，无启动ON |
| 明确START后原调度器请求inflate | 写1800µs，不依赖旧0/180角度映射 |
| STOP / stopAll | 写1200µs并保持Servo脉冲，不detach，不额外抽气 |
| HOST_TIMEOUT | 原5000ms协议租约进入FAULT、调用stopAll，保持1200µs |
| ACTUATOR_FAULT | 原故障路径调用stopAll；driver.service在故障时同样请求OFF |
| RECOVER | 原接口保持OFF、回空闲；必须重新选择并明确START才能再ON |
| RESET后应用重新执行 | 初始状态不恢复旧运行或旧ON，初始化请求1200µs |
| deflate请求 | D7先OFF，锁存故障并返回false；不配置或启动D5/D6，不假装完成真实抽气 |

驱动只包含一个D7 Servo对象，没有D5/D6 Servo、绑定或GPIO写入。已绑定时writeOff不依赖继续ON的准入条件，因此故障仍可请求OFF。attach失败保持故障，不能允许ON。

头文件旧角度候选／全通道组合常量为兼容原骨架及安全检查保留，**D7实现完全不读取它们**。其中`INFLATION_OFF.servoValue=0, verified=false`不是新的D7控制依据；真正使用的是`D7_OFF_US=1200`、`D7_ON_US=1800`及用户实测标记。

## 交付版仍硬锁，生产程序仍模拟

以下没有解除：

- `actuator-driver.h`原样：默认`ActuatorSimulation`；非零真实驱动选择仍编译报错。
- `PHYSICAL_OUTPUTS_PERMITTED=false`。
- `D7_ACTIVATION_REVIEWED=false`。
- `POWER_CUTOFF_VERIFIED=false`、`OVERPRESSURE_PROTECTION_VERIFIED=false`。
- `D5_D6_OUTPUTS_PERMITTED=false`；D5/D6没有可执行输出路径。

直接包含交付版真实头文件也不能attach或启动，手工清faultLatched不能绕过锁。

`nature_touch_unified.ino`、模拟驱动、Protocol v2、三个校准时间表、原D7诊断与LED诊断均未修改。默认HEX SHA-256仍为：

```text
1033aa59cb4b8ec21a5ac913c1fca5c813978c3dffab171875e53847858d708b
```

**限制明确保留：本次只准备D7 START/STOP，未开放真实三模式完整执行。** 临时D7副本运行到需要D6抽气的阶段会以ACTUATOR_FAULT停D7；默认模拟版本三模式正常完成与全部时间线不变。

## 离线验证结果

| 检查 | 结果／证据 |
|---|---|
| D7接入，实际编译HEX在AVR8js执行 | 7/7 PASS：[结果](evidence/d7-real-driver-lCk9Yl/results.json) |
| 生产选择仍编译拒绝、直接调用真实头文件仍无输出 | 4项PASS：[安全检查](evidence/driver-safety-qNhjid/results.json) |
| 现有主机回归 | 66/66 PASS：[日志](evidence/step3e-npm-test-20261029.log) |
| TypeScript类型检查 | PASS：[日志](evidence/step3e-typecheck-20261029.log) |
| 原统一模拟固件全部虚拟回归 | 11/11 PASS：[结果](evidence/step3e-unified-9dcd8641/results.json)，三模式时间线、重复命令、STOP、超时、故障及证据保护均通过 |

D7专项涵盖：默认生产无D5/D6/D7输出；启动持续1200无意外1500/1800；Protocol v2 START→1800→STOP→持续1200；HOST_TIMEOUT→OFF及RECOVER不自启；注入FAULT→OFF并保持；D6锁定；ON后虚拟复位回OFF且无恢复START。各场景均无D5/D6活动，OFF期间D7保持输出模式，无detach。

FAULT注入仅是在虚拟CPU SRAM设置`RealActuators::faultLatched`，不是物理传感器或串口命令；复位使用新的虚拟CPU执行同一HEX。沿用既有AVR8js USART RXC兼容适配，干预记录在证据内，未修改已安装依赖。

输出波形测试只在系统临时目录中复制程序，临时副本将Actuators指向RealActuators，并仅在该副本将D7相关4个准入常量设为true；D5/D6锁从未改变。原生产入口和锁始终未变。输出可用HEX留在临时目录，没有复制为工作区可上传交付件，也未调用任何上传或串口工具。生产锁定HEX与此前生产基线逐字一致。

当前离线测得1200µs脉冲的首次上升沿约53.463ms、首个完整脉冲完成约54.662ms，原点为虚拟应用PC=0、16MHz。**这不包含真实RESET保持、晶振启动或bootloader等待，不是实体RESET释放到OFF的实测时延。** 不用它证明复位期间可由软件关断。

### Flash / SRAM

| 编译对象 | Flash | 静态SRAM | 静态余量 |
|---|---:|---:|---:|
| 默认生产模拟固件 | 10770/30720（35%） | 1379/2048（67%） | 669字节 |
| 仅临时目录的D7虚拟测试副本 | 11820/30720（38%） | 1413/2048（68%） | 635字节 |
| 交付版直接锁定驱动探针 | 1346字节 | 55字节 | 1993字节 |

635字节是静态剩余，不是最坏栈余量证明；将来获准的实体构建仍需按最终版本审阅运行内存及故障路径。

测试脚本只增加必要的Arduino配置目录显式指定，避免Windows配置重定向；安全测试默认生成新证据目录，避免覆盖历史记录。主机检查最初一次日志路径计算失败，修正后重跑取得完整66项及类型检查记录；不是产品回归失败。最终检查没有已知失败项。没有修改前端、安装依赖或重做硬件研究。

## 实体激活前仍须完成

1. 确认当前实际负载的断能位置：与单USB架构一致、操作者可触及、覆盖D7供能、无其他电源或信号回灌；明确STOP未生效时立即断能的操作。早先LED断电熄灭不代替负载供能路径审阅。
2. 确认此次测试不会产生危险压力：采用已确认无压排气配置，或有适合部件额定的限压、压力指示及卸压安排；断电不等于泄压。
3. 根据最新RESET修复的实际接法／固件确认测试范围。若演示要求覆盖仍未验证的控制器失效／供电故障，应由硬件朋友确认相应独立失效断能措施；一次RESET通过不替代这些要求。
4. 将来准备具体D7实体构建时，另行审查开锁范围、固件身份／主机报告及剩余D5/D6锁，并取得用户明确上传和单次动作授权。当前统一协议身份仍报告simulation-only，不能把本轮虚拟副本直接用作实体发布固件。

本次不请求立即上传或试泵，不解除生产锁。完成Step 3E后停止。
