// 一键刷课向导：给完全没接触过命令行的人用。
//
// 五步：
//   1. 环境检查（Node 版本、依赖、配置文件）
//   2. 选课程
//   3. 填模型（apikey / model / base_url）
//   4. 登录 → 自检 → 刷课 → 统计
//   5. 问要不要挂机刷时长 → 祝福
//
// 设计原则：
//   - 每一步都能重跑，中途按 Ctrl+C 不会把配置搞坏
//   - 出错说人话，不甩堆栈
//   - 子进程继承 stdio，输出实时可见
//   - 不关闭用户的 Edge（connectOverCDP 之后绝不调用 browser.close()）
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
// spawn 跑长时间子进程（Ctrl+C 能打断），spawnSync 只用于 taskkill 收尾。
import {spawn, spawnSync} from 'node:child_process';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {ROOT_DIR, CONFIG_FILE, CONFIG_EXAMPLE_FILE, ARTIFACTS_DIR, SESSION_FILE} from './paths.mjs';
import {parseCourses, resolveChoice} from './switch-course.mjs';
import {readScan} from './prescan.mjs';

const COURSES_FILE = path.join(ROOT_DIR, 'courses.txt');
const ENV_FILE = path.join(ROOT_DIR, '.env');

// ─────────────────────────── 终端交互 ───────────────────────────

const useColor = process.stdout.isTTY;
const paint = (code, text) => useColor ? `\x1b[${code}m${text}\x1b[0m` : text;
const bold = t => paint('1', t);
const dim = t => paint('2', t);
const green = t => paint('32', t);
const yellow = t => paint('33', t);
const red = t => paint('31', t);
const cyan = t => paint('36', t);

let rl;
let closingOnPurpose = false;

/** 建一个 readline。stdin 意外结束时友好退出，不要让 process 卡在 await 上。 */
function makeReadline() {
  const iface = readline.createInterface({input: process.stdin, output: process.stdout});
  iface.on('close', () => {
    if (closingOnPurpose) return;
    gap();
    warn('输入结束了，向导退出。已经做过的步骤都保存了。');
    gap();
    process.exit(0);
  });
  return iface;
}
function closeReadline() {
  closingOnPurpose = true;
  rl?.close();
  closingOnPurpose = false;
}

function ask(question) {
  return rl.question(question);
}
async function askYesNo(question, fallback = false) {
  const hint = fallback ? '（直接回车=是）' : '（直接回车=否）';
  const answer = String(await ask(`${question} ${hint} `)).trim().toLowerCase();
  if (!answer) return fallback;
  return ['y', 'yes', '是', '要', '好', '1', '刷', '行'].includes(answer);
}
async function askUntil(question, validate) {
  for (;;) {
    const value = String(await ask(question)).trim();
    const verdict = validate(value);
    if (verdict === true) return value;
    console.log(yellow('  ' + (verdict || '这个值看起来不对，再来一次')));
  }
}

function banner(step, total, title) {
  console.log('');
  console.log(cyan('━'.repeat(58)));
  console.log(cyan(` 第 ${step}/${total} 步  ${bold(title)}`));
  console.log(cyan('━'.repeat(58)));
}
function ok(text) { console.log(green('  ✓ ') + text); }
function warn(text) { console.log(yellow('  ! ') + text); }
function bad(text) { console.log(red('  ✗ ') + text); }
function info(text) { console.log('  ' + text); }
function gap() { console.log(''); }

// ─────────────────────── 子进程（继承 stdio）───────────────────────

// spawnSync 会阻塞事件循环，Ctrl+C 期间 Node 收不到任何信号，看起来就是「按了没用」。
// 所以一律用异步 spawn，并记录当前子进程，收到 SIGINT 时连子进程一起收掉。
let activeChild = null;
let interrupted = false;

function hardKill(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  try {
    if (process.platform === 'win32') {
      // Windows 上 kill('SIGINT') 不可靠，taskkill /T 才能带走整棵子进程树。
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {stdio: 'ignore'});
    } else {
      child.kill('SIGKILL');
    }
  } catch { /* 进程可能已经自己退了 */ }
}

function stopNow() {
  // taskkill 是同步的，杀完再退；不留 setTimeout，否则用户会觉得「按了没反应」。
  hardKill(activeChild);
  process.stdout.write('\n  已停止。进度都存着，下次双击就能接着刷。\n');
  process.exit(130);
}

process.on('SIGINT', () => {
  if (interrupted) return stopNow();   // 连按两次立刻走
  interrupted = true;
  process.stdout.write('\n\n  收到 Ctrl+C，正在停止……\n');
  stopNow();
});

// Windows 上 Ctrl+Break 走的是 SIGBREAK，顺手也接住。
process.on('SIGBREAK', () => { interrupted = true; stopNow(); });

