import { type Draw } from "@prisma/client";
import {
  ALL_NUMBERS,
  ZODIAC_SEQUENCE,
  decodeDrawNumbers,
  getNumbersForZodiac,
  getWaveColor,
  getYearZodiac,
  getZodiacForNumber,
  getZoneIndex,
  inferYearFromIssue,
} from "@/lib/marksix";
import { type StrategyId, type StrategyResult } from "@/lib/types";

type NumberMap = Map<number, number>;
type StringMap = Map<string, number>;
type WaveColor = "红波" | "蓝波" | "绿波";
type WavePrediction = {
  predictedWaves: WaveColor[];
  excludedWave: WaveColor;
  risk: Record<string, number>;
  confidence: number;
  betLevel: string;
  confidenceNote: string;
  voterPattern: WaveColor[];
  recentCounts: Record<WaveColor, number>;
};
type MarkovTransitionProfile = {
  transitionScores: NumberMap;
  specialTransitionScores: NumberMap;
  secondOrderScores: NumberMap;
  phaseTransitionScores: NumberMap;
  attributeScores: NumberMap;
  latestPhase: string;
  latestSpecial?: number;
};

const RECENT_SPECIAL_PENALTY = new Set([1, 2]);
const WAVE_COLORS: WaveColor[] = ["红波", "蓝波", "绿波"];

function createNumberMap(defaultValue = 0): NumberMap {
  return new Map(ALL_NUMBERS.map((number) => [number, defaultValue]));
}

function normalizeNumberMap(map: NumberMap): NumberMap {
  const values = [...map.values()];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return new Map([...map.entries()].map(([key, value]) => [key, (value - min) / range]));
}

function normalizeStringMap(map: StringMap): StringMap {
  const values = [...map.values()];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return new Map([...map.entries()].map(([key, value]) => [key, (value - min) / range]));
}

function reverseNumberMap(map: NumberMap): NumberMap {
  return new Map([...map.entries()].map(([key, value]) => [key, 1 - value]));
}

function specialFrequencyMap(draws: Draw[]): NumberMap {
  const scores = createNumberMap();

  for (let index = 0; index < draws.length; index += 1) {
    const weight = 1 / (index + 1);
    const specialNumber = draws[index].specialNumber;
    scores.set(specialNumber, (scores.get(specialNumber) ?? 0) + weight);
  }

  return normalizeNumberMap(scores);
}

function omissionMap(draws: Draw[]): NumberMap {
  const scores = createNumberMap(draws.length + 1);

  for (let index = 0; index < draws.length; index += 1) {
    const specialNumber = draws[index].specialNumber;
    if ((scores.get(specialNumber) ?? draws.length + 1) > index + 1) {
      scores.set(specialNumber, index + 1);
    }
  }

  return normalizeNumberMap(scores);
}

function mainExposureMap(draws: Draw[]): NumberMap {
  const scores = createNumberMap();

  for (let index = 0; index < draws.length; index += 1) {
    const weight = 1 / (index + 1);
    for (const number of decodeDrawNumbers(draws[index])) {
      scores.set(number, (scores.get(number) ?? 0) + weight);
    }
  }

  return normalizeNumberMap(scores);
}

function transitionMap(draws: Draw[]): NumberMap {
  const scores = createNumberMap();
  const currentSpecial = draws[0]?.specialNumber;

  if (!currentSpecial) {
    return scores;
  }

  for (let index = 0; index < draws.length - 1; index += 1) {
    if (draws[index + 1].specialNumber !== currentSpecial) {
      continue;
    }

    const follower = draws[index].specialNumber;
    scores.set(follower, (scores.get(follower) ?? 0) + 1);
  }

  return normalizeNumberMap(scores);
}

function stateNumbers(draw: Draw, includeSpecial = true): number[] {
  const seen = new Set<number>();
  const values = includeSpecial ? [...decodeDrawNumbers(draw), draw.specialNumber] : decodeDrawNumbers(draw);
  return values.filter((number) => {
    if (!Number.isInteger(number) || number < 1 || number > 49 || seen.has(number)) {
      return false;
    }
    seen.add(number);
    return true;
  });
}

function markovZone(number: number): string {
  if (number <= 16) {
    return "low";
  }
  if (number <= 33) {
    return "mid";
  }
  return "high";
}

function markovAttributes(number: number): Record<string, string> {
  return {
    color: getWaveColor(number),
    parity: number % 2 === 0 ? "even" : "odd",
    zone: markovZone(number),
    tail: String(number % 10),
  };
}

function markovPhase(draws: Draw[]): string {
  const counts = new Map<string, number>();
  for (const draw of draws.slice(0, 12)) {
    for (const number of stateNumbers(draw)) {
      const zone = markovZone(number);
      counts.set(zone, (counts.get(zone) ?? 0) + 1);
    }
  }

  const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    return "neutral";
  }

  const dominant = Math.max(...counts.values()) / total;
  if (dominant >= 0.48) {
    return "concentrated";
  }
  if ([...counts.values()].filter((value) => value > 0).length >= 3 && dominant <= 0.4) {
    return "dispersed";
  }
  return "neutral";
}

function markovProbability(numerator: number, denominator: number, minSamples: number): number {
  if (denominator <= 0) {
    return 0;
  }
  const confidence = Math.min(1, Math.max(0.15, denominator / Math.max(minSamples, 1)));
  return (numerator / denominator) * confidence;
}

function normalizePlainNumberMap(map: Record<number, number>): NumberMap {
  return normalizeNumberMap(new Map(ALL_NUMBERS.map((number) => [number, map[number] ?? 0])));
}

function scoreAttributeTransition(
  candidate: number,
  latestSpecial: number | undefined,
  profile: Map<string, Map<string, Map<string, number>>>,
): number {
  if (!latestSpecial) {
    return 0;
  }

  const sourceState = markovAttributes(latestSpecial);
  const candidateState = markovAttributes(candidate);
  let total = 0;
  let used = 0;
  for (const [attr, sourceValue] of Object.entries(sourceState)) {
    const targetValue = candidateState[attr];
    total += profile.get(attr)?.get(sourceValue)?.get(targetValue) ?? 0;
    used += 1;
  }
  return total / Math.max(used, 1);
}

