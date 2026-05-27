# 新澳门六合彩预测项目

这个项目有两种用法：

- `web/`：部署到 Vercel 的在线预测看板，适合长期自动运行。
- `marksix_local.py`：本地 Python 版，不需要安装第三方依赖，适合在电脑上快速查看。

数据源已经固定为“新澳门六合彩”：

- 最新期开奖：`https://macaumarksix.com/api/macaujc2.com`
- 按年历史：`https://history.macaumarksix.com/history/macaujc2/y/{year}`

预测结果为 `6+1`（6 个主号 + 1 个特别号），复盘会单独统计特别号命中率。新澳门期号使用 `YYYYNNN` 格式，例如 `2026146`。

## Vercel 部署教程

下面按“小白照着点”的方式写。你只要有 GitHub 账号和 Vercel 账号，就能部署。

### 1. 先把代码推到 GitHub

在项目根目录执行：

```bash
git add -A
git commit -m "Adapt project to new Macau Mark Six"
git push
```

如果你还没有把项目关联到 GitHub，先在 GitHub 新建一个仓库，然后按 GitHub 页面提示执行 `git remote add origin ...` 和 `git push -u origin main`。

### 2. 登录 Vercel 并导入项目

1. 打开 `https://vercel.com/`。
2. 使用 GitHub 账号登录。
3. 点击右上角 `Add New...`。
4. 选择 `Project`。
5. 找到你的 GitHub 仓库，点击 `Import`。

### 3. 设置 Root Directory

导入页面里一定要改这一项：

```text
Root Directory = web
```

原因：Vercel 要部署的是 `web/` 里的 Next.js 项目，不是仓库根目录。

如果页面里有 `Framework Preset`，保持 `Next.js` 即可。

### 4. 设置 Build Command

在 Vercel 的 Build 设置里确认：

```bash
npm run vercel-build
```

这个命令会自动做三件事：

1. 生成 Prisma Client
2. 把数据库表结构推到 Postgres
3. 构建 Next.js 网站

如果 Vercel 没有自动填，手动填进去。

### 5. 创建数据库

这个项目需要 Postgres 数据库保存开奖记录和预测结果。推荐直接用 Vercel 里的 Neon 集成。

在 Vercel 项目里操作：

1. 进入项目页面。
2. 点击顶部或侧边栏的 `Storage`。
3. 点击创建数据库，选择 `Postgres` / `Neon`。
4. 按页面提示创建并连接到当前项目。
5. 创建完成后，Vercel 通常会自动添加 `DATABASE_URL` 环境变量。

确认方法：

1. 进入 `Settings`。
2. 点击 `Environment Variables`。
3. 查找是否已有 `DATABASE_URL`。

如果已经有，就不用自己填 `DATABASE_URL`。

### 6. 添加环境变量

在 Vercel 项目里进入：

```text
Settings -> Environment Variables
```

依次添加下面这些变量。`DATABASE_URL` 如果 Neon 已经自动添加，就不要重复添加。

```env
CRON_SECRET=换成一串你自己生成的长随机字符串
RESULT_PROVIDER=macau
MACAU_LOTTERY_KEY=macaujc2
MACAU_LATEST_API_URL=https://macaumarksix.com/api/macaujc2.com
MACAU_HISTORY_API_TEMPLATE=https://history.macaumarksix.com/history/macaujc2/y/{year}
MACAU_HISTORY_FROM_YEAR=2024
MACAU_HISTORY_TO_YEAR=2026
```

`CRON_SECRET` 可以随便生成一串长一点的字符串，例如：

```text
new-macau-2026-your-random-secret-please-change-me
```

更安全的做法是在本机执行：

```bash
openssl rand -hex 32
```

然后把输出结果填到 `CRON_SECRET`。

### 7. 第一次部署

环境变量填完后，回到 Vercel 项目页面：

1. 点击 `Deployments`。
2. 如果刚才已经部署失败或没用最新变量，点击最新部署右侧的三个点。
3. 选择 `Redeploy`。
4. 等它显示 `Ready`。

部署成功后，Vercel 会给你一个网址，例如：

```text
https://your-project.vercel.app
```

先打开这个网址。如果数据库还没有数据，页面可能暂时没内容，这是正常的，下一步初始化数据。

### 8. 第一次初始化历史数据

部署完成后，需要手动触发一次同步接口，让数据库导入新澳门历史数据并生成下一期预测。

打开浏览器访问：

```text
https://你的域名/api/jobs/sync-latest
```

如果你设置了 `CRON_SECRET`，推荐用终端触发，因为接口需要带密钥：

```bash
curl -H "x-cron-secret: 你的CRON_SECRET" https://你的域名/api/jobs/sync-latest
```

成功时会看到类似结果：

```json
{
  "ok": true,
  "totalRecords": 878,
  "inserted": 878,
  "updated": 0,
  "reviewedIssue": "2026146",
  "generatedForIssue": "2026147"
}
```

