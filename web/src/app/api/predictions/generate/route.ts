import { NextResponse } from "next/server";
import { isMacauIssueNo } from "@/lib/marksix";
import { generatePredictionsForIssue, generatePredictionsForNextIssue } from "@/lib/prediction-service";
import { type StrategyId } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      issueNo?: string;
      strategies?: StrategyId[];
    };

    if (body.issueNo) {
      if (!isMacauIssueNo(body.issueNo)) {
        return NextResponse.json({ error: "新澳门六合彩期号必须是 7 位格式，例如 2026147" }, { status: 400 });
      }
      const createdRunIds = await generatePredictionsForIssue(body.issueNo, body.strategies);
      return NextResponse.json({ ok: true, issueNo: body.issueNo, createdRunIds });
    }

    const { issueNo, createdRunIds } = await generatePredictionsForNextIssue(body.strategies);
    return NextResponse.json({ ok: true, issueNo, createdRunIds });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
