# SunoOriginalStudio 项目功能清单、当前状态与开发路线图

> 这是项目的主状态文档。以后每次增加功能、修 Bug、改开发优先级，都必须同步更新这里。
>
> 当前功能基线：**v0.5.4**  
> 仓库：`ximishan/SunoOriginalStudio`  
> v0.5.4 正式 Windows 构建：GitHub Actions Run `32251234629`，状态 `success`。

---

# 一、项目目标

SunoOriginalStudio 是独立的 Windows Electron 桌面工具，主线只围绕以下能力展开：

1. 使用用户自己的 Suno 账号。
2. 3 个独立 Suno 登录 Session。
3. 原创歌曲提交。
4. 用户自己填写歌名、完整歌词、风格、排除风格等参数。
5. Suno 官方 hCaptcha / Cloudflare Turnstile 验证衔接。
6. 持久化歌曲列表，记录每个 Suno clip 的状态。
7. Suno WAV 下载与本地作品目录。
8. AVR 1.77.0 N19 `SoX + Rubber Band + FFmpeg` 完整音频链路。
9. 歌曲列表内试听。
10. 后续增加：自动轮询、自动下载、自动 N19、Excel 批量原创、3 账号调度、断点恢复。

明确不做：

- AVR 激活码 / License / 心跳 / 到期时间
- 设备绑定与授权设备数
- 最大批次数授权限制
- AVR 消息中心 / 公告 / 反馈
- AVR 远程模型配置下发
- AVR 自有更新体系
- 智能母带

---

# 二、状态说明

- ✅ **已完成**：代码已经存在，主链路可实际使用/测试。
- 🟡 **部分完成**：主体已经有，但仍缺自动化、统一性或实机稳定性补强。
- ⬜ **未完成**：当前代码没有实现。
- 🚫 **不做**：明确排除。

---

# 三、当前版本总览

## 3.1 已经做完的核心功能

| 功能 | 状态 | 当前实现 |
|---|---|---|
| 3 个独立 Suno 账号 | ✅ | `persist:suno-original-demo-1/2/3` |
| 固定用户数据目录 | ✅ | `%APPDATA%\SunoOriginalStudio` |
| 旧登录数据迁移 | ✅ | 迁移 persistent partition + `Local State` |
| Clerk 登录状态增强识别 | ✅ | `__client` / `__client_uat` / Clerk Session / 短期 `__session` |
| Session 主动落盘 | ✅ | Cookie/Storage flush + 正常退出前 flush |
| 原创歌曲提交 | ✅ | `/api/generate/v2-web/` |
| 歌名 | ✅ | 自定义 |
| 完整歌词 | ✅ | 用户直接输入，不强制 AI 改词 |
| 风格提示词 | ✅ | `tags` |
| 排除风格 | ✅ | `negative_tags` |
| 模型选择 | ✅ | v5.5 / v5 / v4.5+ / v4.5-all |
| 男声 / 女声 | ✅ | `vocal_gender` |
| Weirdness | ✅ | 0-100 |
| Style Influence | ✅ | 0-100 |
| 官方人机验证 | ✅ | hCaptcha / Turnstile 官方组件 |
| 验证完成自动续提 | ✅ | 官方 token 回传后重试原任务 |
| 持久化歌曲列表 | ✅ | 每个 clip 独立记录 |
| 一次提交的两个 Suno 版本分别记录 | ✅ | version 1 / version 2 |
| 歌曲状态手动刷新 | ✅ | `/api/feed/v2` |
| 歌曲状态记录 | ✅ | `generationStatus` |
| WAV 下载状态记录 | ✅ | `wavStatus` |
| AI 消痕状态记录 | ✅ | `deaiStatus` |
| 本地保存状态记录 | ✅ | `localStatus` |
| 选中歌曲下载 Suno WAV | ✅ | `convert_wav` → `wav_file` |
| 每首歌曲独立本地目录 | ✅ | 歌名 + 版本 + clipId |
| 保存歌词 TXT | ✅ | AI 消痕处理时保存 |
| 保存 Suno 原始 WAV | ✅ | AI 消痕处理时保存 |
| 保存 N19 消痕 WAV | ✅ | AI 消痕处理时保存 |
| 自定义作品根目录 | ✅ | 默认 `文档/SunoOriginalStudio作品` |
| AVR N19 完整链路 | ✅ | SoX → loudnorm → FFmpeg Rubber Band → 后处理 |
| N19 工具链 SHA-256 校验 | ✅ | 构建时 + 运行时 |
| 已消痕歌曲禁止重复处理 | ✅ | 前端禁选 + 后端强制跳过 |
| 独立 AI 消痕页面 | ✅ | 可处理本地音频文件 |
| 歌曲列表试听 | ✅ | v0.5.4 |
| 播放 / 暂停 / 停止 | ✅ | 内置播放器 |
| 播放进度拖动 | ✅ | 内置播放器 |
| 当前时间 / 总时长 | ✅ | 内置播放器 |
| 音量调节 | ✅ | 内置播放器 |
| 播放本地 N19 WAV | ✅ | 优先级最高 |
| 播放本地 Suno 原始 WAV | ✅ | 第二优先级 |
| 播放 Suno 在线音频 | ✅ | `audio_url` / CDN MP3 fallback |

