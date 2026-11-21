// 启动前自检：把「依赖没装」「Node 太旧」翻译成一句人话，
// 而不是甩一段 ERR_MODULE_NOT_FOUND 堆栈让人以为程序坏了。
import {createRequire} from 'node:module';

const problems = [];

const major = Number(process.versions.node.split('.')[0]);
if (!Number.isFinite(major) || major < 20) {
  problems.push([
    `Node.js 版本过低：当前 v${process.versions.node}，需要 20 或更高。`,
    '到 https://nodejs.org/zh-cn 下载 LTS 版本重装，装完重开一个 PowerShell 窗口再试。',
  ].join('\n'));
}

const require = createRequire(import.meta.url);
let hasPlaywright = true;
try {
  require.resolve('playwright');
} catch {
  hasPlaywright = false;
}
if (!hasPlaywright) {
  problems.push([
    '缺少依赖 playwright —— 这个目录还没有执行过 npm install。',
    '',
    '先运行：',
    '    npm install',
    '',
    '如果下载卡住（国内网络常见），换镜像再试：',
    '    npm install --registry=https://registry.npmmirror.com',
    '',
    '注意：npm install 要在本文件夹里执行，不要用 npm install -g。',
  ].join('\n'));
}

if (problems.length) {
  console.error('');
  for (const item of problems) console.error(item + '\n');
  process.exit(1);
}