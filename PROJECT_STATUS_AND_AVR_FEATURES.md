# SunoOriginalStudio 项目功能清单与 AVR 功能对照

> 用途：持续记录本项目要做的全部功能、已完成功能、未完成功能，以及 AVR Suno Cover 1.77.0 的详细功能清单。后续每个版本都要同步更新本文件，确保换对话窗口后也能直接继续开发。

---

## 一、项目目标

SunoOriginalStudio 是独立的 Windows Electron 桌面工具，核心目标是：

- 使用用户自己的 Suno 账号
- 原创歌曲生成
- 用户自己输入完整歌词、歌名、风格提示词
- 3 个独立 Suno 账号 Session
- Suno 官方人机验证衔接
- 任务状态查询、后续自动轮询与下载
- Excel 批量原创、多账号轮流执行、断点恢复
- 集成 N19 AI 消痕音频处理

明确不做：AVR 激活码、License、设备绑定、授权到期、最大批次数授权限制、消息中心、公告、反馈、AVR 远程模型配置下发、AVR 自有版本更新体系、智能母带。

---

## 二、当前版本与状态

当前开发版本：`v0.3.0`

仓库：`ximishan/SunoOriginalStudio`

状态说明：

- ✅ 已完成：代码已经存在并可进入实际测试
- 🟡 部分完成：核心链路有了，但还需要实机验证、UI 或调度补全
- ⬜ 未完成：尚未实现
- 🚫 不做：明确排除

版本阶段：

- `v0.1.0`：原创 Demo、3 账号、手动状态查询
- `v0.1.1`：增加人机验证检测，但仍是“打开页面 + 等待”旧方案
- `v0.2.0`：重做人机验证为官方 Challenge → Token → 原任务自动续提
- `v0.3.0`：把之前独立版 N19 AI 消痕集成进主程序，内置 FFmpeg，支持多文件批量处理

---

# 三、我们要做的全部功能

## 3.1 Suno 账号管理

| 功能 | 状态 | 说明 |
|---|---|---|
| 3 个独立 Suno 账号槽位 | ✅ | 账号 1 / 2 / 3 |
| 每个账号独立 persistent Session | ✅ | Cookie / Session 相互隔离 |
| 登录状态持久化 | ✅ | 登录一次后保留 |
| 打开指定账号窗口 | ✅ | 单独打开 |
| 检测登录状态 | ✅ | Cookie + Clerk |
| 人机验证期间账号状态标记 | ✅ | `verificationActive` |
| 登录成功后自动返回主界面 | ⬜ | 仍需优化 |
| 登录成功后自动刷新状态 | ⬜ | 后续增加 |
| 账号退出 / 清除单个账号 | ⬜ | 后续增加 |
| 账号忙碌 / 空闲状态 | ⬜ | 批量调度需要 |
| 自动轮流分配账号 | ⬜ | 账号 1→2→3 |
| 单账号并发限制 | ⬜ | 防止短时间重复提交 |
| 账号失败自动切换 | ⬜ | 后续调度 |

## 3.2 原创歌曲

| 功能 | 状态 | 说明 |
|---|---|---|
| 自定义歌名 | ✅ | 用户输入 |
| 自定义完整歌词 | ✅ | 不强制 AI 改词 |
| 自定义风格提示词 | ✅ | 直接传 Suno |
| 手动选择账号 | ✅ | 1/2/3 |
| v5.5 / v5 / v4.5+ / v4.5-all | ✅ | 已映射模型 |
| 男声 / 女声 | ✅ | `vocal_gender` |
| Weirdness | ✅ | 0-100 |
| Style Influence | ✅ | 0-100 |
| 原创提交 | ✅ | `/api/generate/v2-web/` |
| 返回 clip ID | ✅ | 最多记录 2 个 |
| 刷新任务状态 | ✅ | `/api/feed/v2` |
| 生成数量可配置 | ⬜ | 后续 |
| Instrumental 纯音乐开关 | ⬜ | 后续 |
| Negative Tags | ⬜ | 后续 |
| Voice / Persona 选择 | ⬜ | AVR 有 |
| 创建 Voice | ⬜ | AVR 有 |
| AutoPilot / 预设模式 | ⬜ | 后续 |
| 保存最近输入 / 草稿 | ⬜ | 后续 |

## 3.3 Suno 人机验证

