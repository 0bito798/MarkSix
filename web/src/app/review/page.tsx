import { prisma } from "@/lib/prisma";
import { describeSpecialNumber, inferYearFromIssue, macauIssueWhere } from "@/lib/marksix";
import { strategyMeta } from "@/lib/strategies";
import { type StrategyId } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PAGE_SIZE = 50;
const STRATEGY_OPTIONS: Array<{ value: "all" | StrategyId; label: string }> = [
  { value: "all", label: "全部" },
  { value: "zodiac_special_v1", label: strategyMeta.zodiac_special_v1.name },
  { value: "hot_special_v1", label: strategyMeta.hot_special_v1.name },
  { value: "cold_special_v1", label: strategyMeta.cold_special_v1.name },
  { value: "markov_special_v1", label: strategyMeta.markov_special_v1.name },
  { value: "knowledge_mix_v1", label: strategyMeta.knowledge_mix_v1.name },
];
const HIT_OPTIONS: Array<{ value: HitFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "hit", label: "命中" },
  { value: "miss", label: "未中" },
];

type StrategyFilter = "all" | StrategyId;
type HitFilter = "all" | "hit" | "miss";

function parseJsonArray(text: string): number[] {
  try {
    return JSON.parse(text) as number[];
  } catch {
    return [];
  }
}

function parsePage(value?: string): number {
  const page = Number(value);
  if (!Number.isInteger(page) || page < 1) {
    return 1;
  }
  return page;
}

function parseStrategy(value?: string): StrategyFilter {
  return STRATEGY_OPTIONS.some((option) => option.value === value) ? (value as StrategyFilter) : "all";
}

function parseHit(value?: string): HitFilter {
  return value === "hit" || value === "miss" ? value : "all";
}

function buildReviewHref(page: number, strategy: StrategyFilter, hit: HitFilter): string {
  const params = new URLSearchParams();
  if (strategy !== "all") {
    params.set("strategy", strategy);
  }
  if (hit !== "all") {
    params.set("hit", hit);
  }
  if (page > 1) {
    params.set("page", String(page));
  }
  const query = params.toString();
  return query ? `/review?${query}` : "/review";
}