/** 异步跑一个子进程，返回退出码。Ctrl+C 时会被 SIGINT 处理器打断。 */
function runChild(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    rl?.pause();
    let child;
    try {
      child = spawn(command, args, {cwd: ROOT_DIR, stdio: 'inherit', ...options});
    } catch (error) {
      rl?.resume();
      reject(error);
      return;
    }
    activeChild = child;
    const settle = (code, error) => {
      activeChild = null;
      rl?.resume();
      // Ctrl+C 会同时发给父进程和子进程。子进程自己退了会触发这里，
      // 如果不检查 interrupted，就会被当成「子进程正常结束」，
      // 父进程接着做下一步——表现就是「按了 Ctrl+C 它还在跑」。
      if (interrupted) process.exit(130);
      if (error) reject(error);
      else resolve(code);
    };
    child.on('error', error => settle(null, error));
    child.on('exit', code => settle(code ?? 1, null));
  });
}

/**
 * 跑一个项目内的 node 脚本。用 process.execPath 而不是 'node'，
 * 这样用的是当前运行的这个 Node（可能是 runtime\node\node.exe）。
 */
async function runNode(script, args = [], {allowFail = false, label = ''} = {}) {
  const full = path.join(ROOT_DIR, 'src', script);
  if (!fs.existsSync(full)) throw new Error(`缺少脚本 src/${script}，发行包可能不完整`);
  gap();
  const status = await runChild(process.execPath, [full, ...args], {env: process.env});
  gap();
  if (status !== 0 && !allowFail) {
    throw new Error(`${label || script} 执行失败（退出码 ${status}）。上面的输出里有具体原因。`);
  }
  return status;
}

async function runNpm(args, {allowFail = false, label = ''} = {}) {
  gap();
  const status = await runChild('npm', args, {
    shell: true,
    env: {...process.env, npm_config_yes: 'true'},
  });
  gap();
  if (status !== 0 && !allowFail) {
    throw new Error(`${label || 'npm ' + args.join(' ')} 执行失败（退出码 ${status}）`);
  }
  return status;
}

// 便于测试：直接验证 runChild 能不能真的起子进程。
export {runChild, runNode};

// ───────────────────────────── 配置读写 ─────────────────────────────

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch { return fallback; }
}
function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}
function readEnv() {
  const out = {};
  if (!fs.existsSync(ENV_FILE)) return out;
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}
function writeEnv(values) {
  const lines = [
    '# 由「一键刷课」向导生成。这个文件含密钥，不要发给别人。',
    '',
    `OPENAI_API_KEY=${values.key}`,
    `OPENAI_MODEL=${values.model}`,
  ];
  if (values.baseUrl) lines.push(`OPENAI_BASE_URL=${values.baseUrl}`);
  fs.writeFileSync(ENV_FILE, lines.join('\n') + '\n');
}
function maskKey(key) {
  if (!key) return '(没填)';
  if (key.length <= 12) return key.slice(0, 3) + '***';
  return key.slice(0, 6) + '…' + key.slice(-4);
}

/**
 * 试一次模型接口，把「key 错 / base_url 错 / 模型名错」在进刷课前就查出来。
 * 先走 GET /models（不花 token）；中转站没实现这个接口，再退到一次极小的对话请求。
 */
export async function testModel(env) {
  const baseUrl = String(env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const key = env.OPENAI_API_KEY;
  const model = env.OPENAI_MODEL;
  const headers = {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'};

  const fail = reason => ({ok: false, reason});

  // ── 1. GET /models（不花 token）──
  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: {Authorization: `Bearer ${key}`},
      signal: AbortSignal.timeout(20000),
    });
    if (res.status === 401 || res.status === 403) {
      return fail(`密钥被拒绝（HTTP ${res.status}）。检查 API Key 是否复制完整、有没有过期。`);
    }
    if (res.ok) {
      let ids = [];
      try {
        const data = await res.json();
        ids = (data.data || data.models || []).map(m => m.id || m.name).filter(Boolean);
      } catch {}
      if (ids.length && !ids.includes(model)) {
        // 中转站经常给模型改名，这里只提醒不阻断
        return {ok: true, warning: `接口通，但模型列表里没有「${model}」。可用示例：${ids.slice(0, 6).join(', ')}`};
      }
      return {ok: true, models: ids.length};
    }
    // 404 说明没实现 /models，往下走对话测试；其余状态也先试对话
  } catch (error) {
    if (error.name === 'TimeoutError') return fail('连接接口超时。检查网络，或 base_url 是否写错。');
    // 网络层失败：可能是域名错，也可能只是不支持 /models，交给下面的对话测试判断
  }

  // ── 2. 极小对话请求 ──
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [{role: 'user', content: 'hi'}],
        max_tokens: 1,
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (res.ok) return {ok: true};

    const text = await res.text().catch(() => '');
    let detail = text.slice(0, 200);
    try {
      const json = JSON.parse(text);
      detail = json.error?.message || json.message || detail;
    } catch {}

    if (res.status === 401 || res.status === 403) {
      return fail(`密钥被拒绝（HTTP ${res.status}）：${detail}`);
    }
    if (res.status === 404) {
      return fail(`找不到接口（HTTP 404）。base_url 大概写错了，正确形式类似 https://xxx.com/v1`);
    }
    if (res.status === 400 || res.status === 422) {
      return fail(`请求被拒（HTTP ${res.status}）：${detail}\n这通常是模型名不对，或者这个模型不支持对话接口。`);
    }
    if (res.status === 429) {
      return {ok: true, warning: '接口返回限流（429），说明 key 和地址是对的，但额度可能快用完了。'};
    }
    return fail(`接口返回 HTTP ${res.status}：${detail}`);
  } catch (error) {
    if (error.name === 'TimeoutError') return fail('对话请求超时。网络问题，或 base_url 指向的地址不响应。');
    return fail(`连不上 ${baseUrl}：${error.message}\n检查 base_url 是否写对（要带 /v1 这类路径），以及网络。`);
  }
}

