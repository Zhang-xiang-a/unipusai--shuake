# 命令与参数

所有命令都在项目根目录执行（即 `package.json` 所在目录）。脚本入口在 `src/` 下，`npm` 脚本已经带好路径。

## 1. npm 脚本

| 命令 | 作用 |
|---|---|
| `npm run browser` | 启动或显示专用 Edge。已运行时复用并恢复最小化窗口，只补建真正缺失的课程标签（`answerSource=deepseek-web` 时还包括 DeepSeek 标签）。 |
| `npm run setup` | 检查并保存登录会话。走 API 时只需要登录课程平台。 |
| `npm start` | 默认运行。默认是预览模式（`dryRun=true`），不填写、不提交。 |
| `npm run crawl` | 采集必修目录、题干、控件与任务清单，不答题、不提交。 |
| `npm run inventory` | 根据已采集资料生成题型统计报告。 |
| `npm run list` | 只读打印筛选后的任务队列（序号、路径、题型、状态），不连接浏览器。 |
| `npm run courses` | 只读列出 `course1` ~ `course4` 的填写情况，判断哪门课可以运行。 |
| `npm run pause` | 暂停脚本。在另一个终端执行。 |
| `npm run resume` | 恢复暂停；`stop` 之后重新运行前也要先执行一次。 |
| `npm run stop` | 停止并保留进度。等原进程退出后再启动新进程。 |
| `npm run skip` | 请求跳过当前子任务。若页面有评论输入框会填入 `6666`，不自动发布评论。 |
| `npm run verify -- --unit 3 --tasks 33,35,39` | runner 结束后核对课程侧保存的任务完成标记。不答题、不提交。 |
| `npm run audit -- 3 --skip-banked-cloze` | 核验第三单元的提交证据、学习执行情况与得分。 |
| `npm run audit-missing` | 必修任务体检：列出所有还没完成的任务（未开始 / 失败 / 中断），按单元分组。只读进度文件，不开浏览器。有未完成时退出码为 1。 |
| `npm run fix-missing` | 体检后自动补做未完成的任务，跑完即可。等价于 `npm start -- --audit --fix`。 |
| `npm run reset -- --course course3` | 预览要归档的进度文件；加 `--yes` 才归档并清空。换账号、换课程、想从头重刷时用。默认保留 `inventory/` 任务清单，加 `--all` 连清单一起归档。 |
| `npm test` | 运行项目测试，不接触课程页面。 |
| `npm run check` | 对全部源文件做 `node --check` 语法检查。 |
| `npm run video` | 单独监控当前课件视频的播放进度（排查用）。 |
| `npm run watch` | 挂机刷必修学习时长：循环播 U1~U6 的 Preview，每个播完在当前页停留 5 分钟，读「综合成绩」里的必修学习时长，满 20 小时自动退出。`--hours 20` 改目标，`--dwell-minutes 5` 改停留时长，`--check` 只读一次时长就退出。 |

## 2. `npm start` 常用参数

| 参数 | 说明 |
|---|---|
| `--answer` | 按必修任务队列运行答题流程。 |
| `--execute` | 实际填写、点击和提交；不加则只预览。 |
| `--unit 3` | 只处理指定单元，上限由当前课程的 `unitCount` 决定。 |
| `--from-unit 3` | 从第 3 个单元一路处理到最后一个单元，不用逐个 `--unit` 切换。与 `--unit` 互斥（数字相同则等价）。 |
| `--only-missing` | 只处理本地进度里还没完成的任务（不是 `submitted` / `learned`），用于补漏。这是本地判断；要按课程页真实状态筛选请用 `npm run fix-missing`。 |
| `--audit` | 只体检不答题：列出未完成任务后退出。加 `--fix` 则体检完直接补做。 |
| `--type 翻译` | 只处理指定题型，名称需与 `npm run inventory` 报告一致。 |
| `--skip-banked-cloze` | 排除选词完形（Banked cloze）。 |
| `--retry-skipped` | 重新尝试本次筛选范围内记录为 `skipped` 的任务；已提交和已学习的任务仍保留。 |
| `--new-chat` | 仅 `answerSource=deepseek-web` 时有效：在 DeepSeek 标签里新开对话。走 API 时每次请求本来就是独立的，加了会提示并忽略。 |
| `--text-only` | 只发送题干和控件信息，不发送截图。省 token、也更快；但图表题、版式复杂的题建议带上截图。 |
| `--steps 100` | 本次最多执行多少个队列步骤或答题轮次。 |
| `--current` | 只处理当前打开的那个必修子任务。 |
| `--from 12` | 从队列第 12 个任务开始（序号看 `--list` 的输出）。 |
| `--from "Section C/Translation/Task 1"` | 从匹配该路径片段的任务开始；匹配多个或匹配不到会直接报错并列出候选。**注意**：`Review & check` 里的 `&` 在 PowerShell 中是保留字符，写进参数会被吞掉（`--from "Review & check"` 拿到空值）；改用序号 `--from 41`，或只写不含 `&` 的片段 `--from "check"`。 |
| `--list` | 只打印筛选后的任务队列，不连接浏览器、不答题。 |
| `--inspect` | 保存当前页面结构，不请求答案、不提交。 |
| `--course course2` | 临时切换课程分组，不改配置文件。 |
| `--dry-run` / `--execute` | 显式指定预览 / 执行，优先级高于配置文件里的 `dryRun`。 |

