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
 * 刷新一次课件页即可拿到全部单元的 course_progress：页面自己会为每个单元各发一次请求。
 * 直接 goto 带 hash 的地址不会触发导航（同页 SPA 路由），必须 reload。
 */
export async function readCourseLeafs({page, tasks, timeoutMs = 30000}) {
  const unitIds = new Set(tasks.map(task => unitIdOf(task.url)).filter(Boolean));
  const collected = [];
  const onResponse = response => {
    try {
      if (!response.ok()) return;
      if (!new URL(response.url()).pathname.includes('/course_progress/')) return;
      collected.push(response);
    } catch { /* 忽略无法解析的响应 */ }
  };
  const unitOf = response => {
    try { return new URL(response.url()).pathname.split('/').at(-3); } catch { return undefined; }
  };
  page.on('response', onResponse);
  try {
    await page.reload({waitUntil: 'domcontentloaded', timeout: timeoutMs});
    // 各单元的数据是陆续回来的，等齐或者等够 8 秒再收网。
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const covered = new Set(collected.map(unitOf).filter(id => unitIds.has(id)));
      if (unitIds.size && covered.size >= unitIds.size) break;
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  } catch (error) {
    page.off('response', onResponse);
    return {leafs: {}, failed: [{unitId: '*', reason: String(error.message).split('\n')[0].slice(0, 120)}], unitCount: unitIds.size};
  } finally {
    page.off('response', onResponse);
  }

  const leafs = {};
  const covered = new Set();
  const failed = [];
  for (const response of collected) {
    try {
      const data = await response.json();
      if (data.code !== 0) continue;
      Object.assign(leafs, data.rt?.leafs || {});
      const unitId = unitOf(response);
      if (unitId) covered.add(unitId);
    } catch { /* 单个响应解析失败不影响其他单元 */ }
  }
  for (const unitId of unitIds) if (!covered.has(unitId)) failed.push({unitId, reason: '本次刷新没有拿到该单元的进度'});
  return {leafs, failed, unitCount: unitIds.size};
}

/** 课程侧是否已完成：state.pass 为 1 或 2 表示通过。 */
export function courseCompleted(leaf) {
  return !!leaf && [1, 2].includes(leaf.state?.pass);
}