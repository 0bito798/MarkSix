import { prisma } from "@/lib/prisma";
import { describeSpecialNumber, getWaveColor, inferYearFromIssue, macauIssueWhere } from "@/lib/marksix";
import { strategyMeta } from "@/lib/strategies";
import { type StrategyId } from "@/lib/types";
import { waveSummaryFromDetailOrNumbers } from "@/lib/wave-summary";
import { WaveBadge, WaveBadgeGroup } from "@/components/wave-badge";

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
  { value: "wave_special_v1", label: strategyMeta.wave_special_v1.name },
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

function WaveReviewSummary({ detail, numbers, actualWave }: { detail: { predictedWavesJson: string; excludedWave: string } | null; numbers: number[]; actualWave?: string | null }) {
  const summary = waveSummaryFromDetailOrNumbers(detail, numbers);
  if (!summary) return null;
  return (
    <div className="wave-summary">
      <span className="kv">推荐</span>
      <WaveBadgeGroup waves={summary.predictedWaves} size="sm" />
      <span className="kv">排除</span>
      <WaveBadge wave={summary.excludedWave} size="sm" />
      {actualWave ? (
        <>
          <span className="kv">实际</span>
          <WaveBadge wave={actualWave} size="sm" />
        </>
      ) : null}
    </div>
  );
}

function WaveReviewResult({ hit, actualWave }: { hit: boolean; actualWave: string }) {
  return (
    <span className="wave-result-inline">
      {hit ? "命中波色" : "未命中波色"}
      <WaveBadge wave={actualWave} size="sm" />
    </span>
  );
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
      run: { include: { picks: true, waveDetail: true } },
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
  const overviewStrategies = STRATEGY_OPTIONS.filter((option) => option.value !== "all");

  return (
    <section className="stack">
      <div className="section-head">
        <div>
          <p className="eyebrow">Review</p>
          <h2>特别号码复盘</h2>
        </div>
        <p className="kv">号码方案按候选池是否包含当期特别号判断；波色排除方案按实际波色是否落入推荐波色判断。</p>
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
            {overviewStrategies.map((option) => {
              const item = statsMap.get(option.value);

              return (
                <tr key={option.value}>
                  <td>{option.label}</td>
                  <td>{item?._count._all ?? 0}</td>
                  <td>{(item?._avg.hitCount ?? 0).toFixed(2)}</td>
                </tr>
              );
            })}
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
                    <th>命中结果</th>
                  </tr>
                </thead>
                <tbody>
                  {reviews.map((review) => {
                    const matched = parseJsonArray(review.matchedNumbersJson);
                    const year = inferYearFromIssue(review.draw.issueNo, review.draw.drawDate.getUTCFullYear());
                    const isWaveStrategy = review.run.strategy === "wave_special_v1";
                    const actualWave = getWaveColor(review.draw.specialNumber);

                    return (
                      <tr key={review.id}>
                        <td>{review.draw.issueNo}</td>
                        <td>{isWaveStrategy ? <WaveBadge wave={actualWave} size="sm" /> : describeSpecialNumber(review.draw.specialNumber, year)}</td>
                        <td>
                          {strategyMeta[review.run.strategy as keyof typeof strategyMeta]?.name ?? review.run.strategy}
                          {isWaveStrategy ? <WaveReviewSummary detail={review.run.waveDetail} numbers={review.run.picks.map((pick) => pick.number)} actualWave={actualWave} /> : null}
                        </td>
                        <td>{review.hitCount > 0 ? "命中" : "未中"}</td>
                        <td>{isWaveStrategy ? <WaveReviewResult hit={review.hitCount > 0} actualWave={actualWave} /> : matched.length > 0 ? matched.map((number) => String(number).padStart(2, "0")).join(", ") : "-"}</td>
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
