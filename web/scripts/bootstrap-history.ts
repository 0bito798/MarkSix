import { prisma } from "../src/lib/prisma";
import { loadDrawRecords } from "../src/lib/data-source";
import { upsertDrawRecords } from "../src/lib/history-store";
import { generatePredictionsForNextIssue } from "../src/lib/prediction-service";

const BOOTSTRAP_FLAG = "history_bootstrap_completed";

function hasForceFlag(): boolean {
  return process.argv.slice(2).includes("--force");
}

async function run() {
  const force = hasForceFlag();
  const flag = await prisma.systemState.findUnique({ where: { key: BOOTSTRAP_FLAG } });

  if (flag?.value === "true" && !force) {
    console.log("History bootstrap already completed. Skip.");
    return;
  }

  const records = await loadDrawRecords();
  const synced = await upsertDrawRecords(records);

  await prisma.systemState.upsert({
    where: { key: BOOTSTRAP_FLAG },
    update: { value: "true" },
    create: { key: BOOTSTRAP_FLAG, value: "true" },
  });

  const prediction = await generatePredictionsForNextIssue();
  console.log(
    `Bootstrap done. inserted=${synced.inserted}, updated=${synced.updated}, force=${force}, generated_predictions_for=${prediction.issueNo}`,
  );
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
