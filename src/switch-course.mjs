// 换课向导：问用户这次要跑哪本书，从 courses.txt 取出课程资源 ID，写进 config.json。
//
// 只做三件事：
//   1. 读 courses.txt（课程资源 ID 的唯一来源，改 ID 只改这个文件）
//   2. 问用户选哪门
//   3. 把 activeCourse 和该课的 courseResourceId 写回 config.json
//
// 不用外部依赖：node:readline/promises 就够。
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import process from 'node:process';
import {ROOT_DIR, CONFIG_FILE} from './paths.mjs';

const COURSES_FILE = path.join(ROOT_DIR, 'courses.txt');

const ALIAS = {
  '1': 'course1', '一': 'course1', '大一': 'course1', 'a': 'course1',
  '2': 'course2', '二': 'course2', '大二': 'course2', 'b': 'course2',
  '3': 'course3', '三': 'course3', '大三': 'course3', 'c': 'course3',
  '4': 'course4', '四': 'course4', '大四': 'course4', 'd': 'course4',
};

/** 解析 courses.txt：忽略空行和 # 注释，按 | 切三段。 */
export function parseCourses(text) {
  const rows = [];
  String(text).split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const parts = line.split('|').map(s => s.trim());
    if (parts.length < 3) {
      rows.push({error: `第 ${i + 1} 行格式不对（要用 分组 | 书名 | ID）：${line}`});
      return;
    }
    const [key, label, id] = parts;
    rows.push({key, label: label || key, id: id || ''});
  });
  const errors = rows.filter(r => r.error).map(r => r.error);
  return {courses: rows.filter(r => !r.error), errors};
}

function readCoursesOrDie() {
  if (!fs.existsSync(COURSES_FILE)) {
    throw new Error(`找不到 ${COURSES_FILE}。\n` +
      '这个文件存课程资源 ID，应该和 config.json 放在一起。\n' +
      '从发行包里找一份 courses.txt 复制过来，或者自己建一个：\n' +
      '  course1 | 大学英语 1 | 你的ID\n' +
      '  course2 | 大学英语 2 | 你的ID');
  }
  const {courses, errors} = parseCourses(fs.readFileSync(COURSES_FILE, 'utf8'));
  if (errors.length) {
    console.log('courses.txt 有格式问题（这些行被跳过）：');
    for (const e of errors) console.log('  ' + e);
    console.log('');
  }
  if (!courses.length) throw new Error('courses.txt 里没有可用的课程行，检查格式：分组 | 书名 | 课程资源 ID');
  return courses;
}

function readConfigOrDie() {
  if (!fs.existsSync(CONFIG_FILE)) {
    throw new Error(`找不到 ${CONFIG_FILE}。\n先从模板复制一份：copy config.example.json config.json`);
  }
  const text = fs.readFileSync(CONFIG_FILE, 'utf8');
  try {
    return {json: JSON.parse(text), text};
  } catch (error) {
    throw new Error(`config.json 不是合法 JSON，先修好它再换课：\n  ${error.message}`);
  }
}

/** 用户输入 → 课程分组。支持序号、分组名、书名片段、别名。 */
export function resolveChoice(input, courses) {
  const value = String(input || '').trim();
  if (!value) return null;
  const lower = value.toLowerCase();

  // 纯序号：1 就是列表里第 1 个
  if (/^\d+$/.test(lower)) {
    const index = Number(lower);
    if (ALIAS[lower]) {
      const byAlias = courses.find(c => c.key === ALIAS[lower]);
      if (byAlias) return byAlias;
    }
    if (index >= 1 && index <= courses.length) return courses[index - 1];
  }
  if (ALIAS[lower]) {
    const hit = courses.find(c => c.key === ALIAS[lower]);
    if (hit) return hit;
  }
  // 分组名精确匹配
  const byKey = courses.find(c => c.key.toLowerCase() === lower);
  if (byKey) return byKey;

  // 书名片段匹配。先试原样，再试「大英2 → 大学英语2」这种口语写法。
  const candidates = [lower];
  const spoken = lower.replace(/^大英\s*(\d+)$/, '大学英语 $1').replace(/^英\s*(\d+)$/, '大学英语 $1');
  if (spoken !== lower) candidates.push(spoken);
  for (const needle of candidates) {
    const byLabel = courses.filter(c => c.label.toLowerCase().includes(needle)
      || c.label.toLowerCase().replace(/\s+/g, '').includes(needle.replace(/\s+/g, '')));
    if (byLabel.length === 1) return byLabel[0];
    if (byLabel.length > 1) return {ambiguous: byLabel};
  }
  return {notFound: value};
}

