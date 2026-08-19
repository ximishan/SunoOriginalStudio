# SunoOriginalStudio 项目功能清单与 AVR 功能对照

> 用途：持续记录本项目计划功能、当前完成状态、未完成功能，以及 AVR Suno Cover 1.77.0 的详细功能清单。
>
> 本文件后续应随着每个版本更新，避免功能遗漏、重复开发或误判“已完成”。

---

## 一、项目目标

SunoOriginalStudio 的目标不是复制 AVR 的授权体系，而是独立实现我们真正需要的音乐创作工作流。

当前核心方向：

- 原创歌曲生成
- 用户自己输入完整歌词
- 自己填写歌名
- 自己填写风格提示词
- 3 个独立 Suno 账号
- 保存 Suno 登录状态
- 原创任务提交
- Suno 人机验证衔接
- 任务状态查询
- 作品查看与下载
- 后续支持 Excel 批量原创
- 后续支持多账号轮流执行

明确不做：

- AVR 激活码
- License
- 设备绑定
- 授权到期
- 最大批次数授权限制
- 消息中心
- 公告
- 反馈
- AVR 远程模型配置下发
- AVR 自有版本更新体系
- 智能母带

当前也不优先做：

- AI 消痕
- 翻唱
- 歌曲改词

---

## 二、当前项目状态

当前开发版本：`v0.2.0`

当前仓库：`ximishan/SunoOriginalStudio`

当前阶段说明：

- `v0.1.1`：旧验证方式，只检测验证并打开窗口。
- `v0.2.0`：已经改为 Suno 官方 Challenge → Token → 原任务自动续提架构。
- `v0.2.0` 的 hCaptcha / Turnstile 代码已经完成，当前进入 Windows EXE 构建与实机验证阶段。

### 状态说明

- ✅ 已完成：代码已经存在，可以进入实际测试
- 🟡 部分完成：基础链路已实现，但功能还不完整，或需要继续做 UI / 调度 / 实机验证
- ⬜ 未完成：尚未实现
- 🚫 不做：当前项目明确排除

---

## 三、我们要做的全部功能

### 1. Suno 账号管理

| 功能 | 状态 | 说明 |
|---|---|---|
| 3 个独立 Suno 账号槽位 | ✅ | 账号 1 / 账号 2 / 账号 3 |
| 每个账号独立 Electron Session | ✅ | 使用不同 persistent partition |
| 保存登录 Cookie / Session | ✅ | 登录后可持久保存 |
| 打开指定账号登录窗口 | ✅ | 可单独打开每个账号 |
| 检测登录状态 | ✅ | 当前可判断账号是否已登录 |
| 登录成功后自动返回主界面 | ⬜ | 当前仍需手动切回/关闭窗口 |
| 登录成功后自动刷新状态 | ⬜ | 后续增加 |
| 账号退出登录 | ⬜ | 后续增加 |
| 删除单个账号登录状态 | ⬜ | 后续增加 |
| 账号忙碌/空闲状态 | ⬜ | 批量任务时需要 |
| 账号待验证状态 | 🟡 | main process 已记录 verificationActive，主 UI 还需要做更明显状态 |
| 自动轮流分配账号 | ⬜ | 批量原创需要 |
| 单账号并发限制 | ⬜ | 防止同一账号短时间提交过多任务 |
| 账号失败自动切换 | ⬜ | 后续任务调度功能 |

---

### 2. 原创歌曲

| 功能 | 状态 | 说明 |
|---|---|---|
| 自定义歌名 | ✅ | 用户直接输入 |
| 自定义完整歌词 | ✅ | 不强制 AI 改词 |
| 自定义风格提示词 | ✅ | 直接传入 Suno |
| 选择 Suno 账号 | ✅ | 当前可手动选 1/2/3 |
| 选择模型 | ✅ | 当前有 v5.5 / v5 / v4.5+ / v4.5-all |
| 男声 / 女声 | ✅ | 当前可指定 |
| Weirdness | ✅ | 当前可调 |
| Style Influence | ✅ | 当前可调 |
| 提交原创任务 | ✅ | 已接入 Suno 生成链路 |
| 返回作品 ID | ✅ | 当前记录 Suno clip ID |
| 记录两个生成版本 | ✅ | 正常情况下保留最多 2 个结果 |
| 生成数量可配置 | ⬜ | 后续增加 1/2/3 等选项 |
| Instrumental 纯音乐开关 | ⬜ | 当前固定为有人声原创 |
| Negative Tags | ⬜ | 后续可增加 |
| Voice / Persona 选择 | ⬜ | AVR 有，当前未接 |
| 自定义 Voice 创建 | ⬜ | AVR 有，当前未接 |
| 预设模式 | ⬜ | smart / manual / default |
| AutoPilot | ⬜ | AVR 有，当前未接 |
| Audio Influence | ⬜ | 原创当前未接 |
| 保存最近输入 | ⬜ | 防止重复填写 |
| 草稿保存 | ⬜ | 后续增加 |

