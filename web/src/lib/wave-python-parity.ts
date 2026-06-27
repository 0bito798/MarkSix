import { type Draw } from "@prisma/client";
import { decodeDrawNumbers, getWaveColor as markSixWaveColor } from "@/lib/marksix";
import { type WaveColor, type WavePredictionResult } from "@/lib/types";

type WavePrediction = WavePredictionResult & {
  strategy: string;
  features: Record<string, unknown>;
};

type DrawLike = Pick<Draw, "issueNo" | "numbersJson" | "specialNumber">;

type AscDrawRecord = {
  issueNo: string;
  numbers: number[];
  specialNumber: number;
  specialWave: WaveColor;
};

type HistoryInput = {
  issueNo: string;
  numbers: number[];
  specialNumber: number;
};

type PredictWaveOptions = {
  strategy?: string;
  historyLatestIssue?: string;
  targetIssue?: string | null;
};

type ConfigValue =
  | string
  | number
  | boolean
  | string[]
  | number[]
  | Record<string, unknown>
  | Array<Record<string, unknown>>;

type WaveConfig = Record<string, ConfigValue>;
type ColorCounts = Record<WaveColor, number>;
type StringPrediction = {
  strategy: string;
  predicted_waves: WaveColor[];
  excluded_wave: WaveColor;
  risk: ColorCounts;
  confidence: number;
  features: Record<string, unknown>;
  bet_level?: string;
  confidence_note?: string;
};
type ExpertState = {
  expert_names: string[];
  stats: Record<string, Record<string, [number, number]>>;
  queue: Array<[string[], Record<string, boolean>]>;
};

const WAVE_COLORS: WaveColor[] = ["红波", "蓝波", "绿波"];

const PYTHON_WAVE_CONFIG: WaveConfig = {
  strategy: "segmented_specialist_selector_v1",
  state_profile: "hot_omit_rebuild",
  state_bias: 0.0,
  omit_protect: 6,
  hot_window: 10,
  hot_count: 2,
  protect_bonus: 4,
  hot_penalty: 0.4,
  freq_gamma: 0.5,
  omit_slope: 0.05,
  hot_slope: 0.2,
  streak_penalty: 0.1,
  streak_bonus: 0,
  streak_min: 3,
  main_window: 80,
  green_omission_veto: 8,
  hot_protect_colors: "绿波,蓝波",
  hot_protect_window: 10,
  hot_protect_count: 5,
  enable_voter_pattern_overrides: 0,
  enable_default_overrides: 0,
  enable_learned_overrides: 0,
  enable_feature_overrides: 0,
  enable_generic_post_rules: 1,
  enable_steady_confidence_band_rules: 1,
  red_low_omit_conf_band: 2,
  blue_hot_mod8_count: 5,
  green_omit_roll10: 6,
  red_omit_roll30: 4,
  enable_thirteen_pattern_overrides: 0,
  enable_recent200_error_patch_overrides: 0,
  enable_thirteen_overrides: 0,
  learned_overrides: {},
  steady_conf_low: 0.685,
  steady_conf_high: 0.75,
  manual_feature_overrides: [],
  enable_manual_feature_overrides: 0,
  segmented_min_samples: 1,
  segmented_alpha: 0.45,
  segmented_threshold: 0.0675,
  segmented_window: 193,
};

function toAscDraws(draws: DrawLike[]): AscDrawRecord[] {
  return [...draws]
    .sort((a, b) => a.issueNo.localeCompare(b.issueNo))
    .map((draw) => ({
      issueNo: draw.issueNo,
      numbers: decodeDrawNumbers(draw),
      specialNumber: draw.specialNumber,
      specialWave: markSixWaveColor(draw.specialNumber),
    }));
}

function historyInputToAscDraws(history: HistoryInput[]): AscDrawRecord[] {
  return [...history]
    .sort((a, b) => a.issueNo.localeCompare(b.issueNo))
    .map((draw) => ({
      issueNo: draw.issueNo,
      numbers: [...draw.numbers],
      specialNumber: draw.specialNumber,
      specialWave: markSixWaveColor(draw.specialNumber),
    }));
}