function writeCourse(courses, target) {
  const {json} = readConfigOrDie();
  if (!json.courses) throw new Error('config.json 里没有 courses 分组，可能文件结构不对');
  if (!json.courses[target.key]) {
    throw new Error(`config.json 里没有 ${target.key} 这个分组。\n` +
      `现有分组：${Object.keys(json.courses).join(' / ')}`);
  }
  json.activeCourse = target.key;
  json.courses[target.key].courseResourceId = target.id;
  if (!json.courses[target.key].courseUrl) {
    json.courses[target.key].courseUrl = 'https://uai.unipus.cn/app/cmgt/resource-detail/{courseId}';
  }

  // 写之前留一份备份，换错了能退回去
  const backup = CONFIG_FILE + '.bak';
  fs.copyFileSync(CONFIG_FILE, backup);

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(json, null, 2) + '\n');

  const resourceId = json.courses[target.key].courseResourceId || json.courses[target.key].courseId;
  const url = String(json.courses[target.key].courseUrl).replace(/\{courseId\}|\{courseResourceId\}/g, resourceId);
  return {backup, url};
}

async function main() {
  const courses = readCoursesOrDie();
  const {json} = readConfigOrDie();
  const current = json.activeCourse || '';

  console.log('课程资源 ID 表（来自 courses.txt）：');
  console.log('');
  courses.forEach((c, i) => {
    const mark = c.key === current ? '  ← 当前' : '';
    const id = c.id ? c.id : '（ID 未填写）';
    console.log(`  ${i + 1}) ${c.label}  ${id}${mark}`);
  });
  console.log('');
  console.log('提示：ID 是地址栏 resource-detail/ 后面那串数字。空着的先用浏览器抄一个填进 courses.txt。');
  console.log('');

  const rl = readline.createInterface({input: process.stdin, output: process.stdout});
  let answer;
  try {
    answer = await rl.question('这次要跑哪本书？输入序号或书名（直接回车取消）：');
  } finally {
    rl.close();
  }

  if (!String(answer).trim()) {
    console.log('已取消，配置文件没有改动。');
    return;
  }

  const picked = resolveChoice(answer, courses);
  if (!picked) {
    console.log('已取消，配置文件没有改动。');
    return;
  }
  if (picked.ambiguous) {
    console.log(`「${answer}」匹配到多门课，请写得更具体：`);
    picked.ambiguous.forEach(c => console.log(`  ${c.key}  ${c.label}`));
    process.exitCode = 1;
    return;
  }
  if (picked.notFound) {
    console.log(`没有找到「${picked.notFound}」。可选：`);
    courses.forEach(c => console.log(`  ${c.key}  ${c.label}`));
    process.exitCode = 1;
    return;
  }
  if (!picked.id) {
    console.log('');
    console.log(`${picked.label} 的课程资源 ID 还是空的，没法切过去。`);
    console.log(`做法：在专用 Edge 里登好，点进${picked.label}，`);
    console.log('      把地址栏 resource-detail/ 后面那串数字填进 courses.txt 对应那行，再跑一次这个命令。');
    console.log('');
    console.log(`文件位置：${COURSES_FILE}`);
    process.exitCode = 1;
    return;
  }

  const {backup, url} = writeCourse(courses, picked);
  console.log('');
  console.log(`已切换到：${picked.label}（${picked.key}）`);
  console.log(`  课程资源 ID：${picked.id}`);
  console.log(`  课程地址：${url}`);
  console.log(`  旧配置备份：${backup}`);
  console.log('');
  console.log('下一步：');
  console.log(`  npm run browser      # 确认这个窗口能打开上面那个地址`);
  console.log(`  npm run crawl        # 换了课必须重新采集`);
  console.log(`  npm run list         # 看任务队列`);
  console.log(`  npm run fix-missing  # 开始答题`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1]).replace(/\\/g, '/')}`).href) {
  try {
    await main();
  } catch (error) {
    console.error('');
    console.error(error.message);
    process.exit(1);
  }
}