---

### 3. Suno 人机验证

| 功能 | 状态 | 说明 |
|---|---|---|
| `/api/c/check` 验证需求检测 | ✅ | 已实现 |
| 检测 `captcha_version` | ✅ | v0.2.0 已实际用于选择 provider |
| 422 验证错误识别 | ✅ | 提交后遇验证错误可识别 |
| 打开对应账号 Suno 窗口 | ✅ | 已实现 |
| 验证窗口自动置顶 | ✅ | 已实现 |
| 主界面显示“等待验证”状态 | 🟡 | 有事件通知，后续加强账号卡片 UI |
| hCaptcha 官方验证链路 | ✅ | v0.2.0 已接入 Suno hCaptcha 官方组件，待实机验证 |
| Cloudflare Turnstile 官方验证链路 | ✅ | v0.2.0 已接入官方 Turnstile Managed Challenge，待实机验证 |
| 获取官方验证 token | ✅ | challenge callback 返回 token |
| 将 token 带回原创提交请求 | ✅ | payload 写入 `token` |
| 传递 token provider | ✅ | provider 1=hCaptcha，2=Turnstile |
| 验证完成后自动续提原任务 | ✅ | 不需要用户重新点击“提交原创” |
| 验证失败自动重试 | ✅ | 组件错误最多自动重试 3 次 |
| 手动重新加载验证 | ✅ | 自动重试耗尽后可手动重载 |
| 验证超时处理 | ✅ | 当前最长等待 5 分钟 |
| 验证窗口取消 | ✅ | 验证 UI 中可取消当前任务 |
| 验证结束恢复主界面 | ✅ | challenge 完成后隐藏验证窗口并聚焦主窗口 |
| 多账号验证互不影响 | 🟡 | Session 已隔离；批量调度时还需做到“只暂停对应账号” |

当前 v0.2.0 验证流程：

```text
提交原创
  ↓
/api/c/check 预检
  ↓
若当前已要求验证
  ↓
读取 captcha_version
  ↓
provider=1 → Suno hCaptcha
provider=2 → Cloudflare Turnstile
  ↓
在当前账号自己的 Suno Session /create 页面渲染官方组件
  ↓
用户完成官方挑战（低风险环境可能由官方组件直接通过）
  ↓
获得官方 token
  ↓
原创 payload 写入 token + token_provider
  ↓
自动提交原任务
```

如果预检没有要求验证，但真正调用 `/api/generate/v2-web/` 后返回 422 verification/captcha：

```text
422
 ↓
重新 /api/c/check 探测 captcha_version
 ↓
打开官方 challenge
 ↓
获得 token
 ↓
自动重发同一首原创任务
```

程序不做验证码识别、破解、代答或绕过；只负责把用户自己的 Suno Session 与官方验证组件正确接起来。

注意：当前 hCaptcha / Turnstile Site Key 与相关 endpoint 是依据 AVR 1.77.0 中观察到的 Suno Web 配置实现的。Suno 如果未来修改 Web 验证配置，需要同步维护。

---

### 4. 任务中心

