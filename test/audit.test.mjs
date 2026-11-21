import test from 'node:test';
import assert from 'node:assert/strict';
import {auditQueue, formatAudit} from '../src/audit.mjs';

const QUEUE = [
  {key: '[1,"A","x"]', unit: 1, path: ['A', 'x'], type: '翻译'},
  {key: '[1,"A","y"]', unit: 1, path: ['A', 'y'], type: '选择题'},
  {key: '[2,"B","z"]', unit: 2, path: ['B', 'z'], type: '单词 / 短语填空'},
  {key: '[2,"B","w"]', unit: 2, path: ['B', 'w'], type: '翻译'},
];

test('auditQueue 分开统计已完成、未开始、失败和其他状态', () => {
  const progress = {tasks: {
    '[1,"A","x"]': {status: 'submitted'},
    '[1,"A","y"]': {status: 'learned'},
    '[2,"B","z"]': {status: 'failed', reason: '重复失败 3 次'},
    '[2,"B","w"]': {status: 'in-progress'},
  }};
  const report = auditQueue(QUEUE, progress);
  assert.equal(report.total, 4);
  assert.deepEqual(report.done.map(r => r.key), ['[1,"A","x"]', '[1,"A","y"]']);
  assert.deepEqual(report.failed.map(r => r.key), ['[2,"B","z"]']);
  assert.deepEqual(report.other.map(r => r.key), '[2,"B","w"]'.length ? ['[2,"B","w"]'] : []);
  assert.equal(report.unknown.length, 0);
  assert.deepEqual(report.pending.map(t => t.key), ['[2,"B","z"]', '[2,"B","w"]']);
});

test('auditQueue 里没有任何进度记录的任务算未开始', () => {
  const report = auditQueue(QUEUE, {tasks: {}});
  assert.equal(report.unknown.length, 4);
  assert.equal(report.done.length, 0);
  assert.deepEqual(report.pending.map(t => t.key), QUEUE.map(t => t.key));
});

test('formatAudit 按单元分组，并提示全部完成', () => {
  const partial = formatAudit(auditQueue(QUEUE, {tasks: {'[1,"A","x"]': {status: 'submitted'}}}));
  assert.match(partial, /未完成 3 个/);
  assert.match(partial, /Unit 1/);
  assert.match(partial, /Unit 2/);
  assert.match(partial, /--only-missing/);

  const all = formatAudit(auditQueue(QUEUE, {tasks: Object.fromEntries(QUEUE.map(t => [t.key, {status: 'submitted'}]))}));
  assert.match(all, /全部必修任务都已完成/);
  assert.doesNotMatch(all, /--only-missing/);
});

test('课程侧已通过的任务不再算未完成，哪怕本地记成 learning 或 failed', () => {
  const withUrls = QUEUE.map((t, i) => ({...t, url: `https://uai.unipus.cn/portal#/course/courseware/UNIT-${t.unit}/leaf-${i}`}));
  // 本地进度落后：视频记成 learning，填空题记成 failed。
  const progress = {tasks: {
    '[1,"A","x"]': {status: 'learning'},
    '[1,"A","y"]': {status: 'failed'},
  }};
  // 课程侧说这两个都通过了（pass=2）。
  const courseLeafs = {'leaf-0': {state: {pass: 2}}, 'leaf-1': {state: {pass: 1}}};
  const report = auditQueue(withUrls, progress, {courseLeafs});
  assert.equal(report.courseChecked, true);
  assert.equal(report.courseVerified, 2);
  assert.equal(report.done.length, 2);
  assert.deepEqual(report.pending.map(t => t.key), ['[2,"B","z"]', '[2,"B","w"]']);
});

test('课程侧没通过的任务仍然算未完成，哪怕本地记成 submitted', () => {
  const withUrls = QUEUE.map((t, i) => ({...t, url: `https://uai.unipus.cn/portal#/course/courseware/UNIT-${t.unit}/leaf-${i}`}));
  const progress = {tasks: {'[1,"A","x"]': {status: 'submitted'}}};
  const courseLeafs = {'leaf-0': {state: {pass: 0}}, 'leaf-1': {state: {pass: 1}}};   // 第一个课程侧没通过
  const report = auditQueue(withUrls, progress, {courseLeafs});
  assert.deepEqual(report.done.map(r => r.key), ['[1,"A","y"]']);
  assert.ok(report.pending.some(t => t.key === '[1,"A","x"]'), '课程侧未通过的应当回到待办');
});