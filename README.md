# SunoOriginalStudio

独立的 Suno 原创歌曲 Windows 桌面工具。

## 当前版本：v0.5.0

当前已包含：

- 3 个独立、持久化的 Suno 账号 Session
- 自定义歌名、完整歌词、风格提示词
- 原创歌曲提交与任务状态查询
- Suno 官方 hCaptcha / Cloudflare Turnstile 验证衔接
- 验证完成后自动续提原创任务
- 持久化“歌曲列表”：每个 Suno clip 单独记录版本、账号、歌名、歌词与生成状态
- 歌曲列表记录 WAV 下载状态、AI 消痕状态、本地保存状态
- 已生成歌曲可直接从列表勾选进行 AI 消痕
- 自动请求 Suno WAV：`convert_wav` → `wav_file`
- 每首歌曲独立目录保存 `歌词.txt`、`<歌名>-Suno原始.wav`、`<歌名>-消痕-N19.wav`
- 可配置统一作品保存目录，默认 `文档/SunoOriginalStudio作品`
- AVR 1.77.0 N19 原版完整执行链路：SoX → 节点间响度对齐 → FFmpeg 节点 9（Rubber Band）→ 组合后处理
- Windows 构建和程序运行时都会校验 N19 工具链 SHA-256，只有与 AVR 1.77.0 中观察到的 SoX / FFmpeg 文件一致才允许执行
- 保留独立“AI 消痕”页面，支持手动本地多文件处理

项目完整规划和 AVR 功能对照见：`PROJECT_STATUS_AND_AVR_FEATURES.md`。

v0.5.0 歌曲列表与自动保存流程见：`V0.5_SONG_LIBRARY.md`。

N19 精确工具链、哈希和阶段参数见：`THIRD_PARTY_N19.md`。

> 人机验证只衔接 Suno 官方验证流程，不做验证码破解、识别、代答或绕过。
>
> 歌曲列表的 Suno WAV 下载不会静默降级成 MP3；如果当前 Suno 账号没有 WAV 导出权限，会记录明确的下载失败状态。
>
> N19 使用与观察到的 AVR 1.77.0 相同工具链、阶段顺序和参数。由于原链路本身包含 SoX `dither -s`，独立运行之间不承诺最终 WAV 的文件哈希绝对一致。
