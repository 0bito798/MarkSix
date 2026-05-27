import { type CsvDrawRecord } from "@/lib/types";

type MacauApiRow = Record<string, unknown>;

const DEFAULT_LOTTERY_KEY = "macaujc2";

function lotteryKey(): string {
  const configured = process.env.MACAU_LOTTERY_KEY?.trim();
  return configured || DEFAULT_LOTTERY_KEY;
}

function defaultLatestUrl(): string {
  return `https://macaumarksix.com/api/${lotteryKey()}.com`;
}

function defaultHistoryTemplate(): string {
  return `https://history.macaumarksix.com/history/${lotteryKey()}/y/{year}`;
}

function currentMacauYear(): number {
  return Number(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Macau",
      year: "numeric",
    }).format(new Date()),
  );
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function toInt(value: unknown): number | null {
  const text = `${value ?? ""}`.trim();
  if (!text) {
    return null;
  }

  const parsed = Number(text);
  if (!Number.isInteger(parsed)) {
    return null;
  }

  return parsed;
}

function normalizeIssueNo(input: unknown): string | null {
  const raw = `${input ?? ""}`.trim();
  if (!raw) {
    return null;
  }

  if (/^\d{7}$/.test(raw)) {
    return raw;
  }

  const digits = raw.replace(/\D/g, "");
  if (/^\d{7}$/.test(digits)) {
    return digits;
  }

  return null;
}

function normalizeDate(input: unknown): Date | null {
  const raw = `${input ?? ""}`.trim();
  if (!raw) {
    return null;
  }

  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
  const withTimezone = /Z$|[+-]\d{2}:\d{2}$/.test(normalized) ? normalized : `${normalized}+08:00`;
  const date = new Date(withTimezone);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseNumberList(input: unknown): number[] {
  const text = `${input ?? ""}`.trim();
  if (!text) {
    return [];
  }

  return text
    .split(/[^\d]+/)
    .filter(Boolean)
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= 49);
}

function rowsFromPayload(payload: unknown): MacauApiRow[] {
  if (Array.isArray(payload)) {
    return payload.filter((value): value is MacauApiRow => typeof value === "object" && value !== null);
  }

  if (typeof payload === "object" && payload !== null) {
    const data = (payload as Record<string, unknown>).data;
    if (Array.isArray(data)) {
      return data.filter((value): value is MacauApiRow => typeof value === "object" && value !== null);
    }
  }

  return [];
}

function parseMacauRows(payload: unknown, source: string): CsvDrawRecord[] {
  const records: CsvDrawRecord[] = [];

  for (const row of rowsFromPayload(payload)) {
    const issueNo = normalizeIssueNo(row.expect ?? row.issueNo ?? row.issue ?? row.drawNo);
    const drawDate = normalizeDate(row.openTime ?? row.drawDate ?? row.date);
    const values = parseNumberList(row.openCode ?? row.numbers ?? row.result);

    if (!issueNo || !drawDate || values.length !== 7) {
      continue;
    }

    records.push({
      issueNo,
      drawDate,
      numbers: values.slice(0, 6),
      specialNumber: values[6],
      source,
    });
  }

  return records;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; new-macau-marksix-predictor/1.0)",
      accept: "application/json,text/plain,*/*",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch New Macau API: ${response.status} ${url}`);
  }

  return response.json();
}

function resolveHistoryYears(): number[] {
  const explicitYears = process.env.MACAU_HISTORY_YEARS?.split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value >= 2000 && value <= 2100);

  if (explicitYears && explicitYears.length > 0) {
    return unique(explicitYears).sort((a, b) => a - b);
  }

  const currentYear = currentMacauYear();
  const parsedFromYear = Number(process.env.MACAU_HISTORY_FROM_YEAR || currentYear - 2);
  const parsedToYear = Number(process.env.MACAU_HISTORY_TO_YEAR || currentYear);
  const toYear = Number.isInteger(parsedToYear) ? parsedToYear : currentYear;
  const fromYear = Number.isInteger(parsedFromYear) ? parsedFromYear : currentYear - 2;
  const safeFrom = Math.max(2000, Math.min(fromYear, toYear));
  const safeTo = Math.max(safeFrom, Math.min(toYear, 2100));

  return Array.from({ length: safeTo - safeFrom + 1 }, (_, index) => safeFrom + index);
}

function historyUrlForYear(year: number): string {
  const template = process.env.MACAU_HISTORY_API_TEMPLATE?.trim() || defaultHistoryTemplate();
  return template.replace("{year}", String(year));
}

function sortAndDedupe(records: CsvDrawRecord[]): CsvDrawRecord[] {
  const merged = new Map<string, CsvDrawRecord>();

  for (const record of records) {
    merged.set(record.issueNo, record);
  }

  return [...merged.values()].sort((a, b) => a.drawDate.getTime() - b.drawDate.getTime());
}

export async function loadMacauRecords(): Promise<CsvDrawRecord[]> {
  const latestUrl = process.env.MACAU_LATEST_API_URL?.trim() || defaultLatestUrl();
  const records: CsvDrawRecord[] = [];
  const errors: string[] = [];

  for (const year of resolveHistoryYears()) {
    const url = historyUrlForYear(year);
    try {
      const payload = await fetchJson(url);
      records.push(...parseMacauRows(payload, "new_macau_history_api"));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  try {
    const payload = await fetchJson(latestUrl);
    records.push(...parseMacauRows(payload, "new_macau_latest_api"));
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  const merged = sortAndDedupe(records);
  if (merged.length === 0) {
    throw new Error(`No New Macau draw records were loaded. ${errors.join(" | ")}`);
  }

  return merged;
}