## 3.2 目前部分完成的功能

| 功能 | 状态 | 还缺什么 |
|---|---|---|
| 登录状态持久化 | 🟡 | 主界面状态检测已增强，但 `song_library.js` 的内部取 token 逻辑仍有短期 `__session` 预检查，需要统一 |
| 作品库 | 🟡 | 已有持久化歌曲列表和本地目录，但还没有“生成完成自动下载”的全自动作品库流程 |
| 下载流程 | 🟡 | 选中歌曲做 AI 消痕时会自动下载 WAV；尚未实现生成完成后自动下载 |
| 任务历史 | 🟡 | clip/song 记录已经持久化，但还没有独立“批量任务队列 / submission 任务中心” |
| 在线试听稳定性 | 🟡 | 已有 `audio_url` 与 CDN fallback；长期应优先自动保存本地 WAV 后播放本地文件 |
| 人机验证 | 🟡 | 完整官方链路已实现，仍需随 Suno 页面/API 变化持续兼容测试 |

## 3.3 当前还没有做的关键功能

| 功能 | 状态 |
|---|---|
| 后台自动轮询生成完成 | ⬜ |
| 程序启动后自动恢复轮询 | ⬜ |
| 生成完成后自动下载 Suno WAV | ⬜ |
| 生成完成后自动保存歌词 + WAV | ⬜ |
| 下载完成后自动进入 N19 | ⬜ |
| 自动化链路开关 | ⬜ |
| Excel 批量原创 | ⬜ |
| 多任务提交队列 | ⬜ |
| 3 账号自动轮流分配 | ⬜ |
| 单账号 busy 锁 | ⬜ |
| 每首提交间隔控制 | ⬜ |
| checkpoint 防重复提交 | ⬜ |
| 程序重启后恢复批量队列 | ⬜ |
| 失败任务重试 | ⬜ |
| 账号失败后切换其他账号 | ⬜ |
| 账号退出 / 清除单个账号 | ⬜ |
| 登录成功自动关闭账号窗口并返回主界面 | ⬜ |
| 登录成功自动推送账号状态变化 | ⬜ |
| Instrumental 纯音乐开关 | ⬜ |
| Voice / Persona 选择 | ⬜ |
| 创建 Voice / Persona | ⬜ |
| 生成版本数量配置 | ⬜ |
| 保存原创输入草稿 / 最近参数 | ⬜ |
| 结果 Excel 导出 | ⬜ |

---

# 四、模块详细状态

## 4.1 Suno 账号管理

