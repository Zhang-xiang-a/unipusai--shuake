// 预扫描：把书的题目清单提前采下来存好，之后刷课直接读，不用每次重新爬。
//
// 采集一次大概几分钟（185 个题目页），但只需要做一次——
// 同一本书之后再刷，直接读 artifacts/<couseKey>/inventory/ 就够了。
//
// 也支持一次扫多本（all），晚上挂着，白天直接刷。
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import {spawn, spawnSync as killSync} from 'node:child_process';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {ROOT_DIR, CONFIG_FILE, ARTIFACTS_DIR, INVENTORY_DIR} from './paths.mjs';
import {parseCourses, resolveChoice} from './switch-course.mjs';

const COURSES_FILE = path.join(ROOT_DIR, 'courses.txt');

const useColor = process.stdout.isTTY;
const paint = (c, t) => useColor ? `\x1b[${c}m${t}\x1b[0m` : t;
const bold = t => paint('1', t), dim = t => paint('2', t);
const green = t => paint('32', t), yellow = t => paint('33', t);
const red = t => paint('31', t), cyan = t => paint('36', t);

let rl;
let closingOnPurpose = false;
let activeChild = null;
let interrupted = false;

function makeReadline() {
  const i = readline.createInterface({input: process.stdin, output: process.stdout});
  i.on('close', () => {
    if (closingOnPurpose) return;
    console.log('\n  输入结束了，退出。');
    process.exit(0);
  });
  return i;
}
function closeReadline() { closingOnPurpose = true; rl?.close(); closingOnPurpose = false; }

const ask = q => rl.question(q);
const gap = () => console.log('');
const ok = t => console.log(green('  ✓ ') + t);
const warn = t => console.log(yellow('  ! ') + t);
const bad = t => console.log(red('  ✗ ') + t);
const info = t => console.log('  ' + t);

function hardKill(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  try {
    if (process.platform === 'win32') {
      killSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {stdio: 'ignore'});
    } else child.kill('SIGKILL');
  } catch {}
}
function stopNow() {
  hardKill(activeChild);
  process.stdout.write('\n  已停止。\n');
  process.exit(130);
}
process.on('SIGINT', () => { if (interrupted) return stopNow(); interrupted = true; process.stdout.write('\n\n  收到 Ctrl+C，正在停止……\n'); stopNow(); });
process.on('SIGBREAK', () => { interrupted = true; stopNow(); });

function runChild(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    rl?.pause();
    let child;
    try { child = spawn(command, args, {cwd: ROOT_DIR, stdio: 'inherit', ...options}); }
    catch (error) { rl?.resume(); reject(error); return; }
    activeChild = child;
    const settle = (code, error) => {
      activeChild = null;
      rl?.resume();
      if (interrupted) process.exit(130);
      if (error) reject(error); else resolve(code);
    };
    child.on('error', e => settle(null, e));
    child.on('exit', c => settle(c ?? 1, null));
  });
}

async function runNode(script, args = []) {
  return runChild(process.execPath, [path.join(ROOT_DIR, 'src', script), ...args], {env: process.env});
}

// ─────────────────────── 扫描结果 ───────────────────────

function scanFile(courseKey) {
  return path.join(ARTIFACTS_DIR, courseKey, 'scan-info.json');
}

/**
 * 读已有的扫描记录。返回 null 表示没有可用的结果。
 *
 * 不能只看文件在不在：采集被 Ctrl+C 打断会留下半截的 required-tasks.json，
 * 这种残次品如果当缓存用，刷课时会答到一半发现题目对不上。
 * 所以要求：能解析成非空数组，并且配套的 type-report.json 也在。
 */
