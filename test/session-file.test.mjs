// 全新解压的项目里没有 browser-profile 目录。
//
// 这个目录原来只靠 browser.mjs 启动 Edge 时顺带创建。但 `runner.mjs --setup`
// 连的是已经在跑的 Edge（connectOverCDP），根本不走那条路；于是写
// browser-profile/runner-session.json 直接 ENOENT，登录态保存失败，
// 整个流程卡死在第二步。
//
// 正式环境从没暴露过，因为那个目录早就被用出来了。换了台干净机器就炸。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runner = fs.readFileSync(path.join(ROOT, 'src', 'runner.mjs'), 'utf8');

test('写登录态之前先建目录', () => {
  const mk = runner.indexOf('mkdir(path.dirname(authFile)');
  const write = runner.indexOf('writeFile(authFile');
  assert.ok(mk >= 0, 'runner.mjs 应该先 mkdir browser-profile');
  assert.ok(write >= 0, 'runner.mjs 应该写 authFile');
  assert.ok(mk < write, 'mkdir 必须在 writeFile 之前，否则还是 ENOENT');
});

test('登录态存不下来时给能看懂的提示，不是裸 ENOENT 堆栈', () => {
  assert.match(runner, /登录态存不下来/, '要有一句中人话的错误说明');
  assert.match(runner, /没有写入权限|目录不存在/, '要说清是哪种原因');
  assert.doesNotMatch(runner, /catch \(error\) \{\s*throw error;\s*\}\s*$/m, '不许把原始错误直接抛出去');
});

test('启动 Edge 那条路也会建目录（双保险）', () => {
  const browser = fs.readFileSync(path.join(ROOT, 'src', 'browser.mjs'), 'utf8');
  assert.match(browser, /mkdir\(BROWSER_PROFILE_DIR/, 'browser.mjs 启动 Edge 时要建 profile 目录');
});

test('SESSION_FILE 落在 browser-profile 下，不在项目根乱扔', () => {
  const paths = fs.readFileSync(path.join(ROOT, 'src', 'paths.mjs'), 'utf8');
  assert.match(paths, /SESSION_FILE = path\.join\(BROWSER_PROFILE_DIR, 'runner-session\.json'\)/);
});

test('browser-profile 和 artifacts 都在 gitignore 里（本地文件不进仓库）', () => {
  const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  assert.match(ignore, /browser-profile/, 'browser-profile 要忽略：里面有登录态');
  assert.match(ignore, /artifacts/, 'artifacts 要忽略：里面有采集结果');
});

test('打包出来的测试包不带 browser-profile（里面有真实 cookies）', () => {
  // 测试包目录若在本机，检查它确实没有这个目录
  const pkg = 'C:/Users/Lenovo/Desktop/unipus-test-package';
  if (!fs.existsSync(pkg)) return; // 别的机器上没有这个路径，跳过
  assert.equal(fs.existsSync(path.join(pkg, 'browser-profile')), false,
    '测试包里不能有 browser-profile：runner-session.json 含真实登录态');
});
