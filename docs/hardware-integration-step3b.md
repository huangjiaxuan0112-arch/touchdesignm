# Hardware Integration Step 3B：真实驱动骨架，输出仍锁定

2026-10-27。**准备实现及离线检查通过；真实驱动不可启用。** 未上传、访问 COM、通电测试或改线；没有重复旧草图 PWM 测试。

## 最小改动

- `actuator-driver.h` 是统一入口，调度器改用 `Actuators` 别名。默认只引用原 `simulated-actuators.h`；模拟文件保持原样。任何非零 `NATURE_TOUCH_ACTUATOR_DRIVER` 选择直接 `#error`，不是可直接解锁的功能开关。
- 独立 `real-actuators.h` 使用已有 Servo 库类型，保存原组合：inflate=(180,180,0)，deflate=(0,0,180)，依次对应 D5 阀、D6 抽气泵、D7 充气泵。
- 三路 OFF 分别明确为 `servoValue=-1 / verified=false`，其中 -1 只是 UNVERIFIED 哨兵，不会交给 Servo。独立保护、启动／换向验证均为 false，另外有不可由运行时设置的源代码常量锁。
- 真实骨架的初始化不 `attach()`；充／抽气请求返回 false 并锁存故障；`stopAll()` 也保持故障，不写猜测的 OFF、不 detach、不追加抽气，不能当作真实停机成功。即使单独包含真实头文件、手工清故障标志，也不能初始化或输出。
- 私有旧组合写入函数在本交付中不可达；它不是可启用的安全换向实现。**所有真实换向目前均拒绝，所以不会产生双泵同时供能。** 将来必须先实现经实测的“关闭上一泵→满足关断／交接条件→阀及目标泵”过程，不能只改锁定常量就启用。

四接口名称不变，Protocol v2、调度器算法及校准表不变。正常末段抽气仍为 WIND/WAVE 5 秒、BUBBLE 3 秒，不追加时长。正常完成、STOP、HOST_TIMEOUT 及故障仍分别走原有取消／`stopAll()` 路径，不补跑末段抽气。

## 实际验证

| 检查 | 结果 |
|---|---|
| 现有单元回归／类型检查 | 56/56 PASS；typecheck PASS |
| 统一固件实际 HEX 在 AVR8js 中执行 | 11/11 PASS，含三模式、STOP、超时、故障、重复请求及证据保护；沿用已记录的测试侧 USART RXC 兼容处理 |
| 新安全检查 | 4 项 PASS：真实选择编译失败；逐路 OFF 未验证与旧组合不变；直接调用真实骨架仍拒绝（包括清故障后）；虚拟 D5/D6/D7 无输出模式配置／边沿 |
| 默认 Nano 构建 | Flash **10770/30720 字节（35%）**；静态 SRAM **1379/2048 字节（67%）**，剩余 669 字节供栈／局部变量等 |
| 单独阻塞骨架探针构建 | Flash 1194 字节、静态 SRAM 58 字节；这是测试探针，不是启用真实驱动后的整机内存预测 |

默认 HEX SHA-256 仍为 `1033aa59cb4b8ec21a5ac913c1fca5c813978c3dffab171875e53847858d708b`，与此前已验证模拟固件完全一致。模拟驱动、原始草图、校准表及既有保护证据的哈希保持不变。首次探针编译未自动找到 Servo，显式指定已安装的 `Arduino15/libraries` 后通过，未安装新包。

统一控制器、安全检查和编译器拒绝真实选择的机器记录保存在本机验证目录，未发布到仓库。虚拟管脚结果不代表 RC 开关、电气隔离或实体停机已经验证。

## 激活前仅需补齐的实物条件

1. 三只开关分别测定可靠 OFF／ON；确认阀的气路状态，不能从 0/180 推断。
2. 假负载验证信号丢失、启动／RESET／USB 恢复及泵切换关断时间，确定不会双泵重叠；若必须引入影响短动作的交接时间，先确认取舍，不擅改时间线。
3. 确认独立负载断能、USB-only 电流裕量及感性保护；保留单 USB 架构，不默认更换供电。
4. 确认可用的独立限压和手动卸压路径。断电后缓慢变扁不是验证通过。当前无万用表、手动卸压路径不确定，仍是未解项。

条件通过并另获授权后，才补真实初始化、物理 STOP 与换向实现并重新验证；本次不提供可启用的真实控制构建。

## 离线复跑

在 `desktop` 目录，先为证据选择新目录，避免覆盖历史记录：

```powershell
npm test
npm run typecheck
$env:UNIFIED_RESULTS = Join-Path $env:TEMP ('nature-touch-unified-' + [guid]::NewGuid())
npm run test:unified-actuators
$env:DRIVER_SAFETY_RESULTS = Join-Path $env:TEMP ('nature-touch-driver-' + [guid]::NewGuid())
npm run test:actuator-driver-safety
```

需要已有 Arduino CLI、AVR core、Servo 及 AVR8js；脚本只编译／虚拟执行，没有上传或串口路径。结束于 Step 3B，实体 Nano 上的固件本次没有变化。
