# Nature Touch Phase 0 — P0-00C Baseline Verification

## 1. Git 信息

- Repository: `D:\touch\touchdesignm`
- Branch: `refactor/phase0-technical-debt`
- Baseline commit: `69ccc5e70aa764b1a65cb1a386af17617a112870`
- Backup branch: `backup/phase0-baseline-69ccc5e`
- Test date: 2026-11-03 (Asia/Shanghai, UTC+08:00)
- 工作区：执行验证前干净；验证后除本文件外没有发现仓库文件变化。未创建提交或推送。
- Baseline commit、备份分支和重构分支最初指向相同提交。

本文件由 P0-00C 新增。没有安装依赖、连接 COM、运行 Arduino、上传固件或执行实体 START。

## 2. 当前运行架构

```text
React main.tsx
  └─ ExhibitionHome：卡片选择、页面状态、Mock/Arduino 模式选择
       ├─ 选择：experience:select（Mock）或 firmware:select（Arduino）
       └─ ExperiencePlayer：等待 MP4/MP3 就绪
            └─ start-selected-experience
                 └─ IPC → Electron Main
                      ├─ MockExperienceController
                      └─ ArduinoFirmwareService
                           └─ NativeSerialTransport → Protocol v2 → Arduino

播放器返回/错误/本地时钟到期
  └─ stop-active-experience → IPC STOP → 服务 → STOPPED/状态确认
```

- React 入口：`desktop/renderer/src/main.tsx`。
- 首页与媒体：`desktop/renderer/src/app/ExhibitionHome.tsx`、`ExperiencePlayer.tsx`。
- Electron Main/Preload/IPC：`desktop/electron/main.ts`、`preload.ts`、`desktop/shared/ipc.ts`。
- 固件服务/传输/协议类型：`desktop/electron/serial/arduino-firmware-service.ts`、`native-serial-transport.ts`、`desktop/shared/experience-control-protocol.ts`。
- Arduino 固件：`firmware/unified/nature_touch_unified/`。

当前没有 `ExperienceCoordinator`。Main 将 Mock 和固件服务分别注册为 IPC 处理器；Home/播放器及诊断 UI 都能发起生命周期命令。设备状态来自服务/Arduino 或 Mock；Player 另有媒体状态和本地运行计时。因此，Main 尚不是唯一的应用层体验协调入口，生命周期责任分散。

## 3. Baseline 测试矩阵

本机缺少 `desktop/node_modules`、`test/avr8js-wind/node_modules`、Arduino CLI 和 AVR 工具链。没有安装依赖。以下“FAIL（环境）”表示命令已实际执行但在启动工具时失败，不代表源码编译诊断失败；“SKIPPED”表示运行会改写仓库证据/结果，或运行前提缺失。

