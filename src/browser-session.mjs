// 课程标签页的识别、补建与登录态检查。
// 域名与 SSO 主机来自课程配置（login.courseHosts / login.ssoHost），
// 旧调用不传 hosts 时仍按内置的 U 校园域名判断。
export const DEFAULT_COURSE_HOSTS = ['uai.unipus.cn', 'ucontent.unipus.cn'];
export const DEFAULT_SSO_HOST = 'sso.unipus.cn';

export function needsWebSolver(config) {
  return (config.course?.answerSource ?? config.answerSource ?? 'deepseek-web')==='deepseek-web';
}

export function isCourseUrl(value, {includeLogin = true, hosts = DEFAULT_COURSE_HOSTS, ssoHost = DEFAULT_SSO_HOST} = {}) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    if (hosts.includes(url.hostname)) return true;
    if (!includeLogin || url.hostname !== ssoHost) return false;
    const service = url.searchParams.get('service');
    return !!service && isCourseUrl(service, {includeLogin: false, hosts, ssoHost});
  } catch { return false; }
}

export function isLoginPage(page, {ssoHost = DEFAULT_SSO_HOST} = {}) {
  try {
    const url = new URL(page.url());
    if (url.hostname === ssoHost) return true;
    // 被踢回未登录状态时门户会带 logout=true：页面还在课程域，但已经没有登录态。
    if (url.searchParams.get('logout') === 'true') return true;
    return false;
  } catch { return false; }
}

/**
 * 页面是否已经处于未登录状态。除了 URL，还要看页面上有没有登录入口而没有课程目录——
 * 有些情况门户会留在课程域、静默清掉登录态。
 */
export async function detectLoginLost(page, {ssoHost = DEFAULT_SSO_HOST} = {}) {
  if (isLoginPage(page, {ssoHost})) return '标签页停在登录页或门户带着 logout=true';
  try {
    const state = await page.evaluate(() => ({
      loginEntry: !!document.querySelector('a[href*="sso.unipus.cn"], a[href*="login"], .login-btn, [class*="login-entry"]'),
      courseMenu: !!document.querySelector('.pc-menu-node-name, .pc-task, .pc-tab-view-container'),
    }));
    if (state.loginEntry && !state.courseMenu) return '页面上只有登录入口，没有课程目录，登录态已失效';
  } catch { /* 页面正在跳转时拿不到结构，按已登录处理 */ }
  return null;
}

/**
 * 登录态失效时给出可执行的提示，而不是让后续操作在登录页上莫名失败。
 * 返回 true 表示已登录；抛错表示需要人工重新登录。
 */
export function assertCourseLoggedIn(page, course = {}) {
  const ssoHost = course.login?.ssoHost || DEFAULT_SSO_HOST;
  if (isLoginPage(page, {ssoHost})) {
    const error = new Error(
      `课程标签目前停在登录页（${ssoHost}），登录态已过期或尚未登录。\n` +
      '处理方式：执行 npm run browser 显示专用 Edge，在原课程标签完成登录后重新运行；' +
      '脚本不会自动填写账号密码。'
    );
    error.fatal = true;
    throw error;
  }
  return true;
}

export function selectCoursePage(pages, options = {}) {
  const hosts = options.hosts || DEFAULT_COURSE_HOSTS;
  const hostOf = page => { try { return new URL(page.url()).hostname; } catch { return ''; } };
  // 优先选课件页（ucontent），没有课件页再退回目录页 / 登录页。
  const coursewareHost = hosts.find(host => /ucontent/i.test(host));
  return (coursewareHost && pages.find(page => hostOf(page) === coursewareHost))
    || pages.find(p => isCourseUrl(p.url(), {...options, hosts, includeLogin: false}))
    || pages.find(p => isCourseUrl(p.url(), {...options, hosts}));
}

export async function ensureBrowserPages(context, config) {
  // SSO is still the original course tab; never replace or duplicate it.
  const hosts = config.login?.courseHosts || DEFAULT_COURSE_HOSTS;
  const ssoHost = config.login?.ssoHost || DEFAULT_SSO_HOST;
  let course = selectCoursePage(context.pages(), {hosts, ssoHost});
  const solverHost = (() => { try { return new URL(config.deepseekUrl).hostname; } catch { return 'chat.deepseek.com'; } })();
  let solver = context.pages().find(p => {
    try { return new URL(p.url()).hostname === solverHost; } catch { return false; }
  });
  const created = [];
  const timeout = config.network?.gotoTimeoutMs ?? 30000;
  const targets=[['course',config.courseUrl]];
  if(needsWebSolver(config))targets.push(['deepseek',config.deepseekUrl]);
  for (const [name, target] of targets) {
    if (name === 'course' ? course : solver) continue;
    const page = await context.newPage();
    if (name === 'course') course = page; else solver = page;
    await page.goto(target, {waitUntil: 'domcontentloaded', timeout});
    created.push(name);
  }
  return {course, solver, created};
}

export async function showBrowserPage(context, page) {
  const session = await context.newCDPSession(page);
  try {
    const {windowId, bounds} = await session.send('Browser.getWindowForTarget');
    // 窗口被最小化、被挪到屏幕外（换过显示器或分辨率）、或是全屏，都要先拉回来再摆位置。
    // 单纯 bringToFront 只激活标签页，Windows 的前台锁不保证把整个窗口提到最前；
    // 走一次 setWindowBounds 效果更稳。
    const offscreen = bounds.left < -40 || bounds.top < -40
      || bounds.left + bounds.width < 120 || bounds.top + bounds.height < 120;
    const target = (bounds.windowState !== 'normal' || offscreen || !bounds.width || !bounds.height)
      ? {windowState: 'normal', left: 60, top: 30,
         width: Math.min(bounds.width || 1440, 1560),
         height: Math.min(bounds.height || 900, 980)}
      : {windowState: 'normal', left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height};
    await session.send('Browser.setWindowBounds', {windowId, bounds: target});
    await page.bringToFront();
  } finally { await session.detach(); }
}
