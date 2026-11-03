# Nature Touch：最终接入源码包（实体发布锁定）

统一固件与真实驱动接入已完成，默认模拟可编译。**这不是已准许带泵运行的实体发布件，没有上传授权。**

- `nature_touch_unified/`：最终统一固件源码快照，包含原模拟驱动及已接入的三路真实驱动。
- `SIMULATION_ONLY.hex`：已编译／验证的默认模拟固件，绝不能称为真实气动控制HEX。
- `manifest.json`：源码、默认HEX和最小Electron兼容修改的SHA-256、映射、门锁及验证索引。
- 不包含临时虚拟测试中解除门锁、填入合成等待值后得到的输出可用HEX。

## 保留的行为

Protocol v2、原START／STOP／5000ms HOST_TIMEOUT、WIND/WAVE/BUBBLE校准表和完成时间不变。没有额外抽气、自动循环恢复或RESET后重放START。

| 意图 | D5 | D6 | D7 |
|---|---:|---:|---:|
| INFLATE | 1800µs | 544µs | 1800µs |
| DEFLATE | 1200µs | 2400µs | 1200µs |
| STOP | 1200µs（已选、台架适用性未确认） | 544µs | 1200µs |

换向仍用既有非阻塞两阶段：双泵OFF→等待实际关断窗口→换阀→等待实际阀窗口→目标泵ON。STOP、完成和故障先取消待ON，再维持双泵OFF。

## 当前不能生成实体发布HEX的具体原因

`STOP_VALVE_VERIFIED=false`；`PUMP_OFF_SETTLE_MS`和`VALVE_SETTLE_MS`仍为`UINT16_MAX`未测哨兵；断能、压力与组合启动／故障审阅未完成。源码实体许可均false。

模拟选择为`NATURE_TOUCH_ACTUATOR_DRIVER=0`（默认）。真实选择为`1`，但实际入口通过`static_assert(CONFIGURATION_VERIFIED)`检查全部条件；只改编译选择不能绕过锁。当前真实构建应报`Real actuator driver BLOCKED`，这是预期阻塞，不是待绕过的编译错误。

## 部署清单：按顺序，不在本任务执行

1. **补齐已有驱动所需的实物参数。** 在经审核、不接气囊且不会建立危险压力的台架上确认STOP的A↔R适用性，测泵电气关断及气流停止的较长时间、阀实际通路切换时间；记录多次结果、最大值及有依据的余量。若测量从S端新脉冲计时，须额外考虑固件请求到该帧的等待／相位。100ms和1000ms是离线测试窗口，不得拷贝进实体配置。
2. **确认本次供能与压力安排。** USB作为人工紧急断能；核实无旁路／回灌、负载及感性保护适当。已有信息仍没有限压或可靠卸压；先明确无法建压的无压台架，整机气囊演示则须有适当限压与残压处置。双泵OFF、缓慢变扁不等于已卸压。补齐实际需要的异常恢复覆盖，不重复已经确认的正常ON/OFF端点。
3. **授权后填实测配置并复核。** 把测量写进现有两项等待，确认STOP阀位及对应审阅标志；保留任何尚未通过的锁。仅当整套条件真实满足，才生成真实目标，不可为通过编译而把所有标志直接改true。
4. **重新构建并校验具体实体发布件。** 在现有Arduino CLI／Servo环境下使用`arduino:avr:nano:cpu=atmega328`及`compiler.cpp.extra_flags=-DNATURE_TOUCH_ACTUATOR_DRIVER=1`；记录该版本Flash/SRAM和HEX哈希，重跑必要离线检查。当前包不提供实体HEX，因为第1、2项未完成。
5. **确认操作入口和单次动作授权。** Electron服务已支持真实固件身份；`REAL_HARDWARE_DEPLOYMENT_REVIEWED`仍为false，主进程仍只读，真实控制选项默认关闭。未来经过审阅的实例须明确配置`readOnly:false`和`allowRealHardwareControl:true`，才能通过现有firmware API发送SELECT／START／RECOVER。连接本身永不START；只读真实连接仍允许显式STOP已确认的活动操作。界面原有模拟ARM不能授权实体，首次受监督会话不得用“负载已隔离／模拟固件”勾选来冒充真实授权。
6. **最后才批准上传。** 操作者在场、断能可及，重新识别Nano并核对HEX；仅在用户明确授权后上传／校验。确认真实IDENTIFY及STATUS，再逐个明确授权START／STOP，每次等待实体观察，不自动连跑三模式。响应异常先停并断能，成功ACK不是物理OFF证据。

本次只准备以上源码、验证和清单，**未打开COM、未上传、未驱动硬件**。当前精确下一步是第1、2项的停机／时序／压力确认，不是上传包内模拟HEX。

[完整验证报告](../../../docs/final-real-integration-20261029.md)
