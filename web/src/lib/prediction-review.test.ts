import assert from "node:assert/strict";
import test from "node:test";
import { reviewPredictionRun, reviewWaveExclusion } from "@/lib/prediction-review";

test("wave exclusion review misses when excluded wave equals the actual wave", () => {
  const outcome = reviewWaveExclusion("红波", "红波");

  assert.equal(outcome.hit, false);
  assert.equal(outcome.hitCount, 0);
  assert.equal(outcome.hitRate, 0);
  assert.deepEqual(outcome.matchedNumbers, []);
});

test("wave exclusion review hits when excluded wave differs from the actual wave", () => {
  const outcome = reviewWaveExclusion("红波", "蓝波");

  assert.equal(outcome.hit, true);
  assert.equal(outcome.hitCount, 1);
  assert.equal(outcome.hitRate, 1);
  assert.deepEqual(outcome.matchedNumbers, []);
});

test("wave strategy review requires wave detail instead of falling back to number picks", () => {
  assert.throws(
    () => reviewPredictionRun({
      strategy: "wave_special_v1",
      picks: [1],
      winningSpecial: 1,
      actualWave: "红波",
      waveDetail: null,
    }),
    /Missing wave prediction detail/,
  );
});

test("legacy wave strategy review infers wave detail from old wave-color picks", () => {
  const outcome = reviewPredictionRun({
    strategy: "wave_special_v1",
    picks: [1, 3],
    winningSpecial: 1,
    actualWave: "绿波",
    waveDetail: null,
  });

  assert.equal(outcome.hit, false);
  assert.equal(outcome.hitCount, 0);
  assert.equal(outcome.hitRate, 0);
  assert.deepEqual(outcome.matchedNumbers, []);
});
