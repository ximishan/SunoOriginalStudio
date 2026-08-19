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
- 任务状态查询，后续自动轮询与下载
- Excel 批量原创、多账号轮流执行、断点恢复
- 集成 AVR 1.77.0 N19 AI 消痕完整音频链路

明确不做：AVR 激活码、License、设备绑定、授权到期、最大批次数授权限制、消息中心、公告、反馈、AVR 远程模型配置下发、AVR 自有版本更新体系、智能母带。

---

## 二、当前版本与状态

当前开发版本：`v0.4.0`

仓库：`ximishan/SunoOriginalStudio`

状态说明：

- ✅ 已完成：代码已经存在并可进入实际测试
- 🟡 部分完成：核心链路有了，但还需要持续实机兼容验证、UI 或调度补全
- ⬜ 未完成：尚未实现
- 🚫 不做：明确排除

版本阶段：

- `v0.1.0`：原创 Demo、3 账号、手动状态查询
- `v0.1.1`：增加人机验证检测，但仍是“打开页面 + 等待”旧方案
- `v0.2.0`：重做人机验证为官方 Challenge → Token → 原任务自动续提
- `v0.3.0`：把独立版 FFmpeg-only N19 兼容实现集成进主程序
- `v0.4.0`：将 AI 消痕升级为 AVR 1.77.0 原版完整 `SoX + Rubber Band + FFmpeg` 工具链与执行路径，并增加构建时、运行时 SHA-256 校验

当前最高优先级：**先把 v0.4.0 精确 N19 链路实机跑稳，再继续自动下载、自动消痕和 Excel 批量原创。**

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

## 3.6 AI 消痕 · AVR N19 完整链路

`v0.4.0` 起，FFmpeg-only 兼容实现不再作为主执行链。当前主链路改为对 AVR 1.77.0 中 N19 模块的工具链、阶段顺序和参数进行精确对齐。

| 功能 | 状态 | 说明 |
|---|---|---|
| 主程序独立“AI 消痕”页面 | ✅ | 与原创页切换 |
| 多文件选择 | ✅ | WAV/MP3/FLAC/M4A/AAC/OGG/WMA |
| 批量顺序处理 | ✅ | 一次处理多个文件 |
| 自定义输出目录 | ✅ | 默认源文件旁 `AI消痕输出` |
| 任务取消 | ✅ | 可停止当前子进程 |
| 实时处理日志 | ✅ | 主界面显示阶段 |
| 打开输出目录 | ✅ | 一键打开 |
| AVR SoX 14.4.2 工具链 | ✅ | 与 AVR 1.77.0 中提取文件哈希对齐 |
| AVR FFmpeg v7.1 工具链 | ✅ | `ffmpeg-win-x86_64-v7.1.exe` |
| Rubber Band filter | ✅ | `--enable-librubberband`，节点 9 使用 `rubberband=pitch=0.975` |
| 构建时工具链 SHA-256 校验 | ✅ | 不匹配则构建失败 |
| 运行时工具链 SHA-256 校验 | ✅ | 不匹配则拒绝标记/执行 exact 模式 |
| 解码阶段 | ✅ | 44.1kHz / Stereo / PCM16 |
| SoX 节点 1 | ✅ | 原参数、原顺序 |
| 节点间 loudnorm | ✅ | `I=-15:TP=-1.5:LRA=11` |
| FFmpeg 节点 9 | ✅ | 48kHz / Rubber Band / PCM24 |
| 组合后处理 | ✅ | 原 EQ / compressor / limiter |
| Metadata 清理 | ✅ | 节点 9 与最终输出 `-map_metadata -1` |
| 最终输出 | ✅ | 48kHz / PCM16 / Stereo WAV |
| AVR 输出命名规则 | ✅ | `-消痕-N19`，冲突追加 UUID 6 位 |
| AVR 1GB 输入限制 | ✅ | >1GB 拒绝处理 |
| 中间文件自动清理 | ✅ | temp `deai-xxxxxxxxxx` |
| 自动处理 Suno 下载结果 | ⬜ | 等自动下载功能后串联 |

### 3.6.1 精确阶段顺序