export function buildMarkovTransitionProfile(
  draws: Draw[],
  options: { window?: number; decay?: number; sourceSpecialWeight?: number; minSamples?: number } = {},
): MarkovTransitionProfile {
  const empty = createNumberMap();
  if (draws.length < 2) {
    return {
      transitionScores: empty,
      specialTransitionScores: createNumberMap(),
      secondOrderScores: createNumberMap(),
      phaseTransitionScores: createNumberMap(),
      attributeScores: createNumberMap(),
      latestPhase: "neutral",
      latestSpecial: draws[0]?.specialNumber,
    };
  }

  const windowSize = Math.max(2, Math.min(options.window ?? 80, draws.length));
  const decay = options.decay ?? 0.985;
  const sourceSpecialWeight = options.sourceSpecialWeight ?? 1.28;
  const minSamples = options.minSamples ?? 3;
  const ordered = draws.slice(0, windowSize).reverse();
  const transitions = new Map<number, NumberMap>(ALL_NUMBERS.map((number) => [number, createNumberMap()]));
  const specialTransitions = new Map<number, NumberMap>(ALL_NUMBERS.map((number) => [number, createNumberMap()]));
  const secondOrderTransitions = new Map<string, number>();
  const secondOrderTotals = new Map<string, number>();
  const phaseTransitions = new Map<string, Map<number, NumberMap>>();
  const phaseTotals = new Map<string, NumberMap>();
  const attributeCounts = new Map<string, Map<string, Map<string, number>>>();
  const totals = createNumberMap();
  const specialTotals = createNumberMap();

  for (let index = 1; index < ordered.length; index += 1) {
    const previousPrevious = index >= 2 ? ordered[index - 2] : undefined;
    const sources = stateNumbers(ordered[index - 1]);
    const previousSpecial = ordered[index - 1].specialNumber;
    const currentSpecial = ordered[index].specialNumber;
    const targets = stateNumbers(ordered[index]);
    const weight = decay ** Math.max(0, ordered.length - index - 1);
    const phase = markovPhase(ordered.slice(Math.max(0, index - 12), index).reverse());
    if (!phaseTransitions.has(phase)) {
      phaseTransitions.set(phase, new Map(ALL_NUMBERS.map((number) => [number, createNumberMap()])));
      phaseTotals.set(phase, createNumberMap());
    }

    for (const source of sources) {
      const sourceWeight = weight * (source === previousSpecial ? sourceSpecialWeight : 1);
      totals.set(source, (totals.get(source) ?? 0) + sourceWeight);
      phaseTotals.get(phase)?.set(source, (phaseTotals.get(phase)?.get(source) ?? 0) + sourceWeight);
      const row = transitions.get(source);
      const phaseRow = phaseTransitions.get(phase)?.get(source);
      if (!row) {
        continue;
      }
      for (const target of targets) {
        row.set(target, (row.get(target) ?? 0) + sourceWeight);
        phaseRow?.set(target, (phaseRow.get(target) ?? 0) + sourceWeight);
      }
      specialTotals.set(source, (specialTotals.get(source) ?? 0) + sourceWeight);
      specialTransitions.get(source)?.set(
        currentSpecial,
        (specialTransitions.get(source)?.get(currentSpecial) ?? 0) + sourceWeight,
      );
    }

    if (previousPrevious) {
      const firstSources = stateNumbers(previousPrevious);
      for (const firstSource of firstSources) {
        for (const secondSource of sources) {
          const pairKey = `${firstSource}:${secondSource}`;
          const pairWeight = weight * (secondSource === previousSpecial ? 1.18 : 1);
          secondOrderTotals.set(pairKey, (secondOrderTotals.get(pairKey) ?? 0) + pairWeight);
          for (const target of targets) {
            const key = `${pairKey}:${target}`;
            secondOrderTransitions.set(key, (secondOrderTransitions.get(key) ?? 0) + pairWeight);
          }
        }
      }
    }

    const previousAttrs = markovAttributes(previousSpecial);
    const currentAttrs = markovAttributes(currentSpecial);
    for (const [attr, sourceValue] of Object.entries(previousAttrs)) {
      const targetValue = currentAttrs[attr];
      if (!attributeCounts.has(attr)) {
        attributeCounts.set(attr, new Map());
      }
      const attrMap = attributeCounts.get(attr)!;
      if (!attrMap.has(sourceValue)) {
        attrMap.set(sourceValue, new Map());
      }
      const targetMap = attrMap.get(sourceValue)!;
      targetMap.set(targetValue, (targetMap.get(targetValue) ?? 0) + weight);
    }
  }

  const attributeProfile = new Map<string, Map<string, Map<string, number>>>();
  for (const [attr, sourceMap] of attributeCounts.entries()) {
    attributeProfile.set(attr, new Map());
    for (const [sourceValue, targetMap] of sourceMap.entries()) {
      const total = [...targetMap.values()].reduce((sum, value) => sum + value, 0) || 1;
      attributeProfile.get(attr)!.set(
        sourceValue,
        new Map([...targetMap.entries()].map(([targetValue, value]) => [targetValue, value / total])),
      );
    }
  }

  const latestSources = stateNumbers(draws[0]);
  const latestSecondSources = draws[1] ? stateNumbers(draws[1]) : [];
  const latestPhase = markovPhase(draws.slice(0, 12));
  const transitionScores: Record<number, number> = {};
  const specialTransitionScores: Record<number, number> = {};
  const secondOrderScores: Record<number, number> = {};
  const phaseTransitionScores: Record<number, number> = {};
  const attributeScores: Record<number, number> = {};

  for (const candidate of ALL_NUMBERS) {
    transitionScores[candidate] = 0;
    specialTransitionScores[candidate] = 0;
    secondOrderScores[candidate] = 0;
    phaseTransitionScores[candidate] = 0;

    for (const source of stateNumbers(draws[0])) {
      const total = totals.get(source) ?? 0;
      transitionScores[candidate] += markovProbability(transitions.get(source)?.get(candidate) ?? 0, total, minSamples);
      specialTransitionScores[candidate] += markovProbability(
        specialTransitions.get(source)?.get(candidate) ?? 0,
        specialTotals.get(source) ?? 0,
        minSamples,
      );
      phaseTransitionScores[candidate] += markovProbability(
        phaseTransitions.get(latestPhase)?.get(source)?.get(candidate) ?? 0,
        phaseTotals.get(latestPhase)?.get(source) ?? 0,
        minSamples,
      );
    }

    for (const firstSource of latestSecondSources) {
      for (const secondSource of latestSources) {
        const pairKey = `${firstSource}:${secondSource}`;
        secondOrderScores[candidate] += markovProbability(
          secondOrderTransitions.get(`${pairKey}:${candidate}`) ?? 0,
          secondOrderTotals.get(pairKey) ?? 0,
          minSamples,
        );
      }
    }

    attributeScores[candidate] = scoreAttributeTransition(candidate, draws[0].specialNumber, attributeProfile);
  }

  return {
    transitionScores: normalizePlainNumberMap(transitionScores),
    specialTransitionScores: normalizePlainNumberMap(specialTransitionScores),
    secondOrderScores: normalizePlainNumberMap(secondOrderScores),
    phaseTransitionScores: normalizePlainNumberMap(phaseTransitionScores),
    attributeScores: normalizePlainNumberMap(attributeScores),
    latestPhase,
    latestSpecial: draws[0].specialNumber,
  };
}

