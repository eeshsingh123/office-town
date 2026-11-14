// A plan window's length in minutes, named as the Usage page knows them. ChatGPT Free reports
// one 30-day window (43200 minutes) and no 5-hour or weekly one.
export function usageWindow(minutes: number): { id: string; label: string } {
  if (minutes === 300) return { id: "five_hour", label: "5 hours" };
  if (minutes === 10080) return { id: "seven_day", label: "week" };
  if (minutes >= 28 * 1440 && minutes <= 31 * 1440) return { id: "month", label: "month" };
  if (minutes > 0 && minutes % 1440 === 0) {
    const days = minutes / 1440;
    return { id: `${days}_day`, label: days === 1 ? "day" : `${days} days` };
  }
  if (minutes > 0 && minutes % 60 === 0) {
    const hours = minutes / 60;
    return { id: `${hours}_hour`, label: hours === 1 ? "hour" : `${hours} hours` };
  }
  return { id: `${minutes}_minutes`, label: `${minutes} minutes` };
}