```text
源音频
↓
00-decode.wav
FFmpeg：Stereo / 44100 Hz / PCM16
↓
01-scheme1.wav
SoX 节点 1
↓
02-norm.wav
FFmpeg loudnorm：I=-15:TP=-1.5:LRA=11
Stereo / 44100 Hz / PCM16
↓
03-scheme9.wav
FFmpeg 节点 9：Rubber Band pitch=0.975
Stereo / 48000 Hz / PCM24
metadata stripped
↓
最终 WAV
组合后处理
Stereo / 48000 Hz / PCM16
metadata stripped
```

### 3.6.2 SoX 节点 1

```text
highpass 28
pitch -22
treble -0.20 8500
treble 0 7000
treble -1.5 10000
treble -2.5 12000
lowpass 15000
reverb 15 40 40 45
gain -n -1.8
rate 44100
dither -s
```

### 3.6.3 FFmpeg 节点 9

```text
rubberband=pitch=0.975,
equalizer=f=80:g=4.0:width_type=h:width=80,
equalizer=f=150:g=3.0:width_type=h:width=100,
equalizer=f=300:g=-1.5:width_type=h:width=200,
equalizer=f=1500:g=-1.0:width_type=h:width=400,
equalizer=f=4000:g=3.5:width_type=h:width=2000,
equalizer=f=8000:g=1.8:width_type=h:width=4000,
aecho=0.55:0.4:35|45:0.12|0.08,
volume=2.0,
highpass=f=45,
acompressor=threshold=-18dB:ratio=2.0:attack=10:release=120:makeup=1.5,
volume=2.0dB,
alimiter=limit=0.97
```

### 3.6.4 组合后处理

```text
highpass=f=28,
equalizer=f=120:g=0.25:width_type=h:width=100,
equalizer=f=1800:g=0.20:width_type=h:width=1200,
equalizer=f=7200:g=-0.18:width_type=h:width=3800,
acompressor=threshold=-19dB:ratio=1.18:attack=24:release=210:makeup=1,
alimiter=limit=0.96
```

### 3.6.5 “字节级复刻”的准确含义

v0.4.0 对齐的是：**同一第三方二进制工具链 + 同一阶段顺序 + 同一参数 + 同一中间采样率/位深/编码格式**。

AVR 原链路本身包含 SoX `dither -s`。Dither 会引入噪声，因此即使使用完全相同的二进制和命令，两次独立运行的最终 WAV 文件 SHA-256 也不保证相同。不能把“同一执行链路”错误宣传成“每次输出文件 hash 必然相同”。

完整工具链哈希与第三方说明见 `THIRD_PARTY_N19.md`。

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

以下来自对 AVR 1.77.0 Electron 客户端、preload IPC、renderer bundle、main process 与内置 engine 的静态分析。它表示 AVR 具备/预留的能力，不表示本项目全部复制。

## 5.1 主导航

AVR 主界面包含：首页、翻唱、原创、歌曲改词、任务中心、作品库、AI 消痕、智能母带。

## 5.2 首页

- 软件运行状态
- Suno 账号状态
- 任务概览
- 最近作品 / 最近任务
- 功能入口
- 授权信息
- 消息 / 公告入口

授权、公告、消息类功能本项目不做。

## 5.3 Suno 账号管理

AVR 使用 3 个持久化 Session：

```text
persist:suno-account-1
persist:suno-account-2
persist:suno-account-3
```

能力：打开登录窗口、检查状态、获取 Auth Token、删除账号、Session 隔离与持久化、执行任务绑定账号、账号状态保护、Voice 列表、Voice 创建、人机验证状态。

主要 IPC：

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

核心 payload 包含：

```text
token
token_provider
generation_type
title
tags
negative_tags
mv
prompt
make_instrumental
metadata
persona_id
transaction_uuid
```

metadata 中已观察到 `weirdness_constraint`、`style_weight`、`vocal_gender`、`create_session_token` 等。

主要 IPC：`suggestOriginalTheme`、`createOriginalBatch`、`listLatestOriginalJobs`。

## 5.5 AVR 翻唱

支持：批量翻唱、歌曲信息、素材识别、参考音频、使用原词、AI 改词、纯音乐、改词主题、语言、风格、Weirdness、Style Influence、Audio Influence、模型、性别、Voice、多个版本、预设、AutoPilot、素材确认、歌词确认、失败重试、结果下载。

主要 IPC：

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