export function buildMarkovTransitionScores(
  draws: Draw[],
  options?: { window?: number; decay?: number; targetSpecialOnly?: boolean; includeProfile?: false },
): NumberMap;
export function buildMarkovTransitionScores(
  draws: Draw[],
  options: { window?: number; decay?: number; includeProfile: true },
): MarkovTransitionProfile;
export function buildMarkovTransitionScores(
  draws: Draw[],
  options: { window?: number; decay?: number; targetSpecialOnly?: boolean; includeProfile?: boolean } = {},
): NumberMap | MarkovTransitionProfile {
  const profile = buildMarkovTransitionProfile(draws, options);
  if (options.includeProfile) {
    return profile;
  }
  return options.targetSpecialOnly ? profile.specialTransitionScores : profile.transitionScores;
}

function zodiacFrequencyMap(draws: Draw[], year: number): StringMap {
  const scores = new Map<string, number>(ZODIAC_SEQUENCE.map((zodiac) => [zodiac, 0]));

  for (let index = 0; index < draws.length; index += 1) {
    const weight = 1 / (index + 1);
    const zodiac = getZodiacForNumber(draws[index].specialNumber, year);
    scores.set(zodiac, (scores.get(zodiac) ?? 0) + weight);
  }

  return normalizeStringMap(scores);
}

function zodiacOmissionMap(draws: Draw[], year: number): StringMap {
  const scores = new Map<string, number>(ZODIAC_SEQUENCE.map((zodiac) => [zodiac, draws.length + 1]));

  for (let index = 0; index < draws.length; index += 1) {
    const zodiac = getZodiacForNumber(draws[index].specialNumber, year);
    if ((scores.get(zodiac) ?? draws.length + 1) > index + 1) {
      scores.set(zodiac, index + 1);
    }
  }

  return normalizeStringMap(scores);
}

function zodiacTransitionMap(draws: Draw[], year: number): StringMap {
  const scores = new Map<string, number>(ZODIAC_SEQUENCE.map((zodiac) => [zodiac, 0]));
  const currentSpecial = draws[0]?.specialNumber;

  if (!currentSpecial) {
    return scores;
  }

  const currentZodiac = getZodiacForNumber(currentSpecial, year);

  for (let index = 0; index < draws.length - 1; index += 1) {
    const prevZodiac = getZodiacForNumber(draws[index + 1].specialNumber, year);
    if (prevZodiac !== currentZodiac) {
      continue;
    }

    const followerZodiac = getZodiacForNumber(draws[index].specialNumber, year);
    scores.set(followerZodiac, (scores.get(followerZodiac) ?? 0) + 1);
  }

  return normalizeStringMap(scores);
}

function colorGapMap(draws: Draw[]): NumberMap {
  const counts = new Map<string, number>([
    ["红波", 0],
    ["蓝波", 0],
    ["绿波", 0],
  ]);

  for (const draw of draws) {
    const color = getWaveColor(draw.specialNumber);
    counts.set(color, (counts.get(color) ?? 0) + 1);
  }

  const total = [...counts.values()].reduce((sum, value) => sum + value, 0) || 1;
  const colorScore = new Map<string, number>();
  for (const [color, value] of counts.entries()) {
    colorScore.set(color, 1 - value / total);
  }

  const normalized = normalizeStringMap(colorScore);
  return new Map(ALL_NUMBERS.map((number) => [number, normalized.get(getWaveColor(number)) ?? 0]));
}

function zoneGapMap(draws: Draw[]): NumberMap {
  const counts = [0, 0, 0, 0, 0];

  for (const draw of draws) {
    counts[getZoneIndex(draw.specialNumber)] += 1;
  }

  const max = Math.max(...counts, 1);
  return new Map(
    ALL_NUMBERS.map((number) => {
      const zone = getZoneIndex(number);
      return [number, 1 - counts[zone] / max];
    }),
  );
}