| 项目 / 测试名称 | 执行命令 / 入口 | 实际结果 | 错误或限制 | 历史契约不一致 | 对后续重构的影响 |
|---|---|---|---|---|---|
| TypeScript：Node 与 Web 项目 | `npm --prefix D:\touch\touchdesignm\desktop run typecheck` | **FAIL（环境）** | `tsc` is not recognized；本地依赖未安装，未产生 TypeScript 诊断 | 否 | 无法取得类型检查基线；重构前需在不改 manifest 的前提下恢复锁定依赖并重跑 |
| Electron/Vite 构建（含 React Renderer、Main、Preload） | `npm --prefix D:\touch\touchdesignm\desktop run build` | **FAIL（环境）** | `electron-vite` is not recognized；未开始构建，没有生成 `desktop/out` 或 `desktop/dist` | 否 | 无构建基线；必须补跑 |
| npm 标准纯软件套件 | `npm --prefix D:\touch\touchdesignm\desktop test` | **FAIL（环境）** | `tsx` is not recognized；测试用例没有启动 | 否 | 整套软件测试没有实际 PASS 证据 |
| React 首页渲染、卡片点击与返回 | `npm run test:ui`（`test/electron-ui-interactions.cjs`） | **SKIPPED** | 需要 Electron、SerialPort 依赖及构建产物；均未安装/生成。测试夹具会显式禁止原生 COM 枚举/打开 | **是**：脚本要求体验播放器提供 Pause/Play 按钮，当前播放器没有这两个控件 | 首页与交互运行态未经验证；不能把测试契约冲突误报成当前源码失败 |
| ExperiencePlayer 音视频播放/同步 | `npm run test:audio`（`test/electron-ui-audio.cjs`） | **SKIPPED** | 需要 Electron 和构建产物；测试脚本会禁止 COM 枚举/打开，但本次未启动 Electron | 未知：该脚本检查 MP3/视频来源、一次 START/STOP、首帧及 A/V 漂移阈值（<400ms）；没有实际测量结果 | MP3/视频能否加载、同步精度、取消行为均未实证 |
| 旧单次播放测试 | `test/electron-single-play.cjs`（不在默认 `npm test` 中） | **SKIPPED — CONTRACT MISMATCH** | 需要构建后的 Electron；未运行 | **是**：测试要求 `video.loop === false`、15 秒 video `ended` 后返回；当前视频设置 `loop`，没有 `ended` 处理，并由体验运行时长结束流程 | Phase 0 应先统一当前媒体契约与有效测试，不要先改代码迎合历史断言 |
| ExperiencePlayer 自动返回测试 | `test/electron-player-autoreturn.cjs`（不在默认 `npm test` 中） | **SKIPPED** | 需要构建后的 Electron；未运行 | **是/需核对**：脚本按 15 秒体验等待返回；当前三模式设备时长由现有定义/Arduino 状态决定，不能假设都是 15 秒 | 后续需确定当前有效验收时长，再维护对应测试 |
| FirmwareService / Protocol v2 单测 | 默认 `npm test` 中的 `test/arduino-firmware-service.test.ts` | **SKIPPED（受 `tsx` 缺失阻塞）** | 源码中测试使用 `MockSerialTransport`，模拟 COM3；覆盖 IDENTIFY、SELECT/START/STOP、ACK、STATUS、COMPLETED、FAULT/超时、READY/DEVICE_RESET、断连、重复 START 等；本次没有执行 | 否（就源码中的当前服务契约而言） | 覆盖面较广，但没有本次运行证据；恢复依赖后应优先执行 |
| NativeSerialTransport 单测 | 默认 `npm test` 中的 `test/native-serial-transport.test.ts` | **SKIPPED（受 `tsx` 缺失阻塞）** | 源码注入 SerialPortMock；不需真实 COM；本次没有执行 | 否 | 写入队列、换行和断连行为需在依赖恢复后回归 |
| 其它默认 Node 单测 | 默认 `npm test` 中的 serial diagnostic、experience definitions、Mock controller、interactive UI stop tests | **SKIPPED（受 `tsx` 缺失阻塞）** | 测试源码使用模拟时钟/模拟传输；本次没有执行 | 否 | 无实际回归结果 |
| Arduino 统一控制器 AVR8js 离线验证 | `npm run test:unified-actuators` → `test/unified-controller/verify.mjs` | **SKIPPED** | 缺 Arduino CLI、AVR 编译器和 AVR8js；脚本默认会改写 Git 追踪的 `test/unified-controller/results/`，为遵守只新增本文件的限制未启动 | 否 | 时间线、Protocol 和固件仿真没有本次运行证据 |
| Real Driver 安全门禁 AVR8js 验证 | `npm run test:actuator-driver-safety` → `test/actuator-driver-safety/verify.mjs` | **SKIPPED** | 缺 Arduino CLI/AVR 工具链/AVR8js；脚本默认会在 `docs/evidence/driver-safety-*` 新建输出目录，未启动 | 否 | 实体驱动编译阻断与无 GPIO 输出的历史证据仍须以后续离线复验 |
| 实体 COM / 上传 / 气动测试 | `test/*upload*`、硬件步骤脚本及任何实机流程 | **SKIPPED / NOT RUN** | 本轮明确禁止 | 不适用 | 任何离线结果都不能替代后续实体验收 |

