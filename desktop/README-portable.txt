Codex Studio 0.1.0 — Windows portable

运行：
1. 解压整个文件夹（不要只复制 exe）。
2. 双击 CodexStudio.exe。
3. 如果 Windows 终端环境设置了 ELECTRON_RUN_AS_NODE，使用 CodexStudio.cmd 启动。

配置：
config.json 里是当前机器的 Codex home、DSH home 和数据目录。
换机器时请修改 config.json；DSH 需要先安装并至少创建一次 profile。
Codex Studio 自身的运行历史、模型和 Electron 缓存都在 D:\CodexStudioAppData；
应用安装目录是 D:\CodexStudioApp。不会上传到 GitHub。

桌面版自带 Python 运行时和 Electron，不要求额外安装 Node/Python。