| 功能 | 状态 | 说明 |
|---|---|---|
| 当前单任务展示 | ✅ | 已实现基础版本 |
| 手动刷新任务状态 | ✅ | 已实现 |
| 显示 clip ID | ✅ | 已实现 |
| 显示生成状态 | ✅ | 已实现基础状态 |
| 显示歌曲时长 | ✅ | 查询返回后可显示 |
| 显示错误信息 | ✅ | 有基础支持 |
| 打开 Suno 作品页 | ✅ | 已实现 |
| 自动轮询状态 | ⬜ | 后续增加 |
| 多任务列表 | ⬜ | 当前只有当前任务 |
| 任务历史 | ⬜ | 后续增加 |
| 失败重试 | ⬜ | 后续增加 |
| 取消任务 | ⬜ | 后续增加 |
| 删除任务记录 | ⬜ | 后续增加 |
| 断点恢复 | ⬜ | 批量任务必须有 |
| 避免重复提交 | ⬜ | 后续增加 checkpoint |
| 按账号筛选任务 | ⬜ | 后续增加 |

---

### 5. 作品库

| 功能 | 状态 | 说明 |
|---|---|---|
| 查看当前生成作品 | 🟡 | 当前只能打开 Suno 页面 |
| 本地作品列表 | ⬜ | 后续增加 |
| 自动获取音频 URL | 🟡 | refreshTask 已能读取 audio_url |
| 自动下载歌曲 | ⬜ | 后续增加 |
| 下载 WAV / MP3 | ⬜ | 视 Suno 实际可获得格式而定 |
| 保存歌词 | ⬜ | 后续增加 |
| 保存风格提示词 | ⬜ | 后续增加 |
| 保存封面 | ⬜ | 后续增加 |
| 保存任务元数据 | ⬜ | 后续增加 |
| 自定义下载目录 | ⬜ | 后续增加 |
| 按歌名创建目录 | ⬜ | 后续增加 |
| 避免重复下载 | ⬜ | 后续增加 |

---

### 6. Excel 批量原创

| 功能 | 状态 | 说明 |
|---|---|---|
| Excel 导入 | ⬜ | 计划支持 |
| 推荐列：歌名 | ⬜ | 必填 |
| 推荐列：歌词 | ⬜ | 必填 |
| 推荐列：风格 | ⬜ | 可选 |
| 推荐列：账号 | ⬜ | 可选 |
| 推荐列：模型 | ⬜ | 可选 |
| 推荐列：人声 | ⬜ | 可选 |
| 批量任务预览 | ⬜ | 提交前检查 |
| 数据校验 | ⬜ | 空歌词、空歌名等 |
| 自动轮流账号 | ⬜ | 账号 1→2→3→1 |
| 账号被验证时暂停该账号 | ⬜ | 其他账号继续工作 |
| 逐首提交 | ⬜ | 防止瞬间并发过高 |
| 自定义任务间隔 | ⬜ | 后续增加 |
| 保存批量进度 | ⬜ | 必须支持断点 |
| 重启后继续 | ⬜ | 后续增加 |
| 导出结果 Excel | ⬜ | 写入状态、作品 ID、下载路径 |

---

### 7. 后续可选功能

| 功能 | 状态 | 是否当前优先 |
|---|---|---|
| 翻唱 | ⬜ | 否 |
| 使用原词翻唱 | ⬜ | 否 |
| AI 改词翻唱 | ⬜ | 否 |
| 本地参考音频上传 | ⬜ | 否 |
| 歌曲改词 | ⬜ | 否 |
| Voice 管理 | ⬜ | 中 |
| AI 写歌词 | ⬜ | 否，当前优先自己输入歌词 |
| AI 推荐创作主题 | ⬜ | 否 |
| AI 消痕 | ⬜ | 否 |
| 智能母带 | 🚫 | 明确不做 |

---

## 四、当前明确不做的 AVR 功能

以下功能不属于 SunoOriginalStudio 第一阶段及当前产品方向：

| AVR 功能 | 状态 |
|---|---|
| 激活码 | 🚫 |
| License 激活 | 🚫 |
| License 续期 | 🚫 |
| License 心跳 | 🚫 |
| 授权到期检查 | 🚫 |
| 设备绑定 | 🚫 |
| 最大设备数 | 🚫 |
| 最大批次数授权限制 | 🚫 |
| 消息中心 | 🚫 |
| 公告 | 🚫 |
| 消息已读 | 🚫 |
| 用户反馈 | 🚫 |
| AVR 服务端模型配置下发 | 🚫 |
| AVR 自有版本更新 | 🚫 |
| 智能母带 | 🚫 |

---

# 五、AVR Suno Cover 1.77.0 详细功能列表

以下清单来自对 AVR 1.77.0 Electron 客户端、preload IPC、renderer bundle、main process、内置 engine 的静态分析。

