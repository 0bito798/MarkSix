import { prisma } from "@/lib/prisma";
import { describeSpecialNumber, inferYearFromIssue, macauIssueWhere } from "@/lib/marksix";
import { strategyMeta } from "@/lib/strategies";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function parseJsonArray(text: string): number[] {
  try {
    return JSON.parse(text) as number[];
  } catch {
    return [];
  }
}

export default async function ReviewPage() {
  const reviews = await prisma.predictionReview.findMany({
    where: { draw: macauIssueWhere() },
    include: {
      run: true,
      draw: true,
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const stats = await prisma.predictionRun.groupBy({
    by: ["strategy"],
    where: { status: "REVIEWED", issueNo: macauIssueWhere().issueNo },
    _avg: { hitRate: true, hitCount: true },
    _count: { _all: true },
  });

  return (
    <section className="stack">
      <div className="section-head">
        <div>
          <p className="eyebrow">Review</p>
          <h2>特别号码复盘</h2>
        </div>
        <p className="kv">命中以“候选池是否包含当期特别号”为准，命中率按命中数除以候选数计算。</p>
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
              <tr key={item.strategy}>
                <td>{strategyMeta[item.strategy as keyof typeof strategyMeta]?.name ?? item.strategy}</td>
                <td>{item._count._all}</td>
                <td>{(item._avg.hitCount ?? 0).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>最近复盘</h3>
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
                <tr key={review.id}>
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
    </section>
  );
}
