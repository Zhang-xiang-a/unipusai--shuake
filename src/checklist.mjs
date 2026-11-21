// Review & check（复习自检）任务：一列「I can ...」自评项，每项前面有个方框，
// 全部打勾就算通过。页面上没有提交按钮，勾完即保存。
const CHECK_ICON = 'span[class*="anticon"]';

/** 找出这一页所有的勾选框：既包括已勾的（check-square + primary-color），也包括未勾的。 */
export async function inspectChecklist(page) {
  try {
    const info = await page.evaluate(selector => {
      const icons = [...document.querySelectorAll(selector)].filter(el => {
        const cls = String(el.className || '');
        return /check-square|check-circle|border|square/.test(cls);
      });
      const rows = icons.map(el => {
        const cls = String(el.className || '');
        const row = el.closest('li, .ant-list-item, [class*="item"]') || el.parentElement;
        return {
          cls,
          // primary-color 是「已勾」的标记；没有它说明这一项还没打勾。
          checked: /primary-color/.test(cls) || /check-square-fill/.test(cls),
          text: String(row?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80),
        };
      });
      return {total: rows.length, rows, unchecked: rows.filter(r => !r.checked).length};
    }, CHECK_ICON);
    return {isChecklist: info.total > 0, ...info};
  } catch {
    return {isChecklist: false, total: 0, rows: [], unchecked: 0};
  }
}

/**
 * 把所有还没打勾的项点一遍。只点未勾选的，避免把已经勾上的又取消掉。
 */
export async function tickAll({page, gate, wait}) {
  const before = await inspectChecklist(page);
  if (!before.isChecklist) throw new Error('当前页面没有检测到自评勾选框');
  if (!before.unchecked) return {status: 'already', total: before.total, ticked: 0};

  let ticked = 0;
  for (let i = 0; i < before.total; i++) {
    await gate();
    const clicked = await page.evaluate(index => {
      const icons = [...document.querySelectorAll('span[class*="anticon"]')].filter(el => {
        const cls = String(el.className || '');
        return /check-square|check-circle|border|square/.test(cls) && !/primary-color|check-square-fill/.test(cls);
      });
      const el = icons[index];
      if (!el) return false;
      // 图标本身可能不接事件，点它所在的整行更稳。
      const target = el.closest('li, .ant-list-item, [class*="item"], label') || el;
      target.click();
      el.click();
      return true;
    }, 0).catch(() => false);
    if (!clicked) break;
    ticked++;
    await wait(400);
  }

  const after = await inspectChecklist(page);
  if (after.unchecked > 0) {
    throw new Error(`还有 ${after.unchecked}/${after.total} 个自评项没有勾上（共尝试 ${ticked} 次）`);
  }
  return {status: 'ticked', total: after.total, ticked};
}