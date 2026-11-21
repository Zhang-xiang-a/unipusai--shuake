# 网课全自动学习助手（Unipus 通用版）

一个跑在自己电脑上的命令行小工具。打开课程页面，自动读题、作答、提交、看视频、刷学习时长，
把大学英语 1~4 这类 Unipus 课程从头到尾刷完。**不用装插件、不用改客户端、不碰课程服务器。**

> 全程在你本机的浏览器里操作，登录态只保存在本地，账号密码不会被上传到任何地方。

---

## 0. 开工前先准备这些（重要，先看）

### 必需

| 项目 | 要求 | 怎么确认 |
|---|---|---|
| 操作系统 | **Windows 10 / 11**（64 位） | 本工具依赖 Windows 上的 Edge 浏览器调用方式，Mac / Linux 需要自己改代码 |
| Node.js | **20.0 或更高版本**（推荐 22 / 24 LTS） | 装好后在 PowerShell 里敲 `node -v`，会显示版本号 |
| 浏览器 | **Microsoft Edge**（系统自带，不用另装） | 开始菜单搜 Edge 能打开就行 |
| 硬盘空间 | 至少 **300 MB** 空余 | 依赖包 + 浏览器缓存 + 截图 |
| 大模型 API Key | **必须支持"看图"**（多模态） | 见下面 0.2，这是花钱的部分 |
| 能登录的课程账号 | 课程已加入你的学习账号，能正常打开课程页面 | 自己先用浏览器登一次确认 |

### 0.1 装 Node.js（唯一需要装的软件）

1. 打开 <https://nodejs.org/zh-cn>，下载 **LTS 版本**的 Windows 安装包（`.msi`）。
2. 双击安装，一路"下一步"。**不要**取消勾选"Add to PATH"。
3. 装完**重新打开**一个 PowerShell 窗口（旧窗口读不到新环境变量）。
4. 敲 `node -v`，看到类似 `v22.11.0` 就成功了。

### 0.2 准备一个能看图的 API Key

这个工具的答题方式是：**把题目截图发给大模型，让它看懂题目再给答案**。
所以模型必须能读图片，纯文字模型的答案会完全对不上。

支持任意 **OpenAI 接口格式**的服务，任选其一：

| 服务 | 说明 | 大概花费 |
|---|---|---|
| DeepSeek | 便宜，`deepseek-chat` 支持图片，中文题目理解好 | 刷完一本书通常几块钱 |
| 阿里云百炼 / 通义 | 有免费额度，`qwen-vl-max` 系列 | 有免费额度 |
| 智谱 GLM | `glm-4v` 系列 | 便宜 |
| OpenAI 官方 | 质量最稳，需要海外网络和信用卡 | 较贵 |

你需要准备三样东西，后面填进 `.env` 文件：

- **接口地址**（Base URL），例如 `https://api.deepseek.com`
- **模型名字**（Model），例如 `deepseek-chat`
- **密钥**（API Key），形如 `sk-xxxxxxxxxxxx`

> 如果服务商给你的地址结尾带 `/v1`，一般填到 `/v1` 为止，脚本会自动拼接。

### 0.3 不需要准备的

- 不需要装 Python
- 不需要装数据库
- 不需要买服务器
- 不需要会写代码（会敲几行命令就行）

---

## 1. 这东西能干什么

| 能力 | 说明 |
|---|---|
| 自动答题 | 选择题、填空题、判断题、翻译、选词完形、句型改写、开放问答，读题 → 作答 → 提交 |
| 自动看视频 | 音视频任务自动播完，不跳进度 |
| 自动读阅读材料 | 停留规定时间后进入下一步 |
| 自动点词汇卡 | 逐张点"下一个"，最后做配套练习 |
| 自动发评论 | 讨论区任务自动发一句话 |
| 自动上传作品 | Unit project 上传指定文件后提交 |
| 自动自评打勾 | Review & check 逐项打勾 |
| 任务体检 | 按课程页真实状态列出还差哪些任务 |
| 自动补做 | 体检完直接补做没过的任务 |
| 挂机刷时长 | 循环播视频，学时长达标自动停 |

**不能做的**：不替你登录、不破解验证码、不改课程服务器数据。
所有操作等于"一个人在浏览器里点了点"，只是点得比人快、比人稳。

---

## 2. 五分钟跑起来（第一次用照这个做）

### 第 1 步：拿到文件 + 装依赖

两种方式任选：

