# Nature Touch — Phase 3B Step 4：统一控制器（仅模拟）

## 结果与适用范围

**Step 4 软件实现和限定条件下的自动验证通过。** 已在现有统一固件中接入模拟
执行器层，保留 Protocol v2、`millis()` 绝对截止时间调度和三种 PROGMEM 时间线。
没有启用实体输出，也没有继续测试三份旧程序的 PWM。

| 验证 | 实际结果 |
|---|---|
| 既有协议／控制／传输测试 | 51/51 PASS，假传输支持，不打开实体端口 |
| 新统一控制器场景 | 10/10 PASS，实际编译 HEX 在虚拟 Nano 中执行 |
| USART 模型性质回归 | 1/1 PASS，同时复现原版缺陷并检查兼容处理 |
| Nano 编译 | PASS，`arduino:avr:nano:cpu=atmega328` |
| TypeScript typecheck | PASS |
| D5/D6/D7 输出 | 所有场景均为 0 个输出边沿，0 次输出模式配置 |
| 原始草图、校准表及历史验证资料 | 33 个保护文件 SHA-256 均保持一致 |

**仿真条件必须保留：** 最终控制器结果使用 AVR8js 0.21.1 加一段明确标注的
测试侧 USART 接收标志兼容处理。原版模型的全双工失败没有被称为 PASS，失败
资料保留如下文所述。CPU 仍真实执行同一份 Nano HEX；没有根据预期时间线生成
动作或伪造协议回应。兼容处理不进入 Arduino 固件，也没有修改已安装的依赖文件。

本阶段无 COM 端口访问、USB 连接操作、固件上传、实体执行器控制或接线修改。
原始三份草图和音频未改动；`experience-timelines.h` 未改动。

## 实现内容

新增 [simulated-actuators.h](../firmware/unified/nature_touch_unified/simulated-actuators.h)，
提供 `ActuatorSimulation` 命名空间下的四个接口：

| 接口 | 行为 |
|---|---|
| `initializeOutputs()` | 启动时初始化逻辑记录，记录 STOPPED |
| `inflate()` | 未锁存模拟故障时记录 INFLATING；失败返回 false |
| `deflate()` | 未锁存模拟故障时记录 DEFLATING；失败返回 false |
| `stopAll()` | 仅记录 STOPPED，不附加充气或抽气动作 |

记录包含逻辑意图、Arduino `millis()` 时间、调用计数及最后提交的单字节 revision。
每次调用都会提交新记录，连续 INFLATING 也不会合并。测试读取编译固件实际写入
虚拟 SRAM 的这些记录，并附上 CPU 周期时间，得到完整历史。固件不在有限 SRAM
中保存整轮日志；已有 `ACTUATOR_EVENT` 继续提供兼容的串口诊断记录。

接口没有管脚配置、Servo 库、`Servo.attach()`、GPIO 写入、PWM 数值或物理 OFF
映射。协议里原有的 D5/D6/D7 180/0 字段仅作为兼容诊断文本保留，不会写入管脚。
`STOPPED` 是软件意图，不能解释为 RC 开关已物理断开。

## 调度与串口处理

调度器对每个原始动作调用一次 `inflate()` 或 `deflate()`，再累加原有截止时间，
不加入 `delay()` 或新的调度依赖。WIND 为 12 个动作，WAVE 为 10 个，BUBBLE 为
31 个。BUBBLE 的 4420 ms 与 580 ms 两次充气保持独立，不重采样、不改变整数时长。

首次测试发现，原有同步串口打印会阻塞主循环，既能延后逻辑动作，也可能使
START 后立即到来的较长 STOP 请求挤满 Nano 接收缓冲。修正包含：

- 打印每个字节及等待发送缓冲时，继续收集输入并推进逻辑调度／故障检查。
- 输入仍使用既有 160 字节行缓冲；解析完的字段保存在原有栈对象中，接收缓冲
  可收集下一条请求。命令只在主循环执行，避免 JSON 回应彼此穿插。
