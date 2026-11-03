# Step 3G：统一气动真实驱动，实体输出仍锁定

2026-10-29。**离线实现及验证完成，停止于Step 3G。没有枚举／连接COM、上传、驱动实体泵阀、改接线或修改React/Electron。** 单USB架构保留。

## 三路映射与证据边界

更新既有[real-actuators.h](../firmware/unified/nature_touch_unified/real-actuators.h)，仍复用Servo及原五接口；没有新协议或驱动架构。

| 状态 | D5阀信号 | D6抽气泵 | D7充气泵 |
|---|---:|---:|---:|
| INFLATE | ON：1800µs，选择P↔A | OFF：544µs | ON：1800µs |
| DEFLATE | OFF：1200µs，选择A↔R | ON：2400µs | OFF：1200µs |
| STOP／FAULT | **尚未选择适用于STOP的阀位** | 持续OFF：544µs | 持续OFF：1200µs |

D6数值是用户报告的约544/2400µs端点，不擅自替换为尚未在D6确认的1200/1800µs；不再保留或执行旧角度组合。

D5电气映射依据[用户实测](evidence/d5-electrical-physical-pass-20261029.json)。气路OFF=A↔R/P关闭、ON=P↔A/R关闭依据[用户实物观察](evidence/d5-pneumatic-flow-user-report-20261029.json)；P接充气泵、A接气囊、R接抽气泵吸入口依据[后续接管确认](evidence/pneumatic-routing-confirmed-20261029.json)。这是有来源的用户报告，不冒充本轮独立仪器验证或完整压力安全验证。

D7早先RESET失败及最新用户报告通过均保留。后者不能外推D5/D6或所有供电故障。此前D5/D6 LED闪烁原始记录也保留，没有用后续负载侧报告改写原试验。

## 最小控制实现

- 初始化先预置双泵OFF及经审核的STOP阀位，再attach，避免有意发送默认1500µs或ON。未满足准入时不attach任何一路。
- 每次改变泵方向：先写双泵OFF，进入非阻塞`WAIT_PUMPS`；达到经实测确定的关断等待后写目标阀位，进入`WAIT_VALVE`；待阀响应窗口满足后才写目标泵ON。非目标泵始终维持OFF。
- 同向连续inflate／deflate或相同待执行请求直接保持，不重新关泵或延长等待，保留BUBBLE连续充气语义。
- `stopAll()`先清除待执行动作，再请求双泵OFF；仅有经审核且有效的STOP阀位才允许写阀。无detach、无补跑抽气、无追加排气时长。
- HOST_TIMEOUT、FAULT及正常完成复用统一程序原有stopAll路径。故障在service放行ON前检查；STOP和故障取消两阶段等待，后续service不会恢复旧ON。
- 新的START仍须走原调度器；RESET重新初始化，不保存／恢复旧运行。RECOVER不会自行启动。

软件只保证请求顺序及取消逻辑。OFF命令发出到实际泵停止、阀到位存在帧传播与负载响应，不能由代码顺序替代测量；应用代码也无法控制MCU被持续RESET的阶段。

## 未解除的硬锁

`actuator-driver.h`原样保持默认模拟及真实选择编译拒绝。真实头文件同时保留：

- `PHYSICAL_OUTPUTS_PERMITTED=false`、`D5_D6_OUTPUTS_PERMITTED=false`、`D7_ACTIVATION_REVIEWED=false`。
- 负载断能、压力保护、启动／换向综合行为的审核标志均false。
- `STOP_VALVE_VERIFIED=false`、`STOP_VALVE_US=0`：0是未选择哨兵，绝不交给Servo。
- `PUMP_OFF_SETTLE_MS=UINT16_MAX`、`VALVE_SETTLE_MS=UINT16_MAX`：未测哨兵，不能解释为实际等待方案。

任一关键条件未满足都会阻止初始化及ON。直接包含交付版头文件、手工清faultLatched仍不能输出。若已绑定后进入故障，OFF写入不依赖继续ON的准入检查，双泵优先请求OFF。

STOP不能默认选D5 OFF：那会连通气囊与停止的抽气泵吸入口，不代表自由通大气，也不保证安全卸压。D5 ON也不能未经确认就称为安全隔离。STOP阀位须根据实际气路、压力与异常处置审核。

## 编译、波形与回归

扩展原D7测试入口`test/d7-real-driver/verify.mjs`为三路验证，复用同一Nano／USART／Servo验证方式；未新增依赖。此前Step3E头文件及测试入口另存[基线目录](evidence/step3g-baseline-Ysb0BP)，历史结果不覆盖。

