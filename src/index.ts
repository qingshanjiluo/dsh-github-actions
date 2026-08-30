/**
 * dsh-github-actions — GitHub Actions 工作流管理
 *
 * 功能：
 * 1. 列出 workflow 运行记录
 * 2. 查看 workflow 运行详情和日志
 * 3. 触发 workflow_dispatch
 * 4. 重试失败的 workflow
 * 5. 取消正在运行的 workflow
 * 6. 查看 job 和 step 状态
 * 7. 读取 .github/workflows 下的 workflow 文件
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { z } from 'zod';

export const name = 'dsh-github-actions';
export const inject = ['settings', 'tools', 'commands'];

const configSchema = z.object({
  enabled: z.boolean().default(true),
  defaultTimeout: z.number().int().min(5000).max(120000).default(30000),
  autoDetect: z.boolean().default(true),
});

type Config = z.infer<typeof configSchema>;

// ==================== GitHub CLI 执行器 ====================

function ghExec(args: string, options?: { cwd?: string; timeout?: number }): string {
  try {
    return execSync(`gh ${args}`, {
      cwd: options?.cwd,
      timeout: options?.timeout || 30000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (err: any) {
    const stderr = (err.stderr || '').trim();
    const stdout = (err.stdout || '').trim();
    throw new Error(stderr || stdout || `gh 命令失败: gh ${args}`);
  }
}

function ghExecJson<T = any>(args: string, options?: { cwd?: string; timeout?: number }): T {
  const output = ghExec(args + ' --json', options);
  return JSON.parse(output) as T;
}

// ==================== 仓库信息 ====================

function getRepoInfo(cwd: string): { owner: string; repo: string } | null {
  try {
    const remote = execSync('git remote get-url origin', { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const match = remote.match(/github\.com[:/](.+?)\/(.+?)(?:\.git)?$/);
    if (match) return { owner: match[1], repo: match[2] };
  } catch { /* ignore */ }
  return null;
}

// ==================== Workflow 操作 ====================

interface WorkflowRun {
  id: string;
  name: string;
  status: string;
  conclusion: string | null;
  event: string;
  branch: string;
  commit: string;
  created: string;
  updated: string;
  url: string;
  databaseId: number;
}

function listWorkflowRuns(cwd: string, workflow?: string, branch?: string, limit: number = 20): WorkflowRun[] {
  const args = ['run', 'list', '--json', 'id,name,status,conclusion,event,headBranch,headSha,createdAt,updatedAt,url,databaseId'];
  if (workflow) args.push('--workflow', workflow);
  if (branch) args.push('--branch', branch);
  args.push('--limit', String(limit));
  const output = ghExec(args.join(' '), { cwd });
  const runs = JSON.parse(output) as any[];
  return runs.map(r => ({
    id: r.id,
    name: r.name,
    status: r.status,
    conclusion: r.conclusion,
    event: r.event,
    branch: r.headBranch,
    commit: r.headSha?.substring(0, 7),
    created: r.createdAt,
    updated: r.updatedAt,
    url: r.url,
    databaseId: r.databaseId,
  }));
}

function getWorkflowRun(runId: string, cwd: string): any {
  const output = ghExec(`run view ${runId} --json databaseId,name,status,conclusion,event,headBranch,headSha,createdAt,updatedAt,url,jobs`, { cwd });
  return JSON.parse(output);
}

function getWorkflowRunJobs(runId: string, cwd: string): any[] {
  const output = ghExec(`run view ${runId} --json jobs`, { cwd });
  const data = JSON.parse(output);
  return data.jobs || [];
}

function getWorkflowRunLogs(runId: string, cwd: string): string {
  try {
    const output = ghExec(`run view ${runId} --log-failed`, { cwd, timeout: 15000 });
    return output;
  } catch {
    try {
      return ghExec(`run view ${runId} --log`, { cwd, timeout: 15000 });
    } catch {
      return '无法获取日志';
    }
  }
}

