# Nature Touch 单一开发基线

当前开发工作区采用 **30 秒设备动作 + 完成确认后 3 秒 Cooldown**。WIND、WAVE、BUBBLE 共用阶段时间，各自保留原有 15 秒触觉动作和顺序。

| 阶段 | 标称时间 | 软件行为 |
| --- | --- | --- |
| INFLATE | 0–10 秒 | iPad Preparing 显示 10 秒。Projector 在 START ACK 后开始播放 |
| EXPERIENCE | 10–25 秒 | 体验持续 15 秒。Projector 连续播放至 25 秒 |
| DEFLATE | 25–30 秒 | 最终抽气持续 5 秒。Projector 结束后回 Standby |
| COOLDOWN | 设备完成与影片结束确认后 3 秒 | Main 与设备侧冷却在同一轮内分别计时 |
| READY | 理想约 T=33 秒 | 由完成、冷却与现有设备门禁共同决定 |

## 架构与保护

- 固定 R1–R5 控制链。观众通过 `experience:dispatch` 提交意图。Electron Main 使用 ExhibitionLifecycleController 协调整轮体验，ExperienceCoordinator 仲裁设备命令。iPad 订阅阶段，Projector 管理本地媒体，Arduino 执行本地调度。
- 保留操作和请求 ID、单次 START、设备身份与版本匹配、真实输出权限、STOP、FAULT、HOST_TIMEOUT、迟到消息关联及显式恢复。设备完成与投影结束共同决定 Main 进入 Cooldown。
- 当前 Arduino 保留 RC5 的 D5 阀路、D6/D7 泵角色、READY 预置、换向等待和设备侧 Cooldown。用户于 2026-11-12 确认现场条件并授权通过 30 秒构建的部署审核门禁。设备身份和其他保护仍须满足。

## 版本与工作区

- 日常维护一个开发源码基线。开发构建从当前工作区生成，默认使用 Mock。真实展览路径受既有部署审核和精确身份检查约束。
- 历史 RC5 的正式入口、Bundle、Manifest、HEX、RC4 回退和 Git 基线应保留供追溯与回退。封存 RC5 仍使用原 25 秒固件及配套资源。当前开发路径使用 30 秒设备动作及 25 秒影片。
- 新工作按当前基线做最小可验证变更。版本标识应反映真实构建及时间表，禁止伪装旧固件身份、混装发布资源、自动创建 RC6／RC7、长期维护平行运行版本或重新展开架构重构。
- 修改前核对实际 Git 状态、启动入口和受影响源码。执行相关回归与构建，记录测试范围和待确认实物条件。实体 COM、上传、实体 START、发布及 Git 写操作按用户授权执行。

当前交接与测试记录见 [最终 30 秒基线](NATURE_TOUCH_FINAL_30S_BASELINE.md)。