命令工作目录说明：最初从 `D:\touch` 调用 npm，因父目录没有 `package.json` 报 `ENOENT`，没有运行项目脚本；随后使用上表中的 `--prefix` 命令在正确包目录重试。构建未生成产物，当前也没有 `desktop/out` 或 `desktop/dist`。

### 源码静态核查（非运行测试）

以下为只读源码检查结果，不等同于编译或运行 PASS：

- **Protocol v2：PASS（静态）**：共享协议版本常量为 2；没有修改协议或代码。
- **原始三模式时间线：PASS（静态）**：`experience-timelines.h` 中仍有 WIND、WAVE、BUBBLE 的 PROGMEM 动作表。
- **Simulation / Real Driver 区分：PASS（静态）**：`actuator-driver.h` 默认选 simulation；real 选择受 `CONFIGURATION_VERIFIED` 静态断言保护。当前真实配置仍为未验证/禁止实体输出状态。
- **STOP / FAULT / HOST_TIMEOUT：PASS（静态）**：统一固件仍含 `stopAll`、STOPPED/FAULT 状态处理及 5000ms `HOST_TIMEOUT_MS` 路径。
- **真实编译/AVR8js 执行：SKIPPED**：缺少所需工具；没有生成或上传真实输出发布 HEX。

## 4. 当前已知问题（重构前已存在）

1. **体验生命周期权属分散**：没有 Main `ExperienceCoordinator`；Home、Player、诊断 UI、Mock controller 和 FirmwareService 存在多个命令/状态路径。
2. **FirmwareService 职责集中**：`arduino-firmware-service.ts` 为约 808 行，承担连接、身份、协议请求、状态、心跳和错误处理。
3. **媒体合同不一致**：Player 使用独立 MP3 + 静音循环视频；设备体验完成状态来自 Arduino/服务，但 Player 的本地 duration 到时也会进入返回/STOP 流程。`video.ended` 不是当前结束权威。
4. **音频缓冲恢复风险（静态疑点，未运行复现）**：音频 `waiting` 时会暂停视频；音频恢复的 `playing` 处理更新 UI，但没有显式重新调用视频 `play()`。实际恢复表现需在播放器测试中确认。
5. **旧媒体测试与当前代码不一致**：单次播放测试要求视频不循环并在 15 秒结束；当前 `video` 设置 `loop`，且没有 `onEnded` 返回处理。UI 交互测试要求 Pause/Play 控件，但当前播放器提供返回、音量和全屏控件。
6. **硬件配置快照存在分歧**：当前统一固件 D6 为 1200/1800µs 且映射未验证；locked 发布副本为 544/2400µs；candidate/bench 副本为 1200/1800µs。不同副本不可当作同一已确认发布配置。
7. **实体安全和版本关联仍未闭环**：当前配置门禁未通过，发布状态表明没有真实可部署 HEX；不能由源码或模拟测试推断当前板上固件版本。
8. **Mock/ARM/Bench/诊断入口仍在代码中**：包括 Main 的 `--open-air-bench` profile、模拟 ARM 与恢复 API、`ArduinoConnection` 测试 START/STOP/RECOVER、App 诊断 UI。Main 的常规真实硬件部署许可仍为 false；本轮未连接设备。
9. **README 过时**：README 将仓库描述为最小桌面脚手架、无 Arduino 控制；与当前仓库已有的媒体、Protocol v2、FirmwareService、统一固件及测试不相符。
10. **计划文件未版本化**：`D:\NATURE_TOUCH_TECHNICAL_DEBT_REMEDIATION_FINAL (1).md` 位于仓库外，不受当前 Git 分支保护；后续需另行决定如何纳入版本管理。

## 5. 当前功能行为（源码可确认；运行态未实证）

