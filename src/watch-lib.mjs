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

/** 页面上的「长时间无操作，学习已暂停」一类弹窗，点掉并让它继续。 */
export async function dismissPauseDialog(page, {wait = ms => new Promise(r => setTimeout(r, ms))} = {}) {
  const clicked = await page.evaluate(() => {
    const wraps = [...document.querySelectorAll('.ant-modal-wrap, [class*="modal"], [class*="dialog"]')]
      .filter(el => el.getBoundingClientRect().height > 0 && getComputedStyle(el).display !== 'none');
    for (const wrap of wraps) {
      const text = String(wrap.innerText || '');
      if (!/无操作|暂停|继续学习|超时|离开/.test(text)) continue;
      const buttons = [...wrap.querySelectorAll('button, .ant-btn, a')];
      const hit = buttons.find(b => /确定|确认|我知道了|知道了|继续|好的|继续学习/.test(String(b.innerText || '').replace(/\s/g, '')));
      (hit || buttons[0] || wrap.querySelector('.ant-modal-close'))?.click();
      return text.replace(/\s+/g, ' ').slice(0, 80);
    }
    return null;
  }).catch(() => null);
  if (clicked) await wait(1500);
  return clicked;
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