export function readScan(courseKey) {
  const dir = path.join(ARTIFACTS_DIR, courseKey, 'inventory');
  const tasksFile = path.join(dir, 'required-tasks.json');
  const reportFile = path.join(dir, 'type-report.json');

  if (!fs.existsSync(tasksFile) || !fs.existsSync(reportFile)) return null;

  let tasks;
  try { tasks = JSON.parse(fs.readFileSync(tasksFile, 'utf8')); }
  catch { return null; }                      // 半截 JSON，直接当没有
  if (!Array.isArray(tasks) || tasks.length === 0) return null;

  // type-report 也要能解析，不然题型分类全空
  try {
    const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
    if (!report || typeof report.groups !== 'object') return null;
  } catch { return null; }

  const info = (() => {
    try { return JSON.parse(fs.readFileSync(scanFile(courseKey), 'utf8')); } catch { return null; }
  })();
  const stat = fs.statSync(tasksFile);

  return {
    courseKey,
    scannedAt: info?.scannedAt || stat.mtime.toISOString(),
    taskCount: tasks.length,
    unitCount: info?.unitCount ?? null,
    sizeBytes: stat.size,
  };
}

function writeScan(courseKey, {taskCount, unitCount}) {
  const file = scanFile(courseKey);
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, JSON.stringify({
    courseKey,
    scannedAt: new Date().toISOString(),
    taskCount,
    unitCount,
  }, null, 2) + '\n');
}

