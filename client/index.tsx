import React from 'react';
import { createSettingsCard } from '@deepseek-ai/dsh-settings';

export default createSettingsCard({
  title: 'github-actions',
  description: 'GitHub Actions 工作流管理',
  config: [
    { key: 'enabled', type: 'boolean', label: '启用插件', default: true },
    { key: 'defaultTimeout', type: 'number', label: '默认超时(ms)', default: 30000 },
  ],
});