- 首页配置 WIND、WAVES、BUBBLES 三张卡片及各自海报、视频、MP3。WIND 的体验视频从 `卒研music` 导入；WAVE/BUBBLE 视频来自 Renderer assets。
- 点击卡片先选择模式，再进入播放器。播放器并行等待视频和音频资源就绪；准备成功后调用启动辅助模块。启动辅助模块检查当前状态/硬件准入，必要时 SELECT，再发 START 并查询运行状态。
- 视频保持静音并循环；独立 MP3 是可调音量的音源。播放器每 20ms 尝试按音频时间校正视频漂移，偏差超过阈值时校正视频时间。
- Player 使用 generation token、AbortController、in-flight Promise 和卸载清理来限制取消/迟到异步回调；启动期间退出会等待启动 Promise 后再执行安全停止。
- 返回、Esc、页面隐藏及媒体错误会清理媒体并走安全停止；STOP helper 检查当前状态、发送 STOP，并轮询至 IDLE/COMPLETED 或报错。设备 COMPLETED/FAULT/断连会影响播放器处理。
- 实际媒体加载、自动播放策略、缓冲恢复、音视频漂移、React 卡片渲染和用户交互均**未在本轮运行确认**。

## 6. 重构保护清单

- 保留三模式卡片、当前有效 MP3/视频素材与当前媒体能力；在替换并验收前不得删除独立 MP3 或资源。
- 保留媒体准备取消、generation token、迟到 Promise 防护、卸载清理、音视频同步和错误后的安全停止行为。
- 一次体验只发送一次 START；请求 ID/operation ID 关联、ACK/STATUS 确认和重复 START 拒绝必须保留。
- 保留 NativeSerialTransport 的串行写入/换行/关闭语义及 FirmwareService 的 IDENTIFY、心跳、状态、FAULT、断连和 READY/DEVICE_RESET 处理。
- 保持 Arduino Protocol v2、9600 baud/newline JSON 现有约束、原 WIND/WAVE/BUBBLE 时间线、`millis()`/PROGMEM 调度、`stopAll`、互斥与 HOST_TIMEOUT。
- Simulation 与 Real Driver 必须继续隔离；真实配置未确认前不得移除静态/运行时门禁、修改 PWM 参数或宣称实体输出安全。
- 保留原发布快照、HEX/manifest、测试结果与 `docs/evidence` 硬件证据；历史记录不能被新模拟结果覆盖或替代。
- Home/Player 重构不得让 Renderer 获得 Node/串口访问，也不得让视频结束伪造 Arduino COMPLETED。

## 7. 下一阶段准备情况

**P0-00C：PARTIAL。** 已完成执行前状态核对、测试安全审阅、源码静态基线和失败/跳过原因记录；但由于依赖和 Arduino 工具链缺失，typecheck、build、npm tests、媒体运行及 AVR8js 离线测试均未形成可复现运行结果。

**当前不建议进入 P0-01。** 阻塞是缺少运行/测试基线，而不是发现必须先修的源代码错误。下一步应在不改源码、不新增依赖声明的前提下，依据现有 lockfile 恢复项目依赖和所需本地工具，然后重跑 typecheck/build/纯软件测试及安全的离线固件测试；对于会写入仓库测试结果的脚本，应先明确隔离输出目录并确认不会覆盖已追踪证据。运行 Electron 的媒体测试前，继续确认测试夹具的串口禁用保护有效。复测完成并更新本基线结果后，再由操作者决定是否进入 P0-01。

本轮未运行任何构建后应用、测试浏览器或 Arduino；未进入 P0-01。

---

# P0-00D — 开发依赖恢复与复测（2026-11-03）

本节为 P0-00D 追加记录；上方 P0-00C 原始结果保留，不以本轮结果覆盖。

## 1. 执行前状态与依赖恢复