```powershell
# 方式一：git clone（推荐，之后更新方便）
git clone https://github.com/Zhang-xiang-a/unipusai--shuake.git unipus
cd unipus
```

```text
方式二：从本仓库 Releases 页面下载最新版 zip，解压到一个路径没有中文和空格的地方，例如 D:\unipus
```

> 路径里带中文或空格偶尔会让浏览器启动失败，能避开就避开。

进到项目文件夹后，在地址栏输入 `powershell` 回车（或按住 `Shift` + 右键 → **在此处打开 PowerShell 窗口**），然后：

```powershell
npm install
```

等它跑完（一分钟左右）。看到 `added N packages` 就成功了。

> 依赖只有 Playwright 一个。它默认不去下载浏览器内核——本工具是通过调试协议
> 直接操作你系统里的 Edge，所以不需要额外执行 `npx playwright install`。

### 第 2 步：填 API 密钥

复制 `.env.example`，重命名成 **`.env`**（注意前面有个点，没有扩展名）。

用记事本打开，填成你自己的：

```ini
OPENAI_API_KEY=sk-你的密钥粘这里
OPENAI_MODEL=deepseek-chat
OPENAI_BASE_URL=https://api.deepseek.com
```

三条都要填。填完保存。

> `.env` 里只放密钥，**不要**写账号密码。

### 第 3 步：填课程信息

复制 `config.example.json`，重命名成 **`config.json`**。

打开它，只需要改三处：

**① 选你要跑哪本教材**

```json
"activeCourse": "course1"
```

`course1` 到 `course4` 分别对应大学英语 1~4。哪本在这门课里就跑哪个。

**② 填这门课的 ID**

找到 `courses` 里对应的那一段（比如 `course1`），把 `courseId` 改成你自己的：

```json
"course1": {
  "name": "大学英语 1",
  "courseId": "这里填课程ID",
  ...
}
```

**课程 ID 怎么找**：用 Edge 登录学习平台，点进要刷的那门课，
看地址栏，形如：

```
https://uai.unipus.cn/app/cmgt/resource-detail/12345678901
                                              └────┬────┘
                                              这一串数字就是
```

**③（可选）填作品上传用的图片**

如果课程里有 Unit project 需要交作品：

```json
"learningPolicy": {
  ...
  "uploadFile": "D:\\我的文件\\作业.png"
}
```

路径里的反斜杠要写**两个** `\\`，或者改用 `/`。不填就跳过这类任务。

### 第 4 步：登录一次

```powershell
npm run browser
```

会弹出一个**专用 Edge 窗口**（这个窗口和平时用的 Edge 是分开的，登录一次以后一直有效）。

在这个窗口里：

1. 手动登录学习平台
2. 点进课程，能看到课程目录为止

**登录完不用关窗口**，回到 PowerShell 继续。

想确认登上了没：

```powershell
npm run setup
```

它会自动检测，看到"已保存登录态"之类的提示就对了。

### 第 5 步：采集任务清单

```powershell
npm run crawl
```

脚本会自己翻一遍课程目录，把每个必修任务的题目、控件、链接都记下来。

- 会打开很多页面，全程预计 **5~15 分钟**
- 期间**别动那个 Edge 窗口**，别最小化程序的运行
- 结束后会看到类似 `共 185 个必修任务` 的提示

> 换书、换学期、课程目录更新后，都要重新跑一次这一步。

### 第 6 步：先空跑一遍看看

```powershell
npm start -- --list
```

会列出所有任务，形如：

```
  1. Unit 1 / Unit preview / Quotation  [阅读或尚未识别的交互]  未开始
  2. Unit 1 / Unit preview / Preview    [音视频学习]          未开始
  3. Unit 1 / Section B / Reading skills / Learning  [阅读]     未开始
  ...
```

这一步**不连浏览器、不填任何东西**，纯粹让你看看认出来的题目对不对。

### 第 7 步：正式开跑

```powershell
npm start -- --answer --execute --from-unit 1
```

这一条就是全自动了：从第一单元开始，一路答题、看视频、提交，直到最后一单元。

- **第一次建议先只跑一个单元**，确认没问题再放开：

```powershell
npm start -- --answer --execute --unit 1
```

- 中途想停，**另开一个** PowerShell 窗口敲：

```powershell
npm run stop
```

- 停了以后接着跑，直接重跑同一条命令就行（做过的会自动跳过）

---

## 3. 全部命令速查表

### 3.1 开始用之前