function applyRecentPenalty(draws: Draw[], scores: NumberMap): NumberMap {
  const penalized = new Map(scores);

  for (let index = 0; index < Math.min(draws.length, 3); index += 1) {
    const specialNumber = draws[index].specialNumber;
    const penalty = RECENT_SPECIAL_PENALTY.has(index + 1) ? 0.35 : 0.18;
    penalized.set(specialNumber, (penalized.get(specialNumber) ?? 0) - penalty);
  }

  return penalized;
}

function buildReason(parts: Array<[string, number]>): string {
  return parts
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([label, value]) => `${label} ${value.toFixed(2)}`)
    .join(" · ");
}


function waveCounts(draws: Draw[], window: number): Record<WaveColor, number> {
  const counts: Record<WaveColor, number> = { 红波: 0, 蓝波: 0, 绿波: 0 };
  for (const draw of draws.slice(0, Math.min(window, draws.length))) {
    counts[getWaveColor(draw.specialNumber)] += 1;
  }
  return counts;
}

function waveOmission(draws: Draw[], color: WaveColor): number {
  for (let index = 0; index < draws.length; index += 1) {
    if (getWaveColor(draws[index].specialNumber) === color) {
      return index;
    }
  }
  return draws.length;
}

function lowestCountWave(counts: Record<WaveColor, number>): WaveColor {
  return WAVE_COLORS.reduce((best, color) => (counts[color] < counts[best] ? color : best));
}

function normalizeWaveRisk(raw: Record<WaveColor, number>): Record<WaveColor, number> {
  const total = WAVE_COLORS.reduce((sum, color) => sum + Math.max(0, raw[color]), 0) || 1;
  return { 红波: Math.max(0, raw.红波) / total, 蓝波: Math.max(0, raw.蓝波) / total, 绿波: Math.max(0, raw.绿波) / total };
}

function confidenceFromRisk(risk: Record<WaveColor, number>): number {
  const values = WAVE_COLORS.map((color) => risk[color]).sort((a, b) => a - b);
  return Math.max(0, Math.min(1, 0.5 + Math.min(0.5, Math.max(0, values[1] - values[0]) * 3)));
}

function rollingLowestWave(draws: Draw[], window: number): WaveColor {
  return lowestCountWave(waveCounts(draws, window));
}

function mainWaveLowest(draws: Draw[], window: number): WaveColor {
  const counts: Record<WaveColor, number> = { 红波: 0, 蓝波: 0, 绿波: 0 };
  for (const draw of draws.slice(0, Math.min(window, draws.length))) {
    for (const number of decodeDrawNumbers(draw)) {
      counts[getWaveColor(number)] += 1;
    }
  }
  return lowestCountWave(counts);
}

function issueModLowest(draws: Draw[], issueNo: string, mod: number): WaveColor {
  const counts: Record<WaveColor, number> = { 红波: 1, 蓝波: 1, 绿波: 1 };
  const nextSeq = Number(issueNo.slice(-3));
  const bucket = Number.isFinite(nextSeq) ? nextSeq % mod : draws.length % mod;
  for (const draw of draws) {
    const seq = Number(draw.issueNo.slice(-3));
    if (Number.isFinite(seq) && seq % mod === bucket) {
      counts[getWaveColor(draw.specialNumber)] += 1;
    }
  }
  return lowestCountWave(counts);
}

function patternLowest(draws: Draw[], k: number, window: number): WaveColor {
  if (draws.length <= k) {
    return rollingLowestWave(draws, 80);
  }
  const chronological = draws.slice(0, Math.min(window, draws.length)).reverse();
  const latestPattern = draws.slice(0, k).reverse().map((draw) => getWaveColor(draw.specialNumber)).join("|");
  const counts: Record<WaveColor, number> = { 红波: 1, 蓝波: 1, 绿波: 1 };
  for (let index = k; index < chronological.length; index += 1) {
    const pattern = chronological.slice(index - k, index).map((draw) => getWaveColor(draw.specialNumber)).join("|");
    if (pattern === latestPattern) {
      counts[getWaveColor(chronological[index].specialNumber)] += 1;
    }
  }
  return lowestCountWave(counts);
}

function stateGatedWave(draws: Draw[], config?: Record<string, any>): WaveColor {
  const cfg = {
    omitProtect: 6, hotWindow: 10, protectBonus: 4,
    omitSlope: 0.05, hotSlope: 0.2,
    streakPenalty: 0.1, streakMin: 3, stateBias: 0.0,
    ...config,
  };
  const hot = waveCounts(draws, cfg.hotWindow);
  const latest = getWaveColor(draws[0].specialNumber);
  let streak = 0;
  for (const draw of draws) {
    if (getWaveColor(draw.specialNumber) !== latest) break;
    streak++;
  }
  const raw: Record<WaveColor, number> = { 红波: 0, 蓝波: 0, 绿波: 0 };
  for (const color of WAVE_COLORS) {
    const omit = waveOmission(draws, color);
    let value = cfg.stateBias;
    if (omit >= cfg.omitProtect) {
      value += cfg.protectBonus + (omit - cfg.omitProtect) * cfg.omitSlope;
    }
    value += hot[color] * cfg.hotSlope;
    if (color === latest && streak >= cfg.streakMin) {
      value -= cfg.streakPenalty * streak;
    }
    raw[color] = Math.max(0.01, value);
  }
  return lowestCountWave(raw);
}

function blendWave(draws: Draw[], issueNo: string, config?: Record<string, any>): WaveColor {
  const cfg = { mainWindow: 80, patternK: 2, patternWindow: 500, mod: 7, ...config };
  const votes = [
    mainWaveLowest(draws, cfg.mainWindow),
    patternLowest(draws, cfg.patternK, cfg.patternWindow),
    issueModLowest(draws, issueNo, cfg.mod),
  ];
  const counts: Record<WaveColor, number> = { 红波: 0, 蓝波: 0, 绿波: 0 };
  for (const vote of votes) {
    counts[vote] += vote === votes[0] ? 2 : 1;
  }
  return WAVE_COLORS.reduce((best, color) => (counts[color] > counts[best] ? color : best));
}

