import test from 'node:test';
import assert from 'node:assert/strict';
import {courseCompleted, leafIdOf, swapUnitId, unitIdOf} from '../src/course-progress.mjs';

test('unitIdOf / leafIdOf 从任务 URL 的 hash 里取单元和叶子 ID', () => {
  const url = 'https://uai.unipus.cn/portal#/course/courseware/UNIT-A/leaf-42';
  assert.equal(unitIdOf(url), 'UNIT-A');
  assert.equal(leafIdOf(url), 'leaf-42');
  // 不是课程 URL 时返回 undefined，不能抛错。
  assert.equal(unitIdOf('https://example.com/'), undefined);
  assert.equal(leafIdOf('not-a-url'), undefined);
});

test('swapUnitId 只替换倒数第三段，其余部分原样保留', () => {
  const url = 'https://ucontent.unipus.cn/x/course_progress/unitA/some-leaf/tail?token=1';
  // 与 verify-tasks 里 pathname.split('/').at(-3) === unitId 的约定一致。
  assert.equal(new URL(url).pathname.split('/').at(-3), 'unitA');
  const swapped = swapUnitId(url, 'unitB');
  assert.match(swapped, /\/course_progress\/unitB\//);
  assert.match(swapped, /tail\?token=1$/);
  assert.equal(new URL(swapped).pathname.split('/').at(-3), 'unitB');
});

test('courseCompleted 只认 pass 为 1 或 2', () => {
  assert.equal(courseCompleted({state: {pass: 1}}), true);
  assert.equal(courseCompleted({state: {pass: 2}}), true);
  assert.equal(courseCompleted({state: {pass: 0}}), false);
  assert.equal(courseCompleted({state: {}}), false);
  assert.equal(courseCompleted(null), false);
  assert.equal(courseCompleted(undefined), false);
});