| 命令 | 干什么 |
|---|---|
| `npm install` | 装依赖。**第一次必做**，之后不用再跑 |
| `npm run browser` | 打开专用 Edge。已开的话会复用，只补开缺的课程标签 |
| `npm run setup` | 检测并保存登录状态 |
| `npm run courses` | 看四门课填了没有，哪门能跑 |

### 3.2 采集与查看

| 命令 | 干什么 |
|---|---|
| `npm run crawl` | 采集课程目录、题干、控件，生成任务清单。**换书后必做** |
| `npm run inventory` | 单独重算题型分布（`npm run crawl` 已自动做，目录没变就不用跑） |
| `npm run list` | 列出任务队列（序号 / 路径 / 题型 / 状态），不连浏览器 |
| `npm start -- --list` | 同上，走 `npm start` 的筛选参数 |

### 3.3 答题

| 命令 | 干什么 |
|---|---|
| `npm start` | 预览模式，只生成计划不执行（默认就是预览，安全） |
| `npm start -- --answer --execute` | 全自动答题 + 提交 |
| `npm start -- --answer --execute --unit 3` | 只跑第 3 单元 |
| `npm start -- --answer --execute --from-unit 3` | 从第 3 单元跑到最后 |
| `npm start -- --answer --execute --type 翻译` | 只跑某一类题型 |
| `npm start -- --answer --execute --steps 50` | 最多做 50 步就停 |
| `npm start -- --answer --execute --current` | 只做当前打开的那一个任务 |

### 3.4 体检与补做（强烈推荐用）

| 命令 | 干什么 |
|---|---|
| `npm run audit-missing` | **体检**：按课程页真实状态列出还没完成的任务。有未完成时退出码为 1 |
| `npm run fix-missing` | **补做**：体检完直接把这些任务重做一遍，跑完即止 |
| `npm run audit -- 3` | 核验第 3 单元的提交证据与得分 |
| `npm run verify -- --unit 3` | 核对课程侧保存的完成标记 |

### 3.5 挂机刷学习时长

| 命令 | 干什么 |
|---|---|
| `npm run watch` | 循环播 U1~U6 的 Preview，读学习时长，满 20 小时自动停 |
| `npm run watch -- --check` | 只读一次当前时长就退出，用来确认能不能读到 |
| `npm run watch -- --hours 25` | 目标改成 25 小时 |
| `npm run watch -- --dwell-minutes 8` | 每个视频播完停留 8 分钟 |

### 3.6 中途控制（另开一个窗口敲）

| 命令 | 干什么 |
|---|---|
| `npm run pause` | 暂停。当前这一步做完后停住，不关浏览器 |
| `npm run resume` | 解除暂停 |
| `npm run stop` | 停止。保存进度后退出，等它退干净再重跑 |
| `npm run skip` | 跳过当前这一题（有评论框的话会顺手填一句） |

### 3.7 维护

| 命令 | 干什么 |
|---|---|
| `npm test` | 跑单元测试，不碰课程页面。97 项全绿说明代码本身没坏 |
| `npm run check` | 语法检查 |
| `npm run reset -- --course course3` | 预览要清空的进度文件（**默认不动手**，加 `--yes` 才真清） |
| `npm run video` | 排查用：看当前视频播到哪了 |

---

## 4. 新手最常用的三条命令

如果只记三条，记这三条：

```powershell
npm run crawl          # ① 换书/首次用：采集任务清单
npm run fix-missing    # ② 日常主力：体检 + 自动补做没完成的任务
npm run watch          # ③ 时长不够时：挂机刷学习时长
```

日常循环就是：

1. 跑 `npm run fix-missing`，让它自己找没做完的补上
2. 跑完再跑一次 `npm run audit-missing` 看还剩多少
3. 学习时长不够就 `npm run watch` 挂着
4. 隔天再重复 1~2 步

---

## 5. 怎么换书 / 换课程

### 情况 A：换同一门课里的另一册（比如从大英 2 换成大英 3）

1. 用 Edge 登录，把这门课加到账号里
2. 找到它的课程 ID（地址栏 `resource-detail/` 后面那串数字）
3. 改 `config.json`：

```json
"activeCourse": "course3",
"courses": {
  "course3": {
    "name": "大学英语 3",
    "courseId": "你的新课程ID"
  }
}
```

4. 确认能不能跑：

```powershell
npm run courses
```

看到 `可运行：是` 就行。