Source Song 字段包括：accountId、songId、title、artist、duration、lyrics、local/Suno source。

歌词片段结构：id、text、startS、endS、sectionLabel、success。

任务状态：

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

主要 IPC：

```text
listSongEditJobs
listSunoEditableSongs
loadSongEditLyrics
createSongEdit
chooseSongEditCandidate
cancelSongEdit
retrySongEdit
deleteSongEdit
rewriteSongEditLyrics
onSongEditChanged
```

## 5.7 AVR 任务中心

通用任务状态：

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

主要 IPC：

```text
listLatestJobs
listLatestOriginalJobs
listRecentJobs
listAllJobs
retryJob
cancelJob
deleteJob
```

## 5.8 AVR 作品库

主要 IPC：

```text
listCompletedWorks
openWorksDirectory
```

能力：已完成作品列表、本地作品目录、打开目录、下载结果、保存歌曲相关文件。

## 5.9 AVR Suno 人机验证 / 风控

预检：

```text
POST /api/c/check
body: {"ctype":"generation"}
```

读取 `required` 与 `captcha_version`。

provider 映射：

```text
captcha_version = 1 → hCaptcha → token_provider = 1
captcha_version = 2/其他 → Cloudflare Turnstile → token_provider = 2
```

若 `/api/generate/v2-web/` 返回 422 且包含 verify/verification/captcha，人机验证链路会启动。

Turnstile 使用官方 Cloudflare challenge；hCaptcha 使用 Suno 对应的官方组件。验证后得到 token，再以相同歌名、歌词、风格、模型等参数自动续提原任务。

本项目只衔接官方 challenge，不识别、破解、代答或绕过验证码。

## 5.10 AVR Voice / Persona

已确认 IPC：

```text
listSunoVoices
createSunoVoice
```

能力：获取 Voice/Persona、创建 Voice、原创/翻唱任务选择 Voice。

## 5.11 AVR AI 消痕 N19

AVR 1.77.0 的 AI 消痕不是神经网络模型，而是固定 DSP 链路。

原模块 docstring 明确描述：

```text
AI 消痕：N-1-9（简单）原版链路。
节点 1（SoX）→ 节点间响度对齐 → 节点 9（FFmpeg）→ 组合后处理 → 48k PCM16 WAV
```

已确认 AVR engine 中实际捆绑：

- SoX 14.4.2 Windows 工具链
- `ffmpeg-win-x86_64-v7.1.exe`
- 该 FFmpeg 编译配置包含 `--enable-librubberband`

v0.4.0 已按同一工具链哈希、同一命令阶段、同一参数和中间格式实现。

AVR AI 消痕主要 IPC：

```text
listDeaiJobs
enqueueDeaiJobs
clearFinishedDeaiJobs
getDeaiOutputDir
openDeaiDirectory
onDeaiChanged
```

## 5.12 AVR 智能母带

AVR 提供 dynamic / balanced / loud 等母带预设，并有任务列表、重试、重新母带、输出目录等 IPC。

主要 IPC：

```text
listMasteringJobs
enqueueMasteringJobs
retryMasteringJob
remasterAsNewVersion
clearFinishedMasteringJobs
getMasteringOutputDir
openMasteringDirectory
onMasteringChanged
```

本项目明确不做智能母带。

## 5.13 AVR 设置与窗口

设置 IPC：`getSettings`、`saveSettings`、`selectWorksDirectory`。

窗口 IPC：

```text
getAppInfo
openWorksDirectory
minimizeWindow
toggleMaximizeWindow
isWindowMaximized
closeWindow
onWindowMaximizedChanged
```

## 5.14 AVR License / 授权体系

AVR 包含激活码、License 激活/续期/心跳、设备 ID、设备名、最大设备数、最大歌曲批量数、授权时间等。

观察到授权时长：`1d`、`7d`、`30d`、`90d`、`365d`、`permanent`、`custom`。

观察到状态：`active`、`expired`、`suspended`、`revoked`、`device_unbound`、`deleted`。

本项目全部不做。

## 5.15 AVR 消息 / 公告 / 反馈

IPC：`listInbox`、`markInboxRead`、`sendFeedback`。本项目全部不做。

## 5.16 AVR 远程模型配置

