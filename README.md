# SunoOriginalStudio

独立的 Suno 原创歌曲桌面工具实验项目。

## 当前版本

当前开发版本：`v0.2.0`

当前功能：

- 3 个独立、持久化的 Suno 账号 Session
- 自定义歌名、完整歌词、风格提示词
- 原创歌曲提交
- 任务状态刷新
- 检测 Suno 人机验证要求
- 根据 `captcha_version` 衔接 Suno 官方 hCaptcha / Cloudflare Turnstile 组件
- 用户完成官方挑战后获取验证 token
- 自动把 `token` / `token_provider` 带回原原创请求继续提交
- 验证组件错误自动重试，支持手动重新加载和取消

> 本项目不破解、识别或绕过验证码，只在用户自己的 Suno 登录 Session 中衔接官方验证流程。

详细开发状态和 AVR 功能对照见 `PROJECT_STATUS_AND_AVR_FEATURES.md`。
