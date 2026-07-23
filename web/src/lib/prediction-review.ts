import { isPureZodiacStrategy } from "@/lib/strategies";
import { type WaveColor, type ZodiacSelectionMode } from "@/lib/types";
import { inferWaveSummaryFromNumbers } from "@/lib/wave-summary";

export type ReviewOutcome = {
  matchedNumbers: number[];
  hit: boolean;
  hitCount: number;
  hitRate: number;
};

export type PredictionRunReviewInput = {
  strategy: string;
  selectionMode?: string | null;
  picks: number[];
  winningSpecial: number;
  actualWave: WaveColor | string;
  actualZodiac?: string;
  waveDetail?: { excludedWave: WaveColor | string } | null;
  zodiacDetail?: { mode: ZodiacSelectionMode | string; zodiacsJson: string } | null;
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

export function reviewNumberExclusion(picks: number[], winningSpecial: number): ReviewOutcome {
  const excluded = picks.includes(winningSpecial);
  return {
    matchedNumbers: excluded ? [winningSpecial] : [],
    hit: !excluded,
    hitCount: excluded ? 0 : 1,
    hitRate: excluded ? 0 : 1,
  };
}

function parseZodiacs(zodiacsJson: string): string[] {
  try {
    const value: unknown = JSON.parse(zodiacsJson);
    if (!Array.isArray(value)) {
      return [];
    }
    return value.flatMap((item) => {
      if (!item || typeof item !== "object" || !("zodiac" in item) || typeof item.zodiac !== "string") {
        return [];
      }
      return [item.zodiac];
    });
  } catch {
    return [];
  }
}

export function reviewZodiacSelection(
  mode: ZodiacSelectionMode | string,
  zodiacsJson: string,
  actualZodiac: string,
): ReviewOutcome {
  const zodiacs = parseZodiacs(zodiacsJson);
  if (zodiacs.length === 0) {
    throw new Error("Missing zodiac selection detail");
  }

  const selected = zodiacs.includes(actualZodiac);
  const hit = mode === "RECOMMEND" ? selected : !selected;
  return {
    matchedNumbers: [],
    hit,
    hitCount: hit ? 1 : 0,
    hitRate: hit ? 1 : 0,
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

  if (isPureZodiacStrategy(input.strategy)) {
    if (!input.zodiacDetail || !input.actualZodiac) {
      throw new Error(`Missing zodiac prediction detail for ${input.strategy}`);
    }
    return reviewZodiacSelection(input.zodiacDetail.mode, input.zodiacDetail.zodiacsJson, input.actualZodiac);
  }

  return input.selectionMode === "EXCLUDE"
    ? reviewNumberExclusion(input.picks, input.winningSpecial)
    : reviewNumberPicks(input.picks, input.winningSpecial);
}