建议理解为“原版具备或预留的功能接口”，不是说我们全部都要实现。

---

## 5.1 主导航

AVR 主界面包含：

1. 首页
2. 翻唱
3. 原创
4. 歌曲改词
5. 任务中心
6. 作品库
7. AI 消痕
8. 智能母带

---

## 5.2 首页

AVR 首页主要承担：

- 软件运行状态展示
- Suno 账号状态展示
- 任务概览
- 最近作品 / 最近任务
- 引导进入翻唱 / 原创等功能
- 授权状态相关信息
- 消息 / 公告类入口

其中授权和消息类功能我们不做。

---

## 5.3 Suno 账号管理

AVR 使用 3 个独立持久化 Session：

```text
persist:suno-account-1
persist:suno-account-2
persist:suno-account-3
```

已确认相关功能：

- 打开 Suno 登录窗口
- 检查 Suno 账号状态
- 获取 Suno Auth Token
- 删除 Suno 账号
- 3 个账号独立 Session
- 登录状态持久化
- 执行任务时绑定指定账号
- 账号有任务执行时进行状态保护
- Suno Voice 列表获取
- Suno Voice 创建
- 多账号之间相互隔离
- 人机验证期间账号状态标记

对应 preload IPC：

```text
getEngineStatus
getSunoState
openSunoLogin
removeSunoAccount
getSunoAuthToken
listSunoVoices
createSunoVoice
```

---

## 5.4 AVR 原创功能

AVR 原创是我们当前最主要的参考模块。

已确认原创参数包括：

- 歌名 / title
- 创作说明 / brief
- 自带歌词
- AI 生成歌词
- 创作主题
- 风格提示词
- 模型版本
- 男声 / 女声
- Voice / Persona
- Weirdness
- Style Influence
- 其他生成控制参数
- 预设模式
- AutoPilot
- 每首作品生成多个版本

模型映射中已见：

```text
v5.5 → chirp-fenix
v5   → chirp-crow
v4.5+ / v4.5-all → chirp-bluejay
```

人声：

```text
male
female
```

预设模式：

```text
smart
manual
default
```

AVR 原创直接调用：

```text
POST https://studio-api-prod.suno.com/api/generate/v2-web/
```

核心原创 payload 已确认包含：