看到 `ok: true` 就表示初始化成功。

### 9. 打开网站检查

回到你的 Vercel 网址：

```text
https://你的域名
```

你应该能看到：

- 新澳门六合彩预测看板
- 最近一期开奖
- 下期特别号预测
- 历史数据页面
- 预测历史页面
- 复盘页面

### 10. 自动同步说明

项目里的 `web/vercel.json` 已经配置了 Vercel Cron：

```json
{
  "path": "/api/jobs/sync-latest",
  "schedule": "38 13 * * *"
}
```

Vercel Cron 使用 UTC 时间。`38 13 * * *` 表示每天 UTC 13:38 执行，也就是北京时间 / 澳门时间每天晚上 21:38 执行。

新澳门通常晚上开奖，所以这个时间点用于自动同步最新开奖、复盘上一期预测，并生成下一期预测。

### 11. 常见问题

**部署时报 `DATABASE_URL` 错误**

说明数据库没有接好。去 Vercel 项目的 `Storage` 创建 Neon/Postgres，并确认 `Settings -> Environment Variables` 里有 `DATABASE_URL`。

**页面打开了，但是没有开奖数据**

先手动触发同步接口：

```bash
curl -H "x-cron-secret: 你的CRON_SECRET" https://你的域名/api/jobs/sync-latest
```

然后刷新首页。

**接口返回 Unauthorized**

说明你设置了 `CRON_SECRET`，但请求没有带密钥。用下面格式：

```bash
curl -H "x-cron-secret: 你的CRON_SECRET" https://你的域名/api/jobs/sync-latest
```

**想重新导入历史数据**

最简单的方法是再次访问同步接口。它会按期号去重，不会重复插入同一期：

```bash
curl -H "x-cron-secret: 你的CRON_SECRET" https://你的域名/api/jobs/sync-latest
```

**想看 Vercel 执行日志**

进入 Vercel 项目：

```text
Deployments -> 点开最新部署 -> Functions / Logs
```

如果 Cron 执行失败，也可以在这里看到错误。

**Node 版本怎么设置**

项目 `web/package.json` 声明使用 Node 20：

```json
"engines": {
  "node": ">=20 <21",
  "npm": ">=10 <11"
}
```

Vercel 默认会按这个配置使用合适版本。一般不用手动改。

## 本地 Python 版

脚本：`marksix_local.py`

### 环境

- Python 3.10+
- 不需要 `pip install`

### 快速开始

在项目根目录执行：

```bash
# 1) 首次从新澳门接口导入历史，并生成下一期预测
python3 marksix_local.py bootstrap

# 2) 查看当前摘要（最新开奖、待复盘预测、策略统计）
python3 marksix_local.py show

# 3) 同步新澳门最新开奖 + 复盘 + 生成新预测
python3 marksix_local.py sync

# 4) 快捷更新
python3 marksix_local.py --update
```

### 命令说明

```bash
python3 marksix_local.py bootstrap
python3 marksix_local.py sync --source auto
python3 marksix_local.py sync --source latest
python3 marksix_local.py sync --source history --history-url "https://history.macaumarksix.com/history/macaujc2/y/{year}"
python3 marksix_local.py sync --source csv --csv <新澳门CSV文件>
python3 marksix_local.py sync --source auto --with-backtest
python3 marksix_local.py backtest --rebuild
python3 marksix_local.py backtest --rebuild --remine --progress-every 50
python3 marksix_local.py mine
python3 marksix_local.py predict [--issue 2026147]
python3 marksix_local.py review [--issue 2026146]
python3 marksix_local.py show
```

### 数据源规则

- 数据库为空时会优先使用新澳门在线接口初始化历史。
- 数据库已有历史后继续使用新澳门在线接口更新。
- 默认开启连续性检查：发现新澳门期号断档会直接失败并提示缺失期号样例。
- 如你确认数据源不完整但仍想继续更新，可加 `--no-require-continuity`。

### 本地 Web 页面

```bash
python3 web_app.py --host 127.0.0.1 --port 8080
```

打开浏览器访问：

- `http://127.0.0.1:8080/`：预测看板
- `http://127.0.0.1:8080/review`：复盘总览
- `http://127.0.0.1:8080/review?issue=2026146`：按期查看预测与准确率

### 本地数据库

- 默认数据库文件：`marksix_local.db`
- 默认 CSV：`Macau_Mark_Six.csv`
- 可通过 `--db`、`--csv` 自定义路径

例如：

```bash
python3 marksix_local.py --db ./data/local.db show
```

## 本地 Next.js 版

如果你想在电脑上跑 Vercel 同款网站：

```bash
cd web
npm install
cp .env.example .env
```

然后把 `.env` 里的 `DATABASE_URL` 改成你自己的 Postgres 地址，再执行：

```bash
npx prisma generate
npx prisma db push
npm run bootstrap:history
npm run dev
```

打开：

```text
http://localhost:3000
```
