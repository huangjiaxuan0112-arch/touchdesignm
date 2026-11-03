# Step 3F：D5电磁阀开关 LED-only 诊断

在用户提供D6实体端点结果后，按Step 3F计划准备。复用既有D6/D7 LED诊断的程序、命令、人工编号确认、终端日志与离线检查，仅改目标为D5及身份`D5LED/1`。**没有上传、访问COM或驱动电磁阀。**

**后续实测更新（2026-10-29）：** 用户授权后本LED版本已上传，并执行一次1200µs信号试验，报告期间及结束后闪烁、拔USB后熄灭，见[原始LED记录](../../../docs/evidence/d5-led-short-bBMWg3/trial.json)。用户另行报告D5在1800µs／约2400µs时电气ON且负载侧有电，1200µs／约544µs时电气OFF且负载侧无电，已保存为[独立电气实测通过记录](../../../docs/evidence/d5-electrical-physical-pass-20261029.json)。保留早先LED观察，不将本次四点实测伪装成助手发送过的命令／回包。D5实际气路通断、失信号／RESET／复电行为仍未由该报告验证，恰好1500µs也未测。下文“未测／尚无授权”是原准备阶段状态，不覆盖此更新。

## 已知与未知

**气路观察补充：** 用户报告失电时A↔R、P关闭；得电时P↔A、R关闭，见[独立气路记录](../../../docs/evidence/d5-pneumatic-flow-user-report-20261029.json)。因此D5电气OFF和ON分别选择上述通路，不能笼统写作“阀关／阀开”。当前尚未记录P/A/R各自实际连接到哪个泵、气囊或环境，不能仅凭端口名称推断整机充气／抽气或安全泄压。下文气路“未测”是本记录补充前的历史准备状态。

**接管后续补充：** 用户确认P接充气泵、A接气囊，R为排气路径但仅表示“可能连接抽气泵”；后者仍待确认，见[接管记录](../../../docs/evidence/pneumatic-port-connections-user-report-20261029.json)。据此充气候选意图为D5选择P-A、D7开启、D6关闭；主动抽气需要先确认R是否实际连接抽气泵吸入口。该推导没有作为实体组合测试结果，也未写入或解锁生产驱动。

**R路径最终补充：** 用户进一步明确R为主动抽气路径，接抽气泵吸入口，已另存[完整接管与动作意图表](../../../docs/evidence/pneumatic-routing-confirmed-20261029.json)。充气为D5 ON／D6 OFF／D7 ON；主动抽气为D5 OFF／D6 ON／D7 OFF。这是根据实物连接推导的控制意图，不冒充本轮组合动作实测。停止的抽气泵不等于已验证的自由排气／安全卸压路径。D6只采用其已报告的约544µs OFF、约2400µs ON端点，不外推1200/1800µs已通过。

- D6用户实体报告已单独记录：[2400µs ON／负载侧有电、544µs OFF／负载侧无电](../../../docs/evidence/d6-legacy-endpoints-physical-pass-20261029.json)。这不验证D5，也不验证D6的1200/1800µs及RESET等故障行为。
- D5候选SHORT_PULSE=1200µs、LONG_PULSE=1800µs；跨厂商1500µs阈值，但完整输入范围未公开，两个值均待实物确认，不复制D6/D7的通过标记。
- D5开关电气导通不等于气路打开。阀可能常开、常闭或切换通路；实际通路还取决于接口与配管。气路状态须在另行批准、可控无压／低能量的条件下独立观察，本LED-only测试不接阀，不得据LED判定气路。

## 行为与限制

只attach D5，D6/D7不配置、不写入。启动／RESET无脉冲、不恢复旧确认。SHORT_PULSE或LONG_PULSE只选择候选值，5秒内另行人工输入CONFIRM及匹配编号才输出；每次最多5秒、主机失联2秒移除信号。运行时拒绝切换脉宽，无自动循环。

STOP／上限／失联都是移除信号：结束为LOW再转输入，不称为D5物理OFF。持续闪烁、无响应或异常时停止，不自动扫值；人工断USB保留为应急动作。所有响应固定记录`physical_off=UNVERIFIED led=UNOBSERVED`。

Windows工具沿用原交互与现有serialport，收到新鲜D5LED/1身份才接受试验选择／确认。指定端口才打开串口，可能RESET；仅自动STATUS，不自动开始或重连。OBSERVE ON/OFF/UNKNOWN加备注记录最近一次应用的人工LED观察，须注明脉冲期间／结束后。TX/RX及观察保存至`docs/evidence/d5-led-sessions/*.jsonl`，不伪造电流／气路反馈。

## 上传前停止点

尚无D5上传或试验授权。先在断电条件下确认：电磁阀、抽气泵、充气泵均从所有供能路径物理隔离；D5 C93控制接线、参考连接、极性及3–5V供电适当；单USB无其他供能源／回灌；测试不能驱动气路、无待处理残压；操作者在场且可立即拔USB。

完成确认后需明确授权上传D5 LED-only诊断。上传完成后停止，每次SHORT／LONG另行确认，观察后再决定下一步，不自动执行整组试验。

## 当前记录

| 验证项 | 状态 |
|---|---|
| 1200µs → D5 LED | 未测 |
| 1800µs → D5 LED | 未测 |
| 电气ON/OFF及可靠关断 | 未测 |
| LED响应重复性／失信号／RESET／复电 | 未测 |
| 阀失电／得电时具体气路通断与流向 | 未测，与LED单独记录 |

离线检查：`node test/d5-led-only/verify.mjs`。终端不带端口运行只显示用法；将来授权上传后才使用`node firmware/diagnostic/d5_led_only/windows-led.cjs COM数字`，此处不是连接指令。

生产驱动安全锁、Protocol v2、三模式校准时间表和D6/D7代码均保持不变。沿用AVR8js USART RXC兼容适配；虚拟RESET不代表实体bootloader／电源／阀状态测量。

本次Nano编译通过：Flash **5316/30720字节**、静态SRAM **354/2048字节**。4组实际HEX离线检查通过，D6/D7无配置或边沿；受保护源码及旧证据哈希均不变。[结果](../../../docs/evidence/d5-led-only-y9EySZ/results.json) · [编译日志](../../../docs/evidence/d5-led-only-y9EySZ/compile.log)。Windows工具语法及无端口启动退出检查通过，未连接串口。
