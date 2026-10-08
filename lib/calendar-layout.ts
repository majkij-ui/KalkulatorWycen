/**
 * Układ siatki miesiąca: tygodnie od poniedziałku i pakowanie wydarzeń
 * (także wielodniowych) w „tory" w obrębie tygodnia.
 *
 * Daty to klucze `YYYY-MM-DD` (ewentualnie z `THH:mm` — godzina jest tu
 * ignorowana). Liczymy w UTC, żeby zmiana czasu letniego nie gubiła dnia.
 * Moduł czysty — testy w `calendar-layout.test.ts`.
 */

export interface CalendarItem {
  id: string
  /** `YYYY-MM-DD` lub `YYYY-MM-DDTHH:mm`. */
  start: string
  /** Ostatni dzień, WŁĄCZNIE. Brak = jednodniowe. */
  end?: string
}

export interface WeekSegment<T extends CalendarItem> {
  item: T
  /** Kolumna 0–6 (pon–nd). */
  startCol: number
  /** Liczba kolumn, ≥ 1. */
  span: number
  /** Tor (wiersz) w obrębie tygodnia, od 0. */
  lane: number
  /** Wydarzenie zaczęło się przed tym tygodniem. */
  continuesBefore: boolean
  /** Wydarzenie trwa dalej po tym tygodniu. */
  continuesAfter: boolean
}

export function dayKey(value: string): string {
  return value.slice(0, 10)
}

function toUtc(key: string): Date {
  const [y, m, d] = dayKey(key).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function fromUtc(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function addDays(key: string, days: number): string {
  const date = toUtc(key)
  date.setUTCDate(date.getUTCDate() + days)
  return fromUtc(date)
}

/** Liczba pełnych dni między kluczami (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86_400_000)
}

/**
 * Tygodnie (pon–nd) pokrywające cały miesiąc. `month` 1–12.
 * Zwraca 4–6 tygodni po 7 kluczy; dni spoza miesiąca też są w siatce.
 */
export function monthGrid(year: number, month: number): string[][] {
  const first = new Date(Date.UTC(year, month - 1, 1))
  const mondayOffset = (first.getUTCDay() + 6) % 7
  let cursor = addDays(fromUtc(first), -mondayOffset)
  const lastOfMonth = fromUtc(new Date(Date.UTC(year, month, 0)))

  const weeks: string[][] = []
  while (cursor <= lastOfMonth) {
    const week = Array.from({ length: 7 }, (_, i) => addDays(cursor, i))
    weeks.push(week)
    cursor = addDays(cursor, 7)
  }
  return weeks
}

/**
 * Tnie wydarzenia na odcinki w danym tygodniu i pakuje je w tory zachłannie:
 * najpierw wcześniejsze, przy remisie dłuższe (paski wielodniowe trzymają się
 * górnych torów, więc nie „skaczą" między wierszami).
 */
export function layoutWeek<T extends CalendarItem>(items: T[], week: string[]): WeekSegment<T>[] {
  const weekStart = week[0]
  const weekEnd = week[week.length - 1]

  const visible = items
    .map((item) => {
      const start = dayKey(item.start)
      const end = item.end && dayKey(item.end) >= start ? dayKey(item.end) : start
      return { item, start, end }
    })
    .filter(({ start, end }) => start <= weekEnd && end >= weekStart)
    .map(({ item, start, end }) => {
      const clippedStart = start < weekStart ? weekStart : start
      const clippedEnd = end > weekEnd ? weekEnd : end
      return {
        item,
        startCol: daysBetween(weekStart, clippedStart),
        span: daysBetween(clippedStart, clippedEnd) + 1,
        continuesBefore: start < weekStart,
        continuesAfter: end > weekEnd,
      }
    })
    .sort((a, b) => a.startCol - b.startCol || b.span - a.span || a.item.id.localeCompare(b.item.id))

  /** Ostatnia zajęta kolumna w każdym torze. */
  const laneEnds: number[] = []
  return visible.map((segment) => {
    let lane = laneEnds.findIndex((endCol) => endCol < segment.startCol)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(-1)
    }
    laneEnds[lane] = segment.startCol + segment.span - 1
    return { ...segment, lane }
  })
}

/**
 * Ile odcinków NIE mieści się w `visibleLanes` torach — per dzień tygodnia.
 * Służy do napisu „+N więcej" pod komórką dnia.
 */
export function hiddenPerDay<T extends CalendarItem>(
  segments: WeekSegment<T>[],
  visibleLanes: number
): number[] {
  const hidden = Array<number>(7).fill(0)
  segments.forEach((segment) => {
    if (segment.lane < visibleLanes) return
    for (let col = segment.startCol; col < segment.startCol + segment.span; col++) hidden[col]++
  })
  return hidden
}
