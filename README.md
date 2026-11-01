# Codex Studio

本地可视化编排工作台：**Codex Planner + 现有 Codex Worker + DSH/API Worker**。

它解决的是：

```text
你只输入目标
→ Planner 读取项目并拆任务
→ 自动把任务发给合适的 Worker
→ 收集 Worker 结果
→ Planner 验收并进入下一轮
```

Planner 不是复制出来的代理，而是你选中的**现有 Codex 对话**。  
所以：

- 应用里的 Planner = Codex 里的那个对话；
- 模型就是该对话当前的模型；
- 上下文只有一份；
- 在 Codex 里切换账号后，继续同一个 thread 即可；
- 应用不会另造一份 Planner 上下文。

## 启动

首次使用：

```powershell
Copy-Item D:\CodexStudio\config.example.json D:\CodexStudio\config.json
```

然后按本机路径编辑 `config.json`（Codex home、DSH home、DSH node/entry）。已有本地 `config.json` 时不要覆盖。

双击 `D:\CodexStudio\start_studio.cmd`，或：

```powershell
powershell -ExecutionPolicy Bypass -File D:\CodexStudio\start_studio.ps1
```

会启动本地服务并打开：

```text
http://127.0.0.1:7788
```

所有数据在：

```text
D:\CodexStudio\data
```

## 使用流程

### 1. 选择项目

左侧列出 Codex Desktop 的**全部项目**：读取 `state_5.sqlite` 的 `projects` 和 `project_roots`，按 Codex 侧栏顺序显示项目名和项目根目录。选择项目后，应用会列出该项目所有根目录下的顶层 Codex 对话；对话名称使用 Codex 的 `name` 字段（例如“统筹对话”“执行对话B”），完整首条消息保留为悬浮提示。

### 2. 选择 Planner

从对话列表中选择一个作为 Planner。

- Planner 的模型显示在卡片上；
- 不要求固定模型，选择哪个对话就用哪个对话的模型；
- 这个对话如果正在执行，不能选；
- Planner 的上下文由 Codex 管理，不由应用复制；
- Planner 目前通过 `codex queue --resume` 发送，最好让 Planner 对话在 Codex 里保持打开，确保 Desktop 本地 daemon 能接收。Worker 则使用 `codex exec resume`，不依赖打开窗口。

### 3. 配置 Worker

#### 复用现有 Codex 对话

在“现有对话”标签中勾选一个或多个对话。应用会把它们作为 `codex-01`、`codex-02` 等 Worker，并用 `codex exec resume <thread>` 在对应 thread 上执行一轮。

这里没有用 `codex queue` 作为 Worker 主路径：`queue` 只有在对话已经打开、Desktop 本地 daemon 能 resume 时才会真正开跑，后台对话可能一直停在队列里。`exec resume` 会直接写回同一个 thread，完成后打开 Codex 仍能看到这一轮。

#### 选择 DSH 对话 Worker

切换到“DSH 对话”标签，会列出当前项目下已有的 DeepSeek Harness 对话。点“添加”把某个对话加入 Worker 池。

运行时会通过 `dsh --profile acp` 继续该**原 DSH 会话**：

- 不会新建一次性 headless 会话；
- 任务写回同一个 DSH 会话；
- 会话原有标题、模型和上下文保留；
- 如果该会话正在 DSH 客户端里执行，ACP 会提示 `active write handle`，需要先关闭或换一个会话。

DSH 对话的标题、模型、cwd 来自 DSH 的 `session_projcache`。

#### API 直连 Worker

“API 直连”是备用模式：每个 Worker 是独立 DSH headless 进程，使用 `config.json` 中的 provider/model，不沿用已有 DSH 对话。

如果某个模型（例如 `gpt-6.1-sol`）只存在于 Codex 订阅里、没有 API endpoint，它只能作为“现有 Codex 对话”Worker 使用；要作为 API Worker，需要先在 `config.json` 增加一个可用的 OpenAI-compatible provider/model。

### 4. 输入目标并开始

直接用自然语言写目标，例如：

```text
先只读检查项目当前进度，验收 B/C/D 的交付。
如果还有下一轮工作，按难度给合适的 Worker 分配任务；
代码任务优先 Codex，长文分析优先 DSH。
```

点击“开始运行”。

## Planner 和 Worker 怎么协作

Planner 收到：

- 项目路径；
- 总目标；
- 可用 Worker 列表（类型、模型、特点、等级）；
- 上一轮 Worker 结果；
- 任务输出协议。

Planner 返回：

