import { createShellViewModel } from '../packages/tui/dist/shell/view-model.js';
import { renderPlainShell } from '../packages/tui/dist/shell/plain-renderer.js';

const ctx = {
  language: 'zh-CN',
  permissionMode: 'default',
  briefMode: false,
  model: 'claude-sonnet-4-20250514',
  projectPath: 'F:\\MyProject',
  config: { workspaceTrust: { recorded: true, level: 'trusted' } },
  index: { status: 'ready' },
  cache: { history: [{ hitRate: 0.42 }] },
  backgroundTasks: [],
};

const blocks = [
  {
    id: 'u1',
    kind: 'command',
    status: 'info',
    title: '帮我修复 router.ts 的 bug',
    summary: '帮我修复 router.ts 的 bug',
    fullText: '帮我修复 router.ts 的 bug',
    messageKind: 'user_text',
    keep: true,
  },
  {
    id: 'a1',
    kind: 'response',
    status: 'info',
    title: '',
    summary: '我来看看 router.ts 的问题。',
    fullText: '我来看看 router.ts 的问题。先读取文件内容：',
    messageKind: 'assistant_text',
  },
  {
    id: 'tool-read',
    kind: 'tool',
    status: 'pass',
    title: '',
    summary: '- 45 行; 内容 45 行',
    fullText: '- 45 行; 内容 45 行\n- Ctrl+O 查看详情',
    messageKind: 'tool_result_success',
  },
  {
    id: 'a2',
    kind: 'response',
    status: 'info',
    title: '',
    summary: '',
    fullText: '问题在第 23 行，路由匹配逻辑有误。我来修复：\n\n```diff\n-  if (path.match(route)) {\n+  if (path.startsWith(route.prefix)) {\n```\n\n修复完成，改动如下：',
    messageKind: 'assistant_text',
  },
  {
    id: 'tool-edit',
    kind: 'tool',
    status: 'pass',
    title: '',
    summary: '- 补丁 +1 -1; 改动文件 1',
    fullText: '- 补丁 +1 -1; 改动文件 1\n```diff\n- if (path.match(route)) {\n+ if (path.startsWith(route.prefix)) {\n```\n- Ctrl+O 查看详情',
    messageKind: 'tool_result_success',
  },
  {
    id: 'a3',
    kind: 'response',
    status: 'info',
    title: '',
    summary: '',
    fullText: '修复完成。路由匹配从正则改为前缀匹配，避免了部分路径误匹配的问题。\n\n验证一下：\n\n```bash\nnpm test -- --filter router\n```',
    messageKind: 'assistant_text',
  },
  {
    id: 'tool-bash',
    kind: 'tool',
    status: 'pass',
    title: '',
    summary: '- 12 行; 退出码 0',
    fullText: '- 12 行; 退出码 0\n- Ctrl+O 查看详情',
    messageKind: 'tool_result_success',
  },
];

const view = createShellViewModel(ctx, {
  noColor: false,
  outputBlocks: blocks,
  width: 100,
  height: 40,
  viewMode: 'task',
});

console.log(renderPlainShell(view));