function cfgNumber(config: WaveConfig, key: string, fallback: number): number {
  const value = config[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function cfgString(config: WaveConfig, key: string, fallback: string): string {
  const value = config[key];
  return typeof value === "string" ? value : fallback;
}

function cfgEnabled(config: WaveConfig, key: string, fallback: boolean): boolean {
  const value = config[key];
  if (value == null) return fallback;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return !["0", "false"].includes(value.toLowerCase());
  return Boolean(value);
}

function cfgRecord(config: WaveConfig, key: string): Record<string, unknown> {
  const value = config[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function cfgRecordList(config: WaveConfig, key: string): Array<Record<string, unknown>> {
  const value = config[key];
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

function mergeConfig(base: WaveConfig, override?: WaveConfig): WaveConfig {
  return { ...base, ...(override ?? {}) };
}

function pyRound(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function pyTuple(values: Array<string | number>): string {
  if (values.length === 0) return "()";
  if (values.length === 1) return `(${String(values[0])},)`;
  return `(${values.map(String).join(", ")})`;
}

function pyCounterValues(values: string[]): number[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.values()].sort((a, b) => b - a);
}

function nextIssue(issueNo: string): string {
  return /^\d{7}$/.test(issueNo) ? String(Number(issueNo) + 1).padStart(7, "0") : issueNo;
}

function recent(history: AscDrawRecord[], window: number): AscDrawRecord[] {
  return window && history.length > window ? history.slice(-window) : history;
}

function emptyCounts(initial = 0): ColorCounts {
  return { 红波: initial, 蓝波: initial, 绿波: initial };
}

function nonZeroCounts(counts: ColorCounts): Partial<ColorCounts> {
  return Object.fromEntries(
    WAVE_COLORS.filter((color) => counts[color] !== 0).map((color) => [color, counts[color]]),
  ) as Partial<ColorCounts>;
}

function waveCounts(history: AscDrawRecord[], window: number, target: "special" | "main" = "special"): ColorCounts {
  const counts = emptyCounts();
  for (const row of recent(history, window)) {
    if (target === "main") {
      for (const number of row.numbers) counts[markSixWaveColor(number)] += 1;
    } else {
      counts[row.specialWave] += 1;
    }
  }
  return counts;
}

function waveOmission(history: AscDrawRecord[], color: WaveColor): number {
  for (let distance = 0; distance < history.length; distance += 1) {
    if (history[history.length - 1 - distance].specialWave === color) return distance;
  }
  return history.length;
}

function predictedWavesFromExcluded(excluded: WaveColor): WaveColor[] {
  return WAVE_COLORS.filter((color) => color !== excluded);
}

function normalizeRisk(raw: Partial<ColorCounts>): ColorCounts {
  const values = {
    红波: Math.max(0, Number(raw.红波 ?? 0)),
    蓝波: Math.max(0, Number(raw.蓝波 ?? 0)),
    绿波: Math.max(0, Number(raw.绿波 ?? 0)),
  };
  const total = WAVE_COLORS.reduce((sum, color) => sum + values[color], 0);
  if (total <= 0) return { 红波: 1 / 3, 蓝波: 1 / 3, 绿波: 1 / 3 };
  return { 红波: values.红波 / total, 蓝波: values.蓝波 / total, 绿波: values.绿波 / total };
}

function confidenceFromRisk(risk: ColorCounts): number {
  const values = WAVE_COLORS.map((color) => risk[color]).sort((a, b) => a - b);
  return pyRound(Math.max(0, Math.min(1, 0.5 + Math.min(0.5, Math.max(0, values[1] - values[0]) * 3))), 4);
}

function prediction(strategy: string, excluded: WaveColor, riskRaw: Partial<ColorCounts>, features: Record<string, unknown> = {}): StringPrediction {
  const risk = normalizeRisk(riskRaw);
  return {
    strategy,
    predicted_waves: predictedWavesFromExcluded(excluded),
    excluded_wave: excluded,
    risk,
    confidence: confidenceFromRisk(risk),
    features: { ...features },
  };
}

function lowestFromRisk(risk: ColorCounts): WaveColor {
  return WAVE_COLORS.reduce((best, color) => (risk[color] < risk[best] ? color : best));
}

function highestByCounts(counts: ColorCounts): WaveColor {
  return WAVE_COLORS.reduce((best, color) => {
    if (counts[color] > counts[best]) return color;
    return best;
  });
}

function rollingLowestFreq(history: AscDrawRecord[], window = 80): StringPrediction {
  const counts = waveCounts(history, window, "special");
  const risk = normalizeRisk(counts);
  return prediction(`rolling_lowest_freq_${window}`, lowestFromRisk(risk), risk, { counts: { ...counts } });
}

function rollingHighestFreq(history: AscDrawRecord[], window = 80): StringPrediction {
  const counts = waveCounts(history, window, "special");
  const risk = normalizeRisk({
    红波: 1 / (counts.红波 + 1),
    蓝波: 1 / (counts.蓝波 + 1),
    绿波: 1 / (counts.绿波 + 1),
  });
  return prediction(`rolling_highest_freq_${window}`, highestByCounts(counts), risk, { counts: { ...counts } });
}

function mainWaveLowest(history: AscDrawRecord[], window = 80): StringPrediction {
  const counts = waveCounts(history, window, "main");
  const risk = normalizeRisk(counts);
  return prediction(`main_wave_lowest_${window}`, lowestFromRisk(risk), risk, { counts: { ...counts } });
}

function mainWaveHighest(history: AscDrawRecord[], window = 80): StringPrediction {
  const counts = waveCounts(history, window, "main");
  const risk = normalizeRisk({
    红波: 1 / (counts.红波 + 1),
    蓝波: 1 / (counts.蓝波 + 1),
    绿波: 1 / (counts.绿波 + 1),
  });
  return prediction(`main_wave_highest_${window}`, highestByCounts(counts), risk, { counts: { ...counts } });
}

function issueModLowest(history: AscDrawRecord[], mod = 8): StringPrediction {
  if (!history.length) return rollingLowestFreq(history, 80);
  const tail = nextIssue(history[history.length - 1].issueNo).slice(-3);
  const bucket = /^\d+$/.test(tail) ? Number(tail) % mod : 0;
  const counts = emptyCounts(1);
  for (const row of history) {
    const rowTail = row.issueNo.slice(-3);
    if (/^\d+$/.test(rowTail) && Number(rowTail) % mod === bucket) counts[row.specialWave] += 1;
  }
  const risk = normalizeRisk(counts);
  return prediction(`issue_mod_lowest_${mod}`, lowestFromRisk(risk), risk, { bucket, counts: { ...counts } });
}

function issueModHighest(history: AscDrawRecord[], mod = 8): StringPrediction {
  if (!history.length) return rollingHighestFreq(history, 80);
  const tail = nextIssue(history[history.length - 1].issueNo).slice(-3);
  const bucket = /^\d+$/.test(tail) ? Number(tail) % mod : 0;
  const counts = emptyCounts(1);
  for (const row of history) {
    const rowTail = row.issueNo.slice(-3);
    if (/^\d+$/.test(rowTail) && Number(rowTail) % mod === bucket) counts[row.specialWave] += 1;
  }
  const risk = normalizeRisk({
    红波: 1 / (counts.红波 + 1),
    蓝波: 1 / (counts.蓝波 + 1),
    绿波: 1 / (counts.绿波 + 1),
  });
  return prediction(`issue_mod_highest_${mod}`, highestByCounts(counts), risk, { bucket, counts: { ...counts } });
}

function patternLowest(history: AscDrawRecord[], k = 2, window = 500): StringPrediction {
  if (history.length <= k) return rollingLowestFreq(history, 80);
  const rows = recent(history, window);
  const latestPattern = history.slice(-k).map((row) => row.specialWave);
  const counts = emptyCounts(1);
  for (let index = k; index < rows.length; index += 1) {
    const patternValues = rows.slice(index - k, index).map((row) => row.specialWave);
    if (patternValues.join("|") === latestPattern.join("|")) counts[rows[index].specialWave] += 1;
  }
  const risk = normalizeRisk(counts);
  return prediction(`pattern_lowest_k${k}_${window}`, lowestFromRisk(risk), risk, { pattern: latestPattern, counts: { ...counts } });
}

function transitionLowest(history: AscDrawRecord[], window = 120): StringPrediction {
  if (history.length < 2) return rollingLowestFreq(history, 80);
  const rows = recent(history, window);
  const last = history[history.length - 1].specialWave;
  const counts = emptyCounts(1);
  for (let index = 0; index < rows.length - 1; index += 1) {
    if (rows[index].specialWave === last) counts[rows[index + 1].specialWave] += 1;
  }
  const risk = normalizeRisk(counts);
  return prediction(`transition_lowest_${window}`, lowestFromRisk(risk), risk, { source: last, counts: { ...counts } });
}

function stateGatedWaveV1(history: AscDrawRecord[], config: WaveConfig = {}): StringPrediction {
  const cfg = mergeConfig({
    omit_protect: 6,
    hot_window: 10,
    hot_count: 2,
    protect_bonus: 1.5,
    hot_penalty: 0.4,
    freq_gamma: 0.5,
    omit_slope: 0.1,
    hot_slope: 0.0,
    streak_penalty: 0.1,
    streak_bonus: 0.0,
    streak_min: 3,
    main_window: 80,
    state_profile: "full_feature",
    state_bias: 0.0,
    state_freq_weight: 1.0,
    state_main_weight: 1.0,
  }, config);
  const counts = waveCounts(history, cfgNumber(cfg, "main_window", 80), "special");
  const hot = waveCounts(history, cfgNumber(cfg, "hot_window", 10), "special");
  const main = waveCounts(history, cfgNumber(cfg, "main_window", 80), "main");
  const latest = history.length ? history[history.length - 1].specialWave : "";
  let streak = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index].specialWave !== latest) break;
    streak += 1;
  }
  const raw = emptyCounts();
  for (const color of WAVE_COLORS) {
    const omit = waveOmission(history, color);
    let value: number;
    if (cfgString(cfg, "state_profile", "full_feature") === "hot_omit_rebuild") {
      value = cfgNumber(cfg, "state_bias", 0);
      if (omit >= cfgNumber(cfg, "omit_protect", 6)) {
        value += cfgNumber(cfg, "protect_bonus", 1.5) + (omit - cfgNumber(cfg, "omit_protect", 6)) * cfgNumber(cfg, "omit_slope", 0.1);
      }
      value += hot[color] * cfgNumber(cfg, "hot_slope", 0);
    } else {
      const freq = Math.pow(counts[color] + 1, cfgNumber(cfg, "freq_gamma", 0.5)) * cfgNumber(cfg, "state_freq_weight", 1);
      const mainPart = ((main[color] + 1) / 6) * cfgNumber(cfg, "state_main_weight", 1);
      value = freq + mainPart;
      if (omit >= cfgNumber(cfg, "omit_protect", 6)) value += cfgNumber(cfg, "protect_bonus", 1.5);
      value -= Math.min(omit, 10) * cfgNumber(cfg, "omit_slope", 0.1);
      if (hot[color] >= cfgNumber(cfg, "hot_count", 2)) value -= cfgNumber(cfg, "hot_penalty", 0.4);
    }
    if (color === latest && streak >= cfgNumber(cfg, "streak_min", 3)) value -= cfgNumber(cfg, "streak_penalty", 0.1) * streak;
    raw[color] = Math.max(0.01, value);
  }
  const risk = normalizeRisk(raw);
  return prediction("state_gated_wave_v1", lowestFromRisk(risk), risk, { recent_counts: { ...hot } });
}

function blendWaveV1(history: AscDrawRecord[], config: WaveConfig = {}): StringPrediction {
  const cfg = mergeConfig({ main_window: 80, pattern_k: 2, pattern_window: 500, mod: 7, w_main: 2.0, w_pattern: 1.0, w_mod: 1.0 }, config);
  const weighted: Array<[StringPrediction, number]> = [
    [mainWaveLowest(history, cfgNumber(cfg, "main_window", 80)), cfgNumber(cfg, "w_main", 2)],
    [patternLowest(history, cfgNumber(cfg, "pattern_k", 2), cfgNumber(cfg, "pattern_window", 500)), cfgNumber(cfg, "w_pattern", 1)],
    [issueModLowest(history, cfgNumber(cfg, "mod", 7)), cfgNumber(cfg, "w_mod", 1)],
  ];
  const totalWeight = weighted.reduce((sum, [, weight]) => sum + weight, 0) || 1;
  const raw = emptyCounts();
  for (const color of WAVE_COLORS) {
    raw[color] = weighted.reduce((sum, [voter, weight]) => sum + voter.risk[color] * weight, 0) / totalWeight;
  }
  const risk = normalizeRisk(raw);
  return prediction("blend_wave_v1", lowestFromRisk(risk), risk, { voters: weighted.map(([voter]) => voter.strategy) });
}

function baseVoters(history: AscDrawRecord[], cfg: WaveConfig): StringPrediction[] {
  const mainWindow = cfgNumber(cfg, "main_window", 80);
  return [
    stateGatedWaveV1(history, cfg),
    mainWaveLowest(history, mainWindow),
    blendWaveV1(history, cfg),
    rollingLowestFreq(history, 30),
    patternLowest(history, 2, 500),
  ];
}

function resolveTarget(target: string, history: AscDrawRecord[], statePred: StringPrediction, cfg: WaveConfig): WaveColor {
  if (target === "rolling30") return rollingLowestFreq(history, 30).excluded_wave;
  if (target === "rolling10") return rollingLowestFreq(history, 10).excluded_wave;
  if (target === "main80") return mainWaveLowest(history, cfgNumber(cfg, "main_window", 80)).excluded_wave;
  if (target === "mod8") return issueModLowest(history, 8).excluded_wave;
  if (target === "state") return statePred.excluded_wave;
  if (WAVE_COLORS.includes(target as WaveColor)) return target as WaveColor;
  return target as WaveColor;
}

function applySteadyConfidenceBand(excluded: WaveColor, confidence: number, redOmission: number, cfg: WaveConfig): WaveColor {
  const low = cfgNumber(cfg, "steady_conf_low", 0.70);
  const high = cfgNumber(cfg, "steady_conf_high", 0.75);
  return low <= confidence && confidence < high && redOmission <= cfgNumber(cfg, "red_low_omit_conf_band", 2) ? "红波" : excluded;
}

function configList(value: ConfigValue | undefined, defaultValue: string[]): string[] {
  if (value == null) return [...defaultValue];
  if (typeof value === "string") return value.split(",").map((part) => part.trim()).filter(Boolean);
  if (Array.isArray(value)) return value.map(String);
  return [...defaultValue];
}

function patternKeyFromValue(value: unknown): string {
  return typeof value === "string" ? value : Array.isArray(value) ? value.map(String).join("|") : "";
}

function cappedOmissions(history: AscDrawRecord[], cap: number): number[] {
  return WAVE_COLORS.map((color) => Math.min(waveOmission(history, color), cap));
}

function manualRuleMatches(rule: Record<string, unknown>, excluded: WaveColor, voterPattern: WaveColor[], recentCounts: ColorCounts, history: AscDrawRecord[]): boolean {
  const expectedBase = rule.base ?? rule.excluded;
  if (expectedBase != null && String(expectedBase) !== excluded) return false;
  const kind = String(rule.kind ?? "");
  if (kind.includes("pattern") && patternKeyFromValue(rule.pattern) !== voterPattern.join("|")) return false;
  if (kind.includes("counts")) {
    const expected = Array.isArray(rule.counts) ? rule.counts.map(Number) : [];
    const actual = WAVE_COLORS.map((color) => recentCounts[color]);
    if (expected.join("|") !== actual.join("|")) return false;
  }
  if (kind.includes("omit")) {
    const expected = Array.isArray(rule.omissions) ? rule.omissions.map(Number) : [];
    if (expected.join("|") !== cappedOmissions(history, Number(rule.cap ?? 9)).join("|")) return false;
  }
  return true;
}

function applyManualFeatureOverrides(excluded: WaveColor, voterPattern: WaveColor[], recentCounts: ColorCounts, history: AscDrawRecord[], cfg: WaveConfig): WaveColor {
  for (const rule of cfgRecordList(cfg, "manual_feature_overrides")) {
    if (manualRuleMatches(rule, excluded, voterPattern, recentCounts, history)) {
      const target = String(rule.target ?? "");
      if (WAVE_COLORS.includes(target as WaveColor)) return target as WaveColor;
    }
  }
  return excluded;
}

function trainedWaveV1(history: AscDrawRecord[], config: WaveConfig = {}): StringPrediction {
  const cfg = mergeConfig({
    main_window: 80,
    green_omission_veto: 8,
    hot_protect_colors: "绿波,蓝波",
    hot_protect_window: 10,
    hot_protect_count: 5,
    enable_default_overrides: 0,
    enable_learned_overrides: 0,
    enable_thirteen_overrides: 0,
    enable_generic_post_rules: 1,
    enable_steady_confidence_band_rules: 1,
    red_low_omit_conf_band: 2,
    blue_hot_mod8_count: 5,
    green_omit_roll10: 6,
    red_omit_roll30: 4,
  }, config);
  if (!history.length) return prediction("fixed_exclude_蓝波", "蓝波", { 红波: 1, 蓝波: 0, 绿波: 1 });

  const voters = baseVoters(history, cfg);
  const statePred = voters[0];
  const voterPattern = voters.map((voter) => voter.excluded_wave);
  const votes = emptyCounts();
  for (const color of voterPattern) votes[color] += 1;
  const topCount = Math.max(...Object.values(votes));
  const topColors = WAVE_COLORS.filter((color) => votes[color] === topCount);
  const avgRisk = emptyCounts();
  for (const color of WAVE_COLORS) avgRisk[color] = voters.reduce((sum, voter) => sum + voter.risk[color], 0) / voters.length;
  let excluded = topColors.reduce((best, color) => (avgRisk[color] < avgRisk[best] ? color : best));

  const greenOmission = waveOmission(history, "绿波");
  if (excluded === "绿波" && greenOmission >= cfgNumber(cfg, "green_omission_veto", 8)) {
    excluded = resolveTarget("state", history, statePred, cfg);
    if (excluded === "绿波") {
      excluded = WAVE_COLORS.filter((color) => color !== "绿波").reduce((best, color) => (avgRisk[color] < avgRisk[best] ? color : best));
    }
  }

  const recentCounts = waveCounts(history, cfgNumber(cfg, "hot_protect_window", 10), "special");
  const hotProtectColors = new Set(configList(cfg.hot_protect_colors, ["绿波", "蓝波"]));
  if (hotProtectColors.has(excluded) && recentCounts[excluded] >= cfgNumber(cfg, "hot_protect_count", 5) && statePred.excluded_wave !== excluded) {
    excluded = statePred.excluded_wave;
  }

  if (cfgEnabled(cfg, "enable_default_overrides", true)) {
    const target = defaultPatternOverrides()[voterPattern.join("|")];
    if (target) excluded = resolveTarget(target, history, statePred, cfg);
  }

  if (cfgEnabled(cfg, "enable_learned_overrides", true)) {
    const target = cfgRecord(cfg, "learned_overrides")[voterPattern.join("|")];
    if (target) excluded = resolveTarget(String(target), history, statePred, cfg);
  }

  if (cfgEnabled(cfg, "enable_feature_overrides", true)) {
    const probe = prediction("trained_wave_v1_probe", excluded, normalizeRisk(avgRisk), { votes: { ...votes }, voter_pattern: [...voterPattern], recent_counts: { ...recentCounts } });
    const target = cfgRecord(cfg, "learned_feature_overrides")[featureKey(probe, history, cfgString(cfg, "feature_key_type", "pat_counts"))];
    if (target) excluded = resolveTarget(String(target), history, statePred, cfg);
  }

  if (cfgEnabled(cfg, "enable_generic_post_rules", true)) {
    if (excluded === "蓝波" && recentCounts.蓝波 >= cfgNumber(cfg, "blue_hot_mod8_count", 5)) excluded = resolveTarget("mod8", history, statePred, cfg);
    if (excluded === "绿波" && waveOmission(history, "绿波") >= cfgNumber(cfg, "green_omit_roll10", 6)) excluded = resolveTarget("rolling10", history, statePred, cfg);
    if (excluded === "红波" && waveOmission(history, "红波") >= cfgNumber(cfg, "red_omit_roll30", 4)) excluded = resolveTarget("rolling30", history, statePred, cfg);
  }

  const risk = normalizeRisk(avgRisk);
  const confidence = confidenceFromRisk(risk);
  if (cfgEnabled(cfg, "enable_steady_confidence_band_rules", true)) {
    excluded = applySteadyConfidenceBand(excluded, confidence, waveOmission(history, "红波"), cfg);
  }
  if (cfgEnabled(cfg, "enable_manual_feature_overrides", true)) {
    excluded = applyManualFeatureOverrides(excluded, voterPattern, recentCounts, history, cfg);
  }

  const [betLevel, confidenceNote] = calibrateBetLevel(confidence, excluded);
  const configuredStrategy = cfgString(cfg, "strategy", cfgString(cfg, "strategy_type", "trained_wave_v1"));
  const strategyName = configuredStrategy === "meta_five_veto_wave_v1" ? "meta_five_veto_wave_v1" : "trained_wave_v1";
  const out = prediction(strategyName, excluded, risk, {
    votes: nonZeroCounts(votes),
    voters: voters.map((voter) => voter.strategy),
    voter_exclusions: [...voterPattern],
    voter_pattern: [...voterPattern],
    voter_pattern_13: null,
    recent_counts: { ...recentCounts },
    green_omission: greenOmission,
  });
  out.bet_level = betLevel;
  out.confidence_note = confidenceNote;
  return out;
}

function defaultPatternOverrides(): Record<string, string> {
  return {};
}

function featureKey(pred: StringPrediction, history: AscDrawRecord[], keyType: string): string {
  const features = pred.features;
  const pattern = Array.isArray(features.voter_pattern) ? features.voter_pattern.map(String).join("|") : "";
  const counts = features.recent_counts && typeof features.recent_counts === "object" ? features.recent_counts as Record<string, number> : {};
  const omissions = WAVE_COLORS.map((color) => Math.min(waveOmission(history, color), 9));
  if (keyType === "pat_omit") return [pattern, ...omissions].join("|");
  if (keyType === "pat_counts_omit") return [pattern, counts.红波 ?? 0, counts.蓝波 ?? 0, counts.绿波 ?? 0, ...omissions].join("|");
  if (keyType === "pat_excl_counts_omit") return [pattern, pred.excluded_wave, counts.红波 ?? 0, counts.蓝波 ?? 0, counts.绿波 ?? 0, ...omissions].join("|");
  return [pattern, counts.红波 ?? 0, counts.蓝波 ?? 0, counts.绿波 ?? 0].join("|");
}

function segmentedDefaults(config?: WaveConfig): WaveConfig {
  return mergeConfig({
    strategy: "segmented_specialist_selector_v1",
    min_history: 80,
    segmented_min_samples: 2,
    segmented_alpha: 1.0,
    segmented_threshold: 0.10,
    segmented_window: 150,
  }, config);
}

function segmentedBaseConfig(config: WaveConfig): WaveConfig {
  return {
    ...config,
    strategy: "meta_five_veto_wave_v1",
    enable_voter_pattern_overrides: 0,
    enable_default_overrides: 0,
    enable_learned_overrides: 0,
    learned_overrides: {},
    enable_feature_overrides: 0,
    enable_thirteen_overrides: 0,
    enable_thirteen_pattern_overrides: 0,
    enable_recent200_error_patch_overrides: 0,
    enable_manual_feature_overrides: 0,
    manual_feature_overrides: [],
  };
}

function segmentedExperts(history: AscDrawRecord[], baseCfg: WaveConfig): Record<string, StringPrediction> {
  return {
    clean: trainedWaveV1(history, baseCfg),
    main120: mainWaveLowest(history, 120),
    roll30: rollingLowestFreq(history, 30),
    roll80: rollingLowestFreq(history, 80),
    pat2: patternLowest(history, 2, 500),
    mod7: issueModLowest(history, 7),
    mod8: issueModLowest(history, 8),
    mod9: issueModLowest(history, 9),
    trans: transitionLowest(history, 120),
    blend: blendWaveV1(history, baseCfg),
    state: stateGatedWaveV1(history, baseCfg),
    modH4: issueModHighest(history, 4),
    rollH5: rollingHighestFreq(history, 5),
    mainH200: mainWaveHighest(history, 200),
  };
}

function smallCountBin(value: number): number {
  if (value <= 1) return 0;
  if (value <= 3) return 1;
  if (value <= 5) return 2;
  return 3;
}

function smallOmissionBin(value: number): number {
  if (value <= 1) return 0;
  if (value <= 3) return 1;
  if (value <= 5) return 2;
  if (value <= 8) return 3;
  return 4;
}

function segmentedAtoms(history: AscDrawRecord[], basePred: StringPrediction, expertPreds: Record<string, StringPrediction>): string[] {
  const voterPattern = Array.isArray(basePred.features.voter_pattern) ? basePred.features.voter_pattern.map(String) : [];
  const voteShape = pyCounterValues(voterPattern);
  const votesFeature = basePred.features.votes && typeof basePred.features.votes === "object" ? basePred.features.votes as Record<string, number> : {};
  const votes = WAVE_COLORS.map((color) => Number(votesFeature[color] ?? 0));
  const confidenceBin = Math.trunc((basePred.confidence + 1e-9) / 0.05);
  const excluded = basePred.excluded_wave;
  const atoms = [
    `base=${excluded}`,
    `shape=${pyTuple(voteShape)}`,
    `conf=${confidenceBin}`,
    `votes=${pyTuple(votes)}`,
    `base_shape=${excluded}|${pyTuple(voteShape)}`,
    `base_conf=${excluded}|${confidenceBin}`,
    `base_votes=${excluded}|${pyTuple(votes)}`,
  ];
  for (const [name, pred] of Object.entries(expertPreds)) atoms.push(`exp_${name}=${pred.excluded_wave}`);
  atoms.push(`omit=${pyTuple(WAVE_COLORS.map((color) => smallOmissionBin(waveOmission(history, color))))}`);
  for (const window of [10, 20, 30, 80]) {
    const counts = waveCounts(history, window, "special");
    atoms.push(`cnt${window}=${pyTuple(WAVE_COLORS.map((color) => smallCountBin(counts[color])))}`);
    atoms.push(`low${window}=${WAVE_COLORS.reduce((best, color) => (counts[color] < counts[best] ? color : best))}`);
    atoms.push(`high${window}=${WAVE_COLORS.reduce((best, color) => (counts[color] > counts[best] ? color : best))}`);
  }
  for (const length of [1, 2, 3]) {
    if (history.length >= length) atoms.push(`last${length}=${history.slice(-length).map((row) => row.specialWave).join(">")}`);
  }
  if (history.length && /^\d+$/.test(history[history.length - 1].issueNo.slice(-3))) {
    const nextTail = Number(nextIssue(history[history.length - 1].issueNo).slice(-3));
    for (const mod of [7, 8, 9, 10, 20]) atoms.push(`imod${mod}=${nextTail % mod}`);
  }
  return atoms;
}

function newSegmentedState(expertNames: string[]): ExpertState {
  return { expert_names: [...expertNames], stats: {}, queue: [] };
}

function statsForAtom(state: ExpertState, atom: string): Record<string, [number, number]> {
  if (!state.stats[atom]) {
    state.stats[atom] = Object.fromEntries(state.expert_names.map((name) => [name, [0, 0] as [number, number]]));
  }
  return state.stats[atom];
}

function selectSegmentedSpecialist(atoms: string[], expertExclusions: Record<string, string>, state: ExpertState, cfg: WaveConfig): [string, WaveColor] {
  const minSamples = cfgNumber(cfg, "segmented_min_samples", 2);
  const alpha = cfgNumber(cfg, "segmented_alpha", 1.0);
  const threshold = cfgNumber(cfg, "segmented_threshold", 0.10);
  let bestName = "clean";
  let bestScore = -1;
  let cleanScore = -1;
  for (const name of state.expert_names) {
    let totalScore = 0;
    let totalAtoms = 0;
    for (const atom of atoms) {
      const pair = state.stats[atom]?.[name] ?? [0, 0];
      const [samples, hits] = pair;
      if (samples >= minSamples) {
        totalScore += (hits + alpha) / (samples + 2 * alpha);
        totalAtoms += 1;
      }
    }
    const score = totalAtoms ? totalScore / totalAtoms : -1;
    if (name === "clean") cleanScore = score;
    if (score > bestScore) {
      bestName = name;
      bestScore = score;
    }
  }
  if (bestScore < 0 || (cleanScore >= 0 && bestScore < cleanScore + threshold)) bestName = "clean";
  return [bestName, (expertExclusions[bestName] ?? expertExclusions.clean ?? "蓝波") as WaveColor];
}

function updateSegmentedState(state: ExpertState, atoms: string[], expertExclusions: Record<string, string>, actualWave: WaveColor, cfg: WaveConfig): void {
  const rowHits = Object.fromEntries(state.expert_names.map((name) => [name, String(expertExclusions[name] ?? "") !== actualWave]));
  for (const atom of atoms) {
    const atomStats = statsForAtom(state, atom);
    for (const [name, hit] of Object.entries(rowHits)) {
      atomStats[name][0] += 1;
      atomStats[name][1] += hit ? 1 : 0;
    }
  }
  state.queue.push([[...atoms], rowHits]);
  const window = cfgNumber(cfg, "segmented_window", 150);
  if (window > 0 && state.queue.length > window) {
    const [oldAtoms, oldHits] = state.queue.shift()!;
    for (const atom of oldAtoms) {
      const atomStats = statsForAtom(state, atom);
      for (const [name, hit] of Object.entries(oldHits)) {
        atomStats[name][0] -= 1;
        atomStats[name][1] -= hit ? 1 : 0;
      }
    }
  }
}

function segmentedPredictionFromState(history: AscDrawRecord[], cfg: WaveConfig, baseCfg: WaveConfig, state: ExpertState): [StringPrediction, string[], Record<string, string>] {
  const expertPreds = segmentedExperts(history, baseCfg);
  const basePred = { ...expertPreds.clean };
  const atoms = segmentedAtoms(history, basePred, expertPreds);
  const expertExclusions = Object.fromEntries(Object.entries(expertPreds).map(([name, pred]) => [name, pred.excluded_wave]));
  const [selectedName, selectedExcluded] = selectSegmentedSpecialist(atoms, expertExclusions, state, cfg);
  const features = {
    ...basePred.features,
    segmented_specialist: {
      selected_expert: selectedName,
      base_excluded: basePred.excluded_wave,
      active_atoms: atoms.length,
      dirty_layers_enabled: false,
    },
  };
  const [betLevel, confidenceNote] = calibrateBetLevel(basePred.confidence, selectedExcluded);
  return [
    {
      ...basePred,
      strategy: "segmented_specialist_selector_v1",
      excluded_wave: selectedExcluded,
      predicted_waves: predictedWavesFromExcluded(selectedExcluded),
      features,
      bet_level: betLevel,
      confidence_note: confidenceNote,
    },
    atoms,
    expertExclusions,
  ];
}

function segmentedCurrentPrediction(history: AscDrawRecord[], config?: WaveConfig): [StringPrediction, string[], Record<string, string>] {
  const cfg = segmentedDefaults(config);
  const baseCfg = segmentedBaseConfig(cfg);
  const minHistory = cfgNumber(cfg, "min_history", 80);
  if (history.length <= minHistory) {
    const pred = { ...trainedWaveV1(history, baseCfg), strategy: "segmented_specialist_selector_v1" };
    pred.features = {
      ...pred.features,
      segmented_specialist: {
        selected_expert: "clean",
        base_excluded: pred.excluded_wave,
        active_atoms: 0,
        dirty_layers_enabled: false,
      },
    };
    const expertPreds = history.length ? segmentedExperts(history, baseCfg) : { clean: pred };
    const atoms = history.length ? segmentedAtoms(history, pred, expertPreds) : [];
    return [pred, atoms, Object.fromEntries(Object.entries(expertPreds).map(([name, item]) => [name, item.excluded_wave]))];
  }
  const state = newSegmentedState(Object.keys(segmentedExperts(history.slice(0, minHistory), baseCfg)));
  for (let index = Math.max(1, minHistory); index < history.length; index += 1) {
    const [, atoms, expertExclusions] = segmentedPredictionFromState(history.slice(0, index), cfg, baseCfg, state);
    updateSegmentedState(state, atoms, expertExclusions, history[index].specialWave, cfg);
  }
  return segmentedPredictionFromState(history, cfg, baseCfg, state);
}

function calibrateBetLevel(confidence: number, excluded: WaveColor): [string, string] {
  if (confidence >= 0.90) return ["D级", "原始置信度>=0.90：当前回测命中偏低，越自信越容易错，按最低档处理。"];
  if (excluded === "红波") return ["C级", "排除红波：覆盖32/49，结构上弱于排蓝/绿；当前回测命中约65%-67%。"];
  return ["B级", "排除蓝/绿波：覆盖33/49；当前回测约69%，无可靠的更高把握档。"];
}

export function predictWaveColorWithPythonParity(draws: DrawLike[], config: WaveConfig = PYTHON_WAVE_CONFIG): WavePrediction {
  const history = toAscDraws(draws);
  return predictFromAscHistory(history, config);
}

export function predictWaveFromHistory(historyInput: HistoryInput[], _options: PredictWaveOptions = {}): WavePrediction {
  const history = historyInputToAscDraws(historyInput);
  return predictFromAscHistory(history, PYTHON_WAVE_CONFIG);
}

function predictFromAscHistory(history: AscDrawRecord[], config: WaveConfig): WavePrediction {
  const [pred] = segmentedCurrentPrediction(history, config);
  const features = pred.features;
  const voterPattern = Array.isArray(features.voter_pattern) ? features.voter_pattern as WaveColor[] : [];
  const recentCountsRaw = features.recent_counts && typeof features.recent_counts === "object" ? features.recent_counts as Partial<ColorCounts> : {};
  return {
    strategy: pred.strategy,
    predictedWaves: pred.predicted_waves,
    excludedWave: pred.excluded_wave,
    risk: pred.risk,
    confidence: pred.confidence,
    betLevel: pred.bet_level ?? "",
    confidenceNote: pred.confidence_note ?? "",
    voterPattern,
    recentCounts: {
      红波: Number(recentCountsRaw.红波 ?? 0),
      蓝波: Number(recentCountsRaw.蓝波 ?? 0),
      绿波: Number(recentCountsRaw.绿波 ?? 0),
    },
    features,
  };
}