// ───────────────────────── 第 1 步：环境 ─────────────────────────

async function stepEnv() {
  banner(1, 5, '检查运行环境');

  const major = Number(process.version.replace(/^v/, '').split('.')[0]);
  if (major < 20) {
    bad(`当前 Node.js 是 ${process.version}，太旧了（需要 20 以上）`);
    info('关掉窗口，重新双击 一键刷课.bat，它会自动装新的。');
    throw new Error('Node 版本不满足要求');
  }
  ok(`Node.js ${process.version}`);

  // 依赖
  const hasPlaywright = fs.existsSync(path.join(ROOT_DIR, 'node_modules', 'playwright'));
  if (!hasPlaywright) {
    warn('还没装依赖，现在开始装（第一次会下载 Chromium 驱动，可能几分钟）');
    const status = await runNpm(['install'], {allowFail: true, label: '依赖安装'});
    if (status !== 0) {
      warn('默认源装失败了，换国内镜像再试一次');
      const retry = await runNpm(['install', '--registry=https://registry.npmmirror.com'], {allowFail: true, label: '镜像重试'});
      if (retry !== 0) {
        bad('依赖还是装不上');
        info('检查一下网络，然后重新双击 一键刷课.bat。');
        throw new Error('依赖安装失败');
      }
    }
  }
  if (!fs.existsSync(path.join(ROOT_DIR, 'node_modules', 'playwright'))) {
    throw new Error('装完依赖后仍然找不到 playwright');
  }
  ok('依赖齐全');

  // 配置文件
  if (!fs.existsSync(CONFIG_FILE)) {
    if (!fs.existsSync(CONFIG_EXAMPLE_FILE)) throw new Error('config.example.json 不见了，发行包不完整');
    fs.copyFileSync(CONFIG_EXAMPLE_FILE, CONFIG_FILE);
    ok('已从模板生成 config.json');
  } else {
    ok('config.json 存在');
  }

  // 依赖装好后 playwright 才可用，这里是第一次真正加载它
  const config = readJson(CONFIG_FILE, {});
  if (!config.courses) throw new Error('config.json 里没有 courses 分组，删掉它重新双击 一键刷课.bat');
}

// ──────────────────────── 第 2 步：选课程 ────────────────────────

async function stepCourse() {
  banner(2, 5, '选这次要刷的课');

  if (!fs.existsSync(COURSES_FILE)) {
    throw new Error(`找不到 courses.txt（应该在 ${ROOT_DIR}）`);
  }
  const {courses, errors} = parseCourses(fs.readFileSync(COURSES_FILE, 'utf8'));
  if (errors.length) {
    warn('courses.txt 里有几行格式不对，已跳过：');
    errors.forEach(e => info(dim(e)));
  }
  if (!courses.length) throw new Error('courses.txt 里没有可用的课程行');

  const config = readJson(CONFIG_FILE, {});
  const current = config.activeCourse;

  gap();
  info(bold('可选课程：'));
  courses.forEach((c, i) => {
    const mark = c.key === current ? green('  ← 上次用的') : '';
    const id = c.id ? dim(c.id) : yellow('ID 还没填');
    console.log(`    ${i + 1}) ${c.label.padEnd(12)} ${id}${mark}`);
  });
  gap();
  info(dim('输入序号就行，比如 3。输错了可以直接重来。'));
  gap();

  let picked;
  for (;;) {
    const answer = await ask('这次刷哪本？');
    if (!String(answer).trim()) {
      // 没输就沿用上次的
      picked = courses.find(c => c.key === current);
      if (picked && picked.id) break;
      warn('没说刷哪本，而且上次那本没有记录。');
      continue;
    }
    const hit = resolveChoice(answer, courses);
    if (hit && !hit.notFound && !hit.ambiguous) {
      if (!hit.id) {
        gap();
        bad(`${hit.label} 的课程资源 ID 还是空的`);
        info('做法：在浏览器里登进 U 校园，点开这门课，');
        info('      把地址栏 resource-detail/ 后面那串数字填进 courses.txt 对应那行。');
        info(`文件：${COURSES_FILE}`);
        gap();
        continue;
      }
      picked = hit;
      break;
    }
    if (hit?.ambiguous) {
      warn('匹配到好几门，说得具体一点：');
      hit.ambiguous.forEach(c => info(`  ${c.key}  ${c.label}`));
    } else {
      warn(`没找到「${answer}」，输序号最快。`);
    }
  }

  // three things must be written, or the run quietly does the wrong thing:
  //   courseId           —— config.example.json ships "<COURSE_ID_1>" placeholders,
  //                         leaving them in breaks every URL that uses {courseId}
  //   courseResourceId   —— what resource-detail/ actually needs
  //   dryRun = false     —— the template ships true; leaving it true means the whole
  //                         run answers/uploads/comments nothing and reports success
  config.activeCourse = picked.key;
  config.courses[picked.key].courseId = picked.id;
  config.courses[picked.key].courseResourceId = picked.id;
  config.dryRun = false;
  if (!config.courses[picked.key].courseUrl) {
    config.courses[picked.key].courseUrl = 'https://uai.unipus.cn/app/cmgt/resource-detail/{courseId}';
  }
  writeJson(CONFIG_FILE, config);

  gap();
  ok(`已选：${bold(picked.label)}`);
  info(dim(`课程地址：https://uai.unipus.cn/app/cmgt/resource-detail/${picked.id}`));
  return {courseKey: picked.key, courseLabel: picked.label, resourceId: picked.id};
}

