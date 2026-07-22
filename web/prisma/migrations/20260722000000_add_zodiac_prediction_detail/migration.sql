-- Stores pure-zodiac prediction runs separately from number candidate picks.
CREATE TABLE "ZodiacPredictionDetail" (
    "id" SERIAL NOT NULL,
    "runId" INTEGER NOT NULL,
    "issueNo" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "zodiacsJson" TEXT NOT NULL,
    "actualZodiac" TEXT,
    "hit" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "ZodiacPredictionDetail_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ZodiacPredictionDetail_runId_key" ON "ZodiacPredictionDetail"("runId");
CREATE INDEX "ZodiacPredictionDetail_issueNo_idx" ON "ZodiacPredictionDetail"("issueNo");
CREATE INDEX "ZodiacPredictionDetail_mode_idx" ON "ZodiacPredictionDetail"("mode");
CREATE INDEX "ZodiacPredictionDetail_hit_idx" ON "ZodiacPredictionDetail"("hit");

ALTER TABLE "ZodiacPredictionDetail"
ADD CONSTRAINT "ZodiacPredictionDetail_runId_fkey"
FOREIGN KEY ("runId") REFERENCES "PredictionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
