import { prisma } from "@/lib/prisma";
import { describeSpecialNumber, formatNumber, getWaveColor, inferYearFromIssue, macauIssueWhere } from "@/lib/marksix";
import { formatPredictionReason } from "@/lib/prediction-reason";
import { strategyMeta } from "@/lib/strategies";
import { waveSummaryFromDetailOrNumbers } from "@/lib/wave-summary";
import { parseWaveList, WaveBadge, WaveBadgeGroup, waveTitle } from "@/components/wave-badge";
import { ZodiacSelectionBadges } from "@/components/zodiac-selection";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function parseJsonArray(text: string): number[] {
  try {
    return JSON.parse(text) as number[];
  } catch {
    return [];
  }
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

function waveCardClassName(wave: string): string {
  if (wave === "红波") {
    return "wave-card-red";
  }
  if (wave === "蓝波") {
    return "wave-card-blue";
  }
  return "wave-card-green";
}

function WaveRiskBoard({ detail }: { detail: { predictedWavesJson: string; excludedWave: string; betLevel: string } | null }) {
  if (!detail) return null;
  const predictedWaves = parseWaveList(detail.predictedWavesJson);

  return (
    <section className="wave-panel">
      <div className="wave-grid">
        {["红波", "蓝波", "绿波"].map((wave) => {
          const recommended = predictedWaves.includes(wave);
          const excluded = detail.excludedWave === wave;
          return (
            <article key={wave} className={`wave-card ${waveCardClassName(wave)} ${recommended ? "is-recommended" : ""} ${excluded ? "is-excluded" : ""}`}>
              <div className="wave-card-head">
                <WaveBadge wave={wave} />
                <strong>{waveTitle(wave)}</strong>
                <span className={`status-pill small ${excluded ? "danger" : recommended ? "success" : "neutral"}`}>
                  {excluded ? "排除" : recommended ? "推荐" : "观察"}
                </span>
              </div>
            </article>
          );
        })}
      </div>
      <div className="metric-strip">
        <div><span>推荐</span><strong><WaveBadgeGroup waves={predictedWaves} size="sm" /></strong></div>
        <div><span>排除</span><strong><WaveBadge wave={detail.excludedWave} size="sm" /></strong></div>
        <div><span>模型档位</span><strong>{detail.betLevel}</strong></div>
      </div>
    </section>
  );
}

function WaveSummaryBoard({ predictedWaves, excludedWave }: { predictedWaves: string[]; excludedWave: string }) {
  return (
    <section className="wave-panel compact">
      <div className="metric-strip">
        <div><span>推荐</span><strong><WaveBadgeGroup waves={predictedWaves} size="sm" /></strong></div>
        <div><span>排除</span><strong><WaveBadge wave={excludedWave} size="sm" /></strong></div>
      </div>
    </section>
  );
}

const featuredStrategyIds = [
  "zodiac_special_v1",
  "zodiac_nine_v1",
  "zodiac_six_v1",
  "zodiac_kill_two_v1",
  "zodiac_kill_one_v1",
  "hot_special_v1",
  "cold_special_v1",
  "knowledge_mix_v1",
  "kill_ten_special_v1",
  "wave_special_v1",
  "markov_special_v1",
] as const;

export default async function HomePage() {
  const latestDraw = await prisma.draw.findFirst({
    where: macauIssueWhere(),
    orderBy: { drawDate: "desc" },
  });

  const latestPendingIssue = await prisma.predictionRun.findFirst({
    where: { status: "PENDING", issueNo: macauIssueWhere().issueNo },
    orderBy: [{ issueNo: "desc" }, { createdAt: "desc" }],
    select: { issueNo: true },
  });

  const pendingRuns = latestPendingIssue
    ? await prisma.predictionRun.findMany({
      where: {
        status: "PENDING",
        issueNo: latestPendingIssue.issueNo,
      },
      include: { picks: { orderBy: { rank: "asc" } }, waveDetail: true, zodiacDetail: true },
      orderBy: { createdAt: "asc" },
    })
    : [];

  const latestIssueYear = latestDraw ? inferYearFromIssue(latestDraw.issueNo, latestDraw.drawDate.getUTCFullYear()) : null;

  return (
    <section className="stack">
      <div className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Vercel Special Number Predictor</p>
          <h2>新澳门六合彩特别号码预测</h2>
          <p className="lede">聚合近期热度、遗漏、生肖节奏、结构分布和转移关系，生成下期特别号候选池。</p>
        </div>

        {latestDraw ? (
          <div className="hero-card">
            <p className="kv">最近一期</p>
            <h3 className="issue-title">{latestDraw.issueNo}</h3>
            <p className="kv compact-line">{latestDraw.drawDate.toISOString().slice(0, 10)}</p>
            <p className="numbers-inline">
              正码 {parseJsonArray(latestDraw.numbersJson).map(formatNumber).join(" ")}
            </p>
            {latestIssueYear ? (
              <p className="special-chip">特别号 {describeSpecialNumber(latestDraw.specialNumber, latestIssueYear)}</p>
            ) : null}
          </div>
        ) : (
          <div className="hero-card">
            <p className="kv">暂无历史数据</p>
            <p className="kv">先执行 <code>npm run bootstrap:history</code> 完成初始化。</p>
          </div>
        )}
      </div>

      {latestPendingIssue ? (
        <div className="section-head">
          <div>
            <h3 className="issue-title">下期预测：{latestPendingIssue.issueNo}</h3>
          </div>
            <p className="kv section-copy">下方展示当前已生成的特别号码方案，可直接用于复盘。</p>
        </div>
      ) : null}

      <div className="card">
        <div className="card-head">
          <div>
            <h3>方案介绍</h3>
            <p className="kv">不同方案从不同角度筛选候选号码，便于横向比较和后续复盘。</p>
          </div>
          <span className="badge">策略总览</span>
        </div>
        <div className="metric-grid">
          {featuredStrategyIds.map((strategy) => (
            <article key={strategy} className="metric-card scheme-card">
              <strong>{strategyMeta[strategy].name}</strong>
              <p className="kv">{strategyMeta[strategy].description}</p>
            </article>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h3>指标说明</h3>
            <p className="kv">页面里出现的分值都是模型内部的相对强弱指标，用来做排序参考，不等于真实开奖概率。</p>
          </div>
          <span className="badge">参数解释</span>
        </div>
        <div className="metric-grid">
          <article className="metric-card">
            <strong>热度</strong>
            <p className="kv">某号码或某生肖在最近历史中特别号出现得有多活跃，数值越高表示近期越常见。</p>
          </article>
          <article className="metric-card">
            <strong>转移</strong>
            <p className="kv">根据历史期次节奏，上一种状态过后接着出现该号码或生肖的相对强度，不是百分比概率。</p>
          </article>
          <article className="metric-card">
            <strong>遗漏</strong>
            <p className="kv">该号码或生肖距离上一次作为特别号出现已经隔了多久，越高通常代表越久没出。</p>
          </article>
          <article className="metric-card">
            <strong>综合分</strong>
            <p className="kv">把热度、遗漏、转移、波色、分区和正码联动等指标加权后的总分，用来给候选号排序。</p>
          </article>
          <article className="metric-card">
            <strong>主号联动</strong>
            <p className="kv">某号码近期在正码 6 个号码中出现得有多频繁，用来观察它与特别号的联动倾向。</p>
          </article>
          <article className="metric-card">
            <strong>波色 / 分区</strong>
            <p className="kv">波色是红波、蓝波、绿波；分区是 1-10、11-20 等区段，用来衡量近期结构是否失衡。</p>
          </article>
        </div>
      </div>

      <div className="grid">
        {pendingRuns.map((run) => {
          const isWaveStrategy = run.strategy === "wave_special_v1";
          const isZodiacStrategy = Boolean(run.zodiacDetail);
          const isNumberExclusion = run.selectionMode === "EXCLUDE";
          const waveSummary = isWaveStrategy
            ? waveSummaryFromDetailOrNumbers(run.waveDetail, run.picks.map((pick) => pick.number))
            : null;

          return (
          <article
            key={run.id}
            className={`card prediction-card ${isWaveStrategy ? "wave-prediction-card" : ""} ${isNumberExclusion ? "number-exclusion-card" : ""}`}
          >
            <div className="card-head">
              <h3>{strategyMeta[run.strategy as keyof typeof strategyMeta]?.name ?? run.strategy}</h3>
              <span className="badge">
                {isWaveStrategy
                  ? "\u6ce2\u8272\u65b9\u6848"
                  : isZodiacStrategy
                    ? "\u751f\u8096\u65b9\u6848"
                    : isNumberExclusion
                      ? `${run.picks.length} \u4e2a\u6392\u9664\u7801`
                      : `${run.picks.length} \u4e2a\u5019\u9009`}
              </span>
            </div>
            <p className="kv">{strategyMeta[run.strategy as keyof typeof strategyMeta]?.description}</p>
            <p className="kv">目标期号: {run.issueNo}</p>
            {run.waveDetail ? <WaveRiskBoard detail={run.waveDetail} /> : null}
            {run.zodiacDetail ? <ZodiacSelectionBadges detail={run.zodiacDetail} variant="prediction" /> : null}
            {isWaveStrategy && !run.waveDetail && waveSummary ? (
              <WaveSummaryBoard predictedWaves={waveSummary.predictedWaves} excludedWave={waveSummary.excludedWave} />
            ) : null}
            {!isWaveStrategy && !isZodiacStrategy ? (
              <>
                {isNumberExclusion ? <p className="selection-mode-label">排除号码</p> : null}
                <div className="numbers">
                  {run.picks.map((pick) => (
                    <span key={pick.id} className={`ball ${waveClassName(pick.number)}`} title={formatPredictionReason(pick.reason)}>
                      {String(pick.number).padStart(2, "0")}
                    </span>
                  ))}
                </div>
                <div className="reason-list">
                  {run.picks.slice(0, 6).map((pick) => (
                    <div key={pick.id} className="reason-item">
                      <span className="reason-order">{pick.rank}</span>
                      <span className={`reason-ball ${waveClassName(pick.number)}`}>
                        {String(pick.number).padStart(2, "0")}
                      </span>
                      <p className="kv reason-copy">{formatPredictionReason(pick.reason)}</p>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </article>
          );
        })}
      </div>

      {pendingRuns.length === 0 ? (
        <div className="empty-state">
          <p>还没有待开奖预测结果。</p>
          <p className="kv">可调用 <code>POST /api/predictions/generate</code> 或先执行一次同步任务。</p>
        </div>
      ) : null}
    </section>
  );
}