// ─────────────────────── 第 3 步：模型配置 ───────────────────────

async function stepModel() {
  banner(3, 5, '配置答题用的模型');

  const existing = readEnv();
  gap();
  info('脚本要靠 AI 模型读题作答，需要你提供三样东西：');
  info(dim('  1. API Key    —— 一串 sk- 开头的密钥'));
  info(dim('  2. 模型名字   —— 比如 deepseek-chat、gpt-4o-mini'));
  info(dim('  3. 接口地址   —— 服务商给你的 base_url，官方可留空'));
  gap();

  if (existing.OPENAI_API_KEY) {
    info(`当前已配置：${bold(maskKey(existing.OPENAI_API_KEY))}  模型 ${bold(existing.OPENAI_MODEL || '未填')}`);
    if (existing.OPENAI_BASE_URL) info(dim(`接口 ${existing.OPENAI_BASE_URL}`));
    gap();
    if (await askYesNo('继续用这套配置？', true)) {
      // 沿用的也测一次：key 可能过期了，早点发现比刷到一半炸好
      info('正在试一下这个配置能不能用……');
      const probe = await testModel(existing);
      if (probe.ok) {
        if (probe.warning) warn(probe.warning);
        else ok('配置可用');
        return existing;
      }
      gap();
      bad('这套配置用不了：');
      for (const line of probe.reason.split('\n')) info('  ' + line);
      gap();
      info('重新填一次吧。');
      gap();
    } else {
      gap();
    }
  }

  const key = await askUntil('API Key（粘贴后回车）：', v => {
    if (!v) return '不能空着';
    if (v.length < 16) return '这个太短了，Key 一般 30 位以上，检查是不是复制漏了';
    if (/[\s]/.test(v)) return '中间有空格，重新复制一次';
    return true;
  });

  const model = await askUntil('模型名字（例如 deepseek-chat）：', v => {
    if (!v) return '不能空着';
    if (/[\s]/.test(v)) return '模型名里不该有空格';
    return true;
  });

  gap();
  info(dim('接口地址：用官方服务或不确定就直接回车。'));
  info(dim('  中转站/自建服务才需要填，形如 https://xxx.com/v1'));
  const baseUrlRaw = String(await ask('接口地址（可留空）：')).trim();
  let baseUrl = '';
  if (baseUrlRaw) {
    if (!/^https?:\/\//i.test(baseUrlRaw)) {
      warn('没写 http(s)://，已自动补上 https://');
      baseUrl = 'https://' + baseUrlRaw;
    } else {
      baseUrl = baseUrlRaw;
    }
    baseUrl = baseUrl.replace(/\/+$/, '');
  }

  writeEnv({key, model, baseUrl});
  gap();
  ok('已写入 .env（这个文件含密钥，别发给别人）');
  info(dim(`Key ${maskKey(key)}   模型 ${model}${baseUrl ? '   接口 ' + baseUrl : ''}`));

  // 填完先试一次，别等刷到一半才发现 key 不能用
  gap();
  info('正在试一下这个配置能不能用……');
  const probe = await testModel({OPENAI_API_KEY: key, OPENAI_MODEL: model, OPENAI_BASE_URL: baseUrl});
  if (probe.ok) {
    if (probe.warning) warn(probe.warning);
    else ok('配置可用，模型能正常回应');
  } else {
    gap();
    bad('这个配置用不了：');
    for (const line of probe.reason.split('\n')) info('  ' + line);
    gap();
    if (await askYesNo('要重新填一次吗？（选否=先这样，稍后再说）', true)) {
      return stepModel();
    }
    warn('先记着这个问题，刷课时大概率会失败。');
  }

  return {OPENAI_API_KEY: key, OPENAI_MODEL: model, OPENAI_BASE_URL: baseUrl};
}

// ──────────────────── 第 4 步：登录 → 自检 → 刷课 ────────────────────

let currentCourseKey = 'course3';

