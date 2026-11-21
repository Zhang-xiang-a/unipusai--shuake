// 把工作目录清理成"可以直接发出去"的状态。
//
// 这个项目跑起来会在本地留下五类东西，全都是**这台机器自己的**：
//
//   .env                         API key
//   config.json                  本机课程/路径配置
//   browser-profile/             Edge 的用户数据，含真实 cookies
//   logs/                        运行日志
//   artifacts/<courseKey>/       扫描结果和作答进度（可能含个人信息）
//
// 但它们同时也是程序正常运行需要的——尤其 browser-profile 就是 Edge 的
// profile 目录，删掉等于退出登录。所以只在**分发前**跑这个脚本。
//
// 用法：
//   node scripts/clean-dist.mjs              清掉上面五样，保留源码和脱敏清单
//   node scripts/clean-dist.mjs --dry-run    只列出来，不删
//   node scripts/clean-dist.mjs --keep-logs  保留日志（排查问题时用）
//
// 保留不动的东西：src/ test/ docs/ assets/ scripts/ node_modules/
//                 config.example.json .env.example courses.txt *.bat
//                 artifacts/course3/inventory/（如果那是脱敏过的清单）
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const keepLogs = argv.includes('--keep-logs');

const targets = [
  {rel: '.env',              why: 'API key'},
  {rel: 'config.json',       why: '本机配置'},
  {rel: 'browser-profile',   why: 'Edge 用户数据，含真实 cookies'},
  {rel: 'logs',              why: '运行日志', skip: keepLogs},
];

// artifacts 下每个课程目录都删（里面有扫描结果和作答进度）。
// 注意：故意不碰 artifacts/course3/inventory —— 那是脱敏清单，
// 留着可以让别人省一次扫描。要连它一起删就加 --purge-artifacts。
const artifactsDir = path.join(ROOT, 'artifacts');
if (fs.existsSync(artifactsDir)) {
  for (const name of fs.readdirSync(artifactsDir)) {
    const abs = path.join(artifactsDir, name);
    if (!fs.statSync(abs).isDirectory()) continue;
    const inventory = path.join(abs, 'inventory');
    if (fs.existsSync(inventory) && !argv.includes('--purge-artifacts')) {
      // 只删 course 目录下除 inventory 以外的东西
      for (const sub of fs.readdirSync(abs)) {
        if (sub === 'inventory') continue;
        targets.push({rel: path.join('artifacts', name, sub), why: '扫描结果/进度'});
      }
    } else {
      targets.push({rel: path.join('artifacts', name), why: '扫描结果/进度'});
    }
  }
}

const size = p => {
  const st = fs.statSync(p);
  if (!st.isDirectory()) return st.size;
  let total = 0;
  for (const e of fs.readdirSync(p, {withFileTypes: true})) {
    total += size(path.join(p, e.name));
  }
  return total;
};
const human = n => n < 1024 ? `${n} B`
  : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB`
  : `${(n / 1024 / 1024).toFixed(2)} MB`;

let removed = 0;
let bytes = 0;

console.log('');
for (const t of targets) {
  if (t.skip) { console.log(`  -  ${t.rel.padEnd(28)} 跳过`); continue; }
  const abs = path.join(ROOT, t.rel);
  if (!fs.existsSync(abs)) { console.log(`  -  ${t.rel.padEnd(28)} 不存在`); continue; }
  const s = size(abs);
  if (dryRun) {
    console.log(`  ?  ${t.rel.padEnd(28)} ${human(s).padStart(9)}  ${t.why}（没删，只是看看）`);
  } else {
    fs.rmSync(abs, {recursive: true, force: true});
    console.log(`  ✓  ${t.rel.padEnd(28)} ${human(s).padStart(9)}  ${t.why}`);
  }
  removed++;
  bytes += s;
}

console.log('');
if (!removed) {
  console.log('  已经是干净状态了，没什么可删的。');
} else if (dryRun) {
  console.log(`  以上 ${removed} 项共 ${human(bytes)}，加 --dry-run 去掉就真删。`);
} else {
  console.log(`  删掉 ${removed} 项，共 ${human(bytes)}。`);
  console.log('');
  console.log('  提醒：browser-profile 删掉后，下次运行要重新登录 U 校园（Edge 那边也会是全新 profile）。');
  console.log('  不想要这个后果，就把 --keep-logs 换成保留 browser-profile 的版本，或者直接删 .env / artifacts。');
}
console.log('');
