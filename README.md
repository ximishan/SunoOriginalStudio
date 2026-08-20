# SunoOriginalStudio

独立的 Suno 原创歌曲 Windows 桌面工具。

## 当前版本：v0.5.8

当前已经包含：

- **Excel 批量原创**：一行一首歌，导入后校验、预览、顺序提交
- Excel 批量支持：歌名、歌词、风格、排除风格、模型、人声、Weirdness、风格影响、账号、提交间隔秒、启用
- 软件内可直接生成/下载标准 Excel 模板
- 批量默认每首提交结束后等待 20 秒再进入下一首；支持全局 5-300 秒配置，也支持 Excel 单行覆盖
- 批量支持暂停 / 继续 / 失败重试
- 批次进度本地 checkpoint；程序重启后保留队列
- 提交中异常退出的行会标记“中断待确认”，不会自动重复提交
- 账号未登录、登录失效或额度不足时自动暂停批量队列
- 批量成功提交的歌曲自动进入原有歌曲列表，继续使用后台轮询 / 自动 WAV / 自动 N19 流水线
- 3 个固定账号位、独立持久化的 Suno 账号 Session
- 固定用户数据目录 `%APPDATA%\SunoOriginalStudio`
- 旧版本账号 Session / `Local State` 迁移
- **v0.5.7 账号认证稳定性修复**：账号状态查询改为本地快速判断，不再为了刷新绿点启动隐藏 Suno 页面
- 登录产生 `__session` 后立即确认该槽位已登录，并保存可靠登录状态到 `suno-account-login-state-v1.json`
- `__client` 不再单独代表登录成功，避免空账号位误判为已登录
- 短期 `__session` 过期后不会立刻把已经确认登录的账号显示成未登录
- 旧版本长期 Clerk Session 只在后台做一次恢复探测，不阻塞账号区显示
- **统一 Suno Session / Auth Token**：原创提交、任务刷新、歌曲列表、WAV 下载共用 `suno_session.js`
- 真正提交歌曲 / 下载 WAV 时才通过 Clerk Session 获取或刷新 token
- Clerk 登录状态增强识别与 Cookie/Storage 主动落盘
- 自定义歌名、完整歌词、风格提示词
- 独立“排除风格”，通过 `negative_tags` 提交
- v5.5 / v5 / v4.5+ / v4.5-all 模型选择
- 男声 / 女声、Weirdness、Style Influence
- 原创歌曲提交与状态查询
- Suno 官方 hCaptcha / Cloudflare Turnstile 验证衔接
- 验证完成后自动续提原创任务
- 持久化“歌曲列表”：每个 Suno clip 单独记录版本、账号、歌名、歌词、风格、排除风格与生成状态
- **主进程后台自动轮询未完成歌曲**，程序启动后自动恢复
- 可选“生成完成后自动下载 Suno WAV + 保存歌词”
- 可选“下载完成后自动 AVR N19”
- 自动下载和自动 N19 使用状态 + 本地文件双重幂等判断，重启后不会重复处理
- 自动处理失败使用指数退避，避免高频重复请求
- 歌曲列表记录 WAV 下载状态、AI 消痕状态、本地保存状态
- 已生成歌曲可直接从列表勾选进行 AI 消痕
- 自动请求 Suno WAV：`convert_wav` → `wav_file`
- 每首歌曲独立目录保存 `歌词.txt`、`<歌名>-Suno原始.wav`、`<歌名>-消痕-N19.wav`
- 可配置统一作品保存目录，默认 `文档/SunoOriginalStudio作品`
- 已完成 AI 消痕的歌曲前端禁选 + 后端强制跳过，不会重复处理
- AVR 1.77.0 N19 原版完整执行链路：SoX → 节点间响度对齐 → FFmpeg 节点 9（Rubber Band）→ 组合后处理
- Windows 构建和程序运行时都会校验 N19 工具链 SHA-256
- 独立“AI 消痕”页面，支持本地多文件处理
- 歌曲列表内置试听播放器
- 试听支持播放/暂停、停止、进度拖动、时间显示、音量调节
- 播放源优先级：N19 WAV → Suno 原始 WAV → Suno `audio_url` → CDN MP3 fallback

## 当前还没有完成

- 3 账号自动轮流调度 / round-robin
- 单账号 busy 锁与多账号并行队列
- 一个账号进入官方验证时其他账号继续执行
- 批量结果 Excel 导出
- 单账号退出/清除
- Instrumental 纯音乐开关
- Voice / Persona
- 歌曲搜索 / 筛选 / 删除 / 归档
- 封面保存 / metadata JSON

## 下一步

### v0.6.x：3 账号自动调度 + 完整后台批量任务中心

在 v0.5.8 的 Excel 顺序队列基础上，继续增加账号 1→2→3 自动轮流、单账号 busy 锁、账号级验证暂停、其他账号继续执行、主进程批量 checkpoint 和结果 Excel 导出。

完整状态与开发路线图见：`PROJECT_STATUS_AND_AVR_FEATURES.md`。

其他文档：

- `BATCH_EXCEL_V0.5.8.md`：Excel 批量原创格式、队列与恢复规则
- `V0.5_SONG_LIBRARY.md`：歌曲列表与 Suno WAV / 本地保存流程
- `V0.5.2_NEGATIVE_STYLE.md`：排除风格
- `V0.5.3_NO_REPEAT_DEAI.md`：已消痕歌曲防重复处理
- `V0.5.4_SONG_PLAYER.md`：歌曲列表试听播放器
- `V0.5.6_AUTOMATION_PIPELINE.md`：统一 Session/Auth 与自动轮询/下载/N19 的实现历史
- `PROFILE_PERSISTENCE.md`：账号 Profile / Session 持久化
- `THIRD_PARTY_N19.md`：N19 工具链、哈希、阶段与第三方说明

> 人机验证只衔接 Suno 官方验证流程，不做验证码破解、识别、代答或绕过。
>
> 批量提交的“提交间隔”用于控制请求频率；程序不会尝试绕过 Suno 的平台限制或官方验证。
>
> 歌曲列表的 Suno WAV 下载不会静默降级成 MP3；如果当前 Suno 账号没有 WAV 导出权限，会记录明确失败状态。
>
> N19 使用与观察到的 AVR 1.77.0 相同工具链、阶段顺序和参数。由于原链路包含 SoX `dither -s`，独立运行之间不承诺最终 WAV 文件哈希绝对一致。