| 功能 | 状态 | 说明 |
|---|---|---|
| 账号 1/2/3 | ✅ | 三个独立槽位 |
| 独立 persistent partition | ✅ | 不共享 Cookie |
| 固定 profile 目录 | ✅ | `%APPDATA%\SunoOriginalStudio` |
| 旧版本 profile 迁移 | ✅ | 包含 `Local State` 与三个 partitions |
| Cookie 主动 flush | ✅ | 登录 Cookie 变化后落盘 |
| Storage 主动 flush | ✅ | 定时与退出前落盘 |
| Clerk 长登录状态识别 | ✅ | 避免只看短期 `__session` |
| 打开账号窗口 | ✅ | 对应账号 partition |
| 当前账号手动刷新状态 | ✅ | 主界面按钮 |
| 登录成功自动返回 | ⬜ | 下一阶段 |
| 登录状态实时事件 | ⬜ | 下一阶段 |
| 单账号退出 | ⬜ | 下一阶段 |
| 账号 busy / idle | ⬜ | 批量调度用 |
| Round-robin 自动分配 | ⬜ | 批量调度用 |

### 当前已知问题：账号状态逻辑还没有完全统一

`bootstrap.js/main.js` 的登录检测已经使用 Clerk 长期状态，但 `song_library.js` 当前 `hiddenAuthToken()` 仍先检查短生命周期 `__session` Cookie。

这意味着：

```text
主界面可能显示“已登录”
↓
Clerk 长期 Session 仍然有效
↓
短期 __session 暂时不存在/刚过期
↓
song_library 内部请求 WAV 时可能错误提示“账号未登录”
```

这是 **v0.5.5 的第一优先级 Bug**，必须把所有 Suno token 获取逻辑统一成一套。

---

## 4.2 原创歌曲

| 参数 / 功能 | 状态 | 实现 |
|---|---|---|
| 歌名 | ✅ | `title` |
| 完整歌词 | ✅ | `prompt` |
| 风格 | ✅ | `tags` |
| 排除风格 | ✅ | `negative_tags` |
| 模型 | ✅ | `mv` |
| 人声性别 | ✅ | `vocal_gender` |
| Weirdness | ✅ | `weirdness_constraint` |
| Style Influence | ✅ | `style_weight` |
| 手动账号选择 | ✅ | slot 1/2/3 |
| 提交原创 | ✅ | `POST /api/generate/v2-web/` |
| 两个 clip 写入歌曲列表 | ✅ | 独立版本 |
| Instrumental | ⬜ | 后续 |
| Persona | ⬜ | 后续 |
| 生成版本数 | ⬜ | 后续 |
| AutoPilot / Preset | ⬜ | 后续可选 |

模型映射：

```text
v5.5       → chirp-fenix
v5         → chirp-crow
v4.5+      → chirp-bluejay
v4.5-all   → chirp-bluejay
```

---

## 4.3 官方人机验证

| 功能 | 状态 |
|---|---|
| `/api/c/check` 预检查 | ✅ |
| `captcha_version` provider 判断 | ✅ |
| 422 verify/captcha 识别 | ✅ |
| hCaptcha 官方组件 | ✅ |
| Cloudflare Turnstile 官方组件 | ✅ |
| 官方 callback token | ✅ |
| `token_provider` | ✅ |
| 原任务自动续提 | ✅ |
| 自动重试 | ✅ |
| 手动重载 | ✅ |
| 取消 | ✅ |
| 5 分钟超时 | ✅ |
| 批量队列只暂停对应账号 | ⬜ |

原则：只衔接 Suno / Cloudflare / hCaptcha 官方验证，不破解、不代答、不绕过。

---

## 4.4 歌曲列表 / 作品记录

当前歌曲列表是项目的核心数据层，文件保存于：

```text
%APPDATA%\SunoOriginalStudio\song-library-v1.json
```

每个 clip 主要记录：

```text
clipId
submissionId
version
title
lyrics
stylePrompt
negativeStyle
slot
modelVersion
vocalGender
weirdness
styleInfluence
submittedAt
generationStatus
audioUrl
duration
wavStatus
deaiStatus
localStatus
localDir
sourceWavPath
processedWavPath
lyricsPath
lastError
updatedAt
```

状态：

