# SunoOriginalStudio 项目功能清单、当前状态与开发路线图

> 这是项目主状态文档。以后每次增加功能、修 Bug、改开发优先级，都同步更新这里。
>
> 当前功能基线：**v0.5.6**  
> 仓库：`ximishan/SunoOriginalStudio`

---

# 一、项目目标

SunoOriginalStudio 是独立 Windows Electron 桌面工具，主线围绕：

1. 使用用户自己的 Suno 账号。
2. 3 个独立持久化 Suno Session。
3. 原创歌曲提交。
4. 自定义歌名、歌词、风格、排除风格、模型、人声和滑杆参数。
5. Suno 官方 hCaptcha / Cloudflare Turnstile 验证衔接。
6. 持久化歌曲列表。
7. 后台自动轮询 Suno 生成状态。
8. 自动 Suno WAV 下载与歌词保存。
9. AVR 1.77.0 N19 `SoX + Rubber Band + FFmpeg` 完整链路。
10. 可选生成完成自动 N19。
11. 歌曲列表试听。
12. 后续：Excel 批量原创、3 账号调度、批量 checkpoint、失败重试和结果导出。

明确不做：AVR License/激活/设备绑定、消息中心/公告/反馈、AVR 远程配置下发、AVR 自有更新体系、智能母带。

---

# 二、版本总览

## v0.5.6 已完成

| 功能 | 状态 | 当前实现 |
|---|---|---|
| 3 个独立 Suno 账号 | ✅ | `persist:suno-original-demo-1/2/3` |
| 固定用户数据目录 | ✅ | `%APPDATA%\SunoOriginalStudio` |
| 旧登录数据迁移 | ✅ | persistent partitions + `Local State` |
| Session 主动落盘 | ✅ | Cookie/Storage flush |
| 统一 Suno Session/Auth | ✅ | `suno_session.js` |
| 短期 `__session` 过期后恢复 | ✅ | 优先恢复 `window.Clerk.session` 并 `getToken()` |
| 原创歌曲提交 | ✅ | `/api/generate/v2-web/` |
| 歌名 / 完整歌词 | ✅ | 自定义 |
| 风格 / 排除风格 | ✅ | `tags` / `negative_tags` |
| 模型 | ✅ | v5.5 / v5 / v4.5+ / v4.5-all |
| 男声 / 女声 | ✅ | `vocal_gender` |
| Weirdness / Style Influence | ✅ | 0-100 |
| 官方人机验证 | ✅ | hCaptcha / Turnstile 官方组件 |
| 验证完成自动续提 | ✅ | 官方 token 回传 |
| 持久化歌曲列表 | ✅ | 每个 clip 独立记录 |
| 手动刷新歌曲状态 | ✅ | `/api/feed/v2` |
| 主进程后台自动轮询 | ✅ | 默认约 5 秒；未完成歌曲按账号刷新 |
| 程序启动恢复轮询 | ✅ | `bootstrap.js` 启动 pipeline |
| 手动 Suno WAV 下载 | ✅ | `convert_wav` → `wav_file` |
| 生成完成自动下载 WAV | ✅ | 用户开关 |
| 自动保存歌词 | ✅ | 与 WAV 同歌曲目录 |
| 自动下载幂等 | ✅ | 状态 + 文件存在双重判断 |
| AVR N19 exact 链路 | ✅ | SoX → loudnorm → FFmpeg Rubber Band → 后处理 |
| 手动歌曲列表 N19 | ✅ | 已完成歌曲可选 |
| 自动 N19 | ✅ | 用户开关；开启后强制开启自动 WAV |
| 防重复 N19 | ✅ | 状态 + 输出文件双重判断 |
| 自动处理失败退避 | ✅ | 指数退避，最高约 120 秒 |
| 自定义作品目录 | ✅ | 默认 `文档/SunoOriginalStudio作品` |
| 歌曲列表试听 | ✅ | N19 WAV → 原始 WAV → 在线音频 |
| 本地多文件 AI 消痕 | ✅ | 独立 AI 消痕页 |

---

# 三、v0.5.6 关键设计

## 3.1 统一 Session/Auth

共享模块：`suno_session.js`

统一提供：

```text
partitionFor(slot)
sessionFor(slot)
getAccountStatus(slot)
getAuthToken(slot)
apiHeaders(slot)
flushAccountSession(slot)
flushAllAccountSessions()
```

规则：

