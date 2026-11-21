import fs from 'node:fs/promises';
import path from 'node:path';
import {gotoWithRetry} from './net.mjs';
import {detectLoginLost} from './browser-session.mjs';

// Read only rendered directory entries and visit required task pages; never submit.
export async function crawlRequired({context, overview, solver, config, output, gate, wait, snapshot}) {
  const dir = path.join(output, 'inventory');
  await fs.mkdir(dir, {recursive:true});
  const uiTexts = config.uiTexts || {};
  // 目录页会异步渲染；导航带超时与重试，失败时给出可读原因而不是直接崩。
  await gotoWithRetry(overview, config.courseUrl, {
    timeoutMs: config.network?.gotoTimeoutMs ?? 30000,
    retries: config.network?.retries ?? 2,
    retryDelayMs: config.network?.retryDelayMs ?? 1500,
  });
  // uai 和 ucontent 是两个域，登录态不通用。只登了课件页时这里会被踢到登录页，
  // 后面找单元页签自然找不着，所以要先把"没登录"和"页面没渲染好"分开。
  const landed = (() => { try { return new URL(overview.url()); } catch { return null; } })();
  if (landed && !/^(?:[^.]*\.)?uai\.unipus\.cn$/.test(landed.hostname)) {
    throw new Error([
      `课程目录页没打开，被带到了：${overview.url().slice(0, 120)}`,
      '这通常说明 uai.unipus.cn 这个域还没登录。',
      'uai（课程目录）和 ucontent（课件）是两个独立域，登录态不通用。',
      `做法：在专用 Edge 窗口里打开 ${config.courseUrl}，登录一次，看到单元列表后重跑 npm run crawl。`,
    ].join('\n'));
  }
  await wait(3500);
  const unitTabs = overview.locator('[class*="unipus-tabs_unitTabItemContainer"]');
  // 目录页是异步渲染的，机器慢或第一次进课（要拉课程数据）都可能超过 3.5 秒。
  // 轮询等待而不是死等一次，最多等 45 秒。
  let unitCount = 0;
  for (let i = 0; i < 45; i++) {
    unitCount = await unitTabs.count();
    if (unitCount) break;
    // URL 还停在 uai 但页面自己写着"登录过期，请重新登录"——这种情况只看 URL 判断不出来。
    const lost = await detectLoginLost(overview, {ssoHost: config.course?.login?.ssoHost});
    if (lost && i >= 2) {
      const bodyTail = await overview.evaluate(() =>
        String(document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 200)).catch(() => '');
      throw new Error([
        `课程目录页显示未登录：${lost}`,
        `  页面文字：${bodyTail}`,
        '',
        '不是选择器的问题，是这个账号在 uai.unipus.cn 上的登录态已经失效。',
        '常见原因：',
        '  1) 同一个账号在别的电脑 / 别的浏览器里也登着，后登的把这里顶掉了',
        '  2) 登录已超过有效期',
        '做法：在专用 Edge 窗口里打开 https://uai.unipus.cn 重新登录，',
        '      确认页面上能看到「我的课程」和课程列表，再重跑 npm run crawl。',
        '      如果反复掉线，先把其它设备上的 U校园 退出登录。',
      ].join('\n'));
    }
    await wait(1000);
  }
  if (!unitCount) {
    const here = overview.url().slice(0, 110);
    const bodyTail = await overview.evaluate(() =>
      String(document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 160)).catch(() => '');
    // U校园对「这个 courseId 我不认识」和「你没登录」给的是同一句「登录过期，请重新登录」。
    // 光看页面文字分不出来，但门户首页的 localStorage 里有没有 __token 能分：
    // 有 __token 说明登录好好的，那问题一定在这个 ID 上。
    const hasToken = await overview.evaluate(() => {
      try { return !!localStorage.getItem('__token'); } catch { return false; }
    }).catch(() => false);
    let portalCourses = '';
    try {
      const portal = await context.newPage();
      await portal.goto('https://uai.unipus.cn/portal', {waitUntil: 'domcontentloaded', timeout: 25000});
      await wait(4000);
      portalCourses = await portal.evaluate(() => {
        const m = String(document.body.innerText || '').match(/我的教程([\s\S]{0,120})/);
        return m ? m[0].replace(/\s+/g, ' ').slice(0, 120) : '';
      });
      await portal.close();
    } catch { /* 门户打不开就按未登录处理，下面的提示仍然成立 */ }
    if (hasToken) {
      throw new Error([
        '这个 courseId 打不开：登录是好的，问题在 ID 上。',
        `  courseId：${config.course?.courseId}`,
        `  当前地址：${here}`,
        portalCourses ? `  你账号下能看到的课程：${portalCourses}` : '',
        '',
        'U校园对「课程不存在 / 无权访问」返回的也是「登录过期，请重新登录」，',
        '所以这个提示会把人引到登录方向，实际是 ID 填错了。',
        '做法：在专用 Edge 里登录后，点进要跑的那门课，',
        '      地址栏里 resource-detail/ 后面那串数字就是正确的 courseId，',
        '      填到 config.json 的 courses.<课程>.courseId，再重跑 npm run crawl。',
      ].filter(Boolean).join('\n'));
    }
    throw new Error([
      '在课程目录页没找到单元页签，无法确认必修范围。',
      `  当前地址：${here}`,
      `  页面开头：${bodyTail || '（读不到页面文字）'}`,
      '常见原因：',
      '  1) 还没登录：先在专用 Edge 窗口里登录，再跑 npm run setup',
      '  2) courseId 填错：应该是地址栏 resource-detail/ 后面那串数字',
      '  3) 课程页需要手动进入：先在那个 Edge 窗口里点进课程，确认能看到 Unit 1~6 的页签',
      '确认能看到目录后重跑 npm run crawl。',
    ].join('\n'));
  }
  const manifest = [];
  for (let ui=0;ui<unitCount;ui++) {
    await gate(); await unitTabs.nth(ui).click(); await wait(900);
    for (let n=0;n<8;n++) {
      const collapsed = overview.locator('[class*="courseDetailNodeCollapseContainer"] .ant-collapse-header[aria-expanded=false]');
      if (!await collapsed.count()) break;
      await collapsed.first().click(); await wait(150); n--;
    }
    const tasks = await overview.evaluate(() => Array.from(document.querySelectorAll('[class*="courses-unit_taskItemContainer"]')).filter(e=>e.getBoundingClientRect().height>0).map(e => {
      const chain=[];
      for(let p=e.parentElement;p;p=p.parentElement) {
        if(p.classList.contains('ant-collapse-item')) {
          const h=p.querySelector(':scope > .ant-collapse-header .ant-collapse-header-text');
          if(h) chain.unshift(h.innerText.trim());
        }
      }
      return {path:chain,task:e.querySelector('[class*="taskTypeName"]')?.innerText.trim(),required:!!e.querySelector('[class*="taskRequireIcon"]'),status:e.querySelector('[class*="taskStateContainer"]')?.innerText.trim()};
    }));
    manifest.push(...tasks.map(t=>({...t,unit:ui+1,key:JSON.stringify([ui+1,...t.path,t.task])})));
    await fs.writeFile(path.join(dir,`directory-unit-${ui+1}.html`),await overview.content());
    console.log(`目录 Unit ${ui+1}: ${tasks.filter(t=>t.required).length}/${tasks.length} 必修`);
  }
  await fs.writeFile(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2));
  const startPattern = new RegExp(`^(${uiTexts.startLearning || '开始学习'}|${uiTexts.continueLearning || '继续学习'})$`);
  await overview.getByRole('button',{name:startPattern}).click(); await wait(2000);
  const coursewareHost = (config.login?.courseHosts || []).find(host => /ucontent/i.test(host)) || 'ucontent.unipus.cn';
  const course=context.pages().filter(p=>p!==solver && (() => { try { return new URL(p.url()).hostname === coursewareHost; } catch { return false; } })()).at(-1);
  if(!course) throw new Error('课件标签未打开');
  const dismissText = uiTexts.dismiss || '我知道了';
  let notices=[];
  await course.addLocatorHandler(course.getByRole('button',{name:dismissText,exact:true}),async locator=>{
    notices.push(await course.locator('.ant-modal-wrap:visible').innerText());
    await locator.click();
  });
  async function dismiss() {
    const text=await course.evaluate(dismissLabel=>{
      const modal=Array.from(document.querySelectorAll('.ant-modal-wrap')).find(e=>e.getBoundingClientRect().height>0);
      if(!modal)return '';
      const button=Array.from(modal.querySelectorAll('button')).find(e=>e.innerText.trim()===dismissLabel);
      if(!button)return '';
      const text=modal.innerText;button.click();return text;
    },dismissText);
    if(text){notices.push(text);await wait(350);}
  }
  await wait(1500); await dismiss();
  const menus=await course.locator('.pc-menu-node-name').evaluateAll(es=>es.map((e,index)=>{
    let section='',unit='';
    for(let p=e.parentElement;p;p=p.parentElement) {
      const s=p.querySelector(':scope > [data-role="section"]');
      const u=p.querySelector(':scope > [data-role="unit"]');
      if(s && !section) section=s.innerText.trim();
      if(u && !unit) unit=u.innerText.trim();
    }
    return {index,name:e.innerText.trim(),section,unit:Number(unit.match(/Unit\s+(\d+)/)?.[1])};
  }));
  await fs.writeFile(path.join(dir,'menus.json'),JSON.stringify(menus,null,2));
  let inventory=[];
  try { inventory=JSON.parse(await fs.readFile(path.join(dir,'required-tasks.json'),'utf8')); } catch(e) {if(e.code!=='ENOENT')throw e;}
  const seen=new Set(inventory.map(t=>t.key));
  for(const m of menus) {
    const targets=manifest.filter(t=>t.required && t.unit===m.unit && t.path[0]===m.section && (t.path[1]===m.name || (t.path.length===1 && m.name===m.section)));
    if(!targets.some(t=>!seen.has(t.key))) continue;
    await gate(); await dismiss();
    await course.locator('.pc-menu-node-name').nth(m.index).click(); await wait(1400); await dismiss();
    for(const t of targets) {
      if(seen.has(t.key))continue;
      await gate(); notices=[]; await dismiss();
      const tabName=t.path[2] || t.path[1];
      const tab=course.locator('.pc-tab-view-container').filter({hasText:new RegExp('^'+tabName.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$')});
      if(await tab.count()!==1)throw new Error(`页签无法唯一定位 ${t.key}`);
      await tab.click(); await wait(1400); await dismiss();
      const task=course.locator('.pc-task').filter({hasText:new RegExp('^'+t.task.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$')});
      if(await task.count()!==1)throw new Error(`任务无法唯一定位 ${t.key}`);
      await task.click(); await wait(1600); await dismiss();
      const state=await snapshot(course);
      const text=await course.locator('main').innerText();
      const record={...state,...t,text,evidence:notices};
      await fs.writeFile(path.join(dir,`task-${inventory.length+1}.html`),await course.locator('main').evaluate(e=>e.outerHTML));
      inventory.push(record);seen.add(t.key);
      await fs.writeFile(path.join(dir,'required-tasks.json'),JSON.stringify(inventory,null,2));
      console.log(`必修遍历 ${inventory.length}: Unit ${t.unit} / ${t.path.join(' / ')} / ${t.task}`);
    }
  }
  const missing=manifest.filter(t=>t.required && !seen.has(t.key));
  await fs.writeFile(path.join(dir,'missing.json'),JSON.stringify(missing,null,2));
  console.log(`必修遍历 ${inventory.length}/${manifest.filter(t=>t.required).length}；缺失 ${missing.length}`);
  if(missing.length)throw new Error('仍有必修任务未定位，详见 inventory/missing.json');
}