```json
{
  "status": "dispatch",
  "reason": "本轮判断",
  "tasks": [
    {
      "worker": "api-1",
      "task_id": "R1-api-1",
      "difficulty": "medium",
      "prompt": "完整、自包含的任务提示词",
      "acceptance": "可验证的验收标准",
      "timeout_minutes": 45
    }
  ]
}
```

`status` 可以是：

- `dispatch`：继续派任务；
- `done`：目标完成；
- `blocked`：需要人决策。

Worker 结束时写：

```text
.codex-studio-result-<task_id>.json
```

并输出同样结构的 JSON。应用读取结果，汇总后发回 Planner。

## Codex 账号

应用不管理 Codex 账号，也不自动登录或自动切换。

- Planner 使用 Codex 客户端当前账号；
- 额度不足时，应用把运行标记为 `paused`；
- 在 Codex 里手动切换到有额度的账号；
- 回到应用点“切换账号后继续”；
- 应用继续向**同一个 Planner thread** 发消息。

这依赖 Codex 自身“切换账号后继续同一对话”的行为，应用不复制上下文。

## Codex 502 / `Invalid character in header content`

如果 Codex 经过本地 `codex-rotator` 代理，且项目路径包含中文，可能出现：

```text
502 Bad Gateway
upstream transport failure:
Invalid character in header content ["x-codex-turn-metadata"]
```

原因是 rotator 把 `x-codex-turn-metadata` 解析后重新 `JSON.stringify`，中文 Windows 路径被写成原始 Unicode；Node 的 HTTP header 只接受 ISO-8859-1。

本机已修复：

```text
D:\Codex\workspaces\codex-rotator\src\identity.js
```

修复方式是只把非 ASCII 字符转成 JSON `\uXXXX` 转义，语义不变，并重启 rotator。原文件备份：

```text
D:\Codex\workspaces\codex-rotator\src\identity.js.bak-codexstudio
```

## DSH / API Worker

API Worker 通过：

```text
dsh --profile headless --patch <model> --json <prompt>
```

运行。当前配置：

```text
D:\AgentOrchestrator\dsh-home
D:\AgentOrchestrator\npm-global
D:\AgentOrchestrator\node\node-v22.23.4-win-x64
```

DSH 的 API key 存在它自己的 `.credentials.yaml` 的 `refs` 中。Codex Studio 只在启动子进程时把这些值注入环境，不写入 `studio.db` 或日志。

如果某个 API Worker 没有勾选独立 worktree，多个 API Worker 会被自动串行，避免同时改同一工作树。

勾选 worktree 要求项目当前是 clean 的；否则该任务会失败并提示先提交或关闭 worktree。

## 当前限制

- Codex Planner 的账号切换是**手动**的，不做自动轮换。
- 一个 Planner thread 同时只使用一个 Codex 账号。
- 不支持给每个 Codex Worker 单独绑定不同 Codex 账号。
- 现有 Codex Worker 没有 worktree 隔离；多个 Worker 写同一项目时需要自己保证任务范围互斥。
- DSH 对话通过 ACP 接管；同一时刻一个 DSH 会话只能被一个写入者持有。正在 DSH 客户端打开的会话可能不能同时作为 Worker。
- API Worker 的 worktree 只支持 clean Git 项目。
- API 模型列表目前写在 `config.json`，还没有做可视化编辑。
- 读取 Codex 本地 SQLite；Codex 大版本升级后可能需要适配。
- 应用只绑定 `127.0.0.1`，没有做多用户鉴权。

## 文件

```text
D:\CodexStudio\
  server.py              # Python 3.7+，仅标准库
  config.json            # Codex/DSH/API 模型配置
  start_studio.ps1       # 启动并打开浏览器
  static\index.html
  static\style.css
  static\app.js
  data\studio.db         # 运行状态
  data\runs\             # 运行记录、模型 patch、worktree
```

## GitHub 发布

仓库已经初始化并提交了干净的源码。GitHub 发布只需要一个空仓库地址：

```powershell
powershell -ExecutionPolicy Bypass -File D:\CodexStudio\publish.ps1 `
  -RepoUrl https://github.com/YOUR_NAME/codex-studio.git
```

如果本机没有 GitHub 凭据，先在 Git Credential Manager 或 GitHub CLI 登录。源码包也已生成：

```text
D:\CodexStudio\dist\codex-studio-0.1.0.zip
```

## 后续扩展

- 可视化编辑 API 模型/API key 引用；
- Planner 额度监控和提示；
- 项目级预算/成本统计；
- 自动模型路由（按 difficulty/tier）；
- 失败重试和换 Worker；
- 更完整的 chat 视图和 markdown 渲染；
- 打包成 Electron 桌面应用。
