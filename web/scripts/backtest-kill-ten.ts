import { readFileSync } from "node:fs";
import { type Draw } from "@prisma/client";
import { generateStrategyResult } from "../src/lib/strategies";

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

const failures: number[] = [];
let currentFailureStreak = 0;
let maxFailureStreak = 0;

for (let targetIndex = MIN_HISTORY; targetIndex < records.length; targetIndex += 1) {
  const target = records[targetIndex];
  const history = records.slice(0, targetIndex).reverse();
  const result = generateStrategyResult("kill_ten_special_v1", history, target.issueNo);
  const excluded = result.picks.map((pick) => pick.number);

  if (result.selectionMode !== "EXCLUDE" || excluded.length !== 10 || new Set(excluded).size !== 10) {
    throw new Error(`Invalid kill-ten output for ${target.issueNo}`);
  }

  const failed = excluded.includes(target.specialNumber) ? 1 : 0;
  failures.push(failed);
  currentFailureStreak = failed ? currentFailureStreak + 1 : 0;
  maxFailureStreak = Math.max(maxFailureStreak, currentFailureStreak);
}

console.log(`kill_ten_special_v1 walk-forward (history only, minHistory=${MIN_HISTORY})`);
printWindow("all", summarize(failures));
printWindow("latest400", summarize(failures.slice(-400)));
printWindow("latest100", summarize(failures.slice(-100)));
console.log(`maxConsecutiveFailures=${maxFailureStreak}`);
console.log(
  `randomBaselineSuccess=${percent(RANDOM_SUCCESS_RATE)} randomBaselineFailure=${percent(1 - RANDOM_SUCCESS_RATE)}`,
);
