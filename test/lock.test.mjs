// runner.lock 的自愈能力。
//
// 背景：一次异常退出（或者被强杀、关窗口、断电）会留下锁文件，而
// process.on('exit') 里的清理根本不会执行。之后每次启动都被挡在门外，
// 终端上却说「登录态没保存成功，跳过这本」——用户照着去重新登录，
// 登一百遍也没用。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runner = fs.readFileSync(path.join(ROOT, 'src', 'runner.mjs'), 'utf8');

/** 取锁那一段源码。 */
function lockBlock() {
  const start = runner.indexOf("const lockFile=path.join(output,'runner.lock');");
  assert.ok(start >= 0, '找不到锁的代码段');
  const end = runner.indexOf('const sleep = ms =>', start);
  assert.ok(end > start, '找不到锁代码段的结尾');
  return runner.slice(start, end);
}

test('--setup 不被 runner.lock 挡住', () => {
  const block = lockBlock();
  assert.match(block, /setupOnly\s*=\s*argv\.includes\('--setup'\)/, '要能识别 --setup');
  assert.match(block, /if\s*\(!setupOnly\)/, '锁检查和写锁都要在 !setupOnly 里');
  // 拒绝那一行必须在 !setupOnly 之内，否则 --setup 还是会被挡
  const guard = block.indexOf('if (!setupOnly)');
  const deny = block.indexOf('已有脚本正在运行');
  assert.ok(deny > guard, '拒绝分支必须在 !setupOnly 之内');
});

test('锁文件写坏了也不崩（半截 JSON 是强杀的常见产物）', () => {
  const block = lockBlock();
  // JSON.parse 失败时不能直接 throw，要当"没有锁"
  assert.match(block, /JSON\.parse\(fsSync\.readFileSync\(lockFile/);
  const parseAt = block.indexOf('JSON.parse(fsSync.readFileSync(lockFile');
  const catchAt = block.indexOf('catch (error)', parseAt);
  assert.ok(catchAt > parseAt, 'JSON.parse 要有 catch');
  // 只截到这一层 catch 结束（prior = null），别把后面 process.kill 那个合法的 throw 也框进来
  const catchEnd = block.indexOf('prior = null', catchAt);
  assert.ok(catchEnd > catchAt, 'catch 里应该有 prior = null');
  const catchBody = block.slice(catchAt, catchEnd);
  assert.match(catchBody, /error\.code !== 'ENOENT'/, '要区分 ENOENT');
  assert.match(catchBody, /内容坏了|unlinkSync/, '坏文件要当没锁并删掉，不能抛出去');
  // 不允许把非 ENOENT 的解析错误 rethrow
  assert.doesNotMatch(catchBody, /throw error/, '坏 JSON 不许 rethrow');
});

test('锁内容没有 pid 时当没有锁', () => {
  const block = lockBlock();
  assert.match(block, /Number\.isInteger\(prior\.pid\)/, '要校验 pid 是整数');
});

test('超过 12 小时的锁当残留清掉', () => {
  const block = lockBlock();
  assert.match(block, /12 \* 3600 \* 1000/, '要有 12 小时阈值');
  assert.match(block, /stale/, '要有 stale 判断');
  // 时间戳读不出来也要放行，别让人卡在一个说不清的锁上
  assert.match(block, /!Number\.isFinite\(ageMs\)/, '时间无效时也该当过期');
});

test('被挡时告诉用户可以直接删锁文件', () => {
  const block = lockBlock();
  assert.match(block, /直接删掉这个文件再跑/, '要给出比 npm run stop 更直接的办法');
  assert.match(block, /\$\{lockFile\}/, '要把锁文件的实际路径打出来');
});

test('只读命令不碰锁', () => {
  // --list / --audit / --courses / --setup 这些在锁检查之前就 return/exit 了
  assert.match(runner, /只读队列，不连接浏览器、不占用 runner\.lock/);
  assert.match(runner, /oneShotCommand/);
});

test('锁里记了时间戳（没有它就判断不了过期）', () => {
  const block = lockBlock();
  assert.match(block, /time:\s*new Date\(\)\.toISOString\(\)/, '写锁时要带时间');
});

test('正常退出会清锁（前提是锁还是自己的）', () => {
  const block = lockBlock();
  assert.match(block, /process\.on\('exit'/, '要有 exit 清理');
  assert.match(block, /=== process\.pid/, '只能删自己那把锁，不能误删别人的');
});