- Repository: `D:\touch\touchdesignm`
- Branch: `refactor/phase0-technical-debt`
- HEAD: `69ccc5e70aa764b1a65cb1a386af17617a112870`（与 baseline 一致）
- Node.js: `v24.19.0`
- npm: `12.2.0`
- 执行前工作区仅有本 Baseline 文档未追踪；本轮未发现其他源码、测试、配置或锁文件改动。
- 使用 `desktop/package-lock.json` 执行 `npm ci`，恢复 201 个 desktop packages；使用 `test/avr8js-wind/package-lock.json` 执行 `npm ci`，恢复 AVR8js `0.21.1`。两份 manifest/lockfile 均未修改。
- npm 12 的脚本许可策略阻止了 Electron、esbuild 与 SerialPort binding 生命周期脚本。`npm rebuild electron esbuild @serialport/bindings-cpp` 返回成功信息，但仍提示脚本被阻止，因此不能视为二进制已准备完成。
- 已审阅并直接运行锁定依赖中的 Electron 与 esbuild 安装脚本，分别准备本机 Electron `33.4.11` 和 esbuild `0.25.12`。SerialPort `13.0.0` 的 Windows x64 预构建 binding 已存在，无需编译。上述步骤不访问 COM、不上传固件、不发送设备命令。
- 安装输出包含弃用包提示及 **2 个 high severity audit advisories**（desktop）；未执行 audit fix，也未升级依赖。AVR8js 安装报告 0 vulnerabilities。

## 2. P0-00D 测试矩阵

| 测试名称 | 执行命令 / 入口 | 结果 | 错误、限制与分类 | 历史测试契约不一致 | 对后续重构的影响 |
|---|---|---|---|---|---|
| Node/Web TypeScript typecheck | `npm --prefix D:\touch\touchdesignm\desktop run typecheck` | **PASS** | Node 与 Web 两个 `tsc --noEmit` 项目均退出 0 | 否 | 已建立 TypeScript 基线 |
| Electron Main、Preload、React/Vite build | `npm --prefix D:\touch\touchdesignm\desktop run build` | **PASS** | Main、Preload、Renderer 均构建成功；生成内容位于被 Git 忽略的 `desktop/out/`。未见构建错误或 Vite warning | 否 | 构建基线可复现 |
| 默认软件测试 | `npm --prefix D:\touch\touchdesignm\desktop test` | **PASS** | 75 tests，75 pass，0 fail。包括 FirmwareService/Protocol v2、NativeSerialTransport mock、Experience definitions、Mock controller、STOP/退出与串口诊断模拟测试 | 否 | 默认软件回归可运行；测试夹具使用模拟传输，不访问实体 COM |
| Electron 首页交互 | `npm --prefix D:\touch\touchdesignm\desktop run test:ui` | **FAIL — CONTRACT MISMATCH** | Electron 成功启动且首页 DOM 已渲染；失败于 `test/electron-ui-interactions.cjs:58`，旧断言期待 `document.querySelectorAll('video').length === 0`，实际值为 1（当前首页卡片包含预览视频）。因此该脚本未继续验证卡片点击、STOP 或退出行为。夹具覆盖 `SerialPort.list` 和 `SerialPort.prototype.open`，任何原生 COM 枚举/打开都会抛错 | **是**：测试假定首页不渲染 `<video>`；当前首页存在懒用的卡片预览 video。后续脚本还包含对当前 UI 控件的断言，需在修复/接受测试前逐条核对 | 不得将此测试失败直接视为首页源码故障；首页剩余交互仍未实证 |
| Electron 音视频与 A/V 同步 | `npm --prefix D:\touch\touchdesignm\desktop run test:audio` | **FAIL — 原因未确认** | Electron 启动，测试夹具禁止 COM。测试在 WAVES 模式 readyState 二次检查失败：`WAVE media was not ready before playback`（`test/electron-ui-audio.cjs:93`）；没有返回可保留的逐模式测量结果。日志另有 Chromium GPU state 警告，不能据此认定根因 | 未确认是契约差异；不是脚本明确的历史合同冲突 | WAVES 媒体加载/缓冲在 Electron 中未通过该检查；需要查明是运行环境、测试时序还是当前媒体行为 |
| 媒体加载取消、15 秒循环、完整三模式 A/V 测量 | 上述 Electron 脚本 | **SKIPPED / 未完整验证** | UI 测试在首页初始断言提前退出；A/V 测试在 WAVES readyState 检查退出。没有完成这些行为的独立验收 | — | 保持为未验证项；不以静态源码推断运行正确 |
| Arduino Unified Firmware AVR8js 执行 | `npm --prefix D:\touch\touchdesignm\desktop run test:unified-actuators` | **SKIPPED** | AVR8js `0.21.1` 已安装，但 `arduino-cli`、`avr-g++`、`avr-nm` 及预期 Arduino IDE 工具目录均不存在。脚本需要先编译真实 Nano HEX；没有运行，也未生成 HEX/覆盖结果 | 否 | 固件仿真与三模式运行时基线仍缺失；工具链版本/来源需明确后另行处理 |
| Real Actuator Driver 安全 AVR8js 验证 | `npm --prefix D:\touch\touchdesignm\desktop run test:actuator-driver-safety` | **SKIPPED** | 缺 Arduino CLI/AVR 工具链；脚本默认会在 `docs/evidence/` 新建输出目录，未运行以避免产生未授权证据文件 | 否 | 真实驱动编译门禁/无 GPIO 输出仍只有既有静态信息，没有本轮运行证据 |
| 实体 COM、Arduino 上传、气泵/执行器 | 不适用 | **SKIPPED / NOT RUN** | 本轮明确禁止；Electron 测试夹具也显式阻止 SerialPort 枚举/打开 | 不适用 | 本轮所有 PASS 均仅是软件/模拟验证 |