## 3. 完整运行示例

首次使用：

```powershell
npm install
Copy-Item config.example.json config.json
Copy-Item .env.example .env      # 填 OPENAI_API_KEY 和 OPENAI_MODEL
npm run browser      # 打开专用 Edge，登录课程平台
npm run setup        # 自动检测并保存登录会话
npm run courses      # 确认目标课程已填写
npm run crawl        # 采集必修任务清单
npm run inventory    # 生成题型报告
npm run list -- --unit 3 --skip-banked-cloze   # 看看队列
npm start -- --unit 3 --skip-banked-cloze      # 先预览
npm start -- --answer --execute --unit 3 --skip-banked-cloze --text-only --steps 100
```

切换课程：

```powershell
npm run courses
npm start -- --answer --execute --course course2 --unit 1 --text-only
```

从指定任务继续：

```powershell
npm run list -- --course course3 --unit 3 --skip-banked-cloze
npm start -- --answer --execute --course course3 --unit 3 --skip-banked-cloze --text-only --from 12
npm start -- --answer --execute --course course3 --unit 3 --skip-banked-cloze --text-only --from "Section C/Translation/Task 1"
```

重试之前跳过的任务：

```powershell
npm start -- --answer --execute --unit 3 --skip-banked-cloze --text-only --retry-skipped --steps 100
```

暂停 / 恢复 / 停止 / 跳过（另开一个终端）：

```powershell
npm run pause
npm run resume
npm run stop
npm run skip
```

## 4. 运行注意事项

1. 改代码后要停掉旧进程再重启；Edge 可以一直开着。
2. `stop` 之后先 `npm run resume`，再重新执行运行命令。
3. 提示“已有脚本运行”时不要重复启动，`runner.lock` 会阻止两个进程同时控制页面。
4. 登录过期时在专用 Edge 窗口重新登录；`npm run browser` 可以把窗口调到前台。
5. 不要删除 `browser-profile/`，它保存专用浏览器配置和登录会话。
6. 阅读停留 10 秒，暂停期间不计时；视频静音正常播放到结束。
7. “已执行学习动作”“已提交”“课程确认完成”是三种不同状态，最终以课程侧记录为准。
8. 跳过的任务不代表课程完成；`skipped` 下次默认继续跳过，加 `--retry-skipped` 才重新尝试。
9. 防卡死：同一题里模型连续返回纯 `wait` 或重复相同内容算作没有进展；达到 `answerLoop.maxStallRounds`（默认 3）轮时，如果页面上的输入框和选项确实都已作答，脚本会直接点击提交并核验答题小结，否则带原因停止。
10. 单题轮次上限 `answerLoop.maxRoundsPerTask`（默认 12）。每轮诊断写入 `artifacts/<courseKey>/answer-rounds.jsonl`。
11. 模型请求超时、回复无法解析或计划未通过控件校验时，脚本会带上失败原因重试一次；仍失败就记录 `failed` 并继续下一个任务，不会提交该失败题。
12. 停止命令、登录异常、页面操作错误会直接中断，不会被“失败后继续”规则吞掉。`401/403/404/422` 这类接口错误同样立即中断——通常是 Key 过期、模型名写错或余额不足。
13. 确认提交成功：`answer-progress.json` 中该任务 `status=submitted`，`evidence` 是答题小结文字；同目录的 `answer-result-<编号>.png` 是提交后的截图。
14. 听力任务：填空统一填 `1`，单选每组选第一项，不参与 1% 随机改选。这条规则只保证流程通过，不保证得分。
15. 选择题与判断题每次点击后都会核验选中状态；全部选好后下一轮直接提交，不重复询问模型。
16. 修改 `config.json` 后重启脚本即可生效，Edge 保持原窗口。
17. 接口兼容性会自动兜底：服务不支持 `response_format: json_object` 时改用普通输出（JSON 校验照旧）；推理模型拒绝 `temperature` 时省略该参数重试。两条降级都会写进 `events.jsonl`。

## 5. 日志与产物位置

| 路径 | 内容 |
|---|---|
| `logs/run-YYYY-MM-DD.log` | 运行日志，含课程名、连接、重试、错误与中断原因 |
| `artifacts/<courseKey>/inventory/` | 该课程的目录清单、题干、控件快照、题型报告 |
| `artifacts/<courseKey>/answer-progress.json` | 每个任务的提交 / 学习 / 跳过 / 失败状态 |
| `artifacts/<courseKey>/checkpoint.json` | 断点与最近动作历史 |
| `artifacts/<courseKey>/events.jsonl` | 步骤级事件流 |
| `artifacts/<courseKey>/answer-rounds.jsonl` | 每轮答题诊断（轮次、是否卡住、动作、提交） |
| `artifacts/<courseKey>/last-run-summary.json` | 本次队列结束时仍未完成的任务 |
| `artifacts/<courseKey>/failure*.json` | 出错时的现场快照 |
| `artifacts/<courseKey>/api-failed-<nonce>-<n>.json` | 模型接口返回的原始内容（Key 已脱敏） |
| `browser-profile/` | 专用 Edge 的用户数据与登录会话 |

`artifacts/`、`logs/`、`browser-profile/`、`config.json`、`.env` 都已在 `.gitignore` 中排除，不要提交或分享。