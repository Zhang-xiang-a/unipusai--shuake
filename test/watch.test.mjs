import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDuration, formatDuration, extractStudySeconds} from '../src/watch-lib.mjs';

test('parseDuration 解析时分秒，非法值返回 null', () => {
  assert.equal(parseDuration('06:46:11'), 6 * 3600 + 46 * 60 + 11);
  assert.equal(parseDuration('20:00:00'), 72000);
  assert.equal(parseDuration('00:05:00'), 300);
  assert.equal(parseDuration('6:46:11'), 6 * 3600 + 46 * 60 + 11);
  assert.equal(parseDuration('99:99:99'), null, '分秒超过 59 不算合法时长');
  assert.equal(parseDuration('abc'), null);
  assert.equal(parseDuration(''), null);
});

test('formatDuration 与 parseDuration 互为逆运算', () => {
  for (const text of ['00:00:00', '06:46:11', '19:59:59', '20:00:00']) {
    assert.equal(formatDuration(parseDuration(text)), text);
  }
  assert.equal(formatDuration(0), '00:00:00');
  assert.equal(formatDuration(-10), '00:00:00');
});

test('extractStudySeconds 从综合成绩页文本里取必修学习时长', () => {
  const page = '当前成绩： 67.1分 成绩明细 考核项 权重占比 完成情况 得分 操作 '
    + '必修学习时长 40% 06:46:11 13.5 查看详情 教程学习成绩 60% 185/185 任务点 53.6 查看详情';
  assert.equal(extractStudySeconds(page), 6 * 3600 + 46 * 60 + 11);
});

test('extractStudySeconds 兼容只有分秒的写法', () => {
  const page = '必修学习时长 40% 12:34 13.5 查看详情';
  assert.equal(extractStudySeconds(page), 12 * 60 + 34);
});

test('extractStudySeconds 拿不到时返回 null 而不是乱猜', () => {
  assert.equal(extractStudySeconds(''), null);
  assert.equal(extractStudySeconds('教程学习成绩 60% 185/185 任务点 53.6'), null);
});