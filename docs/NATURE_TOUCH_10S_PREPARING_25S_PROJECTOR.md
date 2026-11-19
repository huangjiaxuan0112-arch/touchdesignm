# Nature Touch｜10 秒 Preparing 与 25 秒 Projector 整合

验证日期为 2026-11-12（东京时间）。下文的 T=0 指 Main 收到设备 START ACK。设备时间实测来自 Mock，iPad 页面由 Electron 中独立的回环浏览器会话验证。

## 新旧时间线

| 环节 | 旧版 Mock | 本轮 Mock 候选 |
| --- | --- | --- |
| Preparing / 模拟 INFLATE | T=0–5 秒 | T=0–10 秒 |
| Experience | T=5–20 秒，共 15 秒 | T=10–25 秒，共 15 秒 |
| Projector | T=0–20 秒，结束后回 Standby | T=0–25 秒，结束后回 Standby |
| AWAIT_COMPLETION / 模拟 DEFLATE | T=20–25 秒 | T=25–30 秒 |
| Mock 设备 COMPLETED | T=25 秒 | T=30 秒 |
| Cooldown / READY | 双确认后冷却 3 秒，通常 T=28 秒 READY | 双确认后冷却 3 秒，通常 T=33 秒 READY |

Main 配置为 `waitingMs=10000`、`experienceMs=15000`、`mockDeviceCompletionMs=30000`、`cooldownMs=3000`。Projector 在 START ACK 前预载并接受 25 秒时长校验，ACK 后发起一次播放。T=10 的阶段切换不对 Projector 调用播放、暂停、跳转或重新加载。Main 仍同时要求当前操作的设备 `COMPLETED` 和 Projector `ended`，原有故障锁定与停止逻辑继续生效。

## 影片与 Preparing

在工作区、桌面及下载目录未找到 `Nature_Touch_Projector_25s_Media_Package.zip`，因此未读取原始 ZIP 清单。采用用户单独提供的三段 MP4，读取 MP4 容器的时长和轨道元数据，并核对复制前后的 SHA-256。三段素材均为 **25.000 秒、1920×1080、H.264（avc1）、零音轨**。未转码或变速，Projector 视频元素继续使用静音与单次播放设置。

| 模式 | 附件 | 已接入的 Projector 文件 | iPad Preparing |
| --- | --- | --- | --- |
| WIND | `WIND_25s_静音投影.mp4` | `candidate-25s/wind-25s-silent.mp4` | 原有「風」文案、呼吸和风纹，水平线单次推进 |
| WAVE | `WAVE_25s_静音投影.mp4` | `candidate-25s/wave-25s-silent.mp4` | 原有「波」文案、呼吸和波纹，波形进度单次绘出 |
| BUBBLE | `BUBBLE_25s_不变速.mp4` | `candidate-25s/bubble-25s-silent.mp4` | 原有「泡」文案、呼吸和五颗气泡。第五颗约在动画第 9 秒完整显现，末段保留淡出 |

原先 iPad 页面显示通用 WAITING 卡片，三种准备动画实际在 Windows Renderer。iPad 现在沿用原有 SVG、配色及日文文案，并与 Windows Renderer 共用样式。呼吸每 5 秒一轮，共两轮。进度动画随 WAITING 显示，并在 Main 切到 EXPERIENCE 时退出。iPad 没有新增阶段定时器。T=25 的确认等待在 iPad 显示为 `AWAIT_COMPLETION`。

原 `desktop/renderer/src/assets/projector/formal-20s/` 中的三段影片和清单仍在原处，旧片 SHA-256 与原清单一致。新目录中的 `media-manifest.json` 是根据附件实测生成的本地清单。构建后的三段投影片也通过 SHA-256 比对。Windows Main Renderer 的正式体验媒体文件、映射、音轨和播放逻辑沿用原版。其正式媒体随 EXPERIENCE 开始点移到 T=10。

## 实际修改文件

| 文件 | 修改 |
| --- | --- |
| `desktop/shared/exhibition-lifecycle.ts` | 调整 Preparing 和 Mock 完成时间 |
| `desktop/shared/projector.ts` | 共用 Projector 时长及元数据容差 |
| `desktop/experience/exhibition-lifecycle-controller.ts` | 更新预载时长与结束校验阈值 |
| `desktop/electron/main.ts` | Windows Projector 窗口启用软件视频解码，解决 BUBBLE 卡顿 |
| `desktop/renderer/src/projector/media.ts`、`desktop/renderer/src/projector/main.tsx` | 切换到三段 25 秒素材，更新 Projector 预载校验与预览标注 |
| `desktop/renderer/src/assets/projector/candidate-25s/` | 新增三段 MP4 和本地 `media-manifest.json` |
| `desktop/ipad/index.html`、`desktop/ipad/ipad.js` | 接入三种 Preparing 视图，依据 Main 快照切换显示 |
| `desktop/renderer/src/app/PreparingPage.tsx`、`desktop/ipad/preparing-page.css` | 使用共享样式并更新动画。原 `desktop/renderer/src/app/preparing-page.css` 移入 iPad 静态目录 |
| `desktop/electron/ipad-lan-server.ts` | 提供共享 Preparing CSS 的静态资源路由 |
| `test/exhibition-lifecycle-controller.test.ts`、`test/rc1-lan-integration.test.ts` | 更新阶段边界、25 秒媒体校验和内存完成事件的断言 |
| `test/electron-ipad-loopback.cjs`、`test/electron-projector-link.cjs`、`test/electron-projector-media.cjs`、`test/electron-ui-interactions.cjs` | 更新 Mock 端到端及媒体断言，记录三模式实测与故障回归 |
| `docs/NATURE_TOUCH_10S_PREPARING_25S_PROJECTOR.md` | 本报告 |

