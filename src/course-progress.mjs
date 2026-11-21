// 读课程侧的 course_progress，判断任务是否真的完成了。
// 页面刷新时自己会发一次该接口，抓到它的 URL 后把单元 ID 段换掉，就能一次问清所有单元。
export function unitIdOf(taskUrl) {
  try { return new URL(taskUrl).hash.split('/courseware/')[1]?.split('/')[0]; } catch { return undefined; }
}

export function leafIdOf(taskUrl) {
  try { return new URL(taskUrl).hash.split('/').at(-1); } catch { return undefined; }
}

/** 把 course_progress 的 URL 里的单元 ID 换掉（该段位于 pathname 倒数第 3 段）。 */
export function swapUnitId(url, unitId) {
  const parsed = new URL(url);
  const segments = parsed.pathname.split('/');
  segments[segments.length - 3] = unitId;
  parsed.pathname = segments.join('/');
  return parsed.toString();
}

/** 触发一次页面刷新并抓到 course_progress 的请求地址，作为后续批量查询的模板。 */
export async function captureProgressUrl(page, {timeoutMs = 30000} = {}) {
  const pending = page.waitForResponse(response => {
    try {
      const url = new URL(response.url());
      return response.ok() && url.pathname.includes('/course_progress/');
    } catch { return false; }
  }, {timeout: timeoutMs});
  const [response] = await Promise.all([pending, page.reload({waitUntil: 'domcontentloaded', timeout: timeoutMs})]);
  return response.url();
}

/**
 * 逐个单元打开该单元的第一个任务，拦截页面自己发出的 course_progress 响应。
 * 不自己 fetch：该接口带鉴权头，自建请求会 401。
 */
export async function readCourseLeafs({page, tasks, timeoutMs = 30000}) {
  const unitIds = [...new Set(tasks.map(task => unitIdOf(task.url)))].filter(Boolean);
  const leafs = {};
  const failed = [];
  for (const unitId of unitIds) {
    const sample = tasks.find(task => unitIdOf(task.url) === unitId);
    if (!sample?.url) { failed.push({unitId, reason: '没有该单元的任务地址'}); continue; }
    try {
      const pending = page.waitForResponse(response => {
        try {
          const url = new URL(response.url());
          return response.ok() && url.pathname.includes('/course_progress/')
            && url.pathname.split('/').at(-3) === unitId;
        } catch { return false; }
      }, {timeout: timeoutMs});
      // 导航失败（超时/被弹窗拦）不影响已经拿到的响应。
      await page.goto(sample.url, {waitUntil: 'domcontentloaded', timeout: timeoutMs}).catch(() => {});
      const response = await pending;
      const data = await response.json();
      if (data.code !== 0) { failed.push({unitId, reason: `code ${data.code}`}); continue; }
      Object.assign(leafs, data.rt?.leafs || {});
    } catch (error) {
      failed.push({unitId, reason: String(error.message).split('\n')[0].slice(0, 120)});
    }
  }
  return {leafs, failed, unitCount: unitIds.length};
}

/** 课程侧是否已完成：state.pass 为 1 或 2 表示通过。 */
export function courseCompleted(leaf) {
  return !!leaf && [1, 2].includes(leaf.state?.pass);
}