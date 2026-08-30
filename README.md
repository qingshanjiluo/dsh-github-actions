# dsh-github-actions

> DeepSeek Harness GitHub Actions 工作流管理插件

## 功能

- 📋 **运行记录**: 列出 workflow 运行历史，支持按 workflow/branch 过滤
- 📝 **日志查看**: 获取运行日志，失败步骤优先
- 🔄 **重试失败**: 一键重试失败的 jobs
- 🚫 **取消运行**: 取消正在执行的 workflow
- 📂 **Workflow 文件**: 列出和读取 .github/workflows 下的文件
- ⚡ **触发运行**: 手动触发 workflow_dispatch 事件

## 工具

| 工具名 | 说明 |
|--------|------|
| `gh_runs` | 列出 workflow 运行记录 |
| `gh_run_detail` | 查看运行详情（jobs + steps） |
| `gh_run_logs` | 获取运行日志 |
| `gh_trigger` | 触发 workflow_dispatch |
| `gh_retry` | 重试失败的 jobs |
| `gh_cancel` | 取消运行 |
| `gh_workflows` | 列出 workflow 文件 |
| `gh_read_workflow` | 读取 workflow 文件内容 |

## 命令

- `/gh runs` — 列出最近运行
- `/gh workflows` — 列出 workflow 文件
- `/gh <run_id> logs` — 查看日志
- `/gh <run_id> retry` — 重试失败
- `/gh <run_id> cancel` — 取消运行

## 前置要求

需要安装 [GitHub CLI](https://cli.github.com/) 并登录: `gh auth login`

## License

MIT
