// 必修任务体检：把队列和进度对一遍，列出真正没做完的任务。
// 有课程侧数据（course_progress）时以课程为准，本地状态只作为补充说明。
import {courseCompleted, leafIdOf} from './course-progress.mjs';

const DONE = new Set(['submitted', 'learned']);

export function auditQueue(queue, progress, {courseLeafs = null} = {}) {
  const tasks = progress?.tasks || {};
  const done = [], unknown = [], failed = [], other = [];
  let courseVerified = 0;
  for (const task of queue) {
    const status = tasks[task.key]?.status || '';
    const row = {key: task.key, unit: task.unit, path: task.path, type: task.type || '', status};
    // 课程侧有这条任务的确切结论时，一律以课程为准：
    // pass 为 1/2 算完成（哪怕本地记成 learning/failed），其余算未完成（哪怕本地记成 submitted）。
    // 课程侧压根没这条记录（页面没加载到）才回退到本地状态。
    if (courseLeafs) {
      const leaf = courseLeafs[leafIdOf(task.url)];
      if (leaf) {
        if (courseCompleted(leaf)) { done.push({...row, status: '已完成（课程侧核对）'}); courseVerified++; }
        else other.push({...row, status: `课程侧未通过（pass=${leaf.state?.pass ?? '无'}）`});
        continue;
      }
    }
    if (DONE.has(status)) done.push(row);
    else if (!status) unknown.push(row);
    else if (status === 'failed') failed.push(row);
    else other.push(row);
  }
  // pending 保持队列顺序，补做时按课程目录顺序走，避免来回跳。
  const pendingKeys = new Set([...unknown, ...failed, ...other].map(r => r.key));
  const pending = queue.filter(t => pendingKeys.has(t.key));
  return {total: queue.length, done, unknown, failed, other, pending, courseVerified, courseChecked: !!courseLeafs};
}

export function formatAudit(report, {quiet = false} = {}) {
  const lines = [];
  lines.push(`必修任务体检：共 ${report.total} 个`);
  lines.push(`  已完成 ${report.done.length}${report.courseChecked ? `（其中 ${report.courseVerified} 个由课程侧确认）` : ''}`);
  lines.push(`  未开始 ${report.unknown.length}`);
  lines.push(`  失败   ${report.failed.length}`);
  if (report.other.length) lines.push(`  其他   ${report.other.length}（skipped / in-progress / needs-review）`);
  const pending = report.pending;
  if (!pending.length) {
    lines.push('');
    lines.push('全部必修任务都已完成。');
    return lines.join('\n');
  }
  const statusOf = new Map([...report.unknown, ...report.failed, ...report.other].map(r => [r.key, r.status || '未开始']));
  const byUnit = new Map();
  for (const task of pending) {
    if (!byUnit.has(task.unit)) byUnit.set(task.unit, []);
    byUnit.get(task.unit).push(task);
  }
  lines.push('');
  if (quiet) {
    // 安静模式：只报总数和分布，不打三百行逐条清单。
    const units = [...byUnit.keys()].sort((a, b) => a - b);
    lines.push(`未完成 ${pending.length} 个，分布在 Unit ${units.join('、Unit ')}`);
    return lines.join('\n');
  }
  lines.push(`未完成 ${pending.length} 个：`);
  for (const unit of [...byUnit.keys()].sort((a, b) => a - b)) {
    lines.push(`  Unit ${unit}`);
    for (const task of byUnit.get(unit)) {
      const status = statusOf.get(task.key) || '未开始';
      lines.push(`    ${task.path.join(' / ')}  [${task.type || '未知题型'}]  ${status}`);
    }
  }
  lines.push('');
  lines.push('补做：npm start -- --answer --execute --only-missing --skip-banked-cloze');
  return lines.join('\n');
}