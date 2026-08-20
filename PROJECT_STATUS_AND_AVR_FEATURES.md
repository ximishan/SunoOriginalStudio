# SunoOriginalStudio 项目功能清单、当前状态与开发路线图

> 这是项目主状态文档。以后每次增加功能、修 Bug、改开发优先级，都同步更新这里。
>
> 当前功能基线：**v0.5.8**  
> 仓库：`ximishan/SunoOriginalStudio`

---

# 一、项目目标

SunoOriginalStudio 是独立 Windows Electron 桌面工具，主线围绕：

1. 使用用户自己的 Suno 账号。
2. 3 个独立持久化 Suno Session。
3. 手动原创歌曲提交。
4. Excel 顺序批量原创。
5. 自定义歌名、歌词、风格、排除风格、模型、人声和滑杆参数。
6. Suno 官方 hCaptcha / Cloudflare Turnstile 验证衔接。
7. 持久化歌曲列表。
8. 后台自动轮询 Suno 生成状态。
9. 自动 Suno WAV 下载与歌词保存。
10. AVR 1.77.0 N19 `SoX + Rubber Band + FFmpeg` 完整链路。
11. 可选生成完成自动 N19。
12. 歌曲列表试听。
13. 后续：3 账号自动调度、账号级 busy 锁、完整后台批量任务中心与结果 Excel 导出。

明确不做：AVR License/激活/设备绑定、消息中心/公告/反馈、AVR 远程配置下发、AVR 自有更新体系、智能母带。

---

# 二、版本总览

## v0.5.8 已完成

| 功能 | 状态 | 当前实现 |
|---|---|---|
| Excel 批量导入 | ✅ | `.xlsx/.xls`，第一张工作表 |
| Excel 一行一首歌 | ✅ | 每行转换为一个顺序队列任务 |
| Excel 参数校验/预览 | ✅ | 必填字段、模型、人声、账号校验 |
| Excel 模板下载 | ✅ | 软件内生成“批量原创 + 填写说明”模板 |
| 仓库正式 Excel 模板 | ✅ | `templates/SunoOriginalStudio批量原创模板_v0.5.8.xlsx` |
| Excel 顺序提交队列 | ✅ | 一首完成提交后再进入下一首 |
| 默认提交间隔 | ✅ | 默认 20 秒，可配置 5-300 秒 |
| 单行提交间隔覆盖 | ✅ | Excel `提交间隔秒` 优先于全局值 |
| 批量暂停 / 继续 | ✅ | 当前提交结束后安全暂停 |
| 失败重试 | ✅ | 失败/中断行可重新放回队列 |
| 批量本地 checkpoint | ✅ | 主界面 `localStorage` 持久化队列与行状态 |
| 防崩溃重复提交 | ✅ | `submitting` 中断后标记“中断待确认”，不自动重提 |
| 账号异常自动暂停 | ✅ | 未登录、登录失效、额度不足时停止后续连续失败 |
| 批量成功写入歌曲列表 | ✅ | 调用原 `library:save-submission` |
| 与后台流水线联动 | ✅ | 批量歌曲继续自动轮询 / WAV / N19 |
| 3 个固定 Suno 账号位 | ✅ | 账号 1 / 2 / 3 始终固定显示 |
| 3 个独立 Suno Session | ✅ | `persist:suno-original-demo-1/2/3` |
| 固定用户数据目录 | ✅ | `%APPDATA%\SunoOriginalStudio` |
| 旧登录数据迁移 | ✅ | persistent partitions + `Local State` |
| Session 主动落盘 | ✅ | Cookie/Storage flush |
| 统一 Suno Session/Auth | ✅ | `suno_session.js` |
| 账号状态本地快速判断 | ✅ | 刷新绿点不再加载隐藏 Suno 页面 |
| 登录成功即时识别 | ✅ | `__session` 出现后立即标记对应槽位已登录 |
| 可靠登录状态持久化 | ✅ | `suno-account-login-state-v1.json` |
| 防空槽位误判登录 | ✅ | `__client` 不再单独代表已登录 |
| API Token 按需恢复 | ✅ | 只在真实 API 请求时获取新 token |
| 原创歌曲提交 | ✅ | `/api/generate/v2-web/` |
| 歌名 / 完整歌词 | ✅ | 自定义 |
| 风格 / 排除风格 | ✅ | `tags` / `negative_tags` |
| 模型 | ✅ | v5.5 / v5 / v4.5+ / v4.5-all |
| 男声 / 女声 | ✅ | `vocal_gender` |
| Weirdness / Style Influence | ✅ | 0-100 |
| 官方人机验证 | ✅ | hCaptcha / Turnstile 官方组件 |
| 验证完成自动续提 | ✅ | 官方 token 回传 |
| 持久化歌曲列表 | ✅ | 每个 clip 独立记录 |
| 主进程后台自动轮询 | ✅ | 默认约 5 秒；未完成歌曲按账号刷新 |
| 程序启动恢复歌曲轮询 | ✅ | `bootstrap.js` 启动 pipeline |
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