## 3. P0-00D 已知问题与行为边界

1. Electron 首页测试与当前首页 DOM 结构不一致：测试期待完全没有 `<video>`，当前卡片预览使用 video 元素。测试在首项断言退出，不能提供完整交互结论。
2. WAVES 在 Electron 媒体测试中的 readyState 检查失败。日志未能区分测试竞态、媒体缓冲/解码或源码问题；不得在没有复现证据时归因或修复。
3. 本轮未完成媒体加载取消、15 秒循环、完整三模式 A/V 漂移、退出清理及重复 START 的 Electron 端到端验收。默认 75 项 mock 测试通过，不等同于这些 UI/媒体行为的运行验收。
4. Arduino AVR8js 依赖已恢复，但编译工具链缺失，因此本轮没有编译或运行 Arduino 固件。Protocol v2/时间线/驱动隔离仅沿用 P0-00C 静态核查结论；没有修改固件或生成发布 HEX。
5. npm 安装报告的 2 个 high severity advisory 尚未分析/修复；本轮为基线任务，没有运行自动升级或 audit fix。

## 4. 文件、Git 与下一阶段

- 唯一仓库内未追踪文件仍为 `docs/PHASE0_BASELINE.md`；本节仅追加于该文件。
- `desktop/out/` 构建产物及 `desktop/out/interaction-check/` 测试证据均被 `.gitignore` 忽略；没有修改追踪的发布包、测试证据、源码、配置或 lockfile。
- 最终 HEAD 仍为 `69ccc5e70aa764b1a65cb1a386af17617a112870`；`git diff --check` 通过，跟踪文件无差异。无提交、切支、硬件访问或固件上传。
- **P0-00D：PARTIAL。** typecheck、build、75 项默认测试通过；Electron UI/音视频验证未通过，Arduino 离线工具链验证跳过。
- **暂不建议进入 P0-01。** 先审核首页测试契约、查明 WAVES readyState 失败原因，并确定 Arduino 离线工具链是否为 P0-01 的前置要求。以上仅记录，不在 P0-00D 修复。
- 本轮已停止于基线复测；没有开始 P0-01。

---

# P0-00E — 前端测试失败调查（2026-11-03）

本节只记录失败调查；保留 P0-00C / P0-00D 历史结果。没有修改 React/Electron 业务代码、测试断言、固件或依赖。

## 1. 首页 UI 测试失败