function triggerWorkflow(workflow: string, ref: string = 'main', inputs?: Record<string, string>, cwd?: string): string {
  let cmd = `workflow run ${workflow} --ref ${ref}`;
  if (inputs) {
    for (const [key, value] of Object.entries(inputs)) {
      cmd += ` --field ${key}=${value}`;
    }
  }
  ghExec(cmd, { cwd });
  return `已触发 workflow: ${workflow} (ref: ${ref})`;
}

function retryWorkflow(runId: string, cwd: string): string {
  ghExec(`run rerun ${runId} --failed`, { cwd });
  return `已重试失败的 jobs: run ${runId}`;
}

function cancelWorkflow(runId: string, cwd: string): string {
  ghExec(`run cancel ${runId}`, { cwd });
  return `已取消 workflow run: ${runId}`;
}

// ==================== Workflow 文件操作 ====================

function listWorkflowFiles(cwd: string): string[] {
  const workflowDir = join(cwd, '.github', 'workflows');
  if (!existsSync(workflowDir)) return [];
  try {
    return readdirSync(workflowDir)
      .filter(f => f.endsWith('.yml') || f.endsWith('.yaml'))
      .map(f => f);
  } catch { return []; }
}

function readWorkflowFile(cwd: string, filename: string): string {
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    throw new Error('非法文件名');
  }
  const filePath = join(cwd, '.github', 'workflows', filename);
  if (!existsSync(filePath)) throw new Error(`Workflow 文件不存在: ${filename}`);
  return readFileSync(filePath, 'utf-8');
}

function validateWorkflow(yaml: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!yaml.includes('name:')) errors.push('缺少 name 字段');
  if (!yaml.includes('on:')) errors.push('缺少 on 触发器定义');
  if (!yaml.includes('jobs:')) errors.push('缺少 jobs 定义');
  if (yaml.includes('${{') && !yaml.includes('}}')) errors.push('可能存在未闭合的表达式');
  return { valid: errors.length === 0, errors };
}

// ==================== Agent 可读格式 ====================

function formatRunsForAgent(runs: WorkflowRun[]): string {
  if (runs.length === 0) return '没有找到 workflow 运行记录';
  const lines = [`找到 ${runs.length} 个 workflow 运行:`];
  for (const r of runs) {
    const icon = r.conclusion === 'success' ? '✅' : r.conclusion === 'failure' ? '❌' : r.status === 'in_progress' ? '🔄' : '⏳';
    lines.push(`${icon} ${r.name} (#${r.id}) — ${r.status}${r.conclusion ? ` (${r.conclusion})` : ''}`);
    lines.push(`  分支: ${r.branch} | 事件: ${r.event} | 提交: ${r.commit}`);
    lines.push(`  创建: ${r.created}`);
  }
  return lines.join('\n');
}

function formatJobsForAgent(jobs: any[]): string {
  if (jobs.length === 0) return '没有 job 信息';
  const lines = [`找到 ${jobs.length} 个 job:`];
  for (const job of jobs) {
    const icon = job.conclusion === 'success' ? '✅' : job.conclusion === 'failure' ? '❌' : '🔄';
    lines.push(`${icon} ${job.name} — ${job.status}${job.conclusion ? ` (${job.conclusion})` : ''}`);
    if (job.steps) {
      for (const step of job.steps) {
        const sIcon = step.conclusion === 'success' ? '✅' : step.conclusion === 'failure' ? '❌' : '🔄';
        lines.push(`    ${sIcon} ${step.name}`);
      }
    }
  }
  return lines.join('\n');
}

// ==================== 插件入口 ====================