/** 打开专用 Edge，然后等用户在里面登录 U 校园。 */
async function stepLogin(config) {
  gap();
  info(bold('现在会打开一个 Edge 窗口，请在里面完成两件事：'));
  info('  1. 登录 U 校园（账号密码你自己输，脚本不碰）');
  info('  2. 登录成功、能看到「我的教程」就算完成');
  gap();
  info(dim('窗口标题会是「U校园」。登录好之后不用关窗口，脚本会自动检测。'));
  gap();
  await ask('准备好了就按回车，脚本开始打开浏览器…');

  await runNode('browser.mjs', [], {allowFail: true, label: '启动浏览器'});

  const {chromium} = await import('playwright');
  const endpoint = config.browserEndpoint || 'http://127.0.0.1:9228';

  // Edge 刚起来时调试端口可能还没监听，重试几次再判定失败。
  let browser;
  let lastError;
  for (let i = 0; i < 6; i++) {
    try {
      browser = await chromium.connectOverCDP(endpoint);
      break;
    } catch (error) {
      lastError = error;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  if (!browser) {
    throw new Error(`连不上专用浏览器（${endpoint}）：${lastError?.message || '未知错误'}\n` +
      '再双击一次 一键刷课.bat 通常就好了。');
  }

  const context = browser.contexts()[0];

  gap();
  info('正在等你登录……（每 3 秒检查一次，最多等 10 分钟）');

  const started = Date.now();
  const timeoutMs = 10 * 60 * 1000;
  let loggedIn = false;
  let who = '';

  while (Date.now() - started < timeoutMs) {
    // 每轮重新取页面列表：用户可能在等待期间新开了标签页，只用启动时的快照会漏掉。
    for (const page of context.pages()) {
      try {
        const state = await page.evaluate(() => {
          const token = localStorage.getItem('__token');
          if (!token) return {has: false};
          let name = '';
          try {
            const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
            name = payload.name || payload.nickName || payload.nickname || payload.userName
              || payload.realName || payload.account || payload.sub || '';
          } catch {}
          return {has: true, name: String(name || '')};
        });
        if (state.has) {
          loggedIn = true;
          who = state.name;
          break;
        }
      } catch { /* 页面还在跳转，下一轮再试 */ }
    }
    if (loggedIn) break;
    const waited = Math.round((Date.now() - started) / 1000);
    process.stdout.write(`\r  已等 ${waited} 秒…        `);
    await new Promise(r => setTimeout(r, 3000));
  }
  process.stdout.write('\r' + ' '.repeat(30) + '\r');

  // 关键：connectOverCDP 之后绝不 close，否则会把用户的窗口关掉
  if (!loggedIn) {
    throw new Error('等了 10 分钟还没检测到登录。\n' +
      '  在浏览器窗口里登录一次 U 校园，然后重新双击 一键刷课.bat。');
  }

  ok('登录成功');
  if (who) info(dim(`账号：${who}`));
  return who || 'unknown';
}

/** 存档归属：同一本书同一个账号才自动接着上次刷。 */
async function checkSaveOwnership(courseKey, who) {
  const dir = path.join(ARTIFACTS_DIR, courseKey);
  const marker = path.join(dir, '.save-user');
  const progressFile = path.join(dir, 'answer-progress.json');
  const hasProgress = fs.existsSync(progressFile);

  if (!hasProgress) return {mode: 'fresh'};

  const previous = fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8').trim() : '';

  if (!previous) {
    fs.mkdirSync(dir, {recursive: true});
    fs.writeFileSync(marker, who);
    return {mode: 'adopt'};
  }
  if (previous === who) return {mode: 'resume'};

  gap();
  warn(`这本书的存档属于另一个账号（${previous}），当前是 ${who}。`);
  info('接着刷会把两个人的进度混在一起。');
  gap();
  if (await askYesNo('要把旧存档归档、从 0 开始刷吗？（选否=仍接着旧进度）', true)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const archiveDir = path.join(dir, 'archive');
    fs.mkdirSync(archiveDir, {recursive: true});
    for (const name of ['answer-progress.json', 'last-run-summary.json', 'checkpoint.json']) {
      const from = path.join(dir, name);
      if (fs.existsSync(from)) fs.renameSync(from, path.join(archiveDir, `${name}.${stamp}.bak`));
    }
    fs.writeFileSync(marker, who);
    ok('旧存档已归档，从头开始');
    return {mode: 'archived'};
  }
  fs.writeFileSync(marker, who);
  return {mode: 'resume'};
}

/** 从存档里统计：完成多少、失败在哪、学习时长多久。 */
export function summarize(courseKey, startedAt, baseDir) {
  const dir = path.join(baseDir || ARTIFACTS_DIR, courseKey);
  const progress = readJson(path.join(dir, 'answer-progress.json'), {tasks: {}}) || {tasks: {}};
  const summary = readJson(path.join(dir, 'last-run-summary.json'), null);
  const inventory = readJson(path.join(dir, 'inventory', 'required-tasks.json'), null);

  const tasks = progress.tasks || {};
  const entries = Object.entries(tasks);

  let learned = 0;
  let submitted = 0;
  let failed = 0;
  let learningSeconds = 0;
  const failedList = [];

  for (const [key, value] of entries) {
    const status = value?.status || '';
    if (status === 'learned') learned++;
    else if (status === 'submitted') submitted++;
    else if (status === 'failed') {
      failed++;
      failedList.push({key, reason: value?.reason || value?.evidence?.reason || '没有记录原因'});
    }
    const sec = Number(value?.evidence?.elapsedSeconds || 0);
    if (Number.isFinite(sec)) learningSeconds += sec;
  }

  // 把 key 还原成好读的路径：[3,"Unit project","Unit project"] → Unit 3 / Unit project
  const prettyKey = key => {
    try {
      const arr = JSON.parse(key);
      if (!Array.isArray(arr)) return key;
      const [unit, ...rest] = arr;
      return `Unit ${unit} / ${rest.join(' / ')}`;
    } catch { return key; }
  };

  // last-run-summary 里的 pending 更接近「这一轮没做成的」
  const pending = Array.isArray(summary?.pending) ? summary.pending : [];
  const pendingList = pending.map(p => ({
    where: `Unit ${p.unit} / ${(p.path || []).join(' / ')}`,
    status: p.status || '',
    reason: p.reason || '',
  }));

  const total = Array.isArray(inventory) ? inventory.length : entries.length;
  const done = learned + submitted;
  const wallSeconds = Math.round((Date.now() - startedAt) / 1000);

  return {
    total, done, learned, submitted, failed,
    learningSeconds, wallSeconds,
    failedList: failedList.map(f => ({where: prettyKey(f.key), reason: f.reason})),
    pendingList,
  };
}

export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h} 小时 ${m} 分`;
  if (m) return `${m} 分 ${sec} 秒`;
  return `${sec} 秒`;
}

/** 相对时间，给「多久前扫的」用。 */
function humanAge(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.round(h / 24)} 天前`;
}