5. **重新采集**（换了课程，旧的任务清单不能用了）：

```powershell
npm run crawl
```

6. 开始跑：

```powershell
npm start -- --answer --execute --from-unit 1
```

### 情况 B：换一个完全不同的账号

```powershell
npm run reset -- --course course3      # 先看清要清什么
npm run reset -- --course course3 --yes  # 确认清空
npm run browser                        # 在弹出的窗口里退出登录，换新账号登
npm run setup                          # 保存新登录态
npm run crawl                          # 重新采集
```

### 情况 C：课程目录更新了（老师加了新任务）

不用重装、不用改配置，只要：

```powershell
npm run crawl      # 重新采集，认出新任务
npm run fix-missing  # 补做新出现的
```

### 情况 D：想换一个 API 服务商

只改 `.env` 三行，别的一律不动：

```ini
OPENAI_API_KEY=sk-新服务商的密钥
OPENAI_MODEL=新服务商的模型名
OPENAI_BASE_URL=新服务商的接口地址
```

改完直接跑，不用重新采集。

### 想多门课并存

`config.json` 里 `course1`~`course4` 四段可以同时填好，
用 `activeCourse` 或者命令行参数切换，互不干扰：

```powershell
npm start -- --answer --execute --course course2
```

---

## 6. 支持哪些题型

| 题型 | 怎么做 |
|---|---|
| 选择题 | 模型选答案，点选项，提交 |
| 单词 / 短语填空 | 模型填，写进输入框，提交 |
| 选词完形填空（Banked cloze） | 逐个空下拉选择 |
| 三项判断（True / False / Not given） | 按题判断逐题点 |
| 翻译 | 模型给译文，填进输入框 |
| 句型改写 / 完成句子 | 模型写，填进去 |
| 开放问答 / 讨论 | 模型写一段，提交 |
| 音视频学习 | 正常速度播完，不拖进度条 |
| 阅读材料 | 停留规定秒数 |
| 词汇卡片 | 逐张点"下一个" |
| 评论 / 讨论区 | 自动发一句（默认 `666`，可在 `config.json` 改 `commentReply`） |
| Unit project（作品上传） | 上传 `uploadFile` 指定的文件后提交 |
| Review & check（复习自检） | 逐项打勾 |

遇到认不出结构的页面，会记成"阅读或尚未识别的交互"，按阅读任务处理（停留后翻页），不会卡死。

---

## 7. 出问题了怎么办

### courseId 和 courseResourceId 的区别

U 校园的课程入口是：

```
https://uai.unipus.cn/app/cmgt/resource-detail/20001277967
                                              └────┬────┘
                                    这里要的是「课程资源 ID」
```

**这两个 ID 不一定是同一个数。** 实测大英3：

| 填的值 | 结果 |
|---|---|
| `courseId: "20001277964"` | 页面显示「暂无课程 登录过期，请重新登录」 |
| `courseResourceId: "20001277967"` | 6 个单元正常 |

而 U 校园对「课程不存在」和「你没登录」返回的是同一句提示，所以填错 ID 时很容易被误导成登录问题。

配置里两个都填上最稳：

```json
"course3": {
  "courseId": "20001277964",
  "courseResourceId": "20001277967"
}
```

`courseUrl` 里的 `{courseId}` 占位符会自动优先用 `courseResourceId`，没填才退回 `courseId`。
所以只填一个也行，但填错就会打不开。

**怎么确认填对了**：`npm run crawl` 能跑出 `必修遍历 N/N` 就是对的；
报「这个 courseId 打不开：登录是好的」就是 ID 有问题。

### 作品上传：`learningPolicy.uploadFile` 怎么填

填**相对项目根目录**的路径就行，不用写绝对路径：

```json
"learningPolicy": {
  "uploadFile": "assets/work.png"
}
```

仓库自带 `assets/work.png` 做占位示例，换成你自己的图片/文档即可。绝对路径也支持。

找不到文件时会明确报出来，不会静默跳过。

### 评论：`learningPolicy.commentReply`

```json
"learningPolicy": {
  "commentReply": "666"
}
```

评论区是**全课程共享的**，同学发过的内容不代表你发过。脚本的判断：

- 列表里某条带「我」标记 → 认定自己已经发过，跳过
- 没有「我」标记 → 填 `commentReply` 并点「发 布」

所以重复跑不会刷屏，也不会因为别人先评论了就不发。

### 运行 `npm run browser` 没看到窗口

