import { prisma } from "@/lib/prisma";
import { formatNumber, getWaveColor, macauIssueWhere } from "@/lib/marksix";
import { strategyMeta } from "@/lib/strategies";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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

export default async function PredictionsPage() {
  const predictionHistory = await prisma.predictionRun.findMany({
    where: { issueNo: macauIssueWhere().issueNo },
    include: {
      picks: {
        orderBy: { rank: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return (
    <section className="stack">
      <div className="section-head">
        <div>
          <p className="eyebrow">Predictions</p>
          <h2>预测历史</h2>
        </div>
        <p className="kv">展示数据库中已经保存的特别号码预测批次，包括目标期号、策略、生成时间和候选号。</p>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h3>最近 50 次预测</h3>
            <p className="kv">同一期不同方案会分别保留一条记录，方便查看历史生成结果和当前待开奖批次。</p>
          </div>
          <span className="badge">{predictionHistory.length} 条记录</span>
        </div>

        <table>
          <thead>
            <tr>
              <th>目标期号</th>
              <th>策略</th>
              <th>状态</th>
              <th>候选号码</th>
            </tr>
          </thead>
          <tbody>
            {predictionHistory.map((run) => (
              <tr key={run.id}>
                <td>{run.issueNo}</td>
                <td>{strategyMeta[run.strategy as keyof typeof strategyMeta]?.name ?? run.strategy}</td>
                <td>{run.status === "REVIEWED" ? "已复盘" : "待开奖"}</td>
                <td>
                  <div className="history-balls">
                    {run.picks.map((pick) => (
                      <span key={pick.id} className={`history-ball ${waveClassName(pick.number)}`} title={pick.reason}>
                        {formatNumber(pick.number)}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