/**
 * 采集任务清单，但先看有没有存过的结果。
 * 同一本书的清单不会天天变，每次重爬几分钟纯属浪费。
 */
async function crawlWithCache(courseKey, label) {
  const scan = readScan(courseKey);

  if (scan) {
    gap();
    info(`这本书之前扫过了：${bold(humanAge(scan.scannedAt))}，${scan.taskCount ?? '?'} 个任务`);
    info(dim('清单不会天天变，直接用能省几分钟。'));
    gap();
    if (await askYesNo('直接读这份结果？', true)) {
      ok('用已存的结果，跳过采集');
      return true;
    }
    gap();
    info(dim('重新扫一遍，大概几分钟。'));
  } else {
    gap();
    info(bold(`第一次刷 ${label}，要先采集题目清单`));
    info(dim('几分钟，之后就不用再等了。'));
  }

  const status = await runNode('runner.mjs', ['--crawl', '--course', courseKey, '--quiet'],
    {allowFail: true, label: '采集'});

  if (status !== 0) return false;
  ok('采集完成');
  return true;
}

async function stepRun(course, config) {
  banner(4, 5, '登录 → 自检 → 开始刷课');

  currentCourseKey = course.courseKey;
  const who = await stepLogin(config);

  const save = await checkSaveOwnership(course.courseKey, who);
  if (save.mode === 'resume') ok('检测到这个账号刷过这本书，接着上次的进度继续');
  if (save.mode === 'adopt') ok('沿用已有进度');
  if (save.mode === 'fresh') ok('这本书是第一次刷，从 Unit 1 开始');

  // 自检三步：setup 存登录态，crawl 采集清单，audit 看缺口
  gap();
  info(bold('开始自检'));
  info(dim('第一步：把登录态存下来，这样下次不用重新登'));
  const setupStatus = await runNode('runner.mjs', ['--setup'], {allowFail: true, label: '登录态保存'});
  if (setupStatus !== 0) {
    gap();
    bad('登录态没保存成功。');
    info('常见原因：只登了「我的教程」那一页，没进课程页。');
    info('回到那个 Edge 窗口，把这本书点开、看到单元列表，然后重新双击 一键刷课.bat。');
    throw new Error('登录态保存失败，先不往下跑');
  }
  ok('登录态已保存');

  gap();
  const startedAt = Date.now();

  info(bold('第二步：拿到这本书的题目清单'));
  const crawled = await crawlWithCache(course.courseKey, course.courseLabel);
  if (!crawled) {
    gap();
    bad('采集没成功。最常见的原因是：浏览器里登录掉了，或者课程 ID 不对。');
    info('先确认专用 Edge 里能看到这本书的单元列表，然后重新双击 一键刷课.bat。');
    throw new Error('采集失败，无法继续刷课');
  }

  gap();
  info(bold('开始刷课。可以最小化窗口去做别的事，不要关掉。'));
  info(dim('想中途停：在这个黑窗口里按 Ctrl+C，进度会存下来，下次接着刷。'));
  gap();

  // --audit --fix 不带 --unit，等于整本书从 Unit 1 扫到最后一章。
  // --fix 自己会补上 --answer --execute --only-missing，不用手写。
  await runNode('runner.mjs', ['--audit', '--fix'], {allowFail: true, label: '刷课'});

  // 再核一遍还差多少
  gap();
  info(bold('复查一遍还有没有漏的'));
  await runNode('runner.mjs', ['--audit'], {allowFail: true, label: '复查'});

  const stats = summarize(course.courseKey, startedAt);
  return {...stats, who};
}