- 动作诊断使用一个 32 位待发送位图，与逻辑执行分离；按原动作索引顺序发送，
  足以保留全部 31 个 BUBBLE 动作，静态断言限制表长不超过 32。自然完成也先记录
  STOPPED，再发送兼容完成消息。新 SELECT 更换身份前会排空旧轮待发完成诊断。
- STATUS 的状态和故障码在序列化开始时取快照，避免打印期间状态变化造成一个
  回应内部互相矛盾。现有 Windows 单个在途请求的通信方式保持不变。

串口输出仍需要传输时间，回应与诊断到达 Windows 的时间不是动作执行时间。
STOP 命令在完整收集、主循环验证后生效；当前 JSON 帧不会被中途截断。这是软件
协议停止，不是具有电气保证的紧急停机或任意串口洪泛处理承诺。

## 状态、取消与故障规则

| 情况 | 逻辑行为／协议结果 |
|---|---|
| 启动 | IDLE，STOPPED，未选模式 |
| SELECT | 仅 IDLE／COMPLETED 接受；只选模式，不启动 |
| START | 仅 IDLE 且已选模式、近期未用 operationId 时接受 |
| 自然结束 | 记录 STOPPED，进入 COMPLETED，完成消息仅一次，不自动循环 |
| 运行中合法 STOP | 先撤销调度、清除待发动作／完成消息并记录 STOPPED；ACK STOPPING 后发 STOPPED，回 IDLE |
| STOP 尚未运行 | 保持原协议 NACK `INVALID_STATE`；原有 STOPPED 意图不变 |
| STOP operationId 不符 | NACK `OPERATION_MISMATCH`，不误停另一个操作 |
| 取消后换模式 | 可 SELECT；仍需明确的新 START，旧动作不会复活 |
| 重复请求 | 复用既有四项 ACK 缓存，重放回应，不重执行动作 |
| 相同 requestId 改载荷 | NACK `REQUEST_ID_REUSED` |
| 近期重复 operationId | NACK `OPERATION_ID_REUSED`；保留原四项历史边界 |
| 通信租约过期 | 运行中进入 FAULT／`HOST_TIMEOUT`，取消后续动作，记录 STOPPED |
| 模拟执行器故障 | 进入 FAULT／`ACTUATOR_FAULT`，取消后续动作，记录 STOPPED |
| 时间线内部不一致 | 进入 FAULT／`INVALID_TIMELINE`，不继续读取动作 |
| RECOVER | 仅 FAULT 接受；保持 STOPPED，清故障、选择、operationId 和进度，回 IDLE |

恢复后的启动必须重新 SELECT + START，不自动恢复旧动作。自然完成后的再次执行
同样需要明确 SELECT + START。旧 `NEXT WIND CYCLE`／`NEXT ROUND` 标记因兼容性
保留，但不代表统一固件自动重启。

缓存重放沿用 Protocol v2 的历史 ACK 语义；ACK 中的历史状态不是当前状态查询。
当前状态以 STATUS 为准。请求缓存和 operationId 历史仍各为四项，没有声称无限期
保存所有 ID。固件 FAULT 可由后续 STATUS 读取；现有 Electron 无需新增命令。

### 通信超时的准确含义

运行期间，距最后一条被接受的有效 Protocol v2 请求达到 **5000 ms** 时停止逻辑
执行并锁存 FAULT。Windows 原有约 1000 ms 的 STATUS_QUERY 心跳可续租。合法缓存
重放也可续租；无效 JSON、未知命令及被拒绝的请求不会延长租约。完成／空闲时
不因无消息自行产生 HOST_TIMEOUT。

恢复心跳、IDENTIFY 或 STATUS_QUERY 只恢复通信，不解除 FAULT、不自动 START。
RECOVER 是显式恢复入口。本次超时测试通过不发送有效消息来模拟主机失联，
**没有模拟或测量 USB 电气断开、供电变化或复位线路行为**。

