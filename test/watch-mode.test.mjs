// 模式 2（刷时长）的两条回归线。
//
// 背景：模式 2 曾经调的是 `runner.mjs --answer …`——那是答题模式，会强校验
// OPENAI_MODEL。于是「刷时长」这件根本不需要模型的事，在没配模型的机器上
// 4 秒就退出了，报告还显示「已学完 0 个」。
//
// 现在改走 watch.mjs（自己筛 Preview、自己循环播放到目标时长，不碰模型），
// 报告也改成报「必修学习时长」。这两点都得盯住，别哪天又被改回去。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wizardSource = fs.readFileSync(path.join(ROOT, 'src', 'wizard.mjs'), 'utf8');

/** 去掉行注释和块注释。说明文字里提到什么都不算数，只看真代码。 */
function stripComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map(line => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

/** 取一个顶层函数体内的源码，用来只检查那一段。 */
function functionBody(name) {
  const start = wizardSource.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, `wizard.mjs 里应该有 ${name}`);
  const open = wizardSource.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < wizardSource.length; i++) {
    if (wizardSource[i] === '{') depth++;
    else if (wizardSource[i] === '}') {
      depth--;
      if (depth === 0) return wizardSource.slice(open, i + 1);
    }
  }
  throw new Error(`${name} 的大括号没闭合`);
}

test('模式 2 用 watch.mjs 挂时长，不再走答题模式', () => {
  const body = functionBody('stepWatchOnly');
  assert.match(body, /runNode\(\s*'watch\.mjs'/, '刷时长必须调 watch.mjs');
  assert.doesNotMatch(body, /'--answer'/, '刷时长不该带 --answer：那是答题模式，会强校验模型');
  assert.doesNotMatch(body, /'--path'/, 'watch.mjs 自己筛 Preview，不需要 --path');
});

test('刷时长的实际代码不碰模型（注释里提历史不算）', () => {
  const code = stripComments(functionBody('stepWatchOnly'));
  assert.doesNotMatch(code, /OPENAI_MODEL|api\.model|testModel|stepModel/, '刷时长的代码不该引用模型配置');
  // 但仍然要明确告诉用户不用配模型
  assert.match(functionBody('stepWatchOnly'), /不需要模型/);
});

test('模式 2 的报告报学习时长，不报「已学完 N 个」', () => {
  // 报告分支：previewMode 为真时读 stats.watch，展示「必修学习时长」
  const start = wizardSource.indexOf("if (previewMode) {");
  assert.ok(start >= 0, '应该有 previewMode 分支');
  const block = wizardSource.slice(start, start + 1200);
  assert.match(block, /stats\.watch/, '要读 watch-progress 的数据');
  assert.match(block, /必修学习时长/, '要报学习时长');
  assert.doesNotMatch(block, /已学完：/, '不该再报「已学完 N 个」——watch 不写 answer-progress');
});

test('watch.mjs 本身不依赖模型配置', () => {
  const watch = fs.readFileSync(path.join(ROOT, 'src', 'watch.mjs'), 'utf8');
  assert.doesNotMatch(watch, /OPENAI_MODEL/, 'watch.mjs 里不该有 OPENAI_MODEL 校验');
  assert.doesNotMatch(watch, /createApiPlanner|api-planner/, 'watch.mjs 不该加载答题规划器');
  // 它确实会筛 Preview
  assert.match(watch, /Preview/, 'watch.mjs 应该自己筛 Preview');
});

test('watch-progress.json 的字段和报告用法对得上', () => {
  // watch.mjs 写的是 {updatedAt/finishedAt, seconds, targetSeconds, rounds}
  const watch = fs.readFileSync(path.join(ROOT, 'src', 'watch.mjs'), 'utf8');
  for (const field of ['seconds', 'targetSeconds', 'rounds']) {
    assert.match(watch, new RegExp(`${field}\\s*[,:]`), `watch.mjs 应该写 ${field}`);
  }
  // wizard 读的也是这几个
  const start = wizardSource.indexOf("if (previewMode) {");
  const block = wizardSource.slice(start, start + 1200);
  for (const field of ['watch.seconds', 'watch.targetSeconds', 'watch.rounds']) {
    assert.ok(block.includes(field), `报告应该用到 ${field}`);
  }
});
