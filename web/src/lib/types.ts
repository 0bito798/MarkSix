export type WaveColor = "红波" | "蓝波" | "绿波";

export type CsvDrawRecord = {
  issueNo: string;
  drawDate: Date;
  numbers: number[];
  specialNumber: number;
  source?: string;
};

export type StrategyId =
  | "zodiac_special_v1"
  | "hot_special_v1"
  | "cold_special_v1"
  | "markov_special_v1"
  | "knowledge_mix_v1"
  | "wave_special_v1";

export type StrategyResult = {
  strategy: StrategyId;
  strategyVersion: string;
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