执行器故障测试通过直接设置虚拟 CPU SRAM 中的 `faultLatched` 输入触发。
没有新增远程故障注入命令，没有实体故障传感器；RECOVER 清的是这一模拟锁存。
未来真实硬件故障复位要求不由这个模拟标志定义。

## 实际执行数据

测试对编译 HEX 使用 16 MHz ATmega328P 模型、2 KiB SRAM、定时器 0/1/2 和虚拟
USART0。请求按 UART 帧时间注入，回应来自固件实际 TX。执行器记录通过 ELF
符号定位后在提交 revision 时采集，不由 JavaScript 时间线代替固件执行。

| 模式 | 动作数 | 实测 Arduino millis 周期 | CPU 周期计时对应间隔（ms） | 最大动作迟到量（millis ms） |
|---|---:|---:|---:|---:|
| WIND | 12 | 24000 ms | 23998.668750 | 1 |
| WAVE | 10 | 25000 ms | 24999.106750 | 1 |
| BUBBLE | 31 | 27420 ms | 27418.743500 | 1 |

`millis` 周期来自固件在首次动作和完成 STOPPED 时实际写入 SRAM 的时间差；它们
恰好等于名义目标，但不是把目标抄进测量字段。另一列是提交记录的虚拟 CPU
周期差，体现不同时间基准、量化和模型误差，不能宣称纳秒级实体准确性。动作与
自然完成相对 `millis()` 截止时间均按 **±2 ms** 验证，本轮动作实际偏差为 0–1 ms。
这些数值属于统一非阻塞程序，不能与旧草图每个 `delay()` 的累加开销混为一谈。

自然运行中持续发送 STATUS_QUERY。三轮合计 53 个动作全部匹配原定义；BUBBLE
又完整执行第二轮，另 31 个动作也逐项核对，连续两次充气没有合并。各独立虚拟
Nano 场景合计执行约 **171.015 秒**，包含输入／回应、停止后的等待与恢复测试，
不等于某个单模式周期。

STOP 取消测试在停止后继续推进 28 秒，未出现旧操作的新动作或 COMPLETED。
HOST_TIMEOUT 场景在约 5000 ms 的逻辑租约边界记录停止；模拟执行器故障场景中，
从 SRAM 注入到停止记录约 **0.0132 ms 虚拟 CPU 时间**。这是模型测量，不是
物理保护响应时间。最终故障恢复后立即发送的长 STOP 请求也被完整接收并处理。

所有场景的 D5/D6/D7 DDR 输出位始终未启用，GPIO 边沿数组均为空。最长捕获
JSON 帧为 335 个字符，在现有主机 384 字符限制内。

## 编译与内存

| 项目 | 结果 |
|---|---|
| Arduino CLI | 1.5.1，使用已有安装 |
| AVR core | 1.8.8 |
| FQBN | `arduino:avr:nano:cpu=atmega328` |
| Flash | **10770 / 30720 字节，35%** |
| 静态 SRAM | **1379 / 2048 字节，67%** |
| 静态分配后的空间 | **669 字节**，仍需容纳局部变量和调用栈 |
| 虚拟 TX 时采样到的最小栈／静态区间隔 | **269 字节** |

采样栈数据来自本次场景中的 TX 回调位置，不是穷尽所有指令的最坏栈使用证明。
没有新增动态内存分配或日志数组；诊断待发动作只使用一个 32 位位图。

## 保留的失败与 USART 模型兼容条件

首版逻辑层虽然编译通过，实际测试发现串口同步打印会拖延动作：初次记录中
部分动作迟到达 329 ms，且恢复后立即 STOP 的场景未获完整回应。它保存在
[`initial-validation.json`](../test/unified-controller/results/initial-validation.json)。
协作式输入收集和调度推进修复了这部分问题；没有通过放宽 ±2 ms 的最终动作
断言掩盖旧偏移。