# 三、v0.5.8 Excel 批量设计

## 3.1 Excel 字段与正式模板

仓库正式模板：

`templates/SunoOriginalStudio批量原创模板_v0.5.8.xlsx`

模板包含：

- 第一张工作表 `批量原创`：真正导入的数据表。
- 第二张工作表 `填写说明`：字段解释和填写规则。
- 模型、人声、账号、启用等列的下拉选项。

程序只读取第一张工作表，第一行为表头。

```text
歌名 | 歌词 | 风格 | 排除风格 | 模型 | 人声 | Weirdness | 风格影响 | 账号 | 提交间隔秒 | 启用
```

规则：

1. `歌名`、`歌词`必填。
2. 模型默认 `v5.5`。
3. 人声默认“不指定”，支持“女声 / 男声”。
4. Weirdness / 风格影响默认 50，范围 0-100。
5. 账号默认 1，支持 1/2/3；本版不自动 round-robin。
6. 提交间隔为空时使用软件全局值，默认 20 秒；范围 5-300 秒。
7. `启用=否` 的行直接跳过。
8. 完全空白行忽略。
9. 正式使用优先采用仓库模板，不建议随意修改表头。

完整字段别名、值兼容、队列状态和恢复规则统一维护在 `BATCH_EXCEL_V0.5.8.md`。

## 3.2 顺序队列

```text
导入 Excel
→ 参数校验 / 预览
→ 读取当前行账号状态
→ checkpoint: submitting
→ 调用现有 original:submit
→ [需要时] Suno 官方验证
→ 返回 clip IDs
→ 写入歌曲列表
→ checkpoint: submitted
→ 等待 N 秒
→ 下一行
```

提交间隔的作用是控制请求频率。程序不会通过随机伪装、验证码代答或其他方式绕过 Suno 平台限制。

## 3.3 批次恢复

批次状态存储在主界面的 `localStorage`，当前键名为 `suno-batch-v058`：

- `queued`：等待提交。
- `submitting`：正在调用 Suno。
- `submitted`：已成功取得 clip ID 并写入歌曲列表。
- `error`：提交失败，可人工重试。
- `invalid`：Excel 参数错误，不提交。
- `skipped`：Excel 明确禁用。
- `interrupted`：程序在 `submitting` 阶段退出。

程序重新打开时：

- 原 `running` 批次改为 `paused`。
- 原 `submitting` 行改为 `interrupted`。
- 已 `submitted` 的行不会再次提交。
- `interrupted` 行不会自动重提，防止 Suno 已接单但客户端未来得及记录 clip ID 时造成重复生成。

## 3.4 与歌曲流水线联动

每个 Excel 行成功提交后调用已有 `library:save-submission`，所以后续完全复用原流水线：

