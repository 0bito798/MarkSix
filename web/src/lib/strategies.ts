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
  return ["zodiac_special_v1", "hot_special_v1", "cold_special_v1", "knowledge_mix_v1"];
}

export function scheduledStrategies(): StrategyId[] {
  return [...allStrategies(), "markov_special_v1"];
}