AVR 存在服务端下发 `modelEndpoint`、`modelName`、`modelApiKey` 等配置，主要服务 AI 改词/主题生成。本项目当前以用户自带歌词为主，不依赖 AVR 后端，也不复用该配置体系。

---

# 六、开发优先级

## P0：原创核心 + 精确 N19

1. ✅ 3 个 Suno 独立账号
2. ✅ 自定义歌名 / 歌词 / 风格
3. ✅ 模型 / 人声 / Weirdness / Style Influence
4. ✅ 原创提交
5. ✅ 官方人机验证 Challenge → Token → 自动续提代码链路
6. ✅ AVR N19 原版 SoX + Rubber Band + FFmpeg 精确执行路径
7. ✅ 构建/运行时 N19 二进制哈希校验
8. ⬜ 自动轮询生成完成
9. ⬜ 自动下载
10. ⬜ 生成完成后自动送入 N19

## P1：批量原创

1. Excel 导入
2. 多任务队列
3. 3 账号轮流执行
4. 单账号忙碌锁
5. 验证时只暂停对应账号
6. checkpoint
7. 重启恢复
8. 自动下载
9. 自动 N19 消痕
10. 结果 Excel

## P2：体验完善

1. 登录完成自动返回
2. 账号退出 / 重登
3. 本地作品库
4. 下载目录设置
5. 任务历史
6. 失败重试
7. Voice / Persona

## P3：可选扩展

1. 翻唱
2. 歌曲改词
3. AI 主题推荐
4. AI 写歌词

智能母带不进入开发计划。

---

# 七、版本记录

## v0.1.0

- 初版 Electron Demo
- 3 个 Suno 登录槽位
- 自定义歌名、歌词、风格
- 原创提交
- 任务状态查询

## v0.1.1

- 增加人机验证需求检测
- 增加验证窗口置顶
- 增加验证后自动恢复尝试
- 验证尚不是完整 token 链路

## v0.2.0

- `/api/c/check` 的 `captcha_version` 参与 provider 选择
- 接入 hCaptcha / Turnstile 官方 challenge
- challenge token 自动写入原创请求
- 422 验证错误自动进入 challenge 并重发原任务
- 自动重试、手动重载、取消和 5 分钟超时

## v0.3.0

- 集成 AI 消痕页面
- FFmpeg-only N19 兼容 DSP 实现
- 多文件批量处理
- 自定义输出目录、取消、日志、打开目录
- 48kHz PCM16 Stereo WAV 输出

## v0.4.0

- 从 AVR 1.77.0 engine 中确认 N19 原版工具链与准确阶段
- 使用与 AVR 中一致的 SoX 14.4.2 文件集
- 使用与 AVR 中一致的 imageio FFmpeg v7.1 Windows x64 二进制
- 确认 FFmpeg 含 `librubberband`
- SoX 节点 1 参数与执行顺序完整对齐
- 节点间 loudnorm 完整对齐
- FFmpeg 节点 9 改为真实 `rubberband=pitch=0.975`
- 节点 9 输出 48kHz / PCM24，与 AVR 中间格式对齐
- 组合后处理参数与最终 48kHz / PCM16 对齐
- 构建阶段验证全部关键工具 SHA-256
- 运行前再次验证全部关键工具 SHA-256
- 工具链不匹配或 Rubber Band 不存在时拒绝降级冒充 exact
- 新增 `THIRD_PARTY_N19.md` 记录哈希、阶段、第三方依赖和 reproducibility 说明

---

# 八、维护规则

1. 每次更新代码同步更新本文件。
2. 已做完改为 ✅；做到一半改为 🟡；新需求加入对应章节；明确取消改为 🚫。
3. 每次发布版本增加版本记录。
4. 不把 AVR License、授权、公告、反馈重新引入本项目。
5. 优先保证“原创 + 多账号 + 官方验证 + 精确 N19 + 批量 + 下载”主线。
6. Suno Web 私有接口、模型映射、CAPTCHA 配置都可能变化，需要持续维护。
7. N19 exact 模式必须先通过工具链哈希校验，不能静默退化为 FFmpeg-only 兼容链路。
8. 因 AVR 原链路含 `dither -s`，不得用“每次输出文件 hash 必然一致”作为精确复刻标准；精确标准是二进制工具、阶段、参数和中间格式一致。