随后完整回归又捕获 WIND 的 `requestId` 变为 `requetId`，导致 INVALID_SCHEMA。
虚拟栈跟踪未显示该场景栈与静态区重叠；逐行输入记录定位到 USART 接收丢字。
安装的 AVR8js 0.21.1 在 UCSR0B 更新中，只要 RXEN 前后均开启，就清除待处理
RXC；Arduino 核心切换发送 UDRIE 时也走这个分支。独立性质测试能直接复现：
待接收字符仍存在，却因一次无关 UDRIE 更新失去 RXC。

按照 [ATmega328/P 数据手册，24.12.2–24.12.3 节，245–247 页](https://docs.arduino.cc/resources/datasheets/Atmel-42735-8-bit-AVR-Microcontroller-ATmega328-328P_Datasheet.pdf#page=245)，
RXC 对应未读取的接收数据，读取完毕或关闭接收器才会清除。结合捕获轨迹和
本地模型源码，本次丢字可归因于模型的接收标志处理，而非把缺字请求当成固件
应接受的合法请求。上游 [USART 模型源码](https://github.com/wokwi/avr8js/blob/main/src/peripherals/usart.ts)
用于实现对照；具体回归以已安装、固定版本的本地代码为准。

测试侧 [avr-usart-compat.mjs](../test/unified-controller/avr-usart-compat.mjs) 仅在
接收器保持启用且 RXC 原本待处理时，保留被模型清掉的标志和中断。它不补写输入
字符、不替换 JSON、不改变调度器、HEX、定时器或输出记录。最终 WIND 场景记录
到一次这样的干预，其余控制器场景为零。独立回归同时检查原版失败和兼容后该
字符能从 UDR 读出，因此这不是无条件声称上游模型已完全正确。

原版全双工失败仍保存在
[`pre-final-regression.json`](../test/unified-controller/results/pre-final-regression.json)
及 [failure-WIND.json](../test/unified-controller/results/failure-WIND.json)。
**最终 PASS 是带上述兼容条件的虚拟验证，不是未修改模型的全双工通过，也不是
实体 Nano 验证。** 固件和已安装 AVR8js 文件未为该模型问题打补丁。未上传补丁
或提交上游问题。

## 文件与复跑

- [统一固件](../firmware/unified/nature_touch_unified/nature_touch_unified.ino)
- [模拟执行器层](../firmware/unified/nature_touch_unified/simulated-actuators.h)
- [实际 HEX 测试及说明](../test/unified-controller/README.md)
- [完整机器结果、虚拟输入／回应及意图记录](../test/unified-controller/results/results.json)
- [Nano 编译记录](../test/unified-controller/results/compile.log)
- [实际执行的 HEX](../test/unified-controller/results/unified.hex.txt)
- [既有 51 项测试记录](../test/unified-controller/results/protocol-tests.log)
- [typecheck 记录](../test/unified-controller/results/typecheck.log)

从项目根目录执行：

```powershell
Set-Location .\desktop
npm test
npm run typecheck
npm run test:unified-actuators
```

需要已有 Node 24、Arduino CLI／AVR 工具及 Step 2 安装的 AVR8js；本次没有新增
包或调度依赖。测试仅编译到新的临时目录。`UNIFIED_RESULTS` 可指定独立结果目录。
最终完整运行的 `caseFilter` 必须为 null；调试过滤的个别场景 PASS 不是整套通过。

Step 2／Step 3 历史数据及其原始哈希清单原样保留；Step 3 清单中的统一固件哈希
描述的是当时版本，不因这次获授权的统一固件开发而改写。Step 4 保护校准表、
原始草图和历史证据，并记录新统一固件及新执行器头文件的 SHA-256。

## 阶段边界

Step 4 到此结束。下一阶段按既定计划转向 Step 5 的真实 RC 开关 OFF 行为及保护
验证，而不是继续增加旧程序 PWM 测试。本次没有自动开始实体测试或解锁气泵。
模拟器不知道开关在信号消失、Arduino 重启、供电异常时的真实行为；真正停机、
压力保护与实体驱动整合仍未由本次软件 PASS 解决。
