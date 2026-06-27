#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(__dirname, "..");
const repoRoot = resolve(webRoot, "..");

function readOption(name, fallback) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

const oracleRoot = readOption("oracle-root", "E:\\MarkSix");
const python = readOption("python", process.env.PYTHON ?? "python");
const predictorPath = readOption("predictor", resolve(oracleRoot, "wave_predictor.py"));
const dbPath = readOption("db", resolve(oracleRoot, "marksix_local.db"));
const configPath = readOption("config", resolve(oracleRoot, "wave_model_config.json"));
const outputPath = readOption("output", resolve(webRoot, "src/lib/wave-python-golden.fixture.json"));

const oracle = String.raw`
import hashlib
import importlib.util
import json
import pathlib
import sys

predictor_path = pathlib.Path(sys.argv[1])
db_path = pathlib.Path(sys.argv[2])
config_path = pathlib.Path(sys.argv[3])

spec = importlib.util.spec_from_file_location("wave_predictor_oracle", predictor_path)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

with config_path.open("r", encoding="utf-8") as fh:
    config_file = json.load(fh)

config = config_file.get("config", config_file)
records = module.load_draw_records(str(db_path))
min_history = int(config_file.get("training", {}).get("min_history", 80))

def stable(value):
    return json.loads(json.dumps(value, ensure_ascii=False, sort_keys=True, default=str))

def draw(row):
    return {
        "issueNo": row.issue_no,
        "drawDate": row.draw_date,
        "numbers": list(row.numbers),
        "specialNumber": int(row.special_number),
        "specialWave": row.special_wave,
    }

candidate_lengths = [
    min(10, len(records)),
    min_history,
    min_history + 1,
    min_history + 5,
    min_history + 40,
    len(records) // 2,
    max(min_history + 1, len(records) - 200),
    max(min_history + 1, len(records) - 50),
    len(records),
]

lengths = []
for length in candidate_lengths:
    if 1 <= length <= len(records) and length not in lengths:
        lengths.append(length)

cases = []
for length in lengths:
    history = records[:length]
    prediction = stable(module.predict_from_config(history, config))
    features = prediction.get("features", {})
    target = records[length] if length < len(records) else None
    kind = "walk_forward"
    if length < min_history:
        kind = "low_history_fallback"
    elif length == len(records):
        kind = "latest_full_history"
    cases.append({
        "id": f"{kind}_{length}",
        "kind": kind,
        "historyLength": length,
        "historyLatestIssue": history[-1].issue_no,
        "targetIssue": target.issue_no if target else None,
        "actualWave": target.special_wave if target else None,
        "expected": {
            "strategy": prediction.get("strategy"),
            "predictedWaves": prediction.get("predicted_waves", []),
            "excludedWave": prediction.get("excluded_wave"),
            "risk": prediction.get("risk", {}),
            "confidence": prediction.get("confidence"),
            "betLevel": prediction.get("bet_level"),
            "confidenceNote": prediction.get("confidence_note"),
            "voterPattern": list(features.get("voter_pattern") or []),
            "recentCounts": dict(features.get("recent_counts") or {}),
            "features": features,
        },
    })

payload = {
    "schemaVersion": 1,
    "generatedBy": "web/scripts/generate-wave-python-golden.mjs",
    "oracle": {
        "predictorPath": str(predictor_path),
        "dbPath": str(db_path),
        "configPath": str(config_path),
        "predictorSha256": hashlib.sha256(predictor_path.read_bytes()).hexdigest(),
        "configSha256": hashlib.sha256(config_path.read_bytes()).hexdigest(),
        "strategy": config.get("strategy", config.get("strategy_type", "trained_wave_v1")),
        "minHistory": min_history,
    },
    "draws": [draw(row) for row in records],
    "cases": cases,
}

print(json.dumps(payload, ensure_ascii=False, sort_keys=True))
`;

async function run() {
  const [predictorBytes, configBytes] = await Promise.all([
    readFile(predictorPath),
    readFile(configPath),
  ]);

  const result = spawnSync(python, ["-c", oracle, predictorPath, dbPath, configPath], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 64,
  });

  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.stderr.write(result.stdout);
    process.exit(result.status ?? 1);
  }

  const fixture = JSON.parse(result.stdout);
  fixture.oracle.predictorSha256 = createHash("sha256").update(predictorBytes).digest("hex");
  fixture.oracle.configSha256 = createHash("sha256").update(configBytes).digest("hex");
  fixture.generatedAt = new Date().toISOString();

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");

  console.log(`Wrote ${fixture.cases.length} Python golden cases to ${outputPath}`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
