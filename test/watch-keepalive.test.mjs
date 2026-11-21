// 「长时间未操作，学习暂停」这类弹窗的识别 + 挂机保活。
//
// 背景：光把弹窗点掉治标不治本。播放器是在数用户的活跃度——没有 mousemove
// 就认为人走了，暂停计时，过几分钟又弹。所以除了认弹窗，还得主动制造动静。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PAUSE_TEXT, PAUSE_STRONG, RESUME_LABEL, DIALOG_SELECTOR} from '../src/watch-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('各种「长时间未操作」的文案都认得出', () => {
  const wordings = [
    '您已长时间未操作，学习暂停',
    '您长时间无操作，学习已暂停',
    '学习已暂停，点击继续学习',
    '长时间未操作，是否继续',
    '抱歉，您已离开页面',
    '超时未操作',
    '学习暂停',
  ];
  for (const text of wordings) {
    assert.match(text, PAUSE_TEXT, `没认出：${text}`);
  }
});

test('泛词「暂停」不会被当成强特征（否则会误点播放器的暂停按钮）', () => {
  // 整页兜底只认强特征，避免把「暂停」两个字当成弹窗证据
  assert.doesNotMatch('播放/暂停', PAUSE_STRONG);
  assert.doesNotMatch('倍速 暂停', PAUSE_STRONG);
  // 但真正的弹窗文案必须命中
  assert.match('您已长时间未操作，学习暂停', PAUSE_STRONG);
  assert.match('您长时间无操作，学习已暂停', PAUSE_STRONG);
});

test('弹窗上那个「继续」按钮的各种叫法都认得', () => {
  for (const label of ['继续学习', '继续观看', '继续', '我知道了', '知道了', '确定', '确认', '好的', '是的', '重播']) {
    assert.match(label.replace(/\s/g, ''), RESUME_LABEL, `没认出按钮：${label}`);
  }
});

test('对话框选择器覆盖 class 和 id 两种挂法', () => {
  for (const piece of ['[class*="modal"]', '[id*="modal"]', '[class*="mask"]', '[id*="mask"]', '[role="dialog"]']) {
    assert.ok(DIALOG_SELECTOR.includes(piece), `选择器缺 ${piece}`);
  }
});

test('watch.mjs 每个监控点都做了保活', () => {
  const watch = fs.readFileSync(path.join(ROOT, 'src', 'watch.mjs'), 'utf8');
  // 视频播放循环里必须保活
  const playOnce = watch.slice(watch.indexOf('async function playOnce'));
  const loop = playOnce.slice(0, playOnce.indexOf('async function main'));
  assert.match(loop, /keepAlive\(page/, 'playOnce 的 tick 循环里要 keepAlive');
  assert.match(loop, /dismissPauseDialog\(page/, 'playOnce 里要处理弹窗');
  // 播完停留那段也要保活（那是最容易弹窗的 5 分钟）
  assert.match(watch, /停留期间弹窗已处理/, 'dwell 期间要处理弹窗');
  const dwell = watch.slice(watch.indexOf('const until = Date.now()'));
  assert.match(dwell.slice(0, 600), /keepAlive\(page/, 'dwell 期间要 keepAlive');
});

test('播放器被弹窗换掉时重新加载，而不是直接算失败', () => {
  const watch = fs.readFileSync(path.join(ROOT, 'src', 'watch.mjs'), 'utf8');
  assert.match(watch, /播放器不见了，重新加载这一页/);
  assert.doesNotMatch(watch, /if \(!state\) return \{played: false, reason: '视频元素消失'\}/,
    'video 消失不该直接判失败——先重载再试一次');
});

test('挂机开始时把标签切到前台（后台标签会被节流）', () => {
  const watch = fs.readFileSync(path.join(ROOT, 'src', 'watch.mjs'), 'utf8');
  assert.match(watch, /bringToFront\(\)/, '要 page.bringToFront()，否则后台标签的视频会停');
});

test('keepAlive 只移动鼠标、不点击（不会误触播放条和按钮）', () => {
  const lib = fs.readFileSync(path.join(ROOT, 'src', 'watch-lib.mjs'), 'utf8');
  const body = lib.slice(lib.indexOf('export async function keepAlive'));
  const fn = body.slice(0, body.indexOf('export async function ensurePlaying'));
  assert.match(fn, /page\.mouse\.move\(/, '要移动鼠标');
  assert.doesNotMatch(fn, /\.click\(|mouse\.down|mouse\.up/, '不许点击，挂机时会误触');
});
