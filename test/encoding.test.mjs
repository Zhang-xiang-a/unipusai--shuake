// 编码回归测试。
//
// 这两条规矩都是踩过坑才立的：
//
// 1. .bat 必须纯 ASCII。cmd 按字节偏移逐行解析，多字节字符会把指针提前，
//    下一行从字节中间开始，报 "'et' is not recognized"。中文一律放 .mjs。
//
// 2. 含中文的 .ps1 必须带 UTF-8 BOM。Windows PowerShell 5.1 读无 BOM 文件时
//    按系统 ANSI 代码页（中文系统 = GBK）解析，中文变乱码、引号配对错乱，
//    整个脚本 ParserError。没装 Node 的机器正好要跑 scripts\install-node.ps1，
//    一跑就崩，于是永远装不上 Node。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BOM = [0xEF, 0xBB, 0xBF];

function reads(dir, ext) {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'artifacts', 'logs', 'browser-profile', 'runtime', '.git'].includes(entry.name)) return [];
      return reads(full, ext);
    }
    return entry.name.endsWith(ext) ? [full] : [];
  });
}

test('所有 .bat 是纯 ASCII（多字节字符会让 cmd 解析错位）', () => {
  const bats = reads(ROOT, '.bat');
  assert.ok(bats.length > 0, '至少要找到 .bat 文件');
  for (const file of bats) {
    const bytes = fs.readFileSync(file);
    const bad = [...bytes].filter(b => b > 127).length;
    assert.equal(bad, 0, `${path.basename(file)} 含 ${bad} 个非 ASCII 字节`);
  }
});

test('含中文的 .ps1 必须带 UTF-8 BOM（否则 PowerShell 5.1 按 GBK 读会语法错误）', () => {
  const scripts = reads(ROOT, '.ps1');
  assert.ok(scripts.length > 0, '至少要找到 .ps1 文件');
  const offenders = [];
  for (const file of scripts) {
    const bytes = fs.readFileSync(file);
    const hasBom = bytes.length >= 3 && BOM.every((b, i) => bytes[i] === b);
    const nonAscii = [...bytes].filter(b => b > 127).length;
    // 纯 ASCII 的 ps1 不受影响（无 BOM 也能正确解析），只有含中文的才必须带 BOM
    if (nonAscii > 0 && !hasBom) offenders.push(`${path.basename(file)}（${nonAscii} 个非 ASCII 字节，无 BOM）`);
  }
  assert.deepEqual(offenders, [], `这些脚本在 Windows PowerShell 5.1 下会解析失败：\n  ${offenders.join('\n  ')}`);
});

test('安装脚本能被 PowerShell 解析（防止改了内容又丢 BOM）', () => {
  const file = path.join(ROOT, 'scripts', 'install-node.ps1');
  assert.ok(fs.existsSync(file), 'scripts/install-node.ps1 应该存在');
  const text = fs.readFileSync(file, 'utf8');
  // BOM 会让 readFileSync('utf8') 在开头留一个 \uFEFF，先去掉再检查内容
  const body = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
  assert.ok(body.includes('$ErrorActionPreference'), '脚本主体应该还在');
  assert.ok(!body.includes('\uFFFD'), '不该出现替换字符（说明编码已经被破坏过）');
  // 关键的下载/解压步骤都在
  for (const needle of ['Invoke-WebRequest', 'Expand-Archive', 'node.exe']) {
    assert.ok(body.includes(needle), `缺少关键步骤：${needle}`);
  }
});