| 功能 | 状态 |
|---|---|
| 提交成功自动入列表 | ✅ |
| 每个版本单独一行 | ✅ |
| 持久化重启保留 | ✅ |
| 手动刷新 Suno 状态 | ✅ |
| 显示账号 | ✅ |
| 显示生成状态 | ✅ |
| 显示 WAV 状态 | ✅ |
| 显示 N19 状态 | ✅ |
| 显示本地状态 | ✅ |
| 打开 Suno 页面 | ✅ |
| 打开本地歌曲目录 | ✅ |
| 选中歌曲 N19 | ✅ |
| 已 N19 歌曲自动锁定 | ✅ |
| 自动后台刷新 | ⬜ |
| 搜索 / 筛选 | ⬜ |
| 删除列表记录 | ⬜ |
| 按 submission 聚合 | ⬜ |

---

## 4.5 歌曲列表试听播放器（v0.5.4）

每首已生成歌曲有“试听”按钮。

播放器支持：

- ✅ 播放 / 暂停
- ✅ 停止
- ✅ 拖动进度
- ✅ 当前时间 / 总时长
- ✅ 音量
- ✅ 同一时间只播放一首

播放源优先级：

```text
1. 已存在的 N19 消痕 WAV
2. 已存在的 Suno 原始 WAV
3. 歌曲列表中的 Suno audio_url
4. https://cdn1.suno.ai/{clipId}.mp3 兜底
```

试听只负责播放：

- 不自动下载
- 不自动触发 N19
- 不改变歌曲处理状态

---

## 4.6 Suno WAV 下载与本地目录

当前是“**用户选中歌曲做 AI 消痕时触发下载**”，还不是“生成完成立即自动下载”。

已完成：

```text
POST /api/gen/{clipId}/convert_wav/
↓
GET /api/gen/{clipId}/wav_file/
↓
获得 Suno WAV URL
↓
下载 WAV
↓
写入歌曲目录
```

单首目录示例：

```text
SunoOriginalStudio作品
└─ 歌名-V1-a1b2c3d4
   ├─ 歌词.txt
   ├─ 歌名-Suno原始.wav
   └─ 歌名-消痕-N19.wav
```

| 功能 | 状态 |
|---|---|
| 选择根目录 | ✅ |
| 单歌独立目录 | ✅ |
| 下载 Suno WAV | ✅（按需） |
| 保存歌词 TXT | ✅（按需） |
| 保存原始 WAV | ✅（按需） |
| 保存 N19 WAV | ✅（按需） |
| 生成完成自动下载 | ⬜ |
| 自动保存歌词/音频 | ⬜ |
| 自动避免重复下载 | 🟡 | 已有路径/状态数据，但还需要在自动下载模块里做完整幂等判断 |
| 封面保存 | ⬜ |
| metadata JSON | ⬜ |

---

## 4.7 AI 消痕 · AVR 1.77.0 N19

当前主执行链已不是 FFmpeg-only 兼容实现。

主链：

```text
源音频
↓
FFmpeg 解码 → 44.1kHz / Stereo / PCM16
↓
SoX 节点 1
↓
FFmpeg loudnorm
↓
FFmpeg 节点 9（真实 Rubber Band pitch=0.975）
↓
组合后处理
↓
48kHz / PCM16 / Stereo WAV
```

关键状态：

| 功能 | 状态 |
|---|---|
| AVR SoX 14.4.2 文件集 | ✅ |
| AVR FFmpeg v7.1 文件 | ✅ |
| `librubberband` | ✅ |
| SoX 节点 1 | ✅ |
| 节点间 loudnorm | ✅ |
| FFmpeg 节点 9 | ✅ |
| 组合后处理 | ✅ |
| 48k PCM16 最终输出 | ✅ |
| 构建时 SHA-256 检查 | ✅ |
| 运行时 SHA-256 检查 | ✅ |
| 1GB 输入限制 | ✅ |
| 临时文件清理 | ✅ |
| 手动多文件处理 | ✅ |
| 歌曲列表直接 N19 | ✅ |
| 已完成 N19 强制跳过 | ✅ |
| 生成完成自动 N19 | ⬜ |

完整参数、第三方二进制 SHA-256 与 reproducibility 说明见：`THIRD_PARTY_N19.md`。

