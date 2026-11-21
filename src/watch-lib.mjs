// 挂机刷必修学习时长：循环播 U1~U6 的 Preview，每个视频播完后在该页停留若干分钟，
// 学习时长到目标值就退出。时长从「综合成绩」页的「必修学习时长」读。
export function parseDuration(value) {
  const match = String(value || '').trim().match(/^(\d{1,3}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [hours, minutes, seconds] = match.slice(1).map(Number);
  if (minutes > 59 || seconds > 59) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

export function formatDuration(totalSeconds) {
  const value = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = value % 60;
  return [hours, minutes, seconds].map(n => String(n).padStart(2, '0')).join(':');
}

/** 从「综合成绩」页文本里取出必修学习时长（秒）。拿不到返回 null。 */
export function extractStudySeconds(text) {
  const source = String(text || '');
  // 行内形态：必修学习时长 40% 06:46:11 13.5 查看详情
  // 中间可能夹着权重百分比，所以用惰性任意字符而不是「非数字」。
  const near = source.match(/必修学习时长[\s\S]{0,40}?(\d{1,3}:\d{2}:\d{2}|\d{1,2}:\d{2})/);
  if (near) {
    const raw = near[1];
    const full = raw.split(':').length === 3 ? raw : `00:${raw}`;
    return parseDuration(full);
  }
  // 退化形态：整页只有一处时分秒。
  const any = source.match(/\b(\d{1,3}:\d{2}:\d{2})\b/);
  return any ? parseDuration(any[1]) : null;
}

// 「长时间未操作，学习暂停」这类弹窗的识别。
//
// 这些文案各版本不一样，所以宁可放宽：
//   您已长时间未操作，学习暂停 / 长时间无操作 / 学习已暂停，点击继续学习 / 是否继续
export const PAUSE_TEXT = /未操作|无操作|长时间|暂停|继续学习|继续观看|恢复学习|超时|已离开|离开了页面|点击继续|是否继续|仍要继续/;
// 弹窗上那个「让人继续」的按钮，越靠前越优先。
export const RESUME_LABEL = /继续学习|继续观看|恢复学习|继续|我知道了|知道了|确定|确认|好的|是的|重播/;

// 弹窗不一定是 antd modal，也可能是自绘的遮罩层，所以选择器给宽一点。
export const DIALOG_SELECTOR = [
  '.ant-modal-wrap', '.ant-modal-root', '.ant-modal',
  '[role="dialog"]', '[role="alertdialog"]', '[aria-modal="true"]',
  // 容器可能挂在 class 上，也可能挂在 id 上（实测两种都遇到过）
  '[class*="modal"]', '[class*="dialog"]', '[class*="mask"]',
  '[class*="popup"]', '[class*="layer"]', '[class*="confirm"]',
  '[id*="modal"]', '[id*="dialog"]', '[id*="mask"]',
  '[id*="popup"]', '[id*="layer"]', '[id*="confirm"]',
].join(',');

// 兜底用的强特征：整页搜的时候只认这些，不能拿「暂停」这种泛词去匹配，
// 否则播放器自带的暂停按钮也会被当成弹窗点掉。
export const PAUSE_STRONG = /未操作|无操作|长时间未|长时间无|已离开|离开了页面|学习已暂停|学习暂停/;

/**
 * 页面上的「长时间未操作，学习已暂停」一类弹窗：点掉它，并让视频接着播。
 *
 * 返回 {text, button} 表示这次真的处理了一个弹窗，返回 null 表示页面上没有。
 * 会连试几轮：有些弹窗点一下只是关掉动画层，要再点一次才真的消失。
 */
export async function dismissPauseDialog(page, {wait = ms => new Promise(r => setTimeout(r, ms))} = {}) {
  let handled = null;
  for (let round = 0; round < 3; round++) {
    const hit = await page.evaluate(({pauseSrc, strongSrc, resumeSrc, selector}) => {
      const pause = new RegExp(pauseSrc);
      const strong = new RegExp(strongSrc);
      const resume = new RegExp(resumeSrc);
      const visible = el => {
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        if (rect.bottom < 0 || rect.top > window.innerHeight) return false;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const opacity = Number(style.opacity);
        if (Number.isFinite(opacity) && opacity < 0.1) return false;
        return true;
      };
      let wraps;
      try { wraps = [...document.querySelectorAll(selector)].filter(visible); } catch { return null; }
      for (const wrap of wraps) {
        const text = String(wrap.innerText || '');
        if (!text.trim() || !pause.test(text)) continue;
        const compact = text.replace(/\s+/g, ' ').trim().slice(0, 100);
        const candidates = [...wrap.querySelectorAll('button, .ant-btn, a, [role="button"], [class*="btn"]')]
          .map(el => ({el, label: String(el.innerText || '').replace(/\s+/g, '')}))
          .filter(item => item.label && item.label.length <= 14);
        const pick = candidates.find(item => resume.test(item.label)) || candidates[0];
        if (pick) {
          pick.el.click();
          return {text: compact, button: pick.label};
        }
        const close = wrap.querySelector('.ant-modal-close, [class*="close"], [aria-label*="\u5173\u95ed"]');
        if (close) {
          close.click();
          return {text: compact, button: '(关闭)'};
        }
      }

      // 兜底：容器既不在 class 也不在 id 上（自绘遮罩、Web Components、
      // 或者干脆是个 position:fixed 的裸 div）。那就看整页文本里有没有强特征，
      // 有的话就在全页找那个「继续学习」按钮点掉。
      const bodyText = String(document.body?.innerText || '');
      if (!strong.test(bodyText)) return null;
      const loose = [...document.querySelectorAll('button, .ant-btn, a, [role="button"], [class*="btn"]')]
        .filter(visible)
        .map(el => ({el, label: String(el.innerText || '').replace(/\s+/g, '')}))
        .filter(item => item.label && item.label.length <= 14 && resume.test(item.label));
      if (!loose.length) return null;
      loose[0].el.click();
      return {text: '(整页兜底) ' + bodyText.replace(/\s+/g, ' ').trim().slice(0, 90), button: loose[0].label};
    }, {pauseSrc: PAUSE_TEXT.source, strongSrc: PAUSE_STRONG.source, resumeSrc: RESUME_LABEL.source, selector: DIALOG_SELECTOR}).catch(() => null);

    if (!hit) break;
    handled = hit;
    await wait(1200);
    // 关掉之后立刻让它接着播，别等下一轮 tick（2 秒也是秒）。
    await ensurePlaying(page).catch(() => {});
  }
  return handled;
}

/**
 * 制造「人在电脑前」的动静。
 *
 * 「长时间未操作」本质是播放器在数用户的活跃度：没有 mousemove / keydown，
 * 它就认为人走了，于是暂停计时。光把弹窗点掉治标不治本——过几分钟又弹。
 *
 * 这里用 Playwright 的 CDP 注入真实鼠标移动（isTrusted = true，页面脚本骗不了），
 * 而且只在页面中部小幅游走、绝不点击，不会误触播放条或按钮。
 */
export async function keepAlive(page, {seed = Math.random()} = {}) {
  try {
    const size = page.viewportSize() || {width: 1280, height: 800};
    // 控制在中间那一块：上边是标题栏、下边是播放条，都避开。
    const x = Math.round(size.width * (0.35 + (seed % 1) * 0.3));
    const y = Math.round(size.height * (0.35 + ((seed * 7) % 1) * 0.3));
    await page.mouse.move(x, y, {steps: 4});
    return true;
  } catch {
    return false;
  }
}

/** 让页面上的视频播放起来（静音绕过自动播放限制），返回是否找到视频。 */
export async function ensurePlaying(page) {
  return page.evaluate(() => {
    const video = document.querySelector('video');
    if (!video) return false;
    video.muted = true;
    if (video.paused) video.play().catch(() => {});
    return true;
  }).catch(() => false);
}

export async function videoState(page) {
  return page.evaluate(() => {
    const video = document.querySelector('video');
    if (!video) return null;
    return {
      paused: video.paused,
      ended: video.ended,
      currentTime: video.currentTime,
      duration: Number.isFinite(video.duration) ? video.duration : 0,
      readyState: video.readyState,
    };
  }).catch(() => null);
}