| 功能 | 状态 | 说明 |
|---|---|---|
| `/api/c/check` 检查验证需求 | ✅ | generation precheck |
| 读取 `captcha_version` | ✅ | 用于 provider 选择 |
| 422 verification/captcha 识别 | ✅ | 提交后兜底 |
| 对应账号验证窗口置顶 | ✅ | 同一 Session |
| hCaptcha 官方链路 | ✅ | provider=1，待持续实机兼容验证 |
| Cloudflare Turnstile 官方链路 | ✅ | provider=2，待持续实机兼容验证 |
| 获取官方 token | ✅ | challenge callback |
| payload 写入 `token` | ✅ | 自动回传 |
| payload 写入 `token_provider` | ✅ | 1/2 |
| 验证后自动续提原任务 | ✅ | 用户无需重新点击提交 |
| 自动重试 3 次 | ✅ | 组件失败 |
| 手动重新加载验证 | ✅ | 自动重试耗尽后 |
| 取消验证 | ✅ | 当前任务停止 |
| 5 分钟超时 | ✅ | 超时终止 |
| 验证结束恢复主界面 | ✅ | 自动隐藏验证窗口 |
| 批量时只暂停对应账号 | ⬜ | 等多账号队列实现 |

验证原则：只衔接 Suno / Cloudflare / hCaptcha 官方验证组件，不做验证码识别、破解、代答或绕过。

## 3.4 任务中心

| 功能 | 状态 |
|---|---|
| 当前单任务展示 | ✅ |
| 手动刷新状态 | ✅ |
| 显示生成状态 / 时长 / 错误 | ✅ |
| 打开 Suno 作品页 | ✅ |
| 自动轮询生成完成 | ⬜ |
| 多任务列表 | ⬜ |
| 任务历史 | ⬜ |
| 失败重试 | ⬜ |
| 取消任务 | ⬜ |
| 删除记录 | ⬜ |
| checkpoint 防重复提交 | ⬜ |
| 重启后恢复 | ⬜ |
| 按账号筛选 | ⬜ |

## 3.5 作品库与下载

| 功能 | 状态 |
|---|---|
| 获取生成结果 audio_url | 🟡 |
| 自动下载 Suno 音频 | ⬜ |
| 本地作品库 | ⬜ |
| 保存歌词 / 风格 / 封面 / 元数据 | ⬜ |
| 自定义作品目录 | ⬜ |
| 按歌名创建目录 | ⬜ |
| 避免重复下载 | ⬜ |
| 生成完成后自动送入 AI 消痕 | ⬜ |

## 3.6 AI 消痕 · N19

`v0.3.0` 开始正式集成。

| 功能 | 状态 | 说明 |
|---|---|---|
| 主程序独立“AI 消痕”页面 | ✅ | 与原创页切换 |
| 内置 FFmpeg | ✅ | `ffmpeg-static`，无需用户安装 |
| 多文件选择 | ✅ | WAV/MP3/FLAC/M4A/AAC/OGG/WMA |
| 批量顺序处理 | ✅ | 一次处理多个文件 |
| 自定义输出目录 | ✅ | 不设置则源文件旁创建 `AI消痕输出` |
| N19 兼容 DSP 链 | ✅ | FFmpeg-only 版本 |
| Pitch 调整 | ✅ | `asetrate + aresample + atempo` |
| EQ / 高低通 | ✅ | 多段 EQ |
| Echo / 空间感 | ✅ | aecho |
| Loudness normalization | ✅ | loudnorm |
| Compressor / Limiter | ✅ | 动态处理 |
| Metadata 清理 | ✅ | `-map_metadata -1` |
| 输出 48kHz PCM16 Stereo WAV | ✅ | 统一格式 |
| 防止覆盖同名文件 | ✅ | 自动追加序号 |
| 任务取消 | ✅ | 可停止当前 FFmpeg 进程 |
| 实时处理日志 | ✅ | 主界面显示 |
| 打开输出目录 | ✅ | 一键打开 |
| 自动处理 Suno 下载结果 | ⬜ | 等自动下载完成后串联 |
| 完整 SoX + Rubber Band 字节级 AVR 复刻 | ⬜ | 当前仍是之前独立版同类 FFmpeg-only 兼容实现 |

当前 N19 参考结构：

```text
前置高低通 / 高频 EQ / 空间感
→ Loudness normalization
→ Pitch fallback（asetrate / resample / atempo）
→ AVR Scheme 9 EQ / Echo / Compressor / Limiter
→ 组合后处理
→ 48k PCM16 WAV
```

## 3.7 Excel 批量原创

全部未完成，计划支持：Excel 导入、歌名/歌词/风格/账号/模型/人声字段、数据校验、预览、3 账号轮流执行、账号验证时仅暂停对应账号、逐首提交、自定义间隔、checkpoint、重启恢复、结果 Excel、自动下载。

## 3.8 后续可选

- ⬜ 翻唱 / 使用原词 / AI 改词
- ⬜ 本地参考音频上传
- ⬜ 歌曲改词
- ⬜ Voice 管理
- ⬜ AI 写歌词 / 主题推荐
- 🚫 智能母带

---

# 四、明确不做的 AVR 功能

