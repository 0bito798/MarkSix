export type WaveColor = "红波" | "蓝波" | "绿波";

import { type ZodiacName } from "@/lib/marksix";

export type ZodiacSelectionMode = "RECOMMEND" | "EXCLUDE";

export type ZodiacSelection = {
  mode: ZodiacSelectionMode;
  zodiacs: Array<{
    zodiac: ZodiacName;
    rank: number;
    score: number;
  }>;
};

export type CsvDrawRecord = {
  issueNo: string;
  drawDate: Date;
  numbers: number[];
  specialNumber: number;
  source?: string;
};

export type StrategyId =
  | "zodiac_special_v1"
  | "zodiac_nine_v1"
  | "zodiac_six_v1"
  | "zodiac_kill_two_v1"
  | "zodiac_kill_one_v1"
  | "hot_special_v1"
  | "cold_special_v1"
  | "markov_special_v1"
  | "knowledge_mix_v1"
  | "wave_special_v1";

export type StrategyResult = {
  strategy: StrategyId;
  strategyVersion: string;
  zodiacSelection?: ZodiacSelection;
  picks: Array<{
    number: number;
    rank: number;
    score: number;
    reason: string;
  }>;
};

export type WavePredictionResult = {
  predictedWaves: WaveColor[];
  excludedWave: WaveColor;
  risk: Record<string, number>;
  confidence: number;
  betLevel: string;
  confidenceNote: string;
  voterPattern: WaveColor[];
  recentCounts: Record<WaveColor, number>;
};