```text
token
token_provider
generation_type=TEXT
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

控制参数位于 metadata 中，例如：

```text
weirdness_constraint
style_weight
vocal_gender
create_session_token
```

批量原创 schema 最大值中出现 20 条作品限制，但实际还会受到 License 限制控制。

对应主要 IPC：

```text
suggestOriginalTheme
createOriginalBatch
listLatestOriginalJobs
```

---

## 5.5 AVR 翻唱功能

AVR 翻唱支持：

- 批量创建翻唱
- 输入歌名 / 作者等歌曲信息
- 识别和获取原曲素材
- 选择参考音频
- 使用原词
- AI 改词
- 纯音乐模式
- 改词主题
- 语言设置
- 风格提示词
- Weirdness
- Style Influence
- Audio Influence
- 模型版本
- 男声 / 女声
- Voice / Persona
- 生成多个版本
- 智能 / 手动 / 默认预设模式
- AutoPilot
- 素材确认
- 歌词确认
- 失败重试
- 下载结果

翻唱批量 schema 中看到单批最大 20 首，同时实际 License 可进一步限制。

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

音频选择器支持：

```text
mp3
wav
flac
m4a
aac
ogg
```

文本导入支持：

```text
csv
txt
```

---

## 5.6 AVR 歌曲改词

AVR 有单独“歌曲改词”完整任务系统。

已见 Source Song 数据包括：

- accountId
- songId
- title
- artist
- duration
- lyrics
- local / Suno source

歌词片段结构包括：

- id
- text
- startS
- endS
- sectionLabel
- success 状态

创建改词任务时包含：

- accountId
- sourceSong
- selectedSegmentIds
- replacementLyrics

歌曲改词任务状态：

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

---

## 5.7 AVR 任务中心

AVR 的通用任务状态较完整。

已见状态：

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

中文状态对应：

```text
等待处理
正在识别歌曲
正在获取素材
正在改写歌词
正在检查歌词
正在处理音频
等待上传
正在上传
已提交 Suno
Suno 生成中
正在下载
已完成
待确认素材
失败
已取消
```

任务管理 IPC：

```text
listLatestJobs
listLatestOriginalJobs
listRecentJobs
listAllJobs
retryJob
cancelJob
deleteJob
```

---

## 5.8 AVR 作品库

已确认接口：

```text
listCompletedWorks
openWorksDirectory
```

功能上包括：

- 已完成作品列表
- 本地作品目录
- 打开作品目录
- 下载完成结果
- 保存歌曲相关文件

我们后续会实现自己的作品库，不复用 AVR 文件结构。

---

## 5.9 AVR 人机验证 / Suno 风控

AVR 代码中已确认存在完整生成验证链路。

### 验证预检

```text
POST /api/c/check
body: {"ctype":"generation"}
```

读取：

```text
required
captcha_version
```

provider 映射：

```text
captcha_version = 1 → hCaptcha → token_provider = 1
其他 / 2 → Cloudflare Turnstile → token_provider = 2
```

### 生成接口触发验证

AVR 首次提交时通常：

```text
token = null
```

如果 `/api/generate/v2-web/` 返回 HTTP 422，错误包含：

```text
verify
verification
captcha
人机验证
```

则重新探测 provider，打开对应官方验证组件。

### Cloudflare Turnstile

已确认 AVR 使用：

```text
https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit
```

并渲染可见 Managed Challenge，包含：

- 官方 Turnstile sitekey
- appearance=always
- callback(token)
- error-callback
- expired-callback
- timeout-callback
- unsupported-callback
- 自动重试
- 手动重新加载
- 用户取消
- 5 分钟最长等待

### hCaptcha

AVR 使用 Suno 自有 hCaptcha endpoint / asset host：

```text
hcaptcha-endpoint-prod.suno.com
hcaptcha-assets-prod.suno.com
hcaptcha-imgs-prod.suno.com
hcaptcha-reportapi-prod.suno.com
```

使用 invisible hCaptcha，必要时官方组件会弹出交互挑战。

具备：

- callback(token)
- error-callback
- expired-callback
- chalexpired-callback
- open-callback
- close-callback
- 自动重试
- 手动重载
- 取消
- 5 分钟超时

### Token 回传

拿到 token 后 AVR 重新提交原请求：

```text
token = challenge 返回值
token_provider = 1 或 2
```

歌名、歌词、风格、模型、Voice 等原任务参数保持一致。

我们的 v0.2.0 已按照相同工作流思想独立实现这一链路，但不复用 AVR License / 后端 / 私有业务逻辑。

---

## 5.10 AVR Voice 功能

已确认：

```text
listSunoVoices
createSunoVoice
```

说明 AVR 支持：

- 获取指定 Suno 账号的 Voice / Persona
- 创建新的 Voice
- 在原创 / 翻唱任务中选择 Voice

这是我们后续值得加入的功能。

---

## 5.11 AVR AI 消痕

AVR 1.77.0 的 AI 消痕实际是固定 DSP 处理链，不是神经网络 AI 模型。

方案名：

```text
n19
```

核心链路：

```text
SoX 节点 1
→ 节点间响度对齐
→ FFmpeg 节点 9
→ 组合后处理
→ 48k PCM16 WAV
```

主要功能：

- 输入音频解码
- 高通 / 低通
- Pitch 调整
- 高频 EQ
- Reverb / Echo
- Loudness normalization
- Compressor
- Limiter
- Resample
- Dither
- 清除 metadata
- 输出 48kHz 立体声 PCM16 WAV

IPC：

```text
listDeaiJobs
enqueueDeaiJobs
clearFinishedDeaiJobs
getDeaiOutputDir
openDeaiDirectory
onDeaiChanged
```

当前项目不优先做。

---

## 5.12 AVR 智能母带

AVR 提供 3 个主要母带预设：

### dynamic / 动态优先

- 保留更多瞬态和起伏
- 适合抒情与原声作品

### balanced / 均衡发行

- 默认推荐
- 在密度、清晰度、动态之间取平衡

### loud / 响亮

- 适合短视频和强节奏作品
- 到安全上限时自动退让

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

---

## 5.13 AVR 设置

主要 IPC：

```text
getSettings
saveSettings
selectWorksDirectory
```

功能包括：

- 读取软件设置
- 保存设置
- 自定义作品目录

我们会独立实现自己的设置页。

---

## 5.14 AVR 窗口 / 桌面功能

preload 暴露：

```text
getAppInfo
openWorksDirectory
minimizeWindow
toggleMaximizeWindow
isWindowMaximized
closeWindow
onWindowMaximizedChanged
```

说明 AVR 自定义了 Electron 窗口控制。

我们当前 Demo 使用系统窗口，后续如需美化再做。

---

## 5.15 AVR License / 授权体系

AVR 客户端中存在完整授权模型，包括：

- 激活码
- 用户账号
- License 激活
- License 续期
- License 心跳
- 设备 ID
- 设备名
- 最大设备数
- 最大歌曲批量数
- 授权时间

授权时长类型：

```text
1d
7d
30d
90d
365d
permanent
custom
```

授权状态：

```text
active
expired
suspended
revoked
device_unbound
deleted
```

本项目全部不做。

---

## 5.16 AVR 消息 / 公告 / 反馈

IPC：

```text
listInbox
markInboxRead
sendFeedback
```

功能包括：

- 消息列表
- 标记已读
- 公告
- 用户反馈

本项目全部不做。

---

## 5.17 AVR 远程模型配置

AVR 存在服务端下发模型配置结构，例如：

- modelEndpoint
- modelName
- modelApiKey
- HTTPS Endpoint
- 签名配置

这部分主要服务于 AVR 自己的 AI 改词 / 主题生成等能力。

我们当前自己输入歌词，因此不依赖 AVR 远程模型配置。

本项目不复用 AVR 后端。

---

# 六、开发优先级

当前开发顺序固定为：

## P0：先跑通原创核心

1. ✅ 3 个 Suno 独立账号
2. ✅ 自定义歌名
3. ✅ 自定义歌词
4. ✅ 风格提示词
5. ✅ 模型 / 人声 / Weirdness / Style Influence
6. ✅ 原创提交
7. ✅ 人机验证完整代码链路
8. ✅ 验证 token 回传
9. ✅ 验证后自动续提
10. ⬜ 自动轮询生成完成
11. ⬜ 自动下载

当前 P0 的下一件事：**先实机验证 v0.2.0 的 hCaptcha / Turnstile，然后马上做“自动轮询 + 自动下载”。**

## P1：批量原创

1. Excel 导入
2. 多任务队列
3. 3 账号轮流执行
4. 单账号忙碌锁
5. 验证时只暂停对应账号
6. checkpoint
7. 重启恢复
8. 自动下载
9. 结果 Excel

## P2：完善体验

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
5. AI 消痕

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
- 增加账号验证窗口置顶
- 增加验证状态事件通知
- 增加验证后自动恢复尝试
- 验证仍不是完整 hCaptcha / Turnstile token 链路

## v0.2.0

- 重做人机验证流程，不再依赖“轮询 required 变 false”
- `/api/c/check` 的 `captcha_version` 正式参与 provider 选择
- 接入 Suno 官方 hCaptcha 链路
- 接入 Cloudflare Turnstile Managed Challenge 链路
- 官方 challenge 返回 token 后自动写入原创请求
- 写入 `token_provider`
- 422 验证错误可触发 challenge 并自动重发原任务
- 验证失败自动重试 3 次
- 支持手动重新加载验证
- 支持取消当前验证任务
- 验证最长等待调整为 5 分钟
- challenge 完成后自动隐藏验证窗口并返回主程序
- 增加 `verificationActive` 账号内部状态
- 新增 Windows GitHub Actions 构建流程
- 当前状态：代码完成，等待 Windows EXE 实机验证

---

# 八、维护规则

后续每次更新代码时，同时更新本文件：

1. 已做完的功能改为 ✅
2. 做了一半的功能改为 🟡
3. 新增需求加入“我们要做的全部功能”
4. 不再需要的功能标为 🚫
5. 每次发布新版本，在“版本记录”中增加一节
6. 不把 AVR License、授权、公告、反馈重新引入本项目
7. 重点保证“原创 + 多账号 + 人机验证 + 批量 + 下载”主线稳定
8. 对依赖 Suno Web 私有接口或前端配置的部分，必须标注“需要随 Suno 变化维护”
