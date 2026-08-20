import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import { ToolInvocationError } from "@/lib/agent/tools/errors";

dayjs.extend(utc);
dayjs.extend(timezone);

export function assertIanaTimezone(value: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
  } catch {
    throw new ToolInvocationError("validation_error", "timezone 必须是有效的 IANA 时区", false, [
      { field: "timezone", code: "invalid_timezone", message: "例如 Asia/Shanghai" },
    ]);
  }
}

export function startOfLocalDate(dateOnly: string, timezoneName: string): Date {
  return dayjs.tz(`${dateOnly}T00:00:00`, timezoneName).toDate();
}

export function endExclusiveOfLocalDate(dateOnly: string, timezoneName: string): Date {
  return dayjs.tz(`${dateOnly}T00:00:00`, timezoneName).add(1, "day").toDate();
}

export function addDaysToDateOnly(dateOnly: string, days: number): string {
  return dayjs.utc(`${dateOnly}T00:00:00Z`).add(days, "day").format("YYYY-MM-DD");
}

export function dateOnlyUtc(dateOnly: string): Date {
  return dayjs.utc(`${dateOnly}T00:00:00Z`).toDate();
}

/** 周一至周五计为工作日；法定节假日尚未接入企业日历，调用方必须保留该口径说明。 */
export function countWeekdaysInclusive(dateFrom: string, dateTo: string): number {
  let cursor = dayjs.utc(`${dateFrom}T00:00:00Z`);
  const end = dayjs.utc(`${dateTo}T00:00:00Z`);
  let count = 0;
  while (!cursor.isAfter(end, "day")) {
    const day = cursor.day();
    if (day !== 0 && day !== 6) count += 1;
    cursor = cursor.add(1, "day");
  }
  return count;
}