注意：AVR 原链路包含 SoX `dither -s`，因此“精确复刻”指工具链、阶段、参数和中间格式精确对齐，不代表每次独立执行的最终 WAV SHA-256 必然相同。

---

## 4.8 任务中心 / 自动化队列

目前没有真正的后台任务队列。

| 功能 | 状态 |
|---|---|
| 当前单任务展示 | ✅ |
| clip 持久化列表 | ✅ |
| 手动刷新 | ✅ |
| 后台自动轮询 | ⬜ |
| 多 submission 队列 | ⬜ |
| queued/submitting/generating/downloading 状态机 | ⬜ |
| 失败重试 | ⬜ |
| 暂停/继续 | ⬜ |
| 取消未提交任务 | ⬜ |
| checkpoint | ⬜ |
| 重启恢复 | ⬜ |
| 账号 busy 锁 | ⬜ |

---

## 4.9 Excel 批量原创

当前：**全部未实现。**

计划 Excel 字段：

```text
歌名
歌词
风格
排除风格
账号（可选）
模型
人声
Weirdness
Style Influence
自动AI消痕（可选）
```

计划行为：

- 一次导入多首
- 校验空歌名 / 空歌词 / 非法数值
- 导入预览
- 可固定账号，也可 1→2→3 轮流
- 每账号最多一个正在提交的原创任务
- 每首可设置提交间隔
- 某账号进入官方验证时，只暂停该账号
- 其他账号继续队列
- 成功后写入歌曲列表
- checkpoint 防止程序重启后重复提交
- 失败项可重试
- 最终导出结果 Excel

---

# 五、当前已知问题 / 技术债

按优先级排序：

### P0-1：Suno token 获取逻辑没有统一

主界面登录状态已经改为 Clerk-aware，但 `song_library.js` 仍有 `__session` 的短期 Cookie 前置判断。

**必须先修这个，再继续扩大自动下载。**

### P0-2：歌曲状态依赖手动刷新

用户提交多首后，当前要点击“刷新 Suno 状态”才能更新歌曲列表。

### P0-3：下载和 N19 仍是手动触发

目前必须：

```text
选中歌曲
→ 点击“对选中歌曲 AI 消痕”
→ 下载 WAV
→ N19
```

还没有：

```text
生成完成
→ 自动下载 WAV
→ 自动保存歌词
→ 可选自动 N19
```

### P1-1：没有批量原创任务队列

现在可以手动连续提交多首，但不能一次导入 10/100 首让软件自动跑。

### P1-2：没有完整 checkpoint / 重启恢复

歌曲列表本身会保留，但未提交/等待提交的批量任务还没有持久化状态机。

---

# 六、接下来做什么：明确开发顺序

## v0.5.5 — 统一账号 Session / Auth Token（下一步，P0）

### 目标

彻底解决“主界面显示已登录，但 WAV/歌曲列表接口又说未登录”的不一致。

### 怎么做

新增共享模块，例如：

```text
suno_session.js
```

统一提供：

```text
partitionFor(slot)
getAccountSession(slot)
ensureSunoWindow(slot)
getAuthToken(slot)
getApiHeaders(slot)
getAccountStatus(slot)
flushAccountSession(slot)
```

实现原则：

1. **不再要求 `__session` 必须预先存在。**
2. 优先在对应 persistent partition 打开隐藏 Suno 页面。
3. 等待 `window.Clerk.session` 恢复。
4. 调 `Clerk.session.getToken()` 获取新 token。
5. 只有 Clerk 确认没有 Session，才认为账号真的退出。
6. `main.js`、`song_library.js`、以后批量队列全部调用同一个模块。
7. 删除重复的 token / header 实现，避免以后再出现两套判断标准。
8. 登录成功后立即 flush Cookie/Storage。
9. 增加账号状态事件：`account:state-changed`。
10. 登录成功后自动刷新主界面状态，并可自动隐藏登录窗口。

### v0.5.5 验收标准

