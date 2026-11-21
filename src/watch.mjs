// 挂机刷必修学习时长。
// 循环播放 U1~U6 的 Preview 视频，每个播完后在当前单元停留若干分钟，
// 检测到学习时长达到目标（默认 20 小时）就退出。
import fs from 'node:fs';
import path from 'node:path';
import {loadConfig} from './config.mjs';
import {connectBrowser} from './net.mjs';
import {selectCoursePage, detectLoginLost} from './browser-session.mjs';
import {loadAnswerQueue} from './answer.mjs';
import {extractStudySeconds, formatDuration, dismissPauseDialog, ensurePlaying, videoState} from './watch-lib.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function flagValue(argv, name, fallback) {
  const index = argv.indexOf(name);
  if (index < 0) return fallback;
  const value = Number(argv[index + 1]);
  return Number.isFinite(value) ? value : fallback;
}

const argv = process.argv;
const config = loadConfig();
const output = path.resolve(config.outputDir || path.join('artifacts', config.course.key));
const targetHours = flagValue(argv, '--hours', 20);
const targetSeconds = Math.round(targetHours * 3600);
const dwellMs = Math.round(flagValue(argv, '--dwell-minutes', 5) * 60 * 1000);
const detailUrl = config.course.studyTimeUrl
  || 'https://uai.unipus.cn/app/cmgt/resource-detail/12000000001';
const progressFile = path.join(output, 'watch-progress.json');

function log(message) {
  const line = `[${new Date().toLocaleTimeString('zh-CN', {hour12: false})}] ${message}`;
  console.log(line);
  try {
    fs.mkdirSync(output, {recursive: true});
    fs.appendFileSync(path.join(output, 'watch.log'), line + '\n');
  } catch { /* 日志写不进去不影响挂机 */ }
}

/** 读「综合成绩」页上的必修学习时长，返回秒数或 null。 */
async function readStudySeconds(page) {
  await page.goto(detailUrl, {waitUntil: 'domcontentloaded', timeout: 45000}).catch(() => {});
  await sleep(4000);
  // 切到「综合成绩」页签
  await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.ant-tabs-tab, [role="tab"]')];
    const hit = tabs.find(el => /综合成绩/.test(String(el.innerText || '')));
    if (hit) hit.click();
  }).catch(() => {});
  await sleep(4000);
  for (let i = 0; i < 3; i++) {
    const text = await page.evaluate(() => String(document.body.innerText || '')).catch(() => '');
    const seconds = extractStudySeconds(text);
    if (seconds !== null) return seconds;
    await sleep(2500);
  }
  return null;
}

/** 播放一个 Preview：等到视频播完，期间持续兜底（暂停了重播、弹窗了点掉）。 */
async function playOnce(page, task) {
  await page.goto(task.url, {waitUntil: 'domcontentloaded', timeout: 45000}).catch(() => {});
  await page.reload({waitUntil: 'domcontentloaded', timeout: 45000}).catch(() => {});
  await sleep(5000);
  await dismissPauseDialog(page, {wait: sleep});

  const found = await ensurePlaying(page);
  if (!found) return {played: false, reason: '页面没有 video 元素'};

  let lastTime = 0, idleSince = Date.now();
  for (let tick = 0; tick < 3600; tick++) {
    await sleep(2000);
    await dismissPauseDialog(page, {wait: sleep});
    const state = await videoState(page);
    if (!state) return {played: false, reason: '视频元素消失'};
    if (state.ended || (state.duration > 0 && state.currentTime >= state.duration - 1)) {
      return {played: true, duration: state.duration, ended: true};
    }
    if (state.paused) await ensurePlaying(page);
    if (Math.abs(state.currentTime - lastTime) > 0.3) { lastTime = state.currentTime; idleSince = Date.now(); }
    // 超过 90 秒没有推进就认为卡住了，重新加载一次。
    if (Date.now() - idleSince > 90000) return {played: false, reason: '播放进度长时间不动'};
  }
  return {played: false, reason: '单个视频超过 2 小时仍未播完'};
}

async function main() {
  const {queue} = await loadAnswerQueue({output, argv: ['node', 'watch']});
  // 只留 Preview 板块，按单元排序，1~6 循环。
  let previews = queue.filter(t => t.path.some(part => /^Preview$/i.test(part)));
  if (!previews.length) {
    // 退而求其次：所有音视频学习任务。
    previews = queue.filter(t => t.type === '音视频学习');
  }
  if (!previews.length) throw new Error('队列里没有找到 Preview 视频任务，先运行 npm run crawl');
  previews = [...previews].sort((a, b) => a.unit - b.unit);
  log(`挂机开始：${previews.length} 个 Preview（Unit ${[...new Set(previews.map(t => t.unit))].join('/')}），目标 ${targetHours} 小时，每个播完停留 ${dwellMs / 60000} 分钟`);

  const browser = await connectBrowser(config.browserEndpoint, {
    retries: config.network.retries, retryDelayMs: config.network.retryDelayMs, timeoutMs: config.network.connectTimeoutMs});
  const page = selectCoursePage(browser.contexts()[0].pages(), config.login || {});
  const lost = await detectLoginLost(page, {ssoHost: config.login?.ssoHost || 'sso.unipus.cn'});
  if (lost) throw new Error(`登录态已失效（${lost}）：请在专用 Edge 里重新登录后重跑`);

  // --check：只读一次学习时长就退出，用来确认选择器还能对上。
  if (argv.includes('--check')) {
    const study = await readStudySeconds(page);
    if (study === null) throw new Error('读不到必修学习时长：检查 studyTimeUrl 或页面结构是否变化');
    log(`当前学习时长 ${formatDuration(study)}，目标 ${formatDuration(targetSeconds)}，还差 ${formatDuration(targetSeconds - study)}`);
    process.exit(0);
  }

  let round = 0;
  let consecutiveFailures = 0;
  while (true) {
    round++;
    for (const task of previews) {
      const study = await readStudySeconds(page);
      if (study === null) {
        log('读不到学习时长，先继续挂机（下一轮再试）');
      } else {
        log(`学习时长 ${formatDuration(study)} / 目标 ${formatDuration(targetSeconds)}`);
        if (study >= targetSeconds) {
          log(`已达到 ${targetHours} 小时，挂机结束`);
          await fs.writeFile(progressFile, JSON.stringify({
            finishedAt: new Date().toISOString(), seconds: study, targetSeconds, rounds: round,
          }, null, 2)).catch(() => {});
          process.exit(0);
        }
        fs.writeFileSync(progressFile, JSON.stringify({
          updatedAt: new Date().toISOString(), seconds: study, targetSeconds, rounds: round,
        }, null, 2));
      }

      log(`第 ${round} 轮：Unit ${task.unit} ${task.path.join(' / ')}`);
      const result = await playOnce(page, task);
      if (result.played) {
        consecutiveFailures = 0;
        log(`播放完成（片长 ${formatDuration(result.duration || 0)}），停留 ${dwellMs / 60000} 分钟`);
        // 停留期间保持页面，顺便兜底弹窗。
        const until = Date.now() + dwellMs;
        while (Date.now() < until) {
          await sleep(15000);
          await dismissPauseDialog(page, {wait: sleep});
        }
      } else {
        consecutiveFailures++;
        log(`本片未播完：${result.reason}`);
        if (consecutiveFailures >= previews.length * 2) {
          throw new Error(`连续 ${consecutiveFailures} 个视频都播不动，挂机中止：${result.reason}`);
        }
      }
    }
  }
}

main().catch(error => {
  console.error(`[error] 挂机中止：${error.message}`);
  process.exit(1);
});