// ───────────────────── 第 5 步：挂机刷时长 ─────────────────────

async function stepWatch() {
  banner(5, 5, '要不要挂机刷时长');

  gap();
  info('U 校园的「学习时长」需要页面一直开着才会涨。');
  info('挂机模式会定时翻页、自动续期，把时长刷够。');
  info(dim('目标时长在 config.json 的 watch 里能改，默认 20 小时。'));
  gap();

  if (!await askYesNo('现在就开始挂机刷时长吗？', false)) {
    ok('跳过挂机');
    return;
  }

  gap();
  info(bold('挂机开始了。保持这个窗口开着、电脑不睡眠，刷够时长会自动停。'));
  info(dim('想停就按 Ctrl+C，已刷的时长会记录下来，下次接着刷。'));
  gap();
  await runNode('watch.mjs', [], {allowFail: true, label: '挂机刷时长'});
}

// ───────────────────────────── 报告 ─────────────────────────────

function printReport(course, stats, who, {previewMode = false} = {}) {
  gap();
  console.log(cyan('═'.repeat(58)));
  console.log(cyan(bold('  本次刷课结果')));
  console.log(cyan('═'.repeat(58)));
  gap();
  info(`课程：${bold(course.courseLabel)}`);
  if (who && who !== 'unknown') info(dim(`账号：${who}`));
  gap();
  info(`这次总共花了：${bold(formatDuration(stats.wallSeconds))}`);
  if (stats.learningSeconds > 0) {
    info(`其中视频/阅读学满：${bold(formatDuration(stats.learningSeconds))}`);
  }
  gap();
  if (previewMode) {
    // 刷时长只看 preview 这一小块，报总任务数没意义
    const previewDone = stats.learned;
    info(`这次刷的是 ${bold('1-6 单元的 preview')}，共 12 个任务`);
    info(`  已学完：${green(bold(String(previewDone)))} 个`);
    info(dim('  学习时长会累加到课程的「必修学习时长」里。'));
    gap();
  } else {
  info(`必做任务：${bold(String(stats.total))} 个`);
  info(`  已完成：${green(bold(String(stats.done)))} 个` + dim(`（答题 ${stats.submitted}，学习 ${stats.learned}）`));
  if (stats.failed > 0) {
    info(`  没成功：${red(bold(String(stats.failed)))} 个`);
  } else if (stats.done >= stats.total - 1) {
    info(`  ${green('全部搞定')}`);
  }
  gap();
  }

  const problems = [];
  for (const f of stats.failedList) {
    problems.push({where: f.where, reason: f.reason});
  }
  for (const p of stats.pendingList) {
    if (!problems.some(x => x.where === p.where)) {
      problems.push({where: p.where, reason: p.reason || p.status});
    }
  }

  if (problems.length) {
    console.log(red('  没刷完的位置：'));
    gap();
    problems.slice(0, 30).forEach((p, i) => {
      console.log(`   ${i + 1}. ${bold(p.where)}`);
      console.log(`      ${dim('原因')}：${p.reason}`);
    });
    if (problems.length > 30) {
      gap();
      info(dim(`……还有 ${problems.length - 30} 处，完整清单在：`));
      info(dim(`  ${path.join(ARTIFACTS_DIR, currentCourseKey, 'last-run-summary.json')}`));
    }
    gap();
    info('这些位置常见原因：');
    info(dim('  · 上传类任务：图片格式/大小被拦，换一张小的 jpg 试试'));
    info(dim('  · 模型答不出来：检查 apikey 余额、模型名是否支持图片输入'));
    info(dim('  · 页面结构变了：等作者更新版本'));
    gap();
    info('重跑一次通常能补上大部分：重新双击 一键刷课.bat 就行（会自动读档续刷）。');
  } else {
    ok('没有任何失败项。');
  }
  gap();
}

function bless() {
  const hour = new Date().getHours();
  const greeting = hour < 6 ? '夜深了'
    : hour < 11 ? '早上好'
    : hour < 14 ? '中午好'
    : hour < 18 ? '下午好'
    : '晚上好';

  gap();
  console.log(cyan('═'.repeat(58)));
  gap();
  console.log('  ' + bold(`${greeting}，这次就到这里。`));
  gap();
  console.log('  ' + '刷课只是把重复劳动交出去，省下的时间');
  console.log('  ' + '拿去做点别的吧——睡一觉、打把游戏、');
  console.log('  ' + '或者干脆什么都不干。');
  gap();
  console.log('  ' + dim('成绩是过程，不是目的。'));
  console.log('  ' + dim('课还是得多多少少看一眼的，别全交给我。'));
  gap();
  console.log('  ' + green('祝你期末顺利，也祝你这学期过得开心。'));
  gap();
  console.log(cyan('═'.repeat(58)));
  gap();
}

// ───────────────────────────── 主流程 ─────────────────────────────

