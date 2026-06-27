import { PredictionStatus } from "@prisma/client";
import { getWaveColor, macauIssueWhere, nextMacauIssueNo } from "@/lib/marksix";
import { reviewPredictionRun } from "@/lib/prediction-review";
import { prisma } from "@/lib/prisma";
import { allStrategies, generateStrategyResult, predictWaveColor } from "@/lib/strategies";
import { type StrategyId } from "@/lib/types";

function nextIssueNo(issueNo: string): string {
  if (/^\d{7}$/.test(issueNo)) {
    return nextMacauIssueNo(issueNo);
  }

  const [year, no] = issueNo.split("/");
  const seq = Number(no);
  if (!year || Number.isNaN(seq)) {
    return issueNo;
  }
  return `${year}/${String(seq + 1).padStart(no.length, "0")}`;
}

export async function generatePredictionsForIssue(issueNo: string, strategyIds?: StrategyId[]) {
  const draws = await prisma.draw.findMany({
    where: macauIssueWhere(),
    orderBy: { drawDate: "desc" },
  });

  if (draws.length < 20) {
    throw new Error("Not enough history to generate predictions");
  }

  const strategyList = strategyIds ?? allStrategies();
  const createdRuns: number[] = [];

  for (const strategy of strategyList) {
    const result = generateStrategyResult(strategy, draws, issueNo);

    const run = await prisma.predictionRun.upsert({
      where: {
        issueNo_strategy_strategyVersion: {
          issueNo,
          strategy: result.strategy,
          strategyVersion: result.strategyVersion,
        },
      },
      update: {
        createdAt: new Date(),
        status: PredictionStatus.PENDING,
        hitCount: null,
        hitRate: null,
        reviewedAt: null,
      },
      create: {
        issueNo,
        strategy: result.strategy,
        strategyVersion: result.strategyVersion,
      },
      select: { id: true },
    });

    await prisma.predictionPick.deleteMany({ where: { runId: run.id } });
    if (result.picks.length > 0) {
      await prisma.predictionPick.createMany({
        data: result.picks.map((pick) => ({
          runId: run.id,
          number: pick.number,
          rank: pick.rank,
          score: pick.score,
          reason: pick.reason,
        })),
      });
    }

    if (strategy === "wave_special_v1") {
      const wavePrediction = predictWaveColor(draws, issueNo);
      const common = {
        issueNo,
        predictedWavesJson: JSON.stringify(wavePrediction.predictedWaves),
        excludedWave: wavePrediction.excludedWave,
        riskJson: JSON.stringify(wavePrediction.risk),
        confidence: wavePrediction.confidence,
        betLevel: wavePrediction.betLevel,
        confidenceNote: wavePrediction.confidenceNote,
        voterPatternJson: JSON.stringify(wavePrediction.voterPattern),
        recentCountsJson: JSON.stringify(wavePrediction.recentCounts),
      };
      await prisma.wavePredictionDetail.upsert({
        where: { runId: run.id },
        update: { ...common, actualWave: null, hit: null, reviewedAt: null },
        create: { runId: run.id, ...common },
      });
    } else {
      await prisma.wavePredictionDetail.deleteMany({ where: { runId: run.id } });
    }

    createdRuns.push(run.id);
  }

  return createdRuns;
}

export async function generatePredictionsForNextIssue(strategyIds?: StrategyId[]) {
  const latest = await prisma.draw.findFirst({
    where: macauIssueWhere(),
    orderBy: { drawDate: "desc" },
    select: { issueNo: true },
  });

  if (!latest) {
    throw new Error("No draw history available");
  }

  const targetIssue = nextIssueNo(latest.issueNo);
  const createdRunIds = await generatePredictionsForIssue(targetIssue, strategyIds);
  return { issueNo: targetIssue, createdRunIds };
}

export async function reviewIssue(issueNo: string) {
  const draw = await prisma.draw.findUnique({ where: { issueNo } });
  if (!draw) {
    return { reviewed: 0 };
  }

  const winningSpecial = draw.specialNumber;
  const actualWave = getWaveColor(winningSpecial);
  const pendingRuns = await prisma.predictionRun.findMany({
    where: { issueNo, status: PredictionStatus.PENDING },
    include: { picks: true, waveDetail: true },
  });

  for (const run of pendingRuns) {
    const outcome = reviewPredictionRun({
      strategy: run.strategy,
      picks: run.picks.map((pick) => pick.number),
      winningSpecial,
      actualWave,
      waveDetail: run.waveDetail,
    });

    await prisma.predictionRun.update({
      where: { id: run.id },
      data: {
        status: PredictionStatus.REVIEWED,
        hitCount: outcome.hitCount,
        hitRate: outcome.hitRate,
        reviewedAt: new Date(),
      },
    });

    await prisma.predictionReview.upsert({
      where: { runId: run.id },
      update: {
        matchedNumbersJson: JSON.stringify(outcome.matchedNumbers),
        hitCount: outcome.hitCount,
        hitRate: outcome.hitRate,
      },
      create: {
        runId: run.id,
        drawId: draw.id,
        matchedNumbersJson: JSON.stringify(outcome.matchedNumbers),
        hitCount: outcome.hitCount,
        hitRate: outcome.hitRate,
      },
    });

    if (run.strategy === "wave_special_v1") {
      await prisma.wavePredictionDetail.updateMany({
        where: { runId: run.id },
        data: {
          actualWave,
          hit: outcome.hit,
          reviewedAt: new Date(),
        },
      });
    }
  }

  return { reviewed: pendingRuns.length };
}