- 失败断言：`test/electron-ui-interactions.cjs` 初始页面检查要求 `document.querySelectorAll('video').length === 0`。实际为 `1`，测试在第一个断言处退出。
- 当前实现：`NatureVideoCard.tsx` 仅在 `previewPlaying` 变为 true 后设置 `hasPreview`，再条件渲染 `motion.video`。首页通过 `ExhibitionHome.tsx` 的 `focusPreview`/hover 延迟触发预览；卡片视频静音、循环、inline 播放，失焦时暂停。它是当前仍在使用的首页悬停预览功能，不是旧代码残留。
- 失败时 Electron DOM 确认该视频有当前 preview 源，样式 opacity 为 0；失败结果未记录其 paused 状态。测试自身的目的注释是验证 idle 海报和“不自动播放”，但将“没有任何 video 元素”当作“不自动播放”。指针/焦点导致预览视频被挂载时，这个断言无法区分挂载与实际播放。
- **分类：OUTDATED TEST CONTRACT。** 没有证据表明产品视频功能回归；该断言与现在存在的悬停预览功能冲突。仅凭当前测试文件不能确认它最初编写时的产品版本。
- 新测试条件建议：先将鼠标移出卡片并等待预览清理，然后验证 idle 下没有预览视频正在播放、没有音量输出/体验 START；另行将指针移入卡片并越过 hover 延迟，验证对应视频静音、循环、独占播放，移出后暂停。不要要求 DOM 中永远不存在 `<video>`。

## 2. WAVES readyState 失败

### 资源与代码路径

- WAVES 源视频 `desktop/renderer/src/assets/waves/waves-experience.mp4` 存在（109,790,954 bytes）；MP3 `卒研music/ocean waves/海浪声.mp3` 存在（647,424 bytes）。
- 构建产物 `desktop/out/renderer/assets/waves-experience-CT8b_JR6.mp4` 与 `海浪声-TBiY0r_D.mp3` 均存在。Electron 诊断得到的 `file:///D:/touch/touchdesignm/desktop/out/renderer/assets/...` URL 正确解析到这些产物。
- `ExperiencePlayer.tsx` 将音频和视频的 `waitForMediaReady` 并行放入 `Promise.all`，各自等待 `HAVE_FUTURE_DATA`（readyState ≥ 3）或 error/abort。两者都 ready 后才调用 `begin()`。运行时先请求静音 `video.play()`，其 Promise 成功后再请求 `audio.play()`；音频的 waiting 会暂停视频，音频恢复 playing 后重新对齐视频时间。没有“音频必须先播放才能让视频 ready”或“视频必须先播放才能让音频 ready”的循环等待；运行中只有音频缓冲会单向暂停视频。

### 测试与定向复现

