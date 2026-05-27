# 新澳门六合彩特别号码预测项目

这是一个可部署到 Vercel 的 Next.js 应用，核心目标是预测“下期特别号码候选池”，而不是 6 个正码。

## 当前能力
- 默认使用新澳门六合彩接口同步历史与最新开奖：
  - 最新期开奖：`https://macaumarksix.com/api/macaujc2.com`
  - 按年历史：`https://history.macaumarksix.com/history/macaujc2/y/{year}`
- 支持新澳门期号 `YYYYNNN`，例如 `2026146`
- Vercel Cron 自动同步最新期次，并写入 Postgres
- 自动复盘特别号码是否命中候选池
- 4 套特别号码预测方案：
  - `zodiac_special_v1` 生肖号码方案
  - `hot_special_v1` 热门号码方案
  - `cold_special_v1` 冷门号码方案
  - `knowledge_mix_v1` 其他方案

## 特别号码预测方案
1. 生肖号码方案
   基于特别号生肖热度、生肖遗漏和生肖转移节奏，输出下期更可能出现的生肖对应号码，控制在 30 个以内。
2. 热门号码方案
   基于近期特别号频率、主号带动效应和相邻期开奖接力特征，输出热门特别号候选池。
3. 冷门号码方案
   基于长遗漏、低热度、分区缺口和波色缺口，输出具回补潜力的冷门特别号候选池。
4. 其他方案
   综合热度、冷门、生肖、波色、分区和主号联动，形成平衡型特别号候选池。

## 数据策略
- 自动同步默认使用 `RESULT_PROVIDER=macau`
- `macau` 模式会同步新澳门历史 API 与最新期开奖 API
- 可选 CSV 导入支持 `expect/openTime/openCode` 或旧的中文字段
- 同一期号按 `issueNo` 去重，较新的远程来源会覆盖本地旧记录

说明：
- 数据库只持久化预测真正需要的核心字段：
  - `issueNo`
  - `drawDate`
  - `numbersJson`
  - `specialNumber`
  - `source`
- 其他统计维度如生肖、波色、分区、冷热和主号联动在预测时动态计算。

## 本地启动
1. 安装依赖
```bash
npm install
```

2. 配置环境变量
```bash
cp .env.example .env
```

3. 初始化数据库
```bash
npx prisma generate
npx prisma db push
```

4. 导入历史数据
```bash
npm run bootstrap:history
```

5. 启动项目
```bash
npm run dev
```

## API
- `GET /api/jobs/sync-latest`
  - 功能：同步历史 + 复盘最新已开奖期 + 生成下一期特别号预测
  - 认证：支持 `Authorization: Bearer <CRON_SECRET>` 或 `x-cron-secret: <CRON_SECRET>`
- `POST /api/predictions/generate`
  - 功能：手动生成某一期或下一期特别号预测
  - 请求体示例：
```json
{
  "issueNo": "2026147",
  "strategies": ["zodiac_special_v1", "hot_special_v1"]
}
```

## Vercel 必需变量
```env
DATABASE_URL="auto-injected-by-vercel-neon"
CRON_SECRET="replace-with-a-long-random-string"
RESULT_PROVIDER="macau"
MACAU_LOTTERY_KEY="macaujc2"
MACAU_LATEST_API_URL="https://macaumarksix.com/api/macaujc2.com"
MACAU_HISTORY_API_TEMPLATE="https://history.macaumarksix.com/history/macaujc2/y/{year}"
MACAU_HISTORY_FROM_YEAR="2024"
MACAU_HISTORY_TO_YEAR="2026"
```

说明：
- `DATABASE_URL` 由 Neon 集成自动注入，一般不用手填。
- 历史范围变量建议按需调整。默认未配置时会抓取当前澳门年份及前 2 年。

## 部署到 Vercel
1. 推送代码到 GitHub。
2. 在 Vercel 导入仓库，并把 Root Directory 设为 `web`。
3. 在项目的 `Storage` 或 `Marketplace` 中安装 Neon，并创建数据库。
4. 确认 `DATABASE_URL` 已被 Neon 自动注入。
5. 在项目 `Settings -> Environment Variables` 中新增：
   - `CRON_SECRET`
   - `RESULT_PROVIDER=macau`
   - `MACAU_LOTTERY_KEY=macaujc2`
   - `MACAU_LATEST_API_URL=https://macaumarksix.com/api/macaujc2.com`
   - `MACAU_HISTORY_API_TEMPLATE=https://history.macaumarksix.com/history/macaujc2/y/{year}`
6. Build Command 使用：
```bash
npm run vercel-build
```
7. 首次部署后手动触发一次：
   - `GET /api/jobs/sync-latest`
8. 后续由 `vercel.json` 中的 cron 自动执行。

## 历史补录
如果你有更早的新澳门 CSV 文件，可放到 `data/history/` 后执行：
```bash
npm run backfill:history -- --path ./data/history --from-year 2023 --to-year 2026
```

完成后可审计：
```bash
npm run audit:history
```
