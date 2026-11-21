// 启动/复用专用 Edge 窗口。只负责把浏览器拉起来并补建缺失标签，
// 不登录、不答题；登录由用户在窗口里手动完成。
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync, spawn} from 'node:child_process';
import {chromium} from 'playwright';
import {ensureBrowserPages, showBrowserPage} from './browser-session.mjs';
import {describeCourse, loadConfig} from './config.mjs';
import {BROWSER_PROFILE_DIR} from './paths.mjs';
import {logger} from './log.mjs';
import {sleep, withRetry} from './net.mjs';

const config = loadConfig();
const endpoint = config.browserEndpoint;
const url = new URL(endpoint);
if (url.hostname !== '127.0.0.1') throw new Error('浏览器调试端口必须限制在本机 127.0.0.1');
const port = url.port;
logger.info(`当前课程：${describeCourse(config.course)}`);

/**
 * 专用 Edge 有没有真正显示在屏幕上的窗口。
 * 关掉窗口后进程会驻留后台，这时 CDP 一切正常、getWindowForTarget 也返回正常 bounds，
 * 唯有 MainWindowHandle 为 0 —— 这是唯一能区分「窗口在」和「窗口没了」的信号。
 * 查不出来返回 null（非 Windows 或调用失败），调用方不要据此做破坏性动作。
 */
function visibleWindowCount() {
  if (process.platform !== 'win32') return null;
  try {
    // 必须写成单行：powershell -Command 里多行拼接容易在语句边界出错。
    const script =
      `$n=0; Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | ForEach-Object { ` +
      `if ($_.CommandLine -and $_.CommandLine.Contains('--remote-debugging-port=${port}')) { ` +
      `$g = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; ` +
      `if ($g -and $g.MainWindowHandle -ne 0) { $n++ } } }; $n`;
    const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8', timeout: 20000, windowsHide: true,
    }).trim();
    const n = Number(out);
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}

/** 杀掉本次专用 Edge 的所有进程（只认这个调试端口，不碰用户平常用的 Edge）。 */
function killDedicated() {
  if (process.platform !== 'win32') return 0;
  try {
    const script =
      `Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | ForEach-Object { ` +
      `if ($_.CommandLine -and $_.CommandLine.Contains('--remote-debugging-port=${port}')) { ` +
      `Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } }`;
    execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {timeout: 25000, windowsHide: true});
    return 1;
  } catch { return 0; }
}

async function endpointReady() {
  try {
    const response = await fetch(`${endpoint}/json/version`, {signal: AbortSignal.timeout(800)});
    return response.ok;
  } catch { return false; }
}

async function openWindow(browser, page) {
  const bsession = await browser.newBrowserCDPSession();
  await bsession.send('Target.createTarget', {url: config.courseUrl, newWindow: true, background: false});
  await bsession.detach();
  await sleep(1800);
  if (page) await showBrowserPage(browser.contexts()[0], page).catch(() => {});
}

async function ensurePages() {
  const browser = await chromium.connectOverCDP(endpoint, {timeout: config.network.connectTimeoutMs});
  const context = browser.contexts()[0];
  if (!context) throw new Error('CDP 会话没有可用浏览器上下文');
  // 专用 Edge 关掉窗口后进程还活着（后台驻留），CDP 照常能操作标签，
  // 但屏幕上没有任何窗口——这时 getWindowForTarget 依然能拿到窗口 ID，
  // 靠 setWindowBounds 也唤不出来，只能新开一个窗口。
  let reopened = false;
  if (process.argv.includes('--new-window')) {
    await openWindow(browser);
    reopened = true;
  }
  const {course, created} = await ensureBrowserPages(context, config);
  await showBrowserPage(context, course);
  // 摆完位置再查一次：还是 0 个可见窗口，说明窗口确实被关掉了，自己补一个。
  // 用户不该为了这个去记 --new-window。
  let visible = visibleWindowCount();
  if (!reopened && visible === 0) {
    console.log('检测到专用 Edge 的窗口被关掉了（进程还在后台），正在重新打开窗口…');
    await openWindow(browser, course);
    reopened = true;
    visible = visibleWindowCount();
  }
  console.log(created.length
    ? `已显示专用 Edge，恢复缺失标签：${created.join('、')}。`
    : '已显示并复用专用 Edge，保留现有标签。');
  if (reopened) console.log('窗口已重新打开，请看任务栏上标题为「U校园」的那个 Edge。');
  if (visible === 0) {
    console.log('（仍然没检测到可见窗口：可能被最小化到了屏幕外，或窗口被其它窗口完全遮住）');
  }
  if (course.url().includes(config.login?.ssoHost || 'sso.unipus.cn')) {
    console.log('原课程标签目前是登录页，请在此窗口登录 U 校园后运行答题命令；脚本不会自动填写账号密码。');
  }
  logger.info(`浏览器就绪：${endpoint}，${created.length ? `新建标签 ${created.join('、')}` : '复用已有标签'}${reopened ? '，已重开窗口' : ''}`);
}

// --restart：先把上一次留下的专用 Edge 全部清掉再启动，适合「怎么都出不来窗口」的时候。
if (process.argv.includes('--restart')) {
  const killed = killDedicated();
  if (killed) { console.log('已清理上一次留下的专用 Edge 进程，重新启动…'); await sleep(3000); }
}

if (await endpointReady()) {
  await withRetry(ensurePages, {
    retries: config.network.retries,
    retryDelayMs: config.network.retryDelayMs,
    label: '接管现有 Edge 调试会话',
  });
} else {
  const candidates = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA]
    .filter(Boolean).map(dir => path.join(dir, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  let executable;
  for (const candidate of candidates) {
    try { await fs.access(candidate); executable = candidate; break; } catch { /* 继续找下一个 */ }
  }
  if (!executable) throw new Error('未找到 Microsoft Edge，请先安装 Edge 或修改 config.json 的 channel 设置');
  await fs.mkdir(BROWSER_PROFILE_DIR, {recursive: true});
  const child = spawn(executable, [
    `--remote-debugging-port=${url.port}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${BROWSER_PROFILE_DIR}`,
    '--no-first-run',
    '--restore-last-session',
  ], {detached: true, stdio: 'ignore', windowsHide: true});
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  child.unref();
  let connected = false;
  for (let i = 0; i < 30; i++) {
    if (await endpointReady()) { connected = true; break; }
    await sleep(500);
  }
  if (!connected) throw new Error('Edge 调试端口未就绪；检查该 profile 是否已被其他 Edge 进程占用');
  await withRetry(ensurePages, {
    retries: config.network.retries,
    retryDelayMs: config.network.retryDelayMs,
    label: '连接新启动的 Edge',
  });
  console.log('Edge 会话已启动。后续脚本复用此窗口，任务退出不会关闭浏览器。');
}

// connectOverCDP 没有公开 disconnect API；让 Node 进程结束即可断开 WebSocket，不能调用 browser.close()，
// 后者会向远端发送 Browser.close 并关闭用户正在使用的 Edge。
process.exit(0);