专用 Edge 的窗口被关掉后，进程还会在后台驻留。这时 CDP 照样能操作标签，命令也照常报"已显示并复用"，但屏幕上什么都没有。

**这种情况现在会自动处理**。`npm run browser` 会检测有没有真正显示在屏幕上的窗口，没有就自己重开一个，并打印：

```
检测到专用 Edge 的窗口被关掉了（进程还在后台），正在重新打开窗口…
窗口已重新打开，请看任务栏上标题为「U校园」的那个 Edge。
```

如果还是出不来，用这两个参数：

```powershell
npm run browser -- --restart      # 清掉上次残留的进程再全新启动
npm run browser -- --new-window   # 强制开一个新窗口
```

`--restart` 只杀带 `--remote-debugging-port=9228` 的 Edge，不会碰你平常用的 Edge。

### 提示"登录态已失效"

登录过期了。做法：

```powershell
npm run browser     # 在弹出来的窗口里重新登录，进到课程页
npm run setup       # 保存
```

然后重跑刚才的命令。

### 提示"API 连接失败"或 401

`.env` 三行没填对。逐项检查：

- `OPENAI_API_KEY` 有没有粘全（别带空格、别带引号）
- `OPENAI_BASE_URL` 是不是服务商给的那个（有的要带 `/v1`，有的不带）
- `OPENAI_MODEL` 名字对不对（必须支持看图）

单独验证一下：

```powershell
node -e "console.log(process.env.OPENAI_API_KEY ? 'key 读到了' : 'key 没读到')"
```

### 提示"API 输出被截断"

答案太长或思考太长。脚本会自动把上限翻倍重试一次；
还是不行就换一个不"深度思考"的模型，或者在 `config.json` 里调大：

```json
"api": { "maxOutputTokens": 16384 }
```

### 提示"上下文过长"

同样会自动压缩输入并重试，通常能自己救回来。反复出现说明这道题题干特别长，
可以在 `config.json` 里把 `api.maxInputChars` 调小一点（比如 `80000`）。

### 卡在某个任务不动

在另一个窗口：

```powershell
npm run skip     # 跳过这一题
```

或者

```powershell
npm run stop     # 整个停掉
npm start -- --answer --execute --from-unit 3   # 从第 3 单元重来
```

重跑不会重复做已完成的任务。

### 提示"还没有任务清单"或 "ENOENT ... required-tasks.json"

新解压的目录里没有采集产物，必须先跑一次：

```powershell
npm run crawl
```

`artifacts\` 是自动生成的，压缩包里不带。换书、换课程、课程目录更新后都要重跑。

### 提示"课程目录页没打开，被带到了 …"

**uai.unipus.cn（课程目录）和 ucontent.unipus.cn（课件）是两个独立域，登录态不通用。**
只在课件页登过，目录页还是未登录状态，`crawl` 就会被踢到登录页。

做法：在专用 Edge 窗口里打开 `https://uai.unipus.cn`，登录一次，确认能看到课程列表，再重跑 `npm run crawl`。

### 提示"没找到单元页签，无法确认必修范围"

脚本打开了课程目录页，但页面上没有 Unit 1~6 的页签。按报错里给的地址自己用那个 Edge 窗口打开看一眼：

- 如果跳到登录页 → 先登录，再 `npm run setup`
- 如果页面是空的或还在转圈 → 网络慢，多重跑一次 `npm run crawl`
- 如果 `courseId` 填的是别的数字 → 改成地址栏 `resource-detail/` 后面那串

### 提示"弹窗遮挡"

页面弹了"我知道了"这类提示框，脚本会自动点掉。如果反复卡住，
手动在 Edge 窗口里点掉它再继续。

### 一次跑了很久没动静

检查那个专用 Edge 窗口是不是被最小化或关了。**必须保持窗口开着**，
最小化可以，但不能关。

### 想从头再来

```powershell
npm run reset -- --course course3          # 先看要清什么
npm run reset -- --course course3 --yes    # 确认
npm run crawl                              # 重新采集
```

---

## 8. 文件都是干什么的

```
├─ src\                  程序本体（不用改）
├─ test\                 单元测试（不用管）
├─ docs\                 细一点的说明文档
├─ config.json           ★ 你的课程配置（自己填，别外传）
├─ .env                  ★ 你的 API 密钥（自己填，别外传）
├─ config.example.json   配置模板
├─ .env.example          密钥模板
├─ browser-profile\      专用 Edge 的登录态（自动生成，别外传）
├─ artifacts\            采集结果、进度、截图（自动生成）
└─ logs\                 运行日志（自动生成）
```