/**
 * 出错后停住，等人按回车。
 * bat 现在用 start 把 node 放进独立控制台，如果这里不停，窗口会一闪就关，
 * 用户连错误信息都看不到。
 */
async function waitBeforeExit() {
  if (!process.stdin.isTTY) return;
  try {
    closeReadline();
    rl = makeReadline();
    await ask('\n按回车关掉这个窗口…');
  } catch { /* 用户直接关了窗口 */ }
}

/** 第 0 步：先问这次是刷课还是刷时长。两条路后面完全不同。 */
async function stepMode() {
  console.log(cyan('━'.repeat(58)));
  console.log(cyan('  先确认一件事'));
  console.log(cyan('━'.repeat(58)));

  gap();
  info(bold('  1) 刷课') + dim('    —— 把这本书记分、答题、上传全部做完'));
  info(bold('  2) 刷时长') + dim('  —— 只把 1-6 单元开头的视频/阅读挂满，涨学习时长'));
  gap();
  info(dim('刷时长不答题，所以不用配模型，快得多。'));
  gap();

  for (;;) {
    const answer = String(await ask('选 1 还是 2？（直接回车=1 刷课）')).trim();
    if (!answer || answer === '1' || ['刷课', '课', 'course'].includes(answer.toLowerCase())) return 'course';
    if (answer === '2' || ['刷时长', '时长', 'time', 'watch'].includes(answer.toLowerCase())) return 'watch';
    warn('输 1 或 2 就行。');
  }
}

/** 刷时长：只跑 1-6 单元的 Unit preview，不碰答题。 */
async function stepWatchOnly(course, config) {
  currentCourseKey = course.courseKey;

  banner(4, 5, '登录 → 采集 → 挂满 1-6 单元的 preview');

  const who = await stepLogin(config);

  gap();
  info(dim('刷时长不需要模型，跳过模型配置。'));
  const setupStatus = await runNode('runner.mjs', ['--setup'], {allowFail: true, label: '登录态保存'});
  if (setupStatus !== 0) {
    throw new Error('登录态没保存成功。回到那个 Edge 窗口，把这本书点开、看到单元列表，再重新双击 一键刷课.bat。');
  }
  ok('登录态已保存');

  const startedAt = Date.now();

  gap();
  const crawled = await crawlWithCache(course.courseKey, course.courseLabel);
  if (!crawled) {
    throw new Error('采集没成功。确认专用 Edge 里能看到这本书的单元列表，再重试。');
  }

  gap();
  info(bold('开始把 1-6 单元的 preview 挂满'));
  info(dim('12 个任务（每单元 Quotation + Preview），只学不答题'));
  gap();

  // --path 只留路径里带 "Unit preview" 的任务；再 --quiet 关掉逐条清单
  const status = await runNode('runner.mjs',
    ['--answer', '--execute', '--path', 'Unit preview', '--quiet'],
    {allowFail: true, label: '刷 preview'});

  const stats = summarize(course.courseKey, startedAt);
  return {...stats, who, previewMode: true, runStatus: status};
}

async function main() {
  console.log('');
  console.log(cyan('╔' + '═'.repeat(56) + '╗'));
  console.log(cyan('║') + bold('            U 校园 · 一键刷课向导                      ') + cyan('║'));
  console.log(cyan('╚' + '═'.repeat(56) + '╝'));
  console.log('');
  info(dim('整个流程会问你几个问题，其余全自动。随时可以按 Ctrl+C 退出。'));

  rl = makeReadline();

  try {
    const mode = await stepMode();

    await stepEnv();
    const course = await stepCourse();

    if (mode === 'watch') {
      const config = readJson(CONFIG_FILE, {});
      currentCourseKey = course.courseKey;
      const stats = await stepWatchOnly(course, config);

      closeReadline();
      rl = makeReadline();
      printReport(course, stats, stats.who, {previewMode: true});
      bless();
    } else {
      await stepModel();

      // 模型配置写进 .env，但 config.json 里的 answerSource 要确保是 api
      const config = readJson(CONFIG_FILE, {});
      config.courses[course.courseKey].answerSource = config.courses[course.courseKey].answerSource || 'openai-api';
      writeJson(CONFIG_FILE, config);

      currentCourseKey = course.courseKey;
      const stats = await stepRun(course, config);

      closeReadline();
      rl = makeReadline();
      printReport(course, stats, stats.who);

      await stepWatch();
      bless();
    }

    gap();
    info(dim('这个窗口可以关了。下次想刷别的课，重新双击 一键刷课.bat。'));
    gap();
  } catch (error) {
    gap();
    console.log(red('━'.repeat(58)));
    console.log(red('  出错了'));
    console.log(red('━'.repeat(58)));
    gap();
    for (const line of String(error.message || error).split('\n')) {
      console.log('  ' + line);
    }
    gap();
    console.log(dim('  进度都存着，修好问题后重新双击 一键刷课.bat 就能接着刷。'));
    gap();
    process.exitCode = 1;
    await waitBeforeExit();
  } finally {
    closeReadline();
  }
}

// 只在直接运行时跑向导；被 import（测试、其他脚本）时不执行。
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}