export default async function ReviewPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const pageParam = resolvedSearchParams.page;
  const strategyParam = resolvedSearchParams.strategy;
  const hitParam = resolvedSearchParams.hit;
  const currentPage = parsePage(Array.isArray(pageParam) ? pageParam[0] : pageParam);
  const strategyFilter = parseStrategy(Array.isArray(strategyParam) ? strategyParam[0] : strategyParam);
  const hitFilter = parseHit(Array.isArray(hitParam) ? hitParam[0] : hitParam);
  const reviewWhere = {
    draw: macauIssueWhere(),
    ...(strategyFilter !== "all" ? { run: { strategy: strategyFilter } } : {}),
    ...(hitFilter === "hit" ? { hitCount: { gt: 0 } } : {}),
    ...(hitFilter === "miss" ? { hitCount: 0 } : {}),
  };
  const hasActiveFilters = strategyFilter !== "all" || hitFilter !== "all";

  const totalReviews = await prisma.predictionReview.count({ where: reviewWhere });
  const totalPages = Math.max(1, Math.ceil(totalReviews / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const reviews = await prisma.predictionReview.findMany({
    where: reviewWhere,
    include: {
      run: true,
      draw: true,
    },
    orderBy: { createdAt: "desc" },
    skip: (safePage - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });
  const startIndex = totalReviews === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const endIndex = totalReviews === 0 ? 0 : Math.min(safePage * PAGE_SIZE, totalReviews);
  const pageWindowStart = Math.max(1, safePage - 2);
  const pageWindowEnd = Math.min(totalPages, safePage + 2);
  const visiblePages = Array.from(
    { length: pageWindowEnd - pageWindowStart + 1 },
    (_, index) => pageWindowStart + index,
  );

  const stats = await prisma.predictionRun.groupBy({
    by: ["strategy"],
    where: { status: "REVIEWED", issueNo: macauIssueWhere().issueNo },
    _avg: { hitRate: true, hitCount: true },
    _count: { _all: true },
  });
  const statsMap = new Map(stats.map((item) => [item.strategy, item]));
  const markovStats = statsMap.get("markov_special_v1");
  const reviewedTotal = stats.reduce((sum, item) => sum + item._count._all, 0);

  return (
    <section className="stack">
      <div className="section-head">
        <div>
          <p className="eyebrow">Review</p>
          <h2>特别号码复盘</h2>
        </div>
        <p className="kv">命中以“候选池是否包含当期特别号”为准，马尔科夫转移方案已纳入复盘筛选和策略总览。</p>
      </div>

      <div className="summary-strip">
        <div>
          <span className="kv">复盘总数</span>
          <strong>{reviewedTotal}</strong>
        </div>
        <div>
          <span className="kv">马尔科夫复盘</span>
          <strong>{markovStats?._count._all ?? 0}</strong>
        </div>
        <div>
          <span className="kv">马尔科夫均值</span>
          <strong>{(markovStats?._avg.hitCount ?? 0).toFixed(2)}</strong>
        </div>
      </div>

      <div className="card">
        <h3>策略总览</h3>
        <table>
          <thead>
            <tr>
              <th>策略</th>
              <th>复盘次数</th>
              <th>平均命中值</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((item) => (
              <tr key={item.strategy} className={item.strategy === "markov_special_v1" ? "is-markov-row" : undefined}>
                <td>{strategyMeta[item.strategy as keyof typeof strategyMeta]?.name ?? item.strategy}</td>
                <td>{item._count._all}</td>
                <td>{(item._avg.hitCount ?? 0).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h3>复盘记录</h3>
            <p className="kv">当前显示第 {startIndex} - {endIndex} 条，共 {totalReviews} 条</p>
          </div>
          <span className="badge">{PAGE_SIZE} 条 / 页</span>
        </div>

        <div className="review-filter-panel">
          <div className="review-filter-row">
            <span className="filter-label">策略</span>
            <div className="toggle-group">
              {STRATEGY_OPTIONS.map((option) => (
                <a
                  key={option.value}
                  href={buildReviewHref(1, option.value, hitFilter)}
                  className={`toggle-link ${strategyFilter === option.value ? "is-active" : ""}`}
                  aria-current={strategyFilter === option.value ? "true" : undefined}
                >
                  {option.label}
                </a>
              ))}
            </div>
          </div>
          <div className="review-filter-row">
            <span className="filter-label">命中</span>
            <div className="toggle-group">
              {HIT_OPTIONS.map((option) => (
                <a
                  key={option.value}
                  href={buildReviewHref(1, strategyFilter, option.value)}
                  className={`toggle-link ${hitFilter === option.value ? "is-active" : ""}`}
                  aria-current={hitFilter === option.value ? "true" : undefined}
                >
                  {option.label}
                </a>
              ))}
            </div>
          </div>
        </div>

        {reviews.length > 0 ? (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>开奖期号</th>
                    <th>当期特别号</th>
                    <th>策略</th>
                    <th>是否命中</th>
                    <th>命中号码</th>
                  </tr>
                </thead>
                <tbody>
                  {reviews.map((review) => {
                    const matched = parseJsonArray(review.matchedNumbersJson);
                    const year = inferYearFromIssue(review.draw.issueNo, review.draw.drawDate.getUTCFullYear());

                    return (
                      <tr key={review.id} className={review.run.strategy === "markov_special_v1" ? "is-markov-row" : undefined}>
                        <td>{review.draw.issueNo}</td>
                        <td>{describeSpecialNumber(review.draw.specialNumber, year)}</td>
                        <td>{strategyMeta[review.run.strategy as keyof typeof strategyMeta]?.name ?? review.run.strategy}</td>
                        <td>{review.hitCount > 0 ? "命中" : "未中"}</td>
                        <td>{matched.length > 0 ? matched.map((number) => String(number).padStart(2, "0")).join(", ") : "-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="pagination">
              <a
                href={safePage > 1 ? buildReviewHref(safePage - 1, strategyFilter, hitFilter) : undefined}
                className={`page-link ${safePage <= 1 ? "is-disabled" : ""}`}
                aria-disabled={safePage <= 1}
              >
                上一页
              </a>

              <div className="page-list">
                {visiblePages.map((page) => (
                  <a
                    key={page}
                    href={buildReviewHref(page, strategyFilter, hitFilter)}
                    className={`page-link ${page === safePage ? "is-active" : ""}`}
                    aria-current={page === safePage ? "page" : undefined}
                  >
                    {page}
                  </a>
                ))}
              </div>

              <a
                href={safePage < totalPages ? buildReviewHref(safePage + 1, strategyFilter, hitFilter) : undefined}
                className={`page-link ${safePage >= totalPages ? "is-disabled" : ""}`}
                aria-disabled={safePage >= totalPages}
              >
                下一页
              </a>
            </div>
          </>
        ) : (
          <div className="empty-state">
            <p>{hasActiveFilters ? "没有符合筛选条件的复盘记录。" : "当前数据库还没有复盘记录。"}</p>
            <p className="kv">
              {hasActiveFilters ? (
                <a href="/review" className="inline-link">清除筛选</a>
              ) : (
                "开奖记录同步后会自动复盘对应预测结果。"
              )}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