export function apply(ctx: any, config: Config) {
  if (!config.enabled) return;

  // gh_runs — 列出 workflow 运行
  ctx.effect(() => ctx.tools.register({
    name: 'gh_runs',
    description: '列出 GitHub Actions workflow 运行记录。',
    parameters: {
      workflow: { type: 'string', description: '筛选特定 workflow 名称' },
      branch: { type: 'string', description: '筛选特定分支' },
      limit: { type: 'number', description: '返回数量（默认 20）' },
    },
    output: {
      schema: { type: 'text' },
      render(_args: unknown, value: unknown) {
        return [{ type: 'text', text: value as string }];
      },
    },
    async execute(args: { workflow?: string; branch?: string; limit?: number }, context: any) {
      const cwd = context?.cwd || process.cwd();
      const runs = listWorkflowRuns(cwd, args.workflow, args.branch, args.limit || 20);
      return formatRunsForAgent(runs);
    },
  }), 'dsh-github-actions: gh_runs');

  // gh_run_detail — 查看运行详情
  ctx.effect(() => ctx.tools.register({
    name: 'gh_run_detail',
    description: '查看 GitHub Actions workflow 运行详情（包含 jobs 和 steps）。',
    parameters: {
      run_id: { type: 'string', description: 'Workflow run ID' },
    },
    output: {
      schema: { type: 'text' },
      render(_args: unknown, value: unknown) {
        return [{ type: 'text', text: value as string }];
      },
    },
    async execute(args: { run_id: string }, context: any) {
      const cwd = context?.cwd || process.cwd();
      const jobs = getWorkflowRunJobs(args.run_id, cwd);
      return formatJobsForAgent(jobs);
    },
  }), 'dsh-github-actions: gh_run_detail');

  // gh_run_logs — 查看运行日志
  ctx.effect(() => ctx.tools.register({
    name: 'gh_run_logs',
    description: '获取 GitHub Actions workflow 运行日志（失败步骤优先）。',
    parameters: {
      run_id: { type: 'string', description: 'Workflow run ID' },
    },
    output: {
      schema: { type: 'text' },
      render(_args: unknown, value: unknown) {
        const log = value as string;
        const lines = log.split('\n').slice(-100);
        return [{ type: 'text', text: `## Workflow 日志 (最近 ${lines.length} 行)\n\`\`\`\n${lines.join('\n')}\n\`\`\`` }];
      },
    },
    async execute(args: { run_id: string }, context: any) {
      const cwd = context?.cwd || process.cwd();
      return getWorkflowRunLogs(args.run_id, cwd);
    },
  }), 'dsh-github-actions: gh_run_logs');

  // gh_trigger — 触发 workflow
  ctx.effect(() => ctx.tools.register({
    name: 'gh_trigger',
    description: '触发 GitHub Actions workflow_dispatch 事件。',
    parameters: {
      workflow: { type: 'string', description: 'Workflow 文件名或 ID' },
      ref: { type: 'string', description: '分支或 tag（默认 main）' },
      inputs: { type: 'string', description: '输入参数，逗号分隔（如 key1=val1,key2=val2）' },
    },
    output: {
      schema: { type: 'text' },
      render(_args: unknown, value: unknown) {
        return [{ type: 'text', text: `✅ ${value}` }];
      },
    },
    async execute(args: { workflow: string; ref?: string; inputs?: string }, context: any) {
      const cwd = context?.cwd || process.cwd();
      let inputMap: Record<string, string> | undefined;
      if (args.inputs) {
        inputMap = {};
        for (const pair of args.inputs.split(',')) {
          const [k, v] = pair.trim().split('=');
          if (k) inputMap[k] = v || '';
        }
      }
      return triggerWorkflow(args.workflow, args.ref || 'main', inputMap, cwd);
    },
  }), 'dsh-github-actions: gh_trigger');

  // gh_retry — 重试失败的 workflow
  ctx.effect(() => ctx.tools.register({
    name: 'gh_retry',
    description: '重试 GitHub Actions workflow 中失败的 jobs。',
    parameters: { run_id: { type: 'string', description: 'Workflow run ID' } },
    output: { schema: { type: 'text' }, render: (_a: unknown, v: unknown) => [{ type: 'text', text: `✅ ${v}` }] },
    async execute(args: { run_id: string }, context: any) { return retryWorkflow(args.run_id, context?.cwd || process.cwd()); },
  }), 'dsh-github-actions: gh_retry');

  // gh_cancel — 取消 workflow
  ctx.effect(() => ctx.tools.register({
    name: 'gh_cancel',
    description: '取消正在运行的 GitHub Actions workflow。',
    parameters: { run_id: { type: 'string', description: 'Workflow run ID' } },
    output: { schema: { type: 'text' }, render: (_a: unknown, v: unknown) => [{ type: 'text', text: `✅ ${v}` }] },
    async execute(args: { run_id: string }, context: any) { return cancelWorkflow(args.run_id, context?.cwd || process.cwd()); },
  }), 'dsh-github-actions: gh_cancel');

  // gh_workflows — 列出 workflow 文件
  ctx.effect(() => ctx.tools.register({
    name: 'gh_workflows',
    description: '列出项目中 .github/workflows 下的 workflow 文件。',
    output: {
      schema: { type: 'text' },
      render(_args: unknown, value: unknown) {
        const files = value as string[];
        if (files.length === 0) return [{ type: 'text', text: '未找到 workflow 文件' }];
        const lines = [`找到 ${files.length} 个 workflow 文件:`];
        for (const f of files) lines.push(`- ${f}`);
        return [{ type: 'text', text: lines.join('\n') }];
      },
    },
    async execute(_args: unknown, context: any) {
      return listWorkflowFiles(context?.cwd || process.cwd());
    },
  }), 'dsh-github-actions: gh_workflows');

  // gh_read_workflow — 读取 workflow 文件内容
  ctx.effect(() => ctx.tools.register({
    name: 'gh_read_workflow',
    description: '读取指定 workflow 文件的内容。',
    parameters: { file: { type: 'string', description: 'Workflow 文件名（如 ci.yml）' } },
    output: {
      schema: { type: 'text' },
      render(_args: unknown, value: unknown) {
        return [{ type: 'text', text: `\`\`\`yaml\n${value}\n\`\`\`` }];
      },
    },
    async execute(args: { file: string }, context: any) {
      return readWorkflowFile(context?.cwd || process.cwd(), args.file);
    },
  }), 'dsh-github-actions: gh_read_workflow');

  // slash 命令 /gh
  ctx.effect(() => ctx.commands.register({
    name: 'gh',
    description: 'GitHub Actions 快捷命令',
    input: { hint: 'runs | workflows | <run_id> logs | <run_id> retry' },
    async handler(invocation: any, context: any) {
      const cwd = context?.cwd || process.cwd();
      const parts = invocation.rawInput.trim().split(/\s+/).filter(Boolean);
      if (parts.length === 0) return { kind: 'text', text: '用法: /gh runs | workflows | <id> logs | <id> retry | <id> cancel' };
      const cmd = parts[0];
      switch (cmd) {
        case 'runs': {
          const runs = listWorkflowRuns(cwd);
          return { kind: 'text', text: formatRunsForAgent(runs) };
        }
        case 'workflows': {
          const files = listWorkflowFiles(cwd);
          return { kind: 'text', text: files.length ? files.join('\n') : '未找到 workflow 文件' };
        }
        default: {
          if (parts[1] === 'logs') return { kind: 'text', text: getWorkflowRunLogs(cmd, cwd) };
          if (parts[1] === 'retry') { retryWorkflow(cmd, cwd); return { kind: 'text', text: `已重试: ${cmd}` }; }
          if (parts[1] === 'cancel') { cancelWorkflow(cmd, cwd); return { kind: 'text', text: `已取消: ${cmd}` }; }
          return { kind: 'text', text: `未知操作: ${parts[1]}` };
        }
      }
    },
  }), 'dsh-github-actions: command');

  // 设置注册
  ctx.inject(['settings'], (sctx: any) => {
    const { settingsNamespace } = require('@deepseek-ai/dsh-settings');
    sctx.settings.register(settingsNamespace('github-actions'), configSchema, { base: config, expose: true, applies: 'live' });
  });
}
