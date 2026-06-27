import { getWaveColor } from "@/lib/marksix";
import { type WaveColor } from "@/lib/types";

export type WaveSummary = {
  predictedWaves: WaveColor[];
  excludedWave: WaveColor;
};

const WAVE_COLORS: WaveColor[] = ["红波", "蓝波", "绿波"];

export function inferWaveSummaryFromNumbers(numbers: number[]): WaveSummary | null {
  const present = new Set<WaveColor>();
  for (const number of numbers) {
    if (Number.isInteger(number) && number >= 1 && number <= 49) {
      present.add(getWaveColor(number));
    }
  }

  if (present.size !== 2) {
    return null;
  }

  return {
    predictedWaves: WAVE_COLORS.filter((wave) => present.has(wave)),
    excludedWave: WAVE_COLORS.find((wave) => !present.has(wave))!,
  };
}

export function waveSummaryFromDetailOrNumbers(
  detail: { predictedWavesJson: string; excludedWave: string } | null | undefined,
  numbers: number[],
): WaveSummary | null {
  if (detail) {
    try {
      const parsed = JSON.parse(detail.predictedWavesJson);
      const predictedWaves = Array.isArray(parsed)
        ? parsed.filter((item): item is WaveColor => WAVE_COLORS.includes(item as WaveColor))
        : [];
      if (WAVE_COLORS.includes(detail.excludedWave as WaveColor)) {
        return {
          predictedWaves,
          excludedWave: detail.excludedWave as WaveColor,
        };
      }
    } catch {
      return null;
    }
  }

  return inferWaveSummaryFromNumbers(numbers);
}
