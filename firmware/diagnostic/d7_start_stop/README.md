# Step 3C：D7 START / STOP 独立诊断（输出禁用）

2026-10-29。准备完成；**未上传、未打开 COM、未给执行器通电、未改线。**

此交付验证的是 Windows 命令与 Nano 逻辑控制，不是充气泵响应。没有真实输出实现，也没有 ARM、SET 或启用输出的命令。D5、D6、D7 均不配置、不写入；D7 的真实 START 仍被阻止。

## 文件与范围

- `d7_start_stop.ino`：独立 Nano 草图，使用现有 Servo 头文件／库；不创建 Servo 对象，不调用 attach、write、detach 或 GPIO 输出函数。
- `windows-control.cjs`：Windows 终端界面，复用桌面项目已安装的 Node.js `serialport`，不需要安装依赖，不修改展览界面。
- `../../../test/d7-start-stop/verify.mjs`：编译并执行真实 HEX 的离线验证脚本。
- 结果及实物准备说明见 [Step 3C 报告](../../../docs/hardware-integration-step3c-d7.md)。

## 逻辑命令

9600 baud，ASCII 大写命令，以 LF 或 CRLF 结束。独立诊断协议 `D7DIAG/1`，不冒充统一固件的 Protocol v2。

| 输入／事件 | 逻辑结果 |
|---|---|
| 上电／复位 | `STOPPED`，无自动 START、无自动恢复 |
| `START` | `SIM_RUNNING`；只模拟充气请求，无电气输出 |
| 运行时再次 `START` | `START_DUPLICATE`；不延长起始时间、不续租 |
| `STOP` | `STOPPED`；取消逻辑运行／解除超时锁定，不代表物理 OFF |
| `STATUS` / `PING` | 报告状态并刷新主机通信期限；不启动或解除锁定 |
| 主机通信中断 5000 ms | `TIMEOUT_LOCKED`，事件 `HOST_TIMEOUT` |
| 单次运行达到 10000 ms | `TIMEOUT_LOCKED`，事件 `MAX_TEST`；心跳不能延长 |
| 超时后 `START` | 拒绝，须先显式 `STOP` 再显式 `START` |
| 非法／空／超长帧 | 错误日志，不刷新通信期限；半帧未结束不执行 |

日志包含 Nano 启动后的毫秒数、命令／事件、当前逻辑状态、运行毫秒数，以及固定的 `output=DISABLED off=UNVERIFIED`。STOP／超时日志的 elapsed 保存该次运行时长。状态由相邻日志体现转换；启动后的时钟重新计数。

软件超时仅为次级保护；当前没有任何物理关断动作。后续带输出版本必须另行实现并验证真实 OFF，不能只改一个常量。本草图定义 `D7_ENABLE_OUTPUT` 会直接编译失败。

## 当前允许的离线使用

在项目根目录运行：

```powershell
node test/d7-start-stop/verify.mjs
node firmware/diagnostic/d7_start_stop/windows-control.cjs
```

第二条只启动终端，不自动连接。输入 `status` 可查看未连接状态，输入 `quit` 退出。**本阶段不要输入 `connect`，不要上传。** 实体 Nano 中现有固件不会因为本地文件已准备好而改变。

测试脚本使用已有 Arduino CLI、AVR core、Servo、AVR8js；仅编译／虚拟串口，不加载真实串口库。每次生成新的 `docs/evidence/d7-start-stop-*` 目录，只有 `results.json` 为 PASS 的目录才是通过证据。

## 以后获得授权后的终端操作参考

以下是将来按批准方案部署并核实固件后才使用的命令说明，**不是本次开始实体测试的指令**：

```text
connect COM数字
status
START
STOP
disconnect
quit
```

`COM数字` 是操作人员确认的实际端口，不能照抄占位文字。连接后每秒发送 STATUS；收到新鲜的、匹配 `D7DIAG/1` 且明确输出禁用的状态才允许发送 START。错固件／响应超过 2.5 秒则拒绝 START。连接、READY、重连均不自动 START，也不自动重连。串口打开可能导致 Nano 复位，须在授权方案中处理。

`disconnect`／正常退出会尝试发送 STOP、排空发送队列并关闭端口；这只是尽力发送，无物理停机确认。进程被强制结束／USB 意外拔除时不能依赖此路径。串口错误或关闭后清除身份及逻辑状态；UNKNOWN 表示未知，不能显示成安全 OFF。Windows 日志带 UTC 时间；Nano 日志是本次启动后的毫秒数。

本工具仅接受输出禁用固件。以后若另行开发带输出诊断，必须同时修改协议标识和主机识别规则并重新验证，避免把本次软件通过结果套用到实体输出版本。