- 既有 `test/electron-ui-audio.cjs` 先轮询等待 video 与 audio 都达到 readyState ≥ 3；随后另一次 Renderer 求值读取 URL/readyState 并再次断言 ≥ 3。播放器此时已因同一 readiness 条件自动开始 START/媒体播放，readyState 是可变化的状态，不是锁存的加载结果；两次独立求值之间可发生状态变化。
- P0-00D 失败输出只保留了 `WAVE media was not ready before playback`，**没有保存失败瞬间 video.readyState/audio.readyState 的数值**，也没有该次运行的 media error 或 play Promise rejection 详情；因此不能声称已知失败瞬间的确切数值。
- 为定向复现，运行一次相同构建 Electron Main 的三模式诊断；夹具覆盖 `SerialPort.list` 和 `SerialPort.prototype.open`，明确禁止 COM 发现/打开。WIND、WAVE、BUBBLE 均使用正确的本地构建 URL，均进入 `playing`，20 次采样中音视频各自 20/20 次为 `paused=false`。三模式没有 media `error` 或未处理 play Promise rejection。WIND/WAVE 视频 readyState 采样到 1 与 4，音频采样为 4；BUBBLE 两者采样均为 4。诊断中有少量 `waiting` 事件，符合媒体缓冲事件，不伴随 error，采样随后仍在播放。该诊断证明当前环境下实际播放成功，但不等同于全量验收或证明所有环境永不缓冲。
- **分类：TEST TIMING / ENVIRONMENT ISSUE（强证据，最可能根因）。** 同一应用定向运行能正确加载和播放三种媒体；WAVES 视频 readyState 在播放期间确实会从 HAVE_FUTURE_DATA 变为 HAVE_METADATA 再回到 HAVE_FUTURE_DATA。测试先等待阈值成立，之后又单独读取并再次断言，因此存在 TOCTOU 式时序窗口。原始失败样本没有 readyState 快照，故失败当时的具体值仍为 **UNKNOWN**；没有确认的 WAVES 产品故障，也没有实际 play Promise rejection 证据。
- 新测试条件建议：不要在媒体已经播放后重复把瞬时 `readyState ≥ 3` 当作持续不变的加载保证。将资源 URL 和 ready 门槛在开始命令发出前以同一次采样验证（或在测试夹具中记录 START 时刻的媒体 readiness）；之后以资源无 error、播放事件/时间推进、首个可见视频帧、音视频漂移阈值及返回清理作为播放验收。对合法 `waiting`/恢复事件单独验证，不把瞬时 readyState 下降解释为资源损坏。

## 3. 分类汇总

| 类别 | 结论 | 依据 |
|---|---|---|
| CONFIRMED PRODUCT BUG | **未确认** | 定向 Electron 运行中三模式正确加载并播放；没有媒体 error 或未处理 play rejection。单次诊断不代表穷尽所有环境。 |
| OUTDATED TEST CONTRACT | **首页视频计数断言** | 当前卡片有意按 hover 状态条件渲染预览视频；测试把 DOM 无 `<video>` 错当作“不 autoplay”。 |
| TEST TIMING / ENVIRONMENT ISSUE | **WAVES readyState 二次断言** | ready 等待后又独立读取瞬时 readyState；定向采样证明 WAVES 播放期间状态变化，实际播放成功。 |
| UNKNOWN | **P0-00D 失败瞬间数值及偶发诱因** | 原失败日志未记录两个 readyState 数值、媒体事件/Promise 详情；不能还原精确失败样本。 |

本轮**不需要也不允许直接修改业务代码或测试**。首页问题属于测试契约过期；WAVES 问题目前归类为测试时序问题，而不是已确认产品 Bug。

## 4. P0-01 前置条件判断

1. **75 项核心软件测试可作为初始软件回归基线**：P0-00D 实测 75/75 PASS，且 TypeScript 与 Electron/Vite build PASS。开始 P0-01 时继续执行这些既有检查，并以本报告中的 UI/媒体限制作为已知基线。
2. **两项前端失败不是 P0-01 的代码前置阻塞**：首页为过期测试契约；WAVES 未确认产品缺陷，定向播放成功。无需在 P0-00E 修复或让旧断言变绿。后续触及 UI/Player 阶段时，应按当前行为更新验收条件并补足媒体时序覆盖。
3. **Arduino CLI/AVR 工具链可推迟到 P0-05 前恢复**：P0-01 的工作是共享 TypeScript 契约与 Electron IPC，不编译固件、不改 Protocol v2；缺工具链不阻止本阶段。
4. **未发现其他 P0-01 依赖阻塞**：锁定的 desktop 依赖已恢复，typecheck/build/75 项测试均可运行。P0-01 按计划增加纯 TypeScript 契约测试即可，不需要新增依赖、硬件或网络服务。
5. **结论：具备进入 P0-01 的技术前置条件。** 下一阶段仍须严格限定在 Shared Contract & Ownership；本 P0-00E 没有开始该阶段。

最终仓库状态：HEAD 仍为 `69ccc5e70aa764b1a65cb1a386af17617a112870`，分支仍为 `refactor/phase0-technical-debt`；本轮仅追加本文件。无提交、切支、硬件访问、固件上传或源码/测试修改。