**带 ★ 的三个（`config.json`、`.env`、`browser-profile\`）包含你的私人信息，
不要发给任何人，也不要上传到网盘。**

进度文件在 `artifacts\<课程>\answer-progress.json`，删掉它就等于这门课从头开始。

---

## 9. 配置项改哪里

90% 的情况只需要改 `config.json` 里这几项：

| 配置 | 默认值 | 说明 |
|---|---|---|
| `activeCourse` | `course1` | 当前跑哪门课 |
| `courses.<名字>.courseId` | 空 | 课程 ID（必填） |
| `courses.<名字>.unitCount` | `6` | 这门课有几个单元 |
| `learningPolicy.commentReply` | `666` | 讨论区自动发的内容 |
| `learningPolicy.uploadFile` | 空 | 作品上传用哪个文件 |
| `learningPolicy.readingSeconds` | `10` | 阅读任务停留几秒 |
| `incorrectChoiceRate` | `0.15` | 故意选错的概率（让答题记录更像真人） |
| `throttle.actionDelayMs` | `[1800, 4500]` | 每步随机等待的毫秒区间 |
| `maxSteps` | `1200` | 一次运行最多做多少步 |

更细的配置看 `docs/CONFIG.md`，命令细节看 `docs/COMMANDS.md`。

---

## 10. 它是怎么工作的（技术向，可以跳过）

想改代码或者排查问题时看这段。

```
npm run crawl
   └─ 用 CDP 连上专用 Edge，逐个点开课程目录
      ├─ 记录每个必修任务的 URL、题干文本、可交互控件（输入框 / 选项 / 按钮）
      └─ 存成 artifacts/<课程>/inventory/required-tasks.json + type-report.json

npm start -- --answer --execute
   └─ 按任务清单逐个打开页面
      ├─ 截图 + 抽控件树 → 发给大模型（OpenAI 兼容接口，每次请求独立，不带历史）
      ├─ 模型返回结构化动作（选哪个选项 / 往哪个框填什么）→ 在页面上执行
      ├─ 提交后记录到 answer-progress.json
      └─ 判断"卡住"：连续几轮页面没变化就换策略或跳过

npm run audit-missing
   └─ 刷新一次课件页，拦截它自己发出的 course_progress 请求
      └─ 拿 6 个单元的真实 pass 状态，和本地进度对比出差异

npm run watch
   └─ 循环播 Preview → 读「综合成绩」页的必修学习时长 → 达标退出
```

几个设计上的取舍：

| 做法 | 原因 |
|---|---|
| 每次请求都不带对话历史 | 题目之间没有关联，带历史只会让上下文爆掉 |
| 输入超预算时分级压缩（5 档） | 长题干 + 大量选项很容易超过上下文上限 |
| 输出被截断时自动翻倍重试一次 | 推理型模型会把预算花在"思考"上 |
| 课程侧状态优先于本地进度 | 本地记着 `learning` 但课程页已通过的，不该重做 |
| 超过 3 轮页面无变化就判定卡住 | 避免死循环点同一个按钮 |
| 每步随机等待 1.8~4.5 秒 | 让操作节奏接近真人 |

主要模块：

| 文件 | 职责 |
|---|---|
| `src/runner.mjs` | 入口，参数解析与流程编排 |
| `src/answer.mjs` | 答题队列主循环、卡住检测、各类题型分发 |
| `src/api-planner.mjs` | 大模型调用、输入压缩、动作解析 |
| `src/crawl.mjs` | 课程目录与任务清单采集 |
| `src/course-progress.mjs` | 读课程侧真实完成状态 |
| `src/audit.mjs` | 体检报告 |
| `src/upload.mjs` / `src/checklist.mjs` / `src/comment.mjs` | 作品上传 / 自评打勾 / 讨论区 |
| `src/watch.mjs` | 挂机刷时长 |
| `src/config.mjs` | 配置合并与校验 |

---

## 11. 使用须知

- 本工具只在**你自己的账号**上操作，请勿用于他人账号。
- 请自行确认所在学校/课程对自动化工具的规定，使用者承担使用后果。
- 软件按现状提供，学到的知识才是自己的——工具只是帮你省下重复劳动的时间。
- 遇到问题先看第 7 节，再看 `logs\` 里的日志，日志里通常写清了卡在哪一步。

---

MIT License