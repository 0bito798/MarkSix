import { prisma } from "@/lib/prisma";
import { ALL_NUMBERS, describeSpecialNumber, formatNumber, getWaveColor, inferYearFromIssue, macauIssueWhere } from "@/lib/marksix";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PAGE_SIZE = 50;
type SortMode = "rate" | "number";

function parseJsonArray(text: string): number[] {
  try {
    return JSON.parse(text) as number[];
  } catch {
    return [];
  }
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parsePage(value?: string): number {
  const page = Number(value);
  if (!Number.isInteger(page) || page < 1) {
    return 1;
  }
  return page;
}

function parseSort(value?: string): SortMode {
  return value === "number" ? "number" : "rate";
}

function buildHistoryHref(page: number, sort: SortMode): string {
  const params = new URLSearchParams();
  if (page > 1) {
    params.set("page", String(page));
  }
  if (sort !== "rate") {
    params.set("sort", sort);
  }
  const query = params.toString();
  return query ? `/history?${query}` : "/history";
}

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

export default async function HistoryPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const pageParam = resolvedSearchParams.page;
  const sortParam = resolvedSearchParams.sort;
  const currentPage = parsePage(Array.isArray(pageParam) ? pageParam[0] : pageParam);
  const sortMode = parseSort(Array.isArray(sortParam) ? sortParam[0] : sortParam);

  const [totalDraws, oldestDraw, newestDraw, allSpecials] = await Promise.all([
    prisma.draw.count({ where: macauIssueWhere() }),
    prisma.draw.findFirst({
      where: macauIssueWhere(),
      orderBy: { drawDate: "asc" },
      select: { issueNo: true, drawDate: true },
    }),
    prisma.draw.findFirst({
      where: macauIssueWhere(),
      orderBy: { drawDate: "desc" },
      select: { issueNo: true, drawDate: true },
    }),
    prisma.draw.findMany({
      where: macauIssueWhere(),
      select: { specialNumber: true },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalDraws / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const latestDraws = await prisma.draw.findMany({
    where: macauIssueWhere(),
    orderBy: { drawDate: "desc" },
    skip: (safePage - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });

  const startIndex = totalDraws === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const endIndex = totalDraws === 0 ? 0 : Math.min(safePage * PAGE_SIZE, totalDraws);
  const pageWindowStart = Math.max(1, safePage - 2);
  const pageWindowEnd = Math.min(totalPages, safePage + 2);
  const visiblePages = Array.from(
    { length: pageWindowEnd - pageWindowStart + 1 },
    (_, index) => pageWindowStart + index,
  );
  const specialCounts = new Map<number, number>(ALL_NUMBERS.map((number) => [number, 0]));

  for (const row of allSpecials) {
    specialCounts.set(row.specialNumber, (specialCounts.get(row.specialNumber) ?? 0) + 1);
  }

  const specialStats = ALL_NUMBERS.map((number) => {
    const count = specialCounts.get(number) ?? 0;
    const percentage = totalDraws === 0 ? 0 : (count / totalDraws) * 100;

    return {
      number,
      count,
      percentage,
    };
  }).sort((a, b) => {
    if (sortMode === "number") {
      return a.number - b.number;
    }
    return b.percentage - a.percentage || b.count - a.count || a.number - b.number;
  });

  return (
    <section className="stack">
      <div className="section-head">
        <div>
          <p className="eyebrow">History</p>
          <h2>历史开奖数据</h2>
        </div>
        <p className="kv section-copy">展示数据库中的全部历史开奖，按每页 50 条分页，便于核对同步结果与特别号码走势。</p>
      </div>

      <div className="stat-grid">
        <article className="card stat-card">
          <p className="kv">总记录数</p>
          <h3 className="issue-title">{totalDraws}</h3>
          <p className="kv">当前第 {safePage} / {totalPages} 页</p>
        </article>
        <article className="card stat-card">
          <p className="kv">最早一期</p>
          <h3>{oldestDraw?.issueNo ?? "-"}</h3>
          <p className="kv">{oldestDraw ? formatDate(oldestDraw.drawDate) : "-"}</p>
        </article>
        <article className="card stat-card">
          <p className="kv">最近一期</p>
          <h3>{newestDraw?.issueNo ?? "-"}</h3>
          <p className="kv">{newestDraw ? formatDate(newestDraw.drawDate) : "-"}</p>
        </article>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h3>特别号码出现百分比</h3>
            <p className="kv">以当前数据库全部 {totalDraws} 期历史为基准，统计 1 - 49 每个号码作为特别号的出现次数与占比。</p>
          </div>
          <div className="toggle-group">
            <a
              href={buildHistoryHref(safePage, "rate")}
              className={`toggle-link ${sortMode === "rate" ? "is-active" : ""}`}
              aria-current={sortMode === "rate" ? "true" : undefined}
            >
              按占比排序
            </a>
            <a
              href={buildHistoryHref(safePage, "number")}
              className={`toggle-link ${sortMode === "number" ? "is-active" : ""}`}
              aria-current={sortMode === "number" ? "true" : undefined}
            >
              按号码排序
            </a>
          </div>
        </div>
        <div className="special-stat-grid">
          {specialStats.map((item) => (
            <article key={item.number} className="special-stat-card">
              <div className="special-stat-top">
                <span className={`ball ${waveClassName(item.number)}`}>{formatNumber(item.number)}</span>
                <strong>{item.percentage.toFixed(2)}%</strong>
              </div>
              <p className="kv">出现次数: {item.count}</p>
            </article>
          ))}
        </div>
      </div>

      {latestDraws.length > 0 ? (
        <div className="card">
          <div className="card-head">
            <div>
              <h3>历史开奖列表</h3>
              <p className="kv">当前显示第 {startIndex} - {endIndex} 条，共 {totalDraws} 条</p>
            </div>
            <span className="badge">50 条 / 页</span>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>期号</th>
                  <th>日期</th>
                  <th>正码</th>
                  <th>特别号</th>
                </tr>
              </thead>
              <tbody>
                {latestDraws.map((draw) => {
                  const numbers = parseJsonArray(draw.numbersJson);
                  const year = inferYearFromIssue(draw.issueNo, draw.drawDate.getUTCFullYear());

                  return (
                    <tr key={draw.id}>
                      <td>{draw.issueNo}</td>
                      <td>{formatDate(draw.drawDate)}</td>
                      <td className="history-main-cell">
                        <div className="history-balls">
                          {numbers.map((number) => (
                            <span key={number} className={`history-ball ${waveClassName(number)}`}>
                              {formatNumber(number)}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="history-special-cell">
                        <span className={`history-ball history-special ${waveClassName(draw.specialNumber)}`}>
                          {describeSpecialNumber(draw.specialNumber, year)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="pagination">
            <a
              href={safePage > 1 ? buildHistoryHref(safePage - 1, sortMode) : undefined}
              className={`page-link ${safePage <= 1 ? "is-disabled" : ""}`}
              aria-disabled={safePage <= 1}
            >
              上一页
            </a>

            <div className="page-list">
              {visiblePages.map((page) => (
                <a
                  key={page}
                  href={buildHistoryHref(page, sortMode)}
                  className={`page-link ${page === safePage ? "is-active" : ""}`}
                  aria-current={page === safePage ? "page" : undefined}
                >
                  {page}
                </a>
              ))}
            </div>

            <a
              href={safePage < totalPages ? buildHistoryHref(safePage + 1, sortMode) : undefined}
              className={`page-link ${safePage >= totalPages ? "is-disabled" : ""}`}
              aria-disabled={safePage >= totalPages}
            >
              下一页
            </a>
          </div>
        </div>
      ) : (
        <div className="empty-state">
          <p>当前数据库还没有历史记录。</p>
          <p className="kv">先调用 <code>/api/jobs/sync-latest</code> 完成初始化。</p>
        </div>
      )}
    </section>
  );
}