- 🚫 激活码、License 激活/续期/心跳
- 🚫 授权到期、设备绑定、最大设备数、最大批次数授权限制
- 🚫 消息中心、公告、消息已读、用户反馈
- 🚫 AVR 服务端模型配置下发
- 🚫 AVR 自有版本更新体系
- 🚫 智能母带

---

# 五、AVR Suno Cover 1.77.0 详细功能列表

以下来自对 AVR 1.77.0 Electron 客户端、preload IPC、renderer bundle、main process 与内置 engine 的静态分析。它表示 AVR 具备/预留的能力，不表示我们全部复制。

## 5.1 主导航

首页、翻唱、原创、歌曲改词、任务中心、作品库、AI 消痕、智能母带。

## 5.2 首页

软件运行状态、Suno 账号状态、任务概览、最近作品/任务、功能入口、授权信息、消息/公告入口。

## 5.3 Suno 账号管理

AVR 使用：

```text
persist:suno-account-1
persist:suno-account-2
persist:suno-account-3
```

能力：打开登录窗口、检查状态、获取 Auth Token、删除账号、3 账号 Session 隔离与持久化、执行任务绑定账号、账号状态保护、Voice 列表、Voice 创建、人机验证状态。

IPC：

```text
getEngineStatus
getSunoState
openSunoLogin
removeSunoAccount
getSunoAuthToken
listSunoVoices
createSunoVoice
```

## 5.4 AVR 原创

参数包括：歌名、brief、自带歌词、AI 歌词、主题、风格、模型、男/女声、Voice/Persona、Weirdness、Style Influence、预设、AutoPilot、多个生成版本。

模型映射观察到：

```text
v5.5 → chirp-fenix
v5   → chirp-crow
v4.5+ / v4.5-all → chirp-bluejay
```

核心接口：

```text
POST https://studio-api-prod.suno.com/api/generate/v2-web/
```

payload 包含 `token`、`token_provider`、`generation_type`、`title`、`tags`、`negative_tags`、`mv`、`prompt`、`make_instrumental`、`metadata`、`persona_id`、`transaction_uuid` 等。

IPC：`suggestOriginalTheme`、`createOriginalBatch`、`listLatestOriginalJobs`。

## 5.5 AVR 翻唱

支持批量翻唱、歌曲信息、素材识别、参考音频、使用原词、AI 改词、纯音乐、语言、风格、Weirdness、Style Influence、Audio Influence、模型、性别、Voice、多个版本、预设、AutoPilot、素材确认、歌词确认、失败重试、结果下载。

IPC：

```text
suggestRewriteTheme
createBatch
getMaterialReview
confirmMaterials
getLyricsReview
confirmLyrics
regenerateLyrics
attachAudioToJob
```

音频选择：MP3/WAV/FLAC/M4A/AAC/OGG；文本导入见 CSV/TXT。

## 5.6 AVR 歌曲改词

Source Song：accountId、songId、title、artist、duration、lyrics、local/Suno source。

歌词片段：id、text、startS、endS、sectionLabel、success。

状态：

```text
queued
loading_lyrics
ready
submitting
generating_candidates
awaiting_choice
committing
downloading
completed
failed
cancelled
```

IPC：`listSongEditJobs`、`listSunoEditableSongs`、`loadSongEditLyrics`、`createSongEdit`、`chooseSongEditCandidate`、`cancelSongEdit`、`retrySongEdit`、`deleteSongEdit`、`rewriteSongEditLyrics`、`onSongEditChanged`。

## 5.7 AVR 通用任务中心

状态：

```text
queued
resolving
fetching
rewriting
validating
preparing_audio
waiting_upload
uploading
submitted
generating
downloading
completed
needs_review
failed
cancelled
```

IPC：`listLatestJobs`、`listLatestOriginalJobs`、`listRecentJobs`、`listAllJobs`、`retryJob`、`cancelJob`、`deleteJob`。

## 5.8 AVR 作品库

`listCompletedWorks`、`openWorksDirectory`；包含已完成作品、本地作品目录、下载结果与相关文件保存。

## 5.9 AVR 人机验证 / Suno 风控

预检：

```text
POST /api/c/check
{"ctype":"generation"}
```

provider：`captcha_version=1 → hCaptcha/token_provider=1`；其他/2 → Turnstile/token_provider=2。

Turnstile 使用官方 `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit`，可见 Managed Challenge，具备 callback/error/expired/timeout/unsupported、自动重试、手动重载、取消、5 分钟等待。

hCaptcha 使用 Suno hCaptcha endpoint/assets，支持 invisible challenge 和必要的交互挑战，以及 callback/error/expired/chalexpired/open/close、自动重试、手动重载、取消、超时。