- 登录一次，关闭程序，再开仍显示登录。
- 等几分钟让短期 `__session` 过期，主界面仍能正确识别 Clerk Session。
- 此时歌曲列表刷新、WAV 下载、AI 消痕仍可正常取 token。
- 账号 1/2/3 相互隔离。
- 一个账号退出不会影响另外两个。

---

## v0.5.6 — 自动轮询 + 自动下载 + 可选自动 N19（P0）

### 目标

把当前手动链路变成：

```text
提交原创
↓
歌曲列表
↓
后台自动轮询
↓
生成完成
↓
自动下载 Suno WAV
↓
自动保存歌词
↓
[可选] 自动 AVR N19
↓
最终本地作品目录
```

### 怎么做

新增 `song_pipeline.js` / `job_manager.js`：

1. 启动时扫描歌曲列表中：
   - `submitted`
   - `queued`
   - `streaming`
   - `generating`
   等未完成记录。
2. 按账号分组调用 `/api/feed/v2`。
3. 默认约 5 秒轮询一次；连续失败使用退避，不高频轰接口。
4. `complete` 后停止该 clip 的生成轮询。
5. 如果“自动下载 WAV”开启：
   - 检查 `wavStatus`
   - 检查目标文件是否已存在
   - 已存在则直接标记，不重复下载
   - 否则执行 `convert_wav → wav_file → download`
6. 写 `歌词.txt`。
7. 如果“生成完成自动 AI 消痕”开启：
   - 仅处理 `deaiStatus != complete`
   - 复用现有 N19 后端
   - 继续保留 v0.5.3 的后端幂等保护
8. 每一步写入 `song-library-v1.json`，程序崩溃/重启后从状态继续。

建议新增状态：

```text
generation: submitted / generating / complete / failed
wav: not_downloaded / waiting / downloading / downloaded / error
deai: not_processed / waiting / processing / complete / error
local: not_saved / saving / saved / error
```

### v0.5.6 UI

歌曲列表增加：

```text
☑ 生成完成后自动下载 WAV
☑ 下载完成后自动 AI 消痕
```

并显示后台自动化是否正在运行。

---

## v0.6.0 — Excel 批量原创 + 3 账号调度（P1）

### 目标

一次导入多首，软件自动逐首提交。

### 怎么做

新增持久化批量队列，例如：

```text
batch-jobs-v1.json
```

每个任务记录：

```text
id
sourceRow
title
lyrics
stylePrompt
negativeStyle
preferredSlot
assignedSlot
modelVersion
vocalGender
weirdness
styleInfluence
status
attempts
clipIds
lastError
createdAt
updatedAt
```

任务状态建议：

```text
queued
waiting_account
submitting
waiting_verification
submitted
generating
downloading
cleaning
completed
failed
cancelled
```

调度规则：

1. 默认账号 1→2→3 round-robin。
2. 每个账号同一时间只允许一个“提交动作”。
3. 一个账号要求人机验证时，锁住该账号。
4. 另外两个账号仍可继续提交。
5. 提交成功后立即保存 `clipIds`，避免重启重复提交。
6. 提交失败区分：
   - 账号掉线
   - 额度不足
   - 人机验证
   - 网络错误
   - Suno 业务错误
7. 网络错误可有限次数重试；业务错误不无限重试。
8. 程序重启从 `batch-jobs-v1.json` 恢复。
9. 成功的 clip 同步进入现有歌曲列表，不另造作品库。

---

## v0.6.1 — 批量任务体验补全（P1）

计划：

- 暂停 / 继续队列
- 重试失败项
- 删除未提交任务
- 按账号筛选
- 按状态筛选
- 结果 Excel 导出
- 每首提交间隔设置
- 批次统计
- 账号额度不足自动停止该账号

---

## v0.7.x — 可选增强（P2）

优先级低于上面主线：

- Instrumental 纯音乐开关
- Voice / Persona 列表
- 创建 Voice
- 搜索 / 筛选歌曲列表
- 封面保存
- metadata JSON
- 歌曲删除/归档
- 预设参数模板
- 原创输入草稿

---

# 七、AVR 1.77.0 功能对照

AVR 主导航包含：