```text
Excel 提交成功
→ 两个 clip 写入歌曲列表
→ 后台轮询 Suno 状态
→ complete
→ [自动下载] WAV + 歌词
→ [自动 N19] exact AVR N19
```

---

# 四、账号认证与后台歌曲流水线

## 4.1 统一 Session/Auth

共享模块：`suno_session.js`

```text
partitionFor(slot)
sessionFor(slot)
getAccountStatus(slot)
getAuthToken(slot)
apiHeaders(slot)
flushAccountSession(slot)
flushAllAccountSessions()
```

核心规则：账号 UI 状态是本地快速判断；真正 API 调用才恢复 Clerk Token；三个槽位始终使用各自 persistent partition；`__client` 不单独代表已登录。

## 4.2 后台歌曲流水线

```text
提交原创
→ 写入歌曲列表
→ 主进程后台轮询
→ complete
→ [自动下载开关] Suno WAV + 歌词
→ [自动 N19 开关] AVR exact N19
→ 本地作品目录
```

自动下载和 N19 均使用状态 + 本地文件双重幂等；失败有指数退避。

---

# 五、当前未完成

## P1：v0.6.x 多账号自动调度 / 完整任务中心

- 账号 1→2→3 自动 round-robin
- 单账号 busy 锁
- 多账号同时执行不同歌曲
- 某账号进入官方验证时只暂停该账号
- 其他账号继续执行
- 更完整的主进程批量 checkpoint
- 批量结果 Excel 导出
- 取消单个未提交任务
- 批次历史 / 多批次管理

## P2：可选增强

- Instrumental 纯音乐开关
- Voice / Persona 列表
- 创建 Voice / Persona
- 生成版本数量配置
- 单账号退出 / 清除
- 歌曲搜索 / 筛选
- 歌曲删除 / 归档
- 按 submission 聚合两个版本
- 保存封面
- metadata JSON
- 参数预设
- 原创草稿 / 最近输入

---

# 六、AVR N19 exact 链路

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

# 七、版本记录

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
- 统一 Suno Session/Auth
- 主进程后台轮询
- 自动下载 WAV + 歌词
- 自动 AVR N19

## v0.5.7
- 账号 1/2/3 固定槽位
- 账号状态快速本地判断
- 登录状态可靠持久化
- 修复关闭登录窗口后误判未登录

## v0.5.8
- Excel 批量原创导入 / 模板
- 字段校验与队列预览
- 顺序逐首提交
- 默认 20 秒提交间隔 + 5-300 秒可配置
- Excel 单行间隔覆盖
- 暂停 / 继续 / 失败重试
- 批量 localStorage checkpoint
- 中断提交防自动重复
- 账号登录/额度异常自动暂停
- 批量提交结果自动写入歌曲列表并衔接原后台流水线
- 正式 Excel 模板纳入仓库 `templates/` 并由文档统一维护

---

# 八、维护规则

1. 每次正式功能修改同步本文件和 README。
2. N19 exact 模式不允许静默降级。
3. 已 `deaiStatus=complete` 且输出文件有效的歌曲默认不重复 N19。
4. 所有 Suno API token 获取统一使用 `suno_session.js`。
5. 账号 UI 登录状态不得通过阻塞式 Suno 页面加载来判断。
6. 自动下载与自动 N19 必须保持幂等。
7. 批量原创每行在调用 Suno 前必须 checkpoint 为 `submitting`，成功返回 clip ID 后才能标记 `submitted`。
8. `submitting` 状态发生程序中断时，禁止自动重新提交，必须转为“中断待确认”。
9. Suno Web 私有接口错误必须明确记录，不能静默吞错。
10. 人机验证只走官方组件，不识别、不绕过、不伪造 token、不第三方代解。
11. Excel 字段结构、默认值或解析规则发生变化时，必须同步更新 `templates/` 中的正式模板、`BATCH_EXCEL_V0.5.8.md`、README 和本状态文档；新正式版本应使用新的模板文件名，避免旧模板与新代码混用。