## Mock 验证

从 `desktop` 执行 `electron-vite build --mode production`，将结果写入常规 `desktop/out`。启动前核对编译产物的 `EXHIBITION_DEVICE_SOURCE = "mock"`。回环测试另外核对 Main 的运行时来源和 iPad API 返回的 `mock` / `simulated`。Electron 夹具拦截原生串口枚举、打开、写入。HTTPS 只绑定 `127.0.0.1`。测试不依赖 `npm run dev` 的默认模式。

TypeScript 检查和 Mock Build 已通过。生命周期、iPad HTTPS、内存协议响应夹具合计 61 项通过。7 项投影故障回归通过，覆盖预载错误、播放拒绝、预载或播放中关闭窗口、重载、模拟 FAULT 和断连。迟到或重复的 ready / ended、无效时长、缺失 ended、重复点击及忙碌阶段的重复请求均有对应断言。故障或重开投影窗口未触发重播或新的 START。Windows Renderer 的 8 项联动断言也通过，覆盖原正式媒体预载、T=10 播放、T=25 收尾，以及断连后的媒体清理。

最终构建的三模式联动采用并排测试窗口。Windows Projector 独立进程使用软件视频解码，测试入口没有设置全局解码开关。下表单位为毫秒，播放时长从播放器 `playing` 计到 `ended`，其余 T 节点从 START ACK 计。表内后几列含浏览器轮询的采样延迟。

| 模式 | START | Preparing 可见时长 | ACK 至播放 | T≈10 播放位置 | 实际播放时长 | 回 Standby | Mock 完成 | READY |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| WIND | 1 | 10,004 | 1 | 10,040 | 25,002 | 25,061 | 30,018 | 33,017 |
| WAVE | 1 | 10,005 | 1 | 10,018 | 25,061 | 25,114 | 30,017 | 33,020 |
| BUBBLE | 1 | 10,001 | 1 | 10,073 | 25,002 | 25,049 | 30,045 | 33,026 |

三轮均沿用同一投影视频元素和媒体地址，整轮各一次媒体加载、一次播放，最后自然到达 25.000 秒。两条线形进度在准备末段接近绘满，第五颗气泡在切页前充分显现。浏览器收到 EXPERIENCE 后直接退出 Preparing，Mock 继续运行至 T≈30，之后冷却约 3 秒。串口调用计数为 0。完整证据见 [三模式回环结果](../.validation/10s-preparing-25s-projector/loopback-mock-results.json) 和 [Windows Renderer 结果](../.validation/10s-preparing-25s-projector/windows-renderer-results.json)。

允许硬件解码的默认配置在 BUBBLE 回环复测中出现卡顿，T≈10 时播放位置只有 0.331 秒。将软件视频解码参数限定在 Windows Projector 窗口后，BUBBLE 在复测中完整播放约 25 秒。Main Renderer 保留原解码设置。对照证据见 [默认解码复测](../.validation/10s-preparing-25s-projector/bubble-default-decode-results.json) 与 [独立投影窗口解码复测](../.validation/10s-preparing-25s-projector/bubble-projector-decode-results.json)。

## 真实 Arduino 与下一版实体时间线

本轮未修改 Arduino 固件、PWM、泵阀驱动、Protocol v2、硬件权限或停止保护。未访问 COM、上传固件或驱动气泵。未创建 RC 或覆盖正式 RC5 发布包，也未执行 Commit、Merge、Push 或 Deploy。

现行 RC5 物理时间线在 T=0–5 秒执行初始充气，T=5–20 秒执行各模式的体验驱动段，T=20–25 秒执行最终收尾，约 T=25 秒发出完成。下一版实体候选要把初始充气窗口延长 5 秒，将三个模式各自的 15 秒体验段和最后 5 秒收尾整体后移 5 秒，并以真实完成确认进入冷却。当前源代码候选若直接配旧固件，旧固件约 T=25 的完成事件可能先于新影片的 `ended` 到达并触发既有完成门禁，实体端的阶段也会和新 UI 错开。约 T=30 的完成和 T=33 的 READY 目前只在 Mock 环境验收。