| 检查 | 最终结果 |
|---|---|
| 默认生产与临时三路Nano构建 | PASS |
| 三路实际HEX在AVR8js运行 | **13/13 PASS**：[结果](evidence/pneumatic-driver-NnXAwQ/results.json) |
| 生产安全锁与阻塞探针 | **5/5 PASS**：[结果](evidence/driver-safety-AIlLXE/results.json) |
| 原统一模拟固件回归 | **11/11 PASS**：[结果](evidence/step3g-unified-3a74c632/results.json) |
| 现有主机软件回归 | **66/66 PASS**：[日志](evidence/step3g-npm-test-20261029.log) |
| TypeScript | PASS：[日志](evidence/step3g-typecheck-20261029.log) |

13组检查包含：默认无三路输出；全部启动脉宽无意外ON；正确充气／抽气组合；双向换向OFF间隔、解码后的双泵无ON重叠；STOP持续OFF；HOST_TIMEOUT／FAULT持续OFF及恢复不自启；STOP取消泵关断等待和阀等待两阶段；故障取消待ON；虚拟复位无恢复START；三模式原截止时间完成及BUBBLE连续充气。

输出可用验证只在临时目录副本进行：将副本入口指向RealActuators，临时满足门锁，并用**仅用于逻辑验证、未经实物确认**的STOP阀1200µs、泵等待100ms、阀等待100ms。取消测试的另一个临时副本将两等待各设1000ms，让STOP能在9600波特率日志发送后仍处于待执行窗口。所有输出可用HEX仅留在临时目录，不作为工作区可上传交付件。

这些合成参数没有写回生产驱动，不是实体建议值。换向等待占用原动作窗口，不推迟校准表截止时间；短动作可能因此缩短供能或尚未放行就被下一动作取消。虚拟完整循环通过不等于触觉强度／实际气动时长已满足原物理校准；待实测时序后须确认可接受性，不能偷偷延长时间线补偿。

START后的标记／事件发送可能延后下一条串口命令处理。STOP测试验证的是命令已被处理后的取消与OFF，不把ACK或逻辑取消称为即时实体停机；端到端停机响应仍需受控台架记录。

### 存储使用

| 构建 | Flash | 静态SRAM | 静态剩余 |
|---|---:|---:|---:|
| 默认生产模拟 | 10770/30720（35%） | 1379/2048（67%） | 669字节 |
| 临时三路输出验证 | 12376/30720（40%） | 1438/2048（70%） | 610字节 |
| 交付版直接阻塞探针 | 1516字节 | 68字节 | 1980字节 |

610字节仅是静态余量，不代表最坏栈余量已证明。最终获准实体构建仍需按其实际配置审阅运行内存。

默认生产HEX仍为`1033aa59cb4b8ec21a5ac913c1fca5c813978c3dffab171875e53847858d708b`，与已验证基线逐字一致。统一`.ino`、模拟驱动、入口、Protocol v2、三模式表和诊断源码均未改动。WIND/WAVE/BUBBLE完成时间仍为24000/25000/27420ms，正常末段抽气仍是5/5/3秒，取消不补跑。

虚拟执行沿用已有USART RXC兼容适配，干预随结果保存。复位由新虚拟CPU运行同一HEX表示，不模拟实体RESET保持、晶振、电源、bootloader或C93内部状态。没有重复用户已完成的硬件测试。

初次验证中调整了测试侧的启动／稳态周期边界、按固件elapsed定位换向观察窗，以及单独放大待取消窗口；前三个未完成目录（`pneumatic-driver-VQ8nIF`、`pneumatic-driver-ohTHW2`、`pneumatic-driver-y8a6Th`）保留，不当作PASS。驱动实现未因这些测试时间定位问题放宽安全条件。最终上述检查无失败项。

## 剩余阻塞与最小下一步

1. **确认STOP阀位及停机时的残压处置。** 双泵OFF不是已卸压；选择哪一通路适用于停止需要有实际气路／压力依据。
2. **测定换向窗口。** 关断上一泵的负载侧时延、阀切换时延尚未知，不能用仿真100ms替代实测，也不能未经评估改变短动作时间。
3. **确认实体准入保护。** 单USB负载断能位置、无旁路回灌、必要电流／感性保护、无压或限压及卸压安排；D5/D6失信号／RESET／供电恢复行为尚无完整记录，D7最新RESET通过不自动覆盖它们。

最小下一步：请硬件朋友先在断电状态审核STOP通路、断能及压力处置方案，再据此安排另获授权的隔离台架时序／故障验证。无需重复已确认的正常ON/OFF映射，不立即试整机气囊。任何将来的实体构建、上传和动作均需具体审查及用户授权；本轮不请求启用，不开始实物测试。
