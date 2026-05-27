import { parseDrawCsv, readLocalCsv } from "@/lib/csv";
import { loadMacauRecords } from "@/lib/macau-source";
import { type CsvDrawRecord } from "@/lib/types";

async function loadRemoteCsvRecords(): Promise<CsvDrawRecord[]> {
  const remoteCsv = process.env.RESULT_CSV_URL?.trim();
  if (!remoteCsv) {
    return [];
  }

  const response = await fetch(remoteCsv, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to fetch RESULT_CSV_URL: ${response.status}`);
  }

  const raw = await response.text();
  return parseDrawCsv(raw).map((record) => ({
    ...record,
    source: "remote_csv",
  }));
}

function loadLocalSeedRecords(): CsvDrawRecord[] {
  const configured = process.env.LOCAL_RESULT_CSV_PATH?.trim();
  const candidates = [
    configured,
    "./Macau_Mark_Six.csv",
  ].filter((value, index, arr): value is string => Boolean(value) && arr.indexOf(value) === index);

  let lastError: Error | null = null;

  for (const filePath of candidates) {
    try {
      const source = filePath.includes("/web/") || filePath.startsWith("./web/")
        ? "local_web_csv"
        : "local_csv";
      return parseDrawCsv(readLocalCsv(filePath)).map((record) => ({
        ...record,
        source,
      }));
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error("No local CSV source is available");
}

async function loadOptionalSource(
  loader: () => Promise<CsvDrawRecord[]> | CsvDrawRecord[],
  required: boolean,
): Promise<CsvDrawRecord[]> {
  try {
    return await loader();
  } catch (error) {
    if (required) {
      throw error;
    }
    return [];
  }
}

export async function loadDrawRecords(): Promise<CsvDrawRecord[]> {
  const provider = (process.env.RESULT_PROVIDER || "macau").trim().toLowerCase();

  if (provider === "csv") {
    const remote = await loadOptionalSource(loadRemoteCsvRecords, false);
    if (remote.length > 0) {
      return remote;
    }

    return loadOptionalSource(loadLocalSeedRecords, true);
  }

  if (provider === "macau") {
    return loadOptionalSource(loadMacauRecords, true);
  }

  return loadOptionalSource(loadMacauRecords, true);
}
