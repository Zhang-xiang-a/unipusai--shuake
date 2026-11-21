// 必修任务体检：把队列和本地进度对一遍，列出真正没做完的任务。
// 只读 answer-progress.json，不开浏览器、不改课程状态。
const DONE = new Set(['submitted', 'learned']);

export function auditQueue(queue, progress) {
  const tasks = progress?.tasks || {};
  const done = [], unknown = [], failed = [], other = [];
  for (const task of queue) {
    const status = tasks[task.key]?.status || '';
    const row = {key: task.key, unit: task.unit, path: task.path, type: task.type || '', status};
    if (DONE.has(status)) done.push(row);
    else if (!status) unknown.push(row);
    else if (status === 'failed') failed.push(row);
    else other.push(row);
  }
  // pending 顺序保持队列顺序，补做时按课程目录顺序走，避免来回跳。
  const pendingKeys = new Set([...unknown, ...failed, ...other].map(r => r.key));
  const pending = queue.filter(t => pendingKeys.has(t.key));
  return {total: queue.length, done, unknown, failed, other, pending};
}

export function formatAudit(report) {
  const lines = [];
  lines.push(`必修任务体检：共 ${report.total} 个`);
  lines.push(`  已完成 ${report.done.length}`);
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