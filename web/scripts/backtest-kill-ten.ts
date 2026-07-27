import { readFileSync } from "node:fs";
import { type Draw } from "@prisma/client";
import {
  KILL_TEN_SCORED_VERSION,
  generateStrategyResult,
  type KillTenAlgorithm,
} from "../src/lib/strategies";

type FixtureDraw = {
  drawDate: string;
  issueNo: string;
  numbers: number[];
  specialNumber: number;
};

type WindowResult = {
  issues: number;
  successes: number;
  failures: number;
  successRate: number;
  failureRate: number;
};

type BacktestResult = {
  algorithm: KillTenAlgorithm;
  version: string;
  all: WindowResult;
  latest400: WindowResult;
  latest100: WindowResult;
  maxFailureStreak: number;
  exclusionSignatures: string[];
};

const MIN_HISTORY = 180;
const RANDOM_SUCCESS_RATE = 39 / 49;

function summarize(failures: number[]): WindowResult {
  const issues = failures.length;
  const failureCount = failures.reduce((sum, value) => sum + value, 0);
  const successes = issues - failureCount;
  return {
    issues,
    successes,
    failures: failureCount,
    successRate: issues === 0 ? 0 : successes / issues,
    failureRate: issues === 0 ? 0 : failureCount / issues,
  };
}

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function printWindow(label: string, result: WindowResult): void {
  console.log(
    `${label}: issues=${result.issues} success=${result.successes} failure=${result.failures} ` +
      `successRate=${percent(result.successRate)} failureRate=${percent(result.failureRate)}`,
  );
}

const fixturePath = new URL("../src/lib/wave-python-golden.fixture.json", import.meta.url);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as { draws: FixtureDraw[] };
const records: Draw[] = fixture.draws.map((draw, index) => ({
  id: index + 1,
  issueNo: draw.issueNo,
  drawDate: new Date(draw.drawDate),
  numbersJson: JSON.stringify(draw.numbers),
  specialNumber: draw.specialNumber,
  source: "wave-python-golden",
  createdAt: new Date(0),
  updatedAt: new Date(0),
}));

function backtest(algorithm: KillTenAlgorithm): BacktestResult {
  const failures: number[] = [];
  let currentFailureStreak = 0;
  let maxFailureStreak = 0;
  let version = "";
  const exclusionSignatures: string[] = [];

  for (let targetIndex = MIN_HISTORY; targetIndex < records.length; targetIndex += 1) {
    const target = records[targetIndex];
    const history = records.slice(0, targetIndex).reverse();
    const result = generateStrategyResult("kill_ten_special_v1", history, target.issueNo, {
      killTenAlgorithm: algorithm,
    });
    const excluded = result.picks.map((pick) => pick.number);

    if (result.selectionMode !== "EXCLUDE" || excluded.length !== 10 || new Set(excluded).size !== 10) {
      throw new Error(`Invalid ${algorithm} kill-ten output for ${target.issueNo}`);
    }

    version = result.strategyVersion;
    exclusionSignatures.push([...excluded].sort((left, right) => left - right).join(","));
    const failed = excluded.includes(target.specialNumber) ? 1 : 0;
    failures.push(failed);
    currentFailureStreak = failed ? currentFailureStreak + 1 : 0;
    maxFailureStreak = Math.max(maxFailureStreak, currentFailureStreak);
  }

  const expectedVersion = algorithm === "legacy_scored" ? KILL_TEN_SCORED_VERSION : "kill_ten_special_v1";
  if (version !== expectedVersion) {
    throw new Error(`Unexpected ${algorithm} version: ${version}`);
  }

  return {
    algorithm,
    version,
    all: summarize(failures),
    latest400: summarize(failures.slice(-400)),
    latest100: summarize(failures.slice(-100)),
    maxFailureStreak,
    exclusionSignatures,
  };
}

function printBacktest(result: BacktestResult): void {
  console.log(`${result.algorithm} version=${result.version}`);
  printWindow("all", result.all);
  printWindow("latest400", result.latest400);
  printWindow("latest100", result.latest100);
  console.log(`maxConsecutiveFailures=${result.maxFailureStreak}`);
}

const legacy = backtest("legacy");
const legacyScored = backtest("legacy_scored");

for (let index = 0; index < legacy.exclusionSignatures.length; index += 1) {
  if (legacy.exclusionSignatures[index] !== legacyScored.exclusionSignatures[index]) {
    throw new Error(`Scored exclusions changed at walk-forward index ${index}`);
  }
}

console.log(`kill_ten_special_v1 walk-forward comparison (history only, minHistory=${MIN_HISTORY})`);
printBacktest(legacy);
printBacktest(legacyScored);
console.log(`legacyScoredSuccessDelta=${percent(legacyScored.all.successRate - legacy.all.successRate)}`);
console.log(`identicalExclusionSets=${legacy.exclusionSignatures.length}`);
console.log(
  `randomBaselineSuccess=${percent(RANDOM_SUCCESS_RATE)} randomBaselineFailure=${percent(1 - RANDOM_SUCCESS_RATE)}`,
);