function calibrateWaveBetLevel(confidence: number, excluded: WaveColor, voterPattern: WaveColor[], votes: Record<WaveColor, number>, recentCounts: Record<WaveColor, number>): [string, string] {
  if (confidence >= 0.90) return ["D级", "原始置信度>=0.90：当前回测命中偏低，越自信越容易错"];
  if (excluded === "红波") return ["C级", "排除红波：覆盖32/49，结构上弱于排蓝/绿；当前回测命中约65%-67%"];
  return ["B级", "排除蓝/绿波：覆盖33/49；当前回测约69%，无可靠的更高把握档"];
}

export function generateWavePrediction(recentDraws: Draw[], issueNo: string): WavePrediction {
  const cfg = {
    mainWindow: 80,
    greenOmissionVeto: 8,
    hotProtectColors: ["绿波", "蓝波"],
    hotProtectWindow: 10,
    hotProtectCount: 5,
    enableGenericPostRules: 1,
    enableSteadyConfidenceBandRules: 1,
    redLowOmitConfBand: 2,
    blueHotMod8Count: 5,
    greenOmitRoll10: 6,
    redOmitRoll30: 4,
    steadyConfLow: 0.685,
    steadyConfHigh: 0.75,
    omitProtect: 6, hotWindow: 10, protectBonus: 4,
    omitSlope: 0.05, hotSlope: 0.2,
    streakPenalty: 0.1, streakMin: 3, stateBias: 0.0,
  };

  const state = stateGatedWave(recentDraws, cfg);
  const voters = [state, mainWaveLowest(recentDraws, cfg.mainWindow), blendWave(recentDraws, issueNo, cfg), rollingLowestWave(recentDraws, 30), patternLowest(recentDraws, 2, 500)];
  const votes: Record<WaveColor, number> = { 红波: 0, 蓝波: 0, 绿波: 0 };
  for (const vote of voters) votes[vote] += 1;

  const topCount = Math.max(...Object.values(votes));
  const topColors = WAVE_COLORS.filter((c) => votes[c] === topCount);
  const risk = normalizeWaveRisk({ 红波: votes.红波, 蓝波: votes.蓝波, 绿波: votes.绿波 });
  let excluded = topColors.length === 1 ? topColors[0] : topColors.reduce((best, c) => risk[c] < risk[best] ? c : best);

  const recentCounts = waveCounts(recentDraws, cfg.hotProtectWindow);

  if (excluded === "绿波" && waveOmission(recentDraws, "绿波") >= cfg.greenOmissionVeto) {
    excluded = state !== "绿波" ? state : WAVE_COLORS.find((c) => c !== "绿波")!;
  }

  if (cfg.hotProtectColors.includes(excluded) && recentCounts[excluded] >= cfg.hotProtectCount && state !== excluded) {
    excluded = state;
  }

  if (cfg.enableGenericPostRules) {
    if (excluded === "蓝波" && recentCounts.蓝波 >= cfg.blueHotMod8Count) {
      excluded = issueModLowest(recentDraws, issueNo, 8);
    }
    if (excluded === "绿波" && waveOmission(recentDraws, "绿波") >= cfg.greenOmitRoll10) {
      excluded = rollingLowestWave(recentDraws, 10);
    }
    if (excluded === "红波" && waveOmission(recentDraws, "红波") >= cfg.redOmitRoll30) {
      excluded = rollingLowestWave(recentDraws, 30);
    }
  }

  const confidence = confidenceFromRisk(risk);
  if (cfg.enableSteadyConfidenceBandRules && confidence >= cfg.steadyConfLow && confidence < cfg.steadyConfHigh && waveOmission(recentDraws, "红波") <= cfg.redLowOmitConfBand) {
    excluded = "红波";
  }

  const [betLevel, confidenceNote] = calibrateWaveBetLevel(confidence, excluded, voters, votes, recentCounts);

  return {
    predictedWaves: WAVE_COLORS.filter((color) => color !== excluded),
    excludedWave: excluded,
    risk,
    confidence: Number(confidence.toFixed(4)),
    betLevel,
    confidenceNote,
    voterPattern: voters,
    recentCounts,
  };
}

function predictedWavesFromExcluded(excluded: WaveColor): WaveColor[] {
  return WAVE_COLORS.filter((c) => c !== excluded);
}

type ExpertPrediction = {
  excluded: WaveColor;
  risk: Record<WaveColor, number>;
  confidence: number;
  voterPattern: WaveColor[];
  votes: Record<WaveColor, number>;
  recentCounts: Record<WaveColor, number>;
};

type SegmentedState = {
  stats: Record<string, Record<string, [number, number]>>;
  queue: Array<[string[], Record<string, boolean>]>;
  expertNames: string[];
};

