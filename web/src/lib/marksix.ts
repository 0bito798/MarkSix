import { type Draw } from "@prisma/client";

export const ALL_NUMBERS = Array.from({ length: 49 }, (_, index) => index + 1);
export const ZODIAC_SEQUENCE = ["鼠", "牛", "虎", "兔", "龙", "蛇", "马", "羊", "猴", "鸡", "狗", "猪"] as const;

type ZodiacName = (typeof ZODIAC_SEQUENCE)[number];
type WaveColor = "红波" | "蓝波" | "绿波";

const YEAR_ZODIAC_SEQUENCE: ZodiacName[] = ["猴", "鸡", "狗", "猪", "鼠", "牛", "虎", "兔", "龙", "蛇", "马", "羊"];
const RED_WAVE = new Set([1, 2, 7, 8, 12, 13, 18, 19, 23, 24, 29, 30, 34, 35, 40, 45, 46]);
const BLUE_WAVE = new Set([3, 4, 9, 10, 14, 15, 20, 25, 26, 31, 36, 37, 41, 42, 47, 48]);
export const MACAU_ISSUE_PATTERN = /^\d{7}$/;

function modulo(value: number, base: number): number {
  return ((value % base) + base) % base;
}

export function decodeDrawNumbers(draw: Pick<Draw, "numbersJson">): number[] {
  return JSON.parse(draw.numbersJson) as number[];
}

export function inferYearFromIssue(issueNo: string, fallbackYear?: number): number {
  if (MACAU_ISSUE_PATTERN.test(issueNo)) {
    return Number(issueNo.slice(0, 4));
  }

  const match = issueNo.match(/^(\d{2})\//);
  if (!match) {
    return fallbackYear ?? new Date().getUTCFullYear();
  }

  const twoDigitYear = Number(match[1]);
  return twoDigitYear >= 80 ? 1900 + twoDigitYear : 2000 + twoDigitYear;
}

export function isMacauIssueNo(issueNo: string): boolean {
  return MACAU_ISSUE_PATTERN.test(issueNo);
}

export function macauIssueWhere() {
  return {
    issueNo: {
      gte: "2000000",
      lte: "2099999",
    },
  } as const;
}

export function nextMacauIssueNo(issueNo: string): string {
  if (!isMacauIssueNo(issueNo)) {
    return issueNo;
  }

  const year = Number(issueNo.slice(0, 4));
  const seq = Number(issueNo.slice(4));
  if (!Number.isInteger(year) || !Number.isInteger(seq)) {
    return issueNo;
  }

  const nextSeq = seq + 1;
  const issueCount = new Date(Date.UTC(year, 1, 29)).getUTCMonth() === 1 ? 366 : 365;
  if (nextSeq <= issueCount) {
    return `${year}${String(nextSeq).padStart(3, "0")}`;
  }

  return `${year + 1}001`;
}

export function getYearZodiac(year: number): ZodiacName {
  return YEAR_ZODIAC_SEQUENCE[modulo(year - 2004, 12)];
}

export function getZodiacForNumber(number: number, year: number): ZodiacName {
  const startIndex = ZODIAC_SEQUENCE.indexOf(getYearZodiac(year));
  return ZODIAC_SEQUENCE[modulo(startIndex - (number - 1), 12)];
}

export function getNumbersForZodiac(zodiac: ZodiacName, year: number): number[] {
  return ALL_NUMBERS.filter((number) => getZodiacForNumber(number, year) === zodiac);
}

export function getWaveColor(number: number): WaveColor {
  if (RED_WAVE.has(number)) {
    return "红波";
  }

  if (BLUE_WAVE.has(number)) {
    return "蓝波";
  }

  return "绿波";
}

export function getZoneIndex(number: number): number {
  if (number <= 10) {
    return 0;
  }
  if (number <= 20) {
    return 1;
  }
  if (number <= 30) {
    return 2;
  }
  if (number <= 40) {
    return 3;
  }
  return 4;
}

export function formatNumber(number: number): string {
  return String(number).padStart(2, "0");
}

export function describeSpecialNumber(number: number, year: number): string {
  return `${formatNumber(number)} · ${getZodiacForNumber(number, year)} · ${getWaveColor(number)}`;
}