function humanAge(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.round(h / 24)} 天前`;
}

// ─────────────────────── 登录 ───────────────────────

async function waitLogin() {
  const {chromium} = await import('playwright');
  const config = (() => {
    try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; }
  })();
  const endpoint = config.browserEndpoint || 'http://127.0.0.1:9228';

  let browser;
  for (let i = 0; i < 6; i++) {
    try { browser = await chromium.connectOverCDP(endpoint); break; }
    catch { await new Promise(r => setTimeout(r, 2000)); }
  }
  if (!browser) throw new Error(`连不上专用浏览器（${endpoint}）。先运行 一键刷课.bat 里的打开浏览器，或 npm run browser。`);

  const context = browser.contexts()[0];
  info('正在等你登录……（最多 10 分钟）');

  const started = Date.now();
  while (Date.now() - started < 10 * 60 * 1000) {
    for (const page of context.pages()) {
      try {
        const has = await page.evaluate(() => !!localStorage.getItem('__token'));
        if (has) {
          process.stdout.write('\r' + ' '.repeat(34) + '\r');
          ok('已登录');
          return;
        }
      } catch {}
    }
    process.stdout.write(`\r  已等 ${Math.round((Date.now() - started) / 1000)} 秒…        `);
    await new Promise(r => setTimeout(r, 3000));
  }
  process.stdout.write('\r' + ' '.repeat(34) + '\r');
  throw new Error('等了 10 分钟还没检测到登录。');
}

// ─────────────────────── 主流程 ───────────────────────

async function main() {
  console.log('');
  console.log(cyan('  ╔' + '═'.repeat(54) + '╗'));
  console.log(cyan('  ║') + bold('         U 校园 · 预扫描（提前存好题目清单）             ') + cyan('║'));
  console.log(cyan('  ╚' + '═'.repeat(54) + '╝'));
  console.log('');
  info(dim('采集一次要几分钟，但只做一次。之后刷课直接读结果，不用再爬。'));
  gap();

  rl = makeReadline();

  try {
    const {courses} = parseCourses(fs.readFileSync(COURSES_FILE, 'utf8'));

    // 现状：哪本扫过、哪本没有
    info(bold('当前状态：'));
    courses.forEach((c, i) => {
      const scan = readScan(c.key);
      const mark = scan
        ? green(`已扫过 ${humanAge(scan.scannedAt)}`) + dim(`，${scan.taskCount} 个任务`)
        : yellow('还没扫过');
      console.log(`    ${i + 1}) ${c.label.padEnd(12)} ${mark}`);
    });
    const allScanned = courses.every(c => readScan(c.key));
    if (allScanned) {
      gap();
      info(dim('四本都扫过了。想刷新某一本选它的序号即可。'));
    }
    gap();

    // 选哪本
    info(dim('输序号选一本，输 all 全部扫一遍，直接回车跳过。'));
    gap();

    let targets = [];
    for (;;) {
      const answer = String(await ask('要扫哪本？')).trim();
      if (!answer) { closeReadline(); info('没选，退出。'); gap(); return; }
      if (/^(all|全部|都|4本|四本)$/i.test(answer)) { targets = courses.slice(); break; }
      const hit = resolveChoice(answer, courses);
      if (hit && !hit.notFound && !hit.ambiguous && hit.id) { targets = [hit]; break; }
      if (hit?.notFound || hit?.ambiguous) { warn(`没找到「${answer}」，输序号最快。`); continue; }
      if (hit && !hit.id) { warn(`${hit.label} 的课程资源 ID 还是空的，先填 courses.txt。`); continue; }
    }

    // 开浏览器
    gap();
    info(bold(`要扫 ${targets.length} 本：${targets.map(t => t.label).join('、')}`));
    gap();
    await ask('准备好了按回车，先打开浏览器……');
    await runNode('browser.mjs', []);
    await waitLogin();

    // 逐本采集
    const results = [];
    for (const [index, course] of targets.entries()) {
      gap();
      console.log(cyan('─'.repeat(58)));
      info(bold(`[${index + 1}/${targets.length}] ${course.label}`));
      console.log(cyan('─'.repeat(58)));

      const before = readScan(course.key);
      if (before) info(dim(`已有扫描：${humanAge(before.scannedAt)}，${before.taskCount} 个任务（本次覆盖）`));

      const startedAt = Date.now();
      // --quiet 关掉逐条清单
      const setupCode = await runNode('runner.mjs', ['--setup', '--course', course.key, '--quiet']);
      if (setupCode !== 0) { bad('登录态没保存成功，跳过这本'); results.push({course, ok: false, reason: '登录态保存失败'}); continue; }

      const crawlCode = await runNode('runner.mjs', ['--crawl', '--course', course.key, '--quiet']);
      if (crawlCode !== 0) { bad('采集失败'); results.push({course, ok: false, reason: `采集失败（退出码 ${crawlCode}）`}); continue; }

      const scan = readScan(course.key);
      const seconds = Math.round((Date.now() - startedAt) / 1000);
      if (scan) {
        writeScan(course.key, {taskCount: scan.taskCount, unitCount: scan.unitCount});
        ok(`${course.label}：${scan.taskCount} 个任务，用时 ${seconds} 秒`);
        results.push({course, ok: true, taskCount: scan.taskCount, seconds});
      } else {
        bad('采集跑完了但没找到清单文件');
        results.push({course, ok: false, reason: '清单文件缺失'});
      }
    }

    closeReadline();
    rl = makeReadline();

    // 汇总
    gap();
    console.log(cyan('═'.repeat(58)));
    console.log(cyan(bold('  扫描结果')));
    console.log(cyan('═'.repeat(58)));
    gap();
    for (const r of results) {
      if (r.ok) {
        info(`${green('✓')} ${r.course.label.padEnd(12)} ${r.taskCount} 个任务，${r.seconds} 秒`);
      } else {
        info(`${red('✗')} ${r.course.label.padEnd(12)} ${r.reason}`);
      }
    }
    gap();
    const good = results.filter(r => r.ok);
    if (good.length) {
      ok(`存好了。回去双击 一键刷课.bat，选这本课会直接读结果，不用再等采集。`);
      info(dim(`记录在：${path.relative(ROOT_DIR, ARTIFACTS_DIR)}\\<课程>\\scan-info.json`));
    }
    const failed = results.filter(r => !r.ok);
    if (failed.length) {
      gap();
      warn('有失败项。常见原因：登录掉了、课程 ID 不对、网络断。');
      info(dim('修好后重新跑本脚本，只扫失败的那本就行（会覆盖旧的）。'));
    }
    gap();
  } catch (error) {
    gap();
    console.log(red('━'.repeat(58)));
    console.log(red('  出错了'));
    console.log(red('━'.repeat(58)));
    gap();
    for (const line of String(error.message || error).split('\n')) console.log('  ' + line);
    gap();
    process.exitCode = 1;
  } finally {
    closeReadline();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}