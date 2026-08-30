# dsh-github-actions

> DeepSeek Harness GitHub Actions 工作流管理

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## ✨ 功能特性

- 📋 **运行记录**: 列出 workflow 运行历史，支持按 workflow/branch 过滤
- 📝 **日志查看**: 获取运行日志，失败步骤优先
- 🔄 **重试失败**: 一键重试失败的 jobs
- 🚫 **取消运行**: 取消正在执行的 workflow
- ⚡ **触发运行**: 手动触发 workflow_dispatch 事件
- 📂 **Workflow 文件**: 列出和读取 .github/workflows 下的文件

## 📦 安装

```bash
npm install dsh-github-actions
```

## 🛠️ 工具

| 工具名 | 描述 | 参数 |
|--------|------|------|
| `gh_runs` | 列出 workflow 运行记录 | `workflow`, `branch`, `limit` |
| `gh_run_detail` | 查看运行详情 | `run_id` |
| `gh_run_logs` | 获取运行日志 | `run_id` |
| `gh_trigger` | 触发 workflow_dispatch | `workflow`, `ref`, `inputs` |
| `gh_retry` | 重试失败的 jobs | `run_id` |
| `gh_cancel` | 取消运行 | `run_id` |
| `gh_workflows` | 列出 workflow 文件 | 无 |
| `gh_read_workflow` | 读取 workflow 文件 | `file` |

## 📋 命令

- `/gh runs` — 列出最近运行
- `/gh workflows` — 列出 workflow 文件
- `/gh <run_id> logs` — 查看日志
- `/gh <run_id> retry` — 重试失败
- `/gh <run_id> cancel` — 取消运行

## 📄 License

MIT
