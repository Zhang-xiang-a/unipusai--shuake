// 归档并清空某门课的答题进度。
// 换账号、换课程、或者想从头重刷一遍时用：旧的 progress 会让脚本以为题已经做完，
// 一路「保留已有状态，跳过执行」，看起来像什么都没做。
import fs from 'node:fs/promises';
import path from 'node:path';
import {courseOutputDir} from './paths.mjs';
import {loadConfig} from './config.mjs';

const argv = process.argv;
const confirmed = argv.includes('--yes') || argv.includes('-y');
const keepInventory = !argv.includes('--all');

let config;
try {
  config = loadConfig({validate: false, argv});
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const courseKey = config.course?.key || 'course1';
const output = courseOutputDir(courseKey);
// 这些是「跑到哪了」的记录，清掉才会从头开始。
const progressFiles = [
  'answer-progress.json',
  'checkpoint.json',
  'answer-rounds.jsonl',
  'events.jsonl',
  'api-last-plan.json',
  'last-run-summary.json',
  'control.json',
  'runner.lock',
];

async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

const present = [];
for (const name of progressFiles) {
  if (await exists(path.join(output, name))) present.push(name);
}

if (!present.length && keepInventory) {
  console.log(`${courseKey} 没有答题进度，已经是干净的（inventory 任务清单保留）。`);
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const archiveDir = path.join(output, 'archive', `reset-${stamp}`);

console.log(`课程分组：${courseKey}`);
console.log(`输出目录：${output}`);
console.log(`将归档 ${present.length} 个文件到 archive/reset-${stamp}/：`);
for (const name of present) console.log(`  - ${name}`);
if (!keepInventory) console.log('  - inventory/（任务清单，会被一起归档，之后需要重新 npm run crawl）');

if (!confirmed) {
  console.log('');
  console.log('这只是预览。确认要归档并清空，加 --yes 再执行一次：');
  console.log(`  node src/reset.mjs --course ${courseKey} --yes${keepInventory ? '' : ' --all'}`);
  process.exit(0);
}

await fs.mkdir(archiveDir, {recursive: true});
for (const name of present) {
  await fs.rename(path.join(output, name), path.join(archiveDir, name));
}
if (!keepInventory) {
  const inventoryDir = path.join(output, 'inventory');
  if (await exists(inventoryDir)) await fs.rename(inventoryDir, path.join(archiveDir, 'inventory'));
}

console.log('');
console.log(`已归档到：${archiveDir}`);
console.log('进度已清空。下一步：');
if (!keepInventory) console.log('  npm run crawl                              # 重新采必修清单');
console.log(`  npm start -- --answer --execute --unit 1 --skip-banked-cloze --steps 40`);
console.log('想找回归档：把 archive 里的文件搬回上一级目录即可。');