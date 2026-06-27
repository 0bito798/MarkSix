import { type WaveColor } from "@/lib/types";
import { inferWaveSummaryFromNumbers } from "@/lib/wave-summary";

export type ReviewOutcome = {
  matchedNumbers: number[];
  hit: boolean;
  hitCount: number;
  hitRate: number;
};

export type PredictionRunReviewInput = {
  strategy: string;
  picks: number[];
  winningSpecial: number;
  actualWave: WaveColor | string;
  waveDetail?: { excludedWave: WaveColor | string } | null;
};

export function reviewWaveExclusion(excludedWave: WaveColor | string, actualWave: WaveColor | string): ReviewOutcome {
  const hit = excludedWave !== actualWave;
  return {
    matchedNumbers: [],
    hit,
    hitCount: hit ? 1 : 0,
    hitRate: hit ? 1 : 0,
  };
}

export function reviewNumberPicks(picks: number[], winningSpecial: number): ReviewOutcome {
  const matchedNumbers = picks
    .filter((number) => number === winningSpecial)
    .sort((a, b) => a - b);
  const hitCount = matchedNumbers.length;
  return {
    matchedNumbers,
    hit: hitCount > 0,
    hitCount,
    hitRate: picks.length === 0 ? 0 : Number((hitCount / picks.length).toFixed(4)),
  };
}

export function reviewPredictionRun(input: PredictionRunReviewInput): ReviewOutcome {
  if (input.strategy === "wave_special_v1") {
    const waveSummary = input.waveDetail ?? inferWaveSummaryFromNumbers(input.picks);
    if (!waveSummary) {
      throw new Error("Missing wave prediction detail for wave_special_v1");
    }
    return reviewWaveExclusion(waveSummary.excludedWave, input.actualWave);
  }

  return reviewNumberPicks(input.picks, input.winningSpecial);
}
