import { prisma } from "@/lib/prisma";
import { formatNumber, getWaveColor, macauIssueWhere } from "@/lib/marksix";
import { formatPredictionReason } from "@/lib/prediction-reason";
import { scheduledStrategies, strategyMeta } from "@/lib/strategies";
import { type StrategyId } from "@/lib/types";
import { waveSummaryFromDetailOrNumbers } from "@/lib/wave-summary";
import { WaveBadge, WaveBadgeGroup } from "@/components/wave-badge";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PAGE_SIZE = 50;
const STRATEGY_OPTIONS: Array<{ value: "all" | StrategyId; label: string }> = [
  { value: "all", label: "全部" },
  ...scheduledStrategies().map((strategy) => ({ value: strategy, label: strategyMeta[strategy].name })),
];

function waveClassName(number: number): string {
  const wave = getWaveColor(number);
  if (wave === "红波") {
    return "ball-red";
  }
  if (wave === "蓝波") {
    return "ball-blue";
  }
  return "ball-green";
}

function formatDateTime(date: Date): string {
  return date.toISOString().replace("T", " ").slice(0, 16);
}

function WavePredictionSummary({ detail, numbers }: { detail: { predictedWavesJson: string; excludedWave: string } | null; numbers: number[] }) {
  const summary = waveSummaryFromDetailOrNumbers(detail, numbers);
  if (!summary) return null;
  return (
    <div className="wave-summary">
      <span className="kv">推荐</span>
      <WaveBadgeGroup waves={summary.predictedWaves} size="sm" />
      <span className="kv">排除</span>
      <WaveBadge wave={summary.excludedWave} size="sm" />
    </div>
  );
}

function parsePage(value?: string): number {
  const page = Number(value);
  if (!Number.isInteger(page) || page < 1) {
    return 1;
  }
  return page;
}

type StrategyFilter = "all" | StrategyId;

function parseStrategy(value?: string): StrategyFilter {
  return STRATEGY_OPTIONS.some((option) => option.value === value) ? (value as StrategyFilter) : "all";
}

function buildPredictionsHref(page: number, strategy: StrategyFilter): string {
  const params = new URLSearchParams();
  if (strategy !== "all") {
    params.set("strategy", strategy);
  }
  if (page > 1) {
    params.set("page", String(page));
  }
  const query = params.toString();
  return query ? `/predictions?${query}` : "/predictions";
}

export default async function PredictionsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const pageParam = resolvedSearchParams.page;
  const strategyParam = resolvedSearchParams.strategy;
  const currentPage = parsePage(Array.isArray(pageParam) ? pageParam[0] : pageParam);
  const strategyFilter = parseStrategy(Array.isArray(strategyParam) ? strategyParam[0] : strategyParam);
  const predictionWhere = {
    issueNo: macauIssueWhere().issueNo,
    ...(strategyFilter !== "all" ? { strategy: strategyFilter } : {}),
  };

  const totalPredictions = await prisma.predictionRun.count({ where: predictionWhere });
  const totalPages = Math.max(1, Math.ceil(totalPredictions / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const predictionHistory = await prisma.predictionRun.findMany({
    where: predictionWhere,
    include: {
      picks: {
        orderBy: { number: "asc" },
      },
      waveDetail: true,
    },
    orderBy: { createdAt: "desc" },
    skip: (safePage - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });
  const startIndex = totalPredictions === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const endIndex = totalPredictions === 0 ? 0 : Math.min(safePage * PAGE_SIZE, totalPredictions);
  const pageWindowStart = Math.max(1, safePage - 2);
  const pageWindowEnd = Math.min(totalPages, safePage + 2);
  const visiblePages = Array.from(
    { length: pageWindowEnd - pageWindowStart + 1 },
    (_, index) => pageWindowStart + index,
  );

  return (
    <section className="stack">
      <div className="section-head">
        <div>
          <p className="eyebrow">Predictions</p>
          <h2>预测历史</h2>
        </div>
        <p className="kv">展示数据库中已经保存的特别号码预测批次。</p>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h3>预测记录</h3>
            <p className="kv">当前显示第 {startIndex} - {endIndex} 条，共 {totalPredictions} 条</p>
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
                  href={buildPredictionsHref(1, option.value)}
                  className={`toggle-link ${strategyFilter === option.value ? "is-active" : ""}`}
                  aria-current={strategyFilter === option.value ? "true" : undefined}
                >
                  {option.label}
                </a>
              ))}
            </div>
          </div>
        </div>

        {predictionHistory.length > 0 ? (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>目标期号</th>
                    <th>策略</th>
                    <th>状态</th>
                    <th>生成时间</th>
                    <th>候选号码</th>
                  </tr>
                </thead>
                <tbody>
                  {predictionHistory.map((run) => {
                    const isWaveStrategy = run.strategy === "wave_special_v1";

                    return (
                      <tr key={run.id}>
                        <td>{run.issueNo}</td>
                        <td>{strategyMeta[run.strategy as keyof typeof strategyMeta]?.name ?? run.strategy}</td>
                        <td>{run.status === "REVIEWED" ? "已复盘" : "待开奖"}</td>
                        <td>{formatDateTime(run.createdAt)}</td>
                        <td>
                          {isWaveStrategy ? (
                            <WavePredictionSummary detail={run.waveDetail} numbers={run.picks.map((pick) => pick.number)} />
                          ) : (
                            <div className="history-balls">
                              {run.picks.map((pick) => (
                                <span key={pick.id} className={`history-ball ${waveClassName(pick.number)}`} title={formatPredictionReason(pick.reason)}>
                                  {formatNumber(pick.number)}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="pagination">
              <a
                href={safePage > 1 ? buildPredictionsHref(safePage - 1, strategyFilter) : undefined}
                className={`page-link ${safePage <= 1 ? "is-disabled" : ""}`}
                aria-disabled={safePage <= 1}
              >
                上一页
              </a>

              <div className="page-list">
                {visiblePages.map((page) => (
                  <a
                    key={page}
                    href={buildPredictionsHref(page, strategyFilter)}
                    className={`page-link ${page === safePage ? "is-active" : ""}`}
                    aria-current={page === safePage ? "page" : undefined}
                  >
                    {page}
                  </a>
                ))}
              </div>

              <a
                href={safePage < totalPages ? buildPredictionsHref(safePage + 1, strategyFilter) : undefined}
                className={`page-link ${safePage >= totalPages ? "is-disabled" : ""}`}
                aria-disabled={safePage >= totalPages}
              >
                下一页
              </a>
            </div>
          </>
        ) : (
          <div className="empty-state">
            <p>{strategyFilter === "all" ? "当前数据库还没有预测记录。" : "当前筛选下没有预测记录。"}</p>
            <p className="kv">
              {strategyFilter === "all" ? (
                <>可调用 <code>POST /api/predictions/generate</code> 或先执行一次同步任务。</>
              ) : (
                <a href="/predictions" className="inline-link">查看全部策略</a>
              )}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