拿到 token 后重发原生成请求，带 `token` + `token_provider`，其他歌名、歌词、风格、模型等保持一致。

## 5.10 AVR Voice

`listSunoVoices`、`createSunoVoice`；获取/创建 Persona，并用于原创/翻唱。

## 5.11 AVR AI 消痕

AVR 的 AI 消痕实际上是固定 DSP，不是神经网络 AI。

方案：`n19`

```text
SoX 节点 1
→ 节点间响度对齐
→ FFmpeg 节点 9
→ 组合后处理
→ 48k PCM16 WAV
```

主要处理：高低通、Pitch、EQ、Reverb/Echo、Loudness normalization、Compressor、Limiter、Resample、Dither、metadata 清理、48kHz PCM16 输出。

IPC：

```text
listDeaiJobs
enqueueDeaiJobs
clearFinishedDeaiJobs
getDeaiOutputDir
openDeaiDirectory
onDeaiChanged
```

SunoOriginalStudio v0.3.0 已把此前独立版的 FFmpeg-only N19 兼容实现集成进主程序；尚未集成完整 SoX/Rubber Band 双引擎版本。

## 5.12 AVR 智能母带

预设：dynamic、balanced、loud。

IPC：`listMasteringJobs`、`enqueueMasteringJobs`、`retryMasteringJob`、`remasterAsNewVersion`、`clearFinishedMasteringJobs`、`getMasteringOutputDir`、`openMasteringDirectory`、`onMasteringChanged`。

本项目明确不做。

## 5.13 设置

`getSettings`、`saveSettings`、`selectWorksDirectory`；读取/保存设置、自定义作品目录。

## 5.14 窗口控制

`getAppInfo`、`openWorksDirectory`、`minimizeWindow`、`toggleMaximizeWindow`、`isWindowMaximized`、`closeWindow`、`onWindowMaximizedChanged`。

## 5.15 License / 授权

激活码、License 激活/续期/心跳、设备 ID/设备名、最大设备、最大批量数、授权时间；状态 active/expired/suspended/revoked/device_unbound/deleted；时长 1d/7d/30d/90d/365d/permanent/custom。全部不做。

## 5.16 消息 / 公告 / 反馈

`listInbox`、`markInboxRead`、`sendFeedback`。全部不做。

## 5.17 远程模型配置

AVR 存在 modelEndpoint、modelName、modelApiKey、HTTPS Endpoint、签名配置等，服务 AI 改词/主题生成。本项目不依赖 AVR 后端。

---

# 六、当前开发优先级

## P0 原创核心

✅ 3 账号、自定义歌名/歌词/风格、模型/人声/Weirdness/Style、原创提交、人机验证、token 回传、验证后续提。

下一步：`自动轮询生成完成 → 自动下载`。

## P1 批量原创

Excel 导入、多任务队列、3 账号轮流、账号锁、验证只暂停对应账号、checkpoint、重启恢复、自动下载、结果 Excel。

## P2 体验完善

登录自动返回、账号退出/重登、本地作品库、下载目录、任务历史、失败重试、Voice/Persona。

## P3 音频后处理 / 可选

- ✅ AI 消痕基础集成
- ⬜ Suno 下载完成后自动 AI 消痕
- ⬜ 完整 SoX + Rubber Band N19
- ⬜ 翻唱 / 改词 / AI 主题与歌词

智能母带不进入计划。

---

# 七、版本记录

## v0.1.0
初版 Electron Demo；3 个账号；自定义歌名/歌词/风格；原创提交；状态查询。

## v0.1.1
增加验证需求检测、验证窗口置顶、验证状态通知、验证后恢复尝试；仍非完整 token 链路。

## v0.2.0
完整 Challenge → Token → 自动续提；支持 hCaptcha / Turnstile、422 验证兜底、token_provider、3 次自动重试、手动重载、取消、5 分钟超时、验证后返回主窗口；Windows GitHub Actions 构建。

## v0.3.0
集成 AI 消痕：新增 `bootstrap.js` + `deai.js`；内置 `ffmpeg-static`；新增 AI 消痕页面；支持多文件批处理、自定义输出目录、任务取消、进度日志、打开输出目录；N19 FFmpeg-only 兼容 DSP；输出 48kHz 16-bit Stereo WAV；清理 metadata；不覆盖同名文件。

---

# 八、维护规则

1. 每次开发都更新本文件。
2. 完成改 ✅；部分完成改 🟡；新增需求加入清单；明确不做标 🚫。
3. 每次发布版本增加版本记录。
4. 不重新引入 AVR License、授权、公告、反馈、智能母带。
5. 核心主线：原创 + 多账号 + 人机验证 + 批量 + 下载 + AI 消痕。
6. Suno Web 私有接口、Captcha Site Key、页面结构变化时要重新适配。
