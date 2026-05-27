import { parse } from "csv-parse/sync";
import fs from "node:fs";
import path from "node:path";
import { type CsvDrawRecord } from "@/lib/types";

const ISSUE_KEYS = ["期号", "期數", "expect", "issueNo", "issue_no"];
const DATE_KEYS = ["日期", "openTime", "date", "drawDate", "draw_date"];
const COMBINED_NUMBERS_KEYS = ["中奖号码", "中獎號碼", "openCode", "numbers", "result"];
const SPECIAL_KEYS = ["特别号码", "特別號碼"];

function normalizeHeaderKey(key: string): string {
  return key.replace(/\uFEFF/g, "").trim();
}

function pickValue(row: Record<string, string>, keys: string[]): string | undefined {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null && `${row[k]}`.trim() !== "") {
      return `${row[k]}`.trim();
    }
  }
  return undefined;
}

function parseNumbers(value: string): number[] {
  return value
    .split(",")
    .map((n) => Number(n.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 49);
}

function parseDrawDate(value?: string): Date | null {
  if (!value) {
    return null;
  }

  const text = value.trim();
  if (!text) {
    return null;
  }

  const normalized = text.includes("T") ? text : text.replace(" ", "T");
  const dateText = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? `${text}T12:00:00Z`
    : /Z$|[+-]\d{2}:\d{2}$/.test(normalized)
      ? normalized
      : `${normalized}+08:00`;
  const date = new Date(dateText);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseSplitNumberColumns(row: Record<string, string>): number[] {
  const n1Key = ["中奖号码 1", "中獎號碼 1", "1"].find(
    (k) => row[k] !== undefined && `${row[k]}`.trim() !== "",
  );
  if (!n1Key) {
    return [];
  }

  const keys = [n1Key, "2", "3", "4", "5", "6"];
  if (keys.some((k) => row[k] === undefined || `${row[k]}`.trim() === "")) {
    return [];
  }

  return keys
    .map((k) => Number(`${row[k]}`.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 49);
}

export function parseDrawCsv(csvRaw: string): CsvDrawRecord[] {
  const records = parse(csvRaw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  return records
    .map((rawRow) => {
      const row: Record<string, string> = {};
      for (const [k, v] of Object.entries(rawRow)) {
        row[normalizeHeaderKey(k)] = v;
      }

      const issueNo = pickValue(row, ISSUE_KEYS);
      const drawDateText = pickValue(row, DATE_KEYS);
      const drawDate = parseDrawDate(drawDateText);

      let numbers: number[] = [];
      const combined = pickValue(row, COMBINED_NUMBERS_KEYS);
      if (combined) {
        numbers = parseNumbers(combined);
        if (numbers.length >= 7) {
          numbers = numbers.slice(0, 6);
        }
      } else {
        numbers = parseSplitNumberColumns(row);
      }

      const specialText = pickValue(row, SPECIAL_KEYS);
      const specialNumber = Number(specialText ?? (combined ? parseNumbers(combined)[6] : undefined));

      if (!issueNo || !drawDate || Number.isNaN(drawDate.getTime())) {
        return null;
      }
      if (numbers.length !== 6) {
        return null;
      }
      if (!Number.isInteger(specialNumber) || specialNumber < 1 || specialNumber > 49) {
        return null;
      }

      return {
        issueNo,
        drawDate,
        numbers,
        specialNumber,
      } satisfies CsvDrawRecord;
    })
    .filter((v): v is CsvDrawRecord => Boolean(v))
    .sort((a, b) => a.drawDate.getTime() - b.drawDate.getTime());
}

export function readLocalCsv(filePath: string): string {
  const full = path.resolve(process.cwd(), filePath);
  return fs.readFileSync(full, "utf8");
}
