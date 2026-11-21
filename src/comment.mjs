// 评论 / 讨论区任务。这类页面和学生答题不是一套控件：
// 结构是「我来评论」textarea + 「发 布」按钮（初始 disabled，输入后才启用），
// 文本是「发 布」而不是「提交」，所以不能交给通用答题流程，单独处理。
export const COMMENT_QUERY = {
  root: '.ds-discussion-bottom, .discussion-cloud-recordList',
  box: '.ds-discussion-bottom textarea, textarea[placeholder*="评论"]',
  submit: '.ds-discussion-bottom button.submit-btn, .ds-discussion-bottom button.ant-btn',
  item: '.discussion-cloud-recordList-item, .discussion-cloud-recordList .ant-list-item, .discussion-cloud-recordList-empty',
};

/**
 * 判断当前页面是不是评论任务，并带回按钮状态。
 * 返回对象而不是布尔，避免把「拿不到结构」误判成评论任务。
 */
export async function inspectComment(page) {
  try {
    const info = await page.evaluate(q => {
      const root = document.querySelector(q.root);
      if (!root) return {isComment: false};
      const box = document.querySelector(q.box);
      const button = document.querySelector(q.submit);
      const items = Array.from(document.querySelectorAll(q.item))
        .filter(e => !e.className?.toString().includes('empty'));
      return {
        isComment: true,
        hasBox: !!box,
        hasSubmit: !!button,
        submitText: button ? String(button.innerText || '').replace(/\s+/g, '') : '',
        submitDisabled: button ? button.disabled === true || button.className?.toString().includes('disabled') : true,
        count: items.length,
        preview: items.slice(0, 5).map(e => String(e.innerText || '').trim().slice(0, 120)),
      };
    }, COMMENT_QUERY);
    // 页面正在跳转时 evaluate 可能拿到空值；只有明确带 isComment 的结果才算数。
    return info && typeof info === 'object' && info.isComment ? info : {isComment: false};
  } catch {
    return {isComment: false};
  }
}

/**
 * 在评论框里填一段话并点「发 布」。
 * 评论区是全课程共享的，别人的评论不代表自己发过，
 * 所以只有列表里出现一条**内容完全等于**要发的话时才认定为已发过。
 */
export async function postComment({page, text = '666', gate, wait, force = false}) {
  const info = await inspectComment(page);
  if (!info.isComment) throw new Error('当前页面不是评论任务');
  if (!info.hasBox) throw new Error('评论任务没有找到输入框');
  // 自己的评论在列表里会带「我」标记（条目结构：昵称/我/删除/正文/时间），
  // 别人的不会。所以先认「我」，认不到再退回整行比对正文。
  // 用整行比对而不是 includes：同学发「6666666」不该挡住我们要发的「666」。
  const posted = (info.preview || []).some(entry => {
    const lines = String(entry).split('\n').map(line => line.trim());
    return lines.includes('我') || lines.includes(text);
  });
  if (!force && posted) return {status: 'already', count: info.count, preview: info.preview};

  const box = page.locator(COMMENT_QUERY.box).first();
  await gate();
  // 评论框常在页面底部，不先滚进视口的话 click 会被判定为「不在可视区域」而失败。
  await box.scrollIntoViewIfNeeded({timeout: 5000}).catch(() => {});
  await page.evaluate(() => {
    const el = document.querySelector('.ds-discussion-bottom textarea, textarea[placeholder*="评论"]');
    if (el) el.scrollIntoView({block: 'center', behavior: 'instant'});
  }).catch(() => {});
  await wait(400);
  await box.click({timeout: 8000}).catch(async () => {
    // 被浮层挡住时退回到 DOM 聚焦再输入。
    await box.focus().catch(() => {});
  });
  await box.fill(text, {timeout: 8000});
  await wait(300);

  const submit = page.locator(COMMENT_QUERY.submit).first();
  if (!await submit.count()) throw new Error('评论任务没有找到发布按钮');
  await submit.scrollIntoViewIfNeeded({timeout: 4000}).catch(() => {});

  // 发布按钮在输入有效内容后才会解除 disabled，等它自己启用。
  let enabled = false;
  for (let i = 0; i < 30; i++) {
    await gate();
    const disabled = await submit.isDisabled().catch(() => true);
    if (!disabled) { enabled = true; break; }
    await wait(300);
  }
  if (!enabled) throw new Error(`填入「${text}」后发布按钮仍然是禁用状态，无法发布`);

  await submit.click({timeout: 8000});

  // 发布成功的判据：评论区出现内容，或按钮重新变回禁用。
  for (let i = 0; i < 40; i++) {
    await wait(400);
    const after = await inspectComment(page);
    if (after.count > 0) return {status: 'posted', text, count: after.count, preview: after.preview};
    if (after.submitDisabled) return {status: 'posted', text, evidence: '发布后按钮回到禁用状态'};
  }
  throw new Error('点击发布后评论区没有出现新内容');
}