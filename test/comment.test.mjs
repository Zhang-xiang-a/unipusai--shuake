import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectComment, postComment} from '../src/comment.mjs';

test('inspectComment never treats a page without discussion markup as a comment task', async () => {
  assert.deepEqual(await inspectComment({evaluate: async () => ({isComment: false})}), {isComment: false});
  // 页面正在跳转或已关闭时不能误判成评论任务，否则正常的答题任务会被吞掉。
  assert.deepEqual(await inspectComment({evaluate: async () => { throw new Error('page closed'); }}), {isComment: false});
  assert.deepEqual(await inspectComment({evaluate: async () => undefined}), {isComment: false});
});

test('postComment skips reposting when the discussion already has entries', async () => {
  const page = {evaluate: async () => ({isComment: true, hasBox: true, hasSubmit: true, count: 2, preview: ['666', '同问']})};
  const result = await postComment({page, text: '666', gate: async () => {}, wait: async () => {}});
  assert.equal(result.status, 'already');
  assert.equal(result.count, 2);
});

test('postComment reports a readable error when the box or button is missing', async () => {
  const noBox = {evaluate: async () => ({isComment: true, hasBox: false, count: 0})};
  await assert.rejects(postComment({page: noBox, text: '666', gate: async () => {}, wait: async () => {}}), /没有找到输入框/);

  const notComment = {evaluate: async () => ({isComment: false})};
  await assert.rejects(postComment({page: notComment, text: '666', gate: async () => {}, wait: async () => {}}), /不是评论任务/);
});