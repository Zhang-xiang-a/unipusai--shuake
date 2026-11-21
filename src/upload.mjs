// Unit project（单元产出任务）：拖拽/浏览上传一个文件，然后点「提 交」。
// 页面上真正的控件是隐藏的 input[type=file]，用 setInputFiles 直接塞文件即可，
// 不需要模拟拖拽。上传完成后会出现文件名或缩略图，据此判断是否真的传上去了。
export const UPLOAD_QUERY = {
  input: 'input[type=file]',
  area: '.question-multi-file-upload, .ant-upload-drag, .unipus-upload, [class*="upload"]',
  fileList: '.ant-upload-list-item, [class*="upload-list"] [class*="item"], .unipus-upload-list-item',
  submit: 'a.btn, button.btn, .ant-btn',
};

export async function inspectUpload(page) {
  try {
    const info = await page.evaluate(q => {
      const input = document.querySelector(q.input);
      const area = document.querySelector(q.area);
      const areaText = String(area?.innerText || '').replace(/\s+/g, ' ').trim();
      // 已上传的文件在这个组件里不一定有 ant-upload-list-item，
      // 但它会把「文件名 + 体积」直接写进上传区文案，认这个更可靠。
      const names = areaText.match(/[^\s]+\.(?:png|jpe?g|gif|bmp|webp|pdf|docx?|pptx?|xlsx?|mp4|mp3|wav|zip|rar|txt)\s+[\d.]+\s*[kKmMgG]?[bB]/g) || [];
      const listed = [...document.querySelectorAll(q.fileList)]
        .filter(el => String(el.innerText || '').trim() || el.querySelector('img'));
      const buttons = [...document.querySelectorAll(q.submit)]
        .map(el => ({text: String(el.innerText || '').replace(/\s+/g, ''), cls: String(el.className || '')}))
        .filter(b => b.text);
      return {
        hasInput: !!input,
        accept: input?.accept || '',
        multiple: !!input?.multiple,
        hasArea: !!area,
        areaText: areaText.slice(0, 200),
        names: names.map(text => String(text).replace(/\s+/g, ' ').trim()).slice(0, 5),
        fileCount: names.length || listed.length,
        buttons,
        text: String(document.querySelector('main')?.innerText || '').replace(/\s+/g, ' ').slice(0, 300),
      };
    }, UPLOAD_QUERY);
    return {isUpload: !!info.hasInput && !!info.hasArea, ...info, files: info.names};
  } catch {
    return {isUpload: false, hasInput: false, hasArea: false, fileCount: 0, names: [], files: [], buttons: []};
  }
}

/**
 * 上传一个文件并提交。已经有作品时默认跳过上传，直接走提交。
 */
export async function uploadWork({page, filePath, gate, wait, submitTexts = ['提交']}) {
  const before = await inspectUpload(page);
  if (!before.isUpload) throw new Error('当前页面不是作品上传任务');
  await gate();

  let uploaded = false;
  if (before.fileCount === 0) {
    await page.locator(UPLOAD_QUERY.input).first().setInputFiles(filePath, {timeout: 30000});
    // 等上传完成：出现文件条目，或者上传区的文案变成已上传状态。
    for (let i = 0; i < 60; i++) {
      await wait(500);
      const now = await inspectUpload(page);
      if (now.fileCount > before.fileCount) { uploaded = true; break; }
    }
    if (!uploaded) throw new Error(`上传 ${filePath} 后没有出现文件条目，可能被格式或大小限制拦下`);
  }

  // 提交按钮的文字可能是「提 交」（中间带空格），比较时去掉所有空白。
  const normalized = submitTexts.map(text => String(text).replace(/\s+/g, ''));
  const buttons = page.locator(UPLOAD_QUERY.submit);
  const total = await buttons.count();
  let clicked = false;
  for (let i = 0; i < total; i++) {
    const button = buttons.nth(i);
    const text = String(await button.innerText().catch(() => '')).replace(/\s+/g, '');
    if (!normalized.some(word => text === word || text.includes(word))) continue;
    await button.scrollIntoViewIfNeeded({timeout: 4000}).catch(() => {});
    await button.click({timeout: 10000});
    clicked = true;
    break;
  }
  if (!clicked) throw new Error(`上传完成但没找到提交按钮（页面按钮：${before.buttons.map(b => b.text).join('、')}）`);

  // 提交后常见一次确认弹窗。
  await wait(1200);
  for (const label of ['确定', '确认', '提交', '是']) {
    const confirm = page.getByRole('button', {name: label}).first();
    if (await confirm.count().catch(() => 0)) {
      if (await confirm.isVisible().catch(() => false)) {
        await confirm.click({timeout: 3000}).catch(() => {});
        break;
      }
    }
  }
  await wait(1500);
  const after = await inspectUpload(page);
  return {status: uploaded ? 'uploaded' : 'submitted', fileCount: after.fileCount, files: after.files, text: after.text.slice(0, 160)};
}