```text
首页
翻唱
原创
歌曲改词
任务中心
作品库
AI消痕
智能母带
```

本项目当前只重点复用/参考：

| AVR 能力 | 本项目 |
|---|---|
| 3 个 Suno Session | ✅ 已实现 |
| 原创 | ✅ 已实现核心参数 |
| 官方人机验证衔接 | ✅ 已实现 |
| 任务中心 | 🟡 只有歌曲列表，缺完整队列 |
| 作品库 | 🟡 已有歌曲列表/本地目录，缺全自动下载 |
| AI 消痕 N19 | ✅ 完整主链实现 |
| Voice / Persona | ⬜ 后续 |
| 翻唱 | ⬜ 可选，不是当前主线 |
| 歌曲改词 | ⬜ 可选，不是当前主线 |
| 智能母带 | 🚫 不做 |
| License / 授权 | 🚫 不做 |
| 公告 / 消息 / 反馈 | 🚫 不做 |

AVR 账号相关 IPC 参考：

```text
getSunoState
openSunoLogin
removeSunoAccount
getSunoAuthToken
listSunoVoices
createSunoVoice
```

AVR 原创核心 payload 已确认包含：

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

AVR 通用任务状态参考：

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

---

# 八、版本记录

## v0.1.0

- 初版 Electron Demo
- 3 个账号槽位
- 自定义歌名 / 歌词 / 风格
- 原创提交
- 手动任务状态查询

## v0.1.1

- 增加验证需求检测
- 验证窗口置顶
- 仍不是完整 token 链路

## v0.2.0

- `/api/c/check`
- hCaptcha / Turnstile 官方 Challenge
- 官方 token 自动写回原创请求
- 422 验证后自动续提

## v0.3.0

- 主程序集成 AI 消痕页面
- 初始为 FFmpeg-only N19 兼容实现

## v0.4.0

- 升级为 AVR 1.77.0 原版 SoX + Rubber Band + FFmpeg 工具链
- 精确阶段 / 参数 / 中间格式
- 构建与运行时 SHA-256 校验

## v0.5.0

- 持久化歌曲列表
- 每个 Suno clip 单独记录
- Suno WAV 请求/下载
- 歌词 + 原始 WAV + N19 WAV 本地保存
- 歌曲列表直接进入 N19

## v0.5.1

- 固定 `%APPDATA%\SunoOriginalStudio`
- 旧 profile / Session 迁移

## v0.5.2

- 新增“排除风格”
- 独立写入 `negative_tags`

## v0.5.3

- 已 N19 完成歌曲前端禁选
- 后端再次强制跳过，防止重复处理
- 增强 Clerk 登录状态识别与 Session 落盘

## v0.5.4

- 歌曲列表增加“试听”
- 内置播放 / 暂停 / 停止
- 进度条与时间显示
- 音量控制
- N19 WAV → 原始 WAV → Suno 在线音频自动选源

---

# 九、维护规则

1. **每次代码修改都必须同步本文件。**
2. 做完改成 ✅，部分完成改成 🟡，没有做保持 ⬜。
3. 每个正式版本都要在“版本记录”增加条目。
4. README 的“当前版本”和“当前功能”必须同步。
5. 新增 P0/P1 需求时，要同步“接下来做什么 / 怎么做”。
6. N19 exact 模式绝不静默退化成 FFmpeg-only 兼容链路。
7. 已 `deaiStatus=complete` 的歌曲默认永不重复 N19；以后如需重做，只能增加明确的“强制重新处理”功能。
8. 所有 Suno 登录/token 逻辑最终只能保留一套共享实现，不能在 `main.js`、`song_library.js`、批量模块各写一套。
9. 自动下载与自动 N19 必须具备幂等判断，程序重启不能重复下载/重复处理。
10. 批量原创必须先写 checkpoint 再进入下一首，避免网络异常或程序退出造成重复提交。
11. Suno Web 私有接口可能变化，接口错误必须清晰记录，不能静默吞错。
12. 人机验证只使用官方流程，不做识别、绕过、伪造 token 或第三方代解。