1. 不再把短期 `__session` 当成“是否登录”的唯一依据。
2. 对应账号始终使用自己的 persistent partition。
3. 需要 token 时在该 partition 中恢复 Suno/Clerk。
4. 优先 `window.Clerk.session.getToken()` 获取当前有效 token。
5. 只有 Clerk Session 也无法恢复时才认为登录失效。
6. 原创提交、任务刷新、歌曲列表和 WAV 请求都调用共享 Auth 模块。

## 3.2 后台歌曲流水线

```text
提交原创
→ 写入歌曲列表
→ 主进程后台轮询
→ complete
→ [自动下载开关] Suno WAV + 歌词
→ [自动 N19 开关] AVR exact N19
→ 本地作品目录
```

默认轮询约 5 秒。渲染器不再自己高频请求 Suno API，只读取主进程已经维护的歌曲列表状态。

自动化设置持久化在原 `song-library-v1.json` 内；结构版本升级为 2，但沿用旧文件名兼容旧数据。

## 3.3 幂等与重启恢复

- 已有有效原始 WAV：不重复下载。
- `wavStatus=downloaded` 且文件存在：直接复用。
- `deaiStatus=complete` 且 N19 文件存在：不重复消痕。
- 程序重启后未完成生成任务继续轮询。
- 自动下载/自动 N19 开关重启后继续生效。
- 自动处理失败使用指数退避，不高频轰 Suno 接口。

---

# 四、当前未完成

## P1：Excel 批量原创 + 3 账号调度

当前尚未实现：

- Excel 批量导入
- 导入预览 / 字段校验
- 多任务提交队列
- 账号 1→2→3 round-robin
- 单账号 busy 锁
- 每首提交间隔
- 某账号进入官方验证时只暂停该账号
- 其他账号继续执行
- 账号掉线/额度不足处理
- 批量任务 checkpoint
- 程序重启恢复未提交队列
- 失败项重试
- 暂停/继续队列
- 取消未提交任务
- 结果 Excel 导出

计划版本：`v0.6.0` / `v0.6.1`。

## P2：可选增强

- Instrumental 纯音乐开关
- Voice / Persona 列表
- 创建 Voice / Persona
- 生成版本数量配置
- 歌曲搜索 / 筛选
- 歌曲删除 / 归档
- 按 submission 聚合两个版本
- 保存封面
- metadata JSON
- 参数预设
- 原创草稿 / 最近输入

---

# 五、AVR N19 exact 链路

主链保持不变：

```text
源音频
↓
FFmpeg 解码：44.1kHz / Stereo / PCM16
↓
SoX 节点 1
↓
FFmpeg loudnorm：I=-15:TP=-1.5:LRA=11
↓
FFmpeg 节点 9：Rubber Band pitch=0.975 / 48kHz / PCM24
↓
组合后处理
↓
48kHz / PCM16 / Stereo WAV
```

构建时和运行时继续校验 SoX/FFmpeg 工具链 SHA-256；exact 模式绝不静默降级成 FFmpeg-only 兼容链。

---

# 六、版本记录

## v0.5.0
- 持久化歌曲列表
- Suno WAV 请求/下载
- 歌词 + 原始 WAV + N19 WAV 本地保存
- 歌曲列表直接 N19

## v0.5.1
- 固定 `%APPDATA%\SunoOriginalStudio`
- 旧 Profile / Session 迁移

## v0.5.2
- 排除风格 `negative_tags`

## v0.5.3
- 已完成 N19 前端禁选 + 后端强制跳过
- Clerk 登录状态增强和 Session 落盘

## v0.5.4
- 歌曲列表内置试听播放器

## v0.5.6
- 新增共享 `suno_session.js`
- 原创、任务刷新、歌曲列表、WAV 下载统一 Clerk Session/Auth
- 去掉歌曲列表短期 `__session` 硬性前置判断
- 主进程后台自动轮询
- 自动下载 WAV + 保存歌词开关
- 自动 AVR N19 开关
- 自动下载/N19 幂等与重启恢复
- 自动失败指数退避

---

# 七、维护规则

1. 每次正式功能修改同步本文件和 README。
2. N19 exact 模式不允许静默降级。
3. 已 `deaiStatus=complete` 且输出文件有效的歌曲默认不重复 N19。
4. 所有 Suno API token 获取统一使用 `suno_session.js`。
5. 自动下载与自动 N19 必须保持幂等。
6. 批量原创必须先写 checkpoint 再进入下一首，避免重复提交。
7. Suno Web 私有接口错误必须明确记录，不能静默吞错。
8. 人机验证只走官方组件，不识别、不绕过、不伪造 token、不第三方代解。