function segmentedSpecialistExperts(draws: Draw[], issueNo: string, baseCfg: Record<string, any>): Record<string, ExpertPrediction> {
  const wrap = (fn: () => WaveColor): ExpertPrediction => {
    const excluded = fn();
    return { excluded, risk: { 红波: 0, 蓝波: 0, 绿波: 0 }, confidence: 0, voterPattern: [], votes: { 红波: 0, 蓝波: 0, 绿波: 0 }, recentCounts: { 红波: 0, 蓝波: 0, 绿波: 0 } };
  };
  return {
    clean: wrap(() => generateWavePrediction(draws, issueNo).excludedWave),
    main120: wrap(() => mainWaveLowest(draws, 120)),
    roll30: wrap(() => rollingLowestWave(draws, 30)),
    roll80: wrap(() => rollingLowestWave(draws, 80)),
    pat2: wrap(() => patternLowest(draws, 2, 500)),
    mod7: wrap(() => issueModLowest(draws, issueNo, 7)),
    mod8: wrap(() => issueModLowest(draws, issueNo, 8)),
    mod9: wrap(() => issueModLowest(draws, issueNo, 9)),
    blend: wrap(() => blendWave(draws, issueNo, baseCfg)),
    state: wrap(() => stateGatedWave(draws, baseCfg)),
    rollH5: wrap(() => WAVE_COLORS.reduce((best, c) => waveCounts(draws, 5)[c] > waveCounts(draws, 5)[best] ? c : best)),
    mainH200: wrap(() => {
      const counts: Record<WaveColor, number> = { 红波: 0, 蓝波: 0, 绿波: 0 };
      for (const draw of draws.slice(0, Math.min(200, draws.length))) {
        for (const n of decodeDrawNumbers(draw)) counts[getWaveColor(n)] += 1;
      }
      return WAVE_COLORS.reduce((best, c) => counts[c] > counts[best] ? c : best);
    }),
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

function segmentedSpecialistAtoms(draws: Draw[], issueNo: string, basePred: WavePrediction, experts: Record<string, ExpertPrediction>): string[] {
  const voterPattern = basePred.voterPattern.map((c) => String(c));
  const voteShape = [...Object.values(basePred.risk).map((_, i, a) => a.filter((v) => v === a[i]).length).sort((a, b) => b - a).slice(0, 3)];
  const confidenceBin = Math.floor((basePred.confidence + 1e-9) / 0.05);
  const excluded = basePred.excludedWave;
  const atoms = [
    `base=${excluded}`,
    `shape=(${voteShape})`,
    `conf=${confidenceBin}`,
    `base_shape=${excluded}|(${voteShape})`,
    `base_conf=${excluded}|${confidenceBin}`,
  ];
  for (const [name, pred] of Object.entries(experts)) {
    atoms.push(`exp_${name}=${pred.excluded}`);
  }
  atoms.push("omit=(" + WAVE_COLORS.map((c) => smallOmissionBin(waveOmission(draws, c))).join(",") + ")");
  for (const window of [10, 20, 30, 80]) {
    const counts = waveCounts(draws, window);
    atoms.push("cnt" + window + "=(" + WAVE_COLORS.map((c) => smallCountBin(counts[c])).join(",") + ")");
    atoms.push("low" + window + "=" + WAVE_COLORS.reduce((best, c) => counts[c] < counts[best] ? c : best));
    atoms.push("high" + window + "=" + WAVE_COLORS.reduce((best, c) => counts[c] > counts[best] ? c : best));
  }
  for (const length of [1, 2, 3]) {
    if (draws.length >= length) {
      atoms.push("last" + length + "=" + draws.slice(0, length).map((d) => getWaveColor(d.specialNumber)).join(">"));
    }
  }
  const seq = Number(issueNo.slice(-3));
  if (Number.isFinite(seq)) {
    for (const mod of [7, 8, 9, 10, 20]) {
      atoms.push("imod" + mod + "=" + (seq % mod));
    }
  }
  return atoms;
}

function segmentedSpecialistSelect(atoms: string[], expertExclusions: Record<string, string>, state: SegmentedState, cfg: Record<string, any>): string {
  const minSamples = cfg.segmentedMinSamples ?? 1;
  const alpha = cfg.segmentedAlpha ?? 0.45;
  const threshold = cfg.segmentedThreshold ?? 0.0675;
  let bestName = "clean", bestScore = -1, cleanScore = -1;
  for (const name of state.expertNames) {
    let totalScore = 0, totalAtoms = 0;
    for (const atom of atoms) {
      const entry = state.stats[atom]?.[name];
      if (entry) {
        const [samples, hits] = entry;
        if (samples >= minSamples) {
          totalScore += (hits + alpha) / (samples + 2 * alpha);
          totalAtoms += 1;
        }
      }
    }
    const score = totalAtoms > 0 ? totalScore / totalAtoms : -1;
    if (name === "clean") cleanScore = score;
    if (score > bestScore) { bestName = name; bestScore = score; }
  }
  if (bestScore < 0 || (cleanScore >= 0 && bestScore < cleanScore + threshold)) {
    bestName = "clean";
  }
  return expertExclusions[bestName] ?? expertExclusions["clean"] ?? "蓝波";
}

export function predictWaveColor(draws: Draw[], issueNo: string): WavePrediction {
  const cfg = {
    segmentedMinSamples: 1, segmentedAlpha: 0.45,
    segmentedThreshold: 0.0675, segmentedWindow: 193,
  };
  const minHistory = 80;

  if (draws.length <= minHistory) {
    return generateWavePrediction(draws, issueNo);
  }

  const orderedDraws = [...draws].reverse();
  const baseCfg = {};
  const experts = segmentedSpecialistExperts(orderedDraws, issueNo, baseCfg);
  const basePred = generateWavePrediction(orderedDraws, issueNo);
  const atoms = segmentedSpecialistAtoms(orderedDraws, issueNo, basePred, experts);
  const expertExclusions: Record<string, string> = {};
  for (const [name, pred] of Object.entries(experts)) {
    expertExclusions[name] = pred.excluded;
  }

  const state: SegmentedState = { stats: {}, queue: [], expertNames: Object.keys(experts) };

  for (let index = minHistory; index < orderedDraws.length; index++) {
    const rowHistory = orderedDraws.slice(orderedDraws.length - index);
    const rowPred = generateWavePrediction(rowHistory, issueNo);
    const rowExperts = segmentedSpecialistExperts(rowHistory, issueNo, baseCfg);
    const rowAtoms = segmentedSpecialistAtoms(rowHistory, issueNo, rowPred, rowExperts);
    const rowExclusions: Record<string, string> = {};
    for (const [name, p] of Object.entries(rowExperts)) rowExclusions[name] = p.excluded;
    const actualWave = getWaveColor(orderedDraws[index - 1].specialNumber);
    const rowHits: Record<string, boolean> = {};
    for (const name of state.expertNames) {
      const exc = rowExclusions[name] ?? expertExclusions[name];
      rowHits[name] = exc !== actualWave;
    }
    for (const atom of rowAtoms) {
      if (!state.stats[atom]) state.stats[atom] = {};
      for (const name of state.expertNames) {
        if (!state.stats[atom][name]) state.stats[atom][name] = [0, 0];
        state.stats[atom][name][0] += 1;
        state.stats[atom][name][1] += rowHits[name] ? 1 : 0;
      }
    }
    state.queue.push([rowAtoms, rowHits]);
    if (state.queue.length > cfg.segmentedWindow) {
      const [oldAtoms, oldHits] = state.queue.shift()!;
      for (const atom of oldAtoms) {
        if (!state.stats[atom]) continue;
        for (const name of state.expertNames) {
          if (!state.stats[atom][name]) continue;
          state.stats[atom][name][0] -= 1;
          state.stats[atom][name][1] -= oldHits[name] ? 1 : 0;
        }
      }
    }
  }

  const selectedExcluded = segmentedSpecialistSelect(atoms, expertExclusions, state, cfg);

  const out = { ...basePred, excludedWave: selectedExcluded as WaveColor };
  out.predictedWaves = predictedWavesFromExcluded(out.excludedWave);
  return out;
}

function pickTopCandidates(
  scores: NumberMap,
  count: number,
  explain: (number: number, score: number) => string,
): StrategyResult["picks"] {
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, count)
    .map(([number, score], index) => ({
      number,
      rank: index + 1,
      score,
      reason: explain(number, score),
    }));
}

export const strategyMeta: Record<StrategyId, { name: string; description: string; limit: number }> = {
  zodiac_special_v1: {
    name: "生肖号码方案",
    description: "按生肖热度、遗漏和转移节奏筛选下一期特别号生肖池",
    limit: 30,
  },
  hot_special_v1: {
    name: "热门号码方案",
    description: "优先选择近期特别号高频、主号带动明显的候选号码",
    limit: 18,
  },
  cold_special_v1: {
    name: "冷门号码方案",
    description: "优先选择长遗漏且具回补条件的特别号候选号码",
    limit: 18,
  },
  markov_special_v1: {
    name: "马尔科夫转移方案",
    description: "按最近开奖到开奖的转移概率和特别号转移关系筛选候选号码",
    limit: 18,
  },
  knowledge_mix_v1: {
    name: "综合方案",
    description: "融合热度、冷门、生肖、波色、分区和主号联动的综合方案",
    limit: 20,
  },
  wave_special_v1: {
    name: "波色排除方案",
    description: "直接预测下一期特别号波色，推荐两个波色并排除一个波色",
    limit: 33,
  },
};

export function generateStrategyResult(strategy: StrategyId, recentDraws: Draw[], issueNo: string): StrategyResult {
  const targetYear = inferYearFromIssue(issueNo, recentDraws[0]?.drawDate.getUTCFullYear());
  const longWindow = recentDraws.slice(0, Math.min(recentDraws.length, 180));
  const mediumWindow = recentDraws.slice(0, Math.min(recentDraws.length, 72));
  const shortWindow = recentDraws.slice(0, Math.min(recentDraws.length, 24));

  const hotLong = specialFrequencyMap(longWindow);
  const hotShort = specialFrequencyMap(shortWindow);
  const cold = omissionMap(longWindow);
  const antiHot = reverseNumberMap(hotLong);
  const mainHot = mainExposureMap(recentDraws.slice(0, Math.min(recentDraws.length, 18)));
  const transition = transitionMap(mediumWindow);
  const colorGap = colorGapMap(shortWindow);
  const zoneGap = zoneGapMap(shortWindow);
  const zodiacHot = zodiacFrequencyMap(longWindow, targetYear);
  const zodiacCold = zodiacOmissionMap(longWindow, targetYear);
  const zodiacTransition = zodiacTransitionMap(mediumWindow, targetYear);

  const hotScores = createNumberMap();
  const coldScores = createNumberMap();
  const mixScores = createNumberMap();

  for (const number of ALL_NUMBERS) {
    const zodiac = getZodiacForNumber(number, targetYear);
    const zodiacMomentum =
      (zodiacHot.get(zodiac) ?? 0) * 0.55 +
      (zodiacCold.get(zodiac) ?? 0) * 0.2 +
      (zodiacTransition.get(zodiac) ?? 0) * 0.25;

    hotScores.set(
      number,
      (hotShort.get(number) ?? 0) * 0.48 +
        (hotLong.get(number) ?? 0) * 0.24 +
        (mainHot.get(number) ?? 0) * 0.14 +
        (transition.get(number) ?? 0) * 0.14,
    );

    coldScores.set(
      number,
      (cold.get(number) ?? 0) * 0.56 +
        (antiHot.get(number) ?? 0) * 0.16 +
        (colorGap.get(number) ?? 0) * 0.1 +
        (zoneGap.get(number) ?? 0) * 0.08 +
        zodiacMomentum * 0.1,
    );

    mixScores.set(
      number,
      (hotScores.get(number) ?? 0) * 0.24 +
        (coldScores.get(number) ?? 0) * 0.2 +
        (mainHot.get(number) ?? 0) * 0.16 +
        zodiacMomentum * 0.16 +
        (transition.get(number) ?? 0) * 0.08 +
        (colorGap.get(number) ?? 0) * 0.08 +
        (zoneGap.get(number) ?? 0) * 0.08,
    );
  }

  const adjustedHot = applyRecentPenalty(recentDraws, hotScores);
  const adjustedCold = applyRecentPenalty(recentDraws, coldScores);
  const adjustedMix = applyRecentPenalty(recentDraws, mixScores);

  if (strategy === "wave_special_v1") {
    const wavePrediction = generateWavePrediction(recentDraws, issueNo);
    const waveOrder = new Map(wavePrediction.predictedWaves.map((wave, index) => [wave, index]));
    const pickedNumbers = ALL_NUMBERS
      .filter((number) => wavePrediction.predictedWaves.includes(getWaveColor(number)))
      .sort((a, b) => {
        const waveDiff = (waveOrder.get(getWaveColor(a)) ?? 0) - (waveOrder.get(getWaveColor(b)) ?? 0);
        return waveDiff || a - b;
      });

    return {
      strategy,
      strategyVersion: strategy,
      picks: pickedNumbers.map((number, index) => ({
        number,
        rank: index + 1,
        score: 1 - index / Math.max(pickedNumbers.length, 1),
        reason: `波色方案：推荐 ${wavePrediction.predictedWaves.join("+")}，排除 ${wavePrediction.excludedWave} · 等级 ${wavePrediction.betLevel} · 置信度 ${wavePrediction.confidence.toFixed(4)} · ${wavePrediction.confidenceNote}`,
      })),
    };
  }

  if (strategy === "zodiac_special_v1") {
    const zodiacScores = [...ZODIAC_SEQUENCE]
      .map((zodiac) => ({
        zodiac,
        score:
          (zodiacHot.get(zodiac) ?? 0) * 0.45 +
          (zodiacCold.get(zodiac) ?? 0) * 0.25 +
          (zodiacTransition.get(zodiac) ?? 0) * 0.3,
      }))
      .sort((a, b) => b.score - a.score);

    const pickedZodiacs = zodiacScores.slice(0, 6);
    const zodiacScoreMap = new Map(pickedZodiacs.map((item) => [item.zodiac, item.score]));
    const zodiacPool = pickedZodiacs.flatMap(({ zodiac }) =>
      getNumbersForZodiac(zodiac, targetYear).map((number) => {
        const score =
          (zodiacScoreMap.get(zodiac) ?? 0) * 0.58 +
          (adjustedMix.get(number) ?? 0) * 0.24 +
          (mainHot.get(number) ?? 0) * 0.18;
        return [number, score] as const;
      }),
    );

    const limited = new Map(
      zodiacPool
        .sort((a, b) => b[1] - a[1] || a[0] - b[0])
        .slice(0, strategyMeta[strategy].limit),
    );

    return {
      strategy,
      strategyVersion: strategy,
      picks: pickTopCandidates(limited, strategyMeta[strategy].limit, (number, score) => {
        const zodiac = getZodiacForNumber(number, targetYear);
        return buildReason([
          [`${zodiac}热度`, zodiacHot.get(zodiac) ?? 0],
          [`${zodiac}遗漏`, zodiacCold.get(zodiac) ?? 0],
          [`${zodiac}转移`, zodiacTransition.get(zodiac) ?? 0],
          ["综合分", score],
        ]);
      }),
    };
  }

  if (strategy === "hot_special_v1") {
    return {
      strategy,
      strategyVersion: strategy,
      picks: pickTopCandidates(adjustedHot, strategyMeta[strategy].limit, (number, score) =>
        buildReason([
          ["短期热度", hotShort.get(number) ?? 0],
          ["长期热度", hotLong.get(number) ?? 0],
          ["主号带动", mainHot.get(number) ?? 0],
          ["接力转移", transition.get(number) ?? 0],
          ["综合分", score],
        ]),
      ),
    };
  }

  if (strategy === "cold_special_v1") {
    return {
      strategy,
      strategyVersion: strategy,
      picks: pickTopCandidates(adjustedCold, strategyMeta[strategy].limit, (number, score) =>
        buildReason([
          ["遗漏修复", cold.get(number) ?? 0],
          ["冷门纯度", antiHot.get(number) ?? 0],
          ["波色缺口", colorGap.get(number) ?? 0],
          ["分区缺口", zoneGap.get(number) ?? 0],
          ["综合分", score],
        ]),
      ),
    };
  }

  if (strategy === "markov_special_v1") {
    const profile = buildMarkovTransitionProfile(longWindow, { window: 80 });
    const markovScores = applyRecentPenalty(
      recentDraws,
      new Map(
        ALL_NUMBERS.map((number) => [
          number,
          (profile.transitionScores.get(number) ?? 0) * 0.42 +
            (profile.specialTransitionScores.get(number) ?? 0) * 0.16 +
            (profile.secondOrderScores.get(number) ?? 0) * 0.14 +
            (profile.phaseTransitionScores.get(number) ?? 0) * 0.08 +
            (profile.attributeScores.get(number) ?? 0) * 0.06 +
            (hotShort.get(number) ?? 0) * 0.06 +
            (mainHot.get(number) ?? 0) * 0.04 +
            (cold.get(number) ?? 0) * 0.04,
        ]),
      ),
    );

    return {
      strategy,
      strategyVersion: strategy,
      picks: pickTopCandidates(markovScores, strategyMeta[strategy].limit, (number, score) =>
        buildReason([
          ["开奖转移", profile.transitionScores.get(number) ?? 0],
          ["特别号转移", profile.specialTransitionScores.get(number) ?? 0],
          ["二阶转移", profile.secondOrderScores.get(number) ?? 0],
          ["阶段节奏", profile.phaseTransitionScores.get(number) ?? 0],
          ["综合分", score],
        ]),
      ),
    };
  }

  return {
    strategy,
    strategyVersion: strategy,
    picks: pickTopCandidates(adjustedMix, strategyMeta[strategy].limit, (number, score) =>
      buildReason([
        ["热度", hotLong.get(number) ?? 0],
        ["冷门修复", cold.get(number) ?? 0],
        ["主号联动", mainHot.get(number) ?? 0],
        [`${getYearZodiac(targetYear)}年生肖轴`, zodiacHot.get(getZodiacForNumber(number, targetYear)) ?? 0],
        ["综合分", score],
      ]),
    ),
  };
}

export function allStrategies(): StrategyId[] {
  return ["zodiac_special_v1", "hot_special_v1", "cold_special_v1", "knowledge_mix_v1", "wave_special_v1"];
}

export function scheduledStrategies(): StrategyId[] {
  return [...allStrategies(), "markov_special_v1"];
}
