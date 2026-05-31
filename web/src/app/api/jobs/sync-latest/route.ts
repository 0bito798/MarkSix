import { NextResponse } from "next/server";
import { loadDrawRecords } from "@/lib/data-source";
import { upsertDrawRecords } from "@/lib/history-store";
import { generatePredictionsForNextIssue, reviewIssue } from "@/lib/prediction-service";
import { scheduledStrategies } from "@/lib/strategies";

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return true;
  }

  const token = request.headers.get("x-cron-secret") ?? "";
  if (token === secret) {
    return true;
  }

  const auth = request.headers.get("authorization") ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim() === secret;
  }

  return false;
}

export async function GET(request: Request) {
  try {
    if (!authorized(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const records = await loadDrawRecords();

    const synced = await upsertDrawRecords(records);
    const lastIssue = synced.latestIssue;

    if (lastIssue) {
      await reviewIssue(lastIssue);
    }

    const nextPrediction = await generatePredictionsForNextIssue(scheduledStrategies());

    return NextResponse.json({
      ok: true,
      totalRecords: synced.totalRecords,
      inserted: synced.inserted,
      updated: synced.updated,
      reviewedIssue: lastIssue,
      generatedForIssue: nextPrediction.issueNo,
      createdRunIds: nextPrediction.createdRunIds,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
