'use client'

/**
 * Wariant C „Nici" — każdy projekt to nić biegnąca przez miesiąc od pierwszego
 * do ostatniego wydarzenia. Kolor nici = projekt, koraliki = typy wydarzeń,
 * pogrubienie nici = dni zdjęciowe i postprodukcja. Projekt ma w tygodniu
 * własny tor, więc wątek czyta się poziomo, jak na osi czasu.
 */

import { groupChip, projectInk } from '@/lib/calendar-palette'
import { eventKind } from '@/lib/event-kinds'
import { daysBetween, dayKey } from '@/lib/calendar-layout'
import type { DemoEvent } from './demo-data'
import {
  WEEKDAYS,
  archivo,
  dimClass,
  eventEnd,
  formatDay,
  isRange,
  mono,
  projectsById,
  type CalendarVariant,
  type MonthGridProps,
} from './shared'

const LANE_HEIGHT = 31
/** Środek nici w torze (pod nazwą projektu). */
const LINE_Y = 22

interface ThreadLane {
  /** `null` = tor „firma" (wydarzenia bez projektu, bez nici). */
  projectId: string | null
  threadStart: string
  startCol: number
  endCol: number
  continuesBefore: boolean
  continuesAfter: boolean
  events: DemoEvent[]
}

/** Jeden tor na projekt aktywny w tygodniu; kolejność wg początku wątku. */
function threadLanes(events: DemoEvent[], week: string[]): ThreadLane[] {
  const weekStart = week[0]
  const weekEnd = week[6]
  const overlaps = (e: DemoEvent) => dayKey(e.start) <= weekEnd && eventEnd(e) >= weekStart

  const byProject = new Map<string, DemoEvent[]>()
  const business: DemoEvent[] = []
  events.forEach((e) => {
    if (!e.projectId) business.push(e)
    else byProject.set(e.projectId, [...(byProject.get(e.projectId) ?? []), e])
  })

  const lanes: ThreadLane[] = []
  byProject.forEach((list, projectId) => {
    const start = list.map((e) => dayKey(e.start)).sort()[0]
    const end = list.map(eventEnd).sort().at(-1)!
    if (start > weekEnd || end < weekStart) return
    lanes.push({
      projectId,
      threadStart: start,
      startCol: start < weekStart ? 0 : daysBetween(weekStart, start),
      endCol: end > weekEnd ? 6 : daysBetween(weekStart, end),
      continuesBefore: start < weekStart,
      continuesAfter: end > weekEnd,
      events: list.filter(overlaps),
    })
  })
  lanes.sort((a, b) => a.threadStart.localeCompare(b.threadStart) || a.projectId!.localeCompare(b.projectId!))

  const ownBusiness = business.filter(overlaps)
  if (ownBusiness.length) {
    lanes.push({
      projectId: null,
      threadStart: '',
      startCol: 0,
      endCol: 6,
      continuesBefore: false,
      continuesAfter: false,
      events: ownBusiness,
    })
  }
  return lanes
}

const colLeft = (col: number, offset = 0) => `calc(${col} * 100% / 7 + ${offset}px)`
const colRight = (col: number, offset = 0) => `calc(${6 - col} * 100% / 7 + ${offset}px)`

function Lane({
  lane,
  week,
  focusId,
  onFocusEvent,
}: {
  lane: ThreadLane
  week: string[]
  focusId: string | null
  onFocusEvent: (event: DemoEvent) => void
}) {
  const project = lane.projectId ? projectsById.get(lane.projectId) : undefined
  const ink = projectInk(project?.color)
  const anchor = (e: DemoEvent) => (dayKey(e.start) < week[0] ? 0 : daysBetween(week[0], e.start))

  const columns: DemoEvent[][] = Array.from({ length: 7 }, () => [])
  lane.events.forEach((e) => columns[anchor(e)].push(e))
  const ranges = lane.events.filter(isRange)

  return (
    <div className={`pointer-events-none relative ${dimClass(focusId, lane.projectId)}`} style={{ height: LANE_HEIGHT }}>
      {project && (
        <>
          <span
            className="absolute h-[2px]"
            style={{
              top: LINE_Y - 1,
              left: colLeft(lane.startCol, lane.continuesBefore ? 0 : 10),
              right: colRight(lane.endCol, lane.continuesAfter ? 0 : 10),
              background: ink,
              opacity: 0.5,
            }}
            aria-hidden
          />
          <span
            className="absolute top-[3px] truncate text-[10px] font-semibold leading-none"
            style={{
              ...archivo,
              color: ink,
              left: colLeft(lane.startCol, 8),
              maxWidth: `calc(${lane.endCol - lane.startCol + 1} * 100% / 7 - 12px)`,
            }}
          >
            {project.short}
          </span>
        </>
      )}
      {!project && (
        <span className="absolute left-2 top-[3px] text-[10px] leading-none text-zinc-500">firma</span>
      )}

      {ranges.map((e) => {
        const from = anchor(e)
        const to = Math.min(6, daysBetween(week[0], eventEnd(e)))
        return (
          <button
            key={`bar-${e.id}`}
            type="button"
            tabIndex={-1}
            onClick={() => onFocusEvent(e)}
            title={`${eventKind(e.kind).label}: ${e.title}`}
            className="pointer-events-auto absolute h-[8px] rounded-full outline-none"
            style={{
              top: LINE_Y - 4,
              left: colLeft(from, dayKey(e.start) < week[0] ? 0 : 6),
              right: colRight(to, eventEnd(e) > week[6] ? 0 : 6),
              background: project ? ink : 'oklch(0.55 0 0)',
            }}
          />
        )
      })}

      {columns.map((list, col) =>
        list.length ? (
          <div
            key={col}
            className="absolute flex items-center gap-[3px] overflow-hidden px-1"
            style={{ left: colLeft(col), width: 'calc(100% / 7)', top: LINE_Y - 7, height: 14 }}
          >
            {list.map((e) => {
              const kind = eventKind(e.kind)
              const chip = groupChip(kind.group)
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => onFocusEvent(e)}
                  title={`${kind.label}: ${e.title}${project ? ` (${project.name})` : ''}`}
                  className="pointer-events-auto flex size-2.5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold leading-none outline-none focus-visible:ring-2 focus-visible:ring-white/80 sm:h-[14px] sm:w-auto sm:px-1.5"
                  style={{ background: chip.bg, color: chip.text, boxShadow: '0 0 0 2px var(--background)' }}
                >
                  <span className="hidden sm:inline">{kind.short}</span>
                </button>
              )
            })}
          </div>
        ) : null
      )}
    </div>
  )
}

function MonthGrid({ weeks, events, monthPrefix, today, selectedDay, focusId, onSelectDay, onFocusEvent }: MonthGridProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.07]">
      <div className="grid grid-cols-7 border-b border-white/[0.07]">
        {WEEKDAYS.map((d, i) => (
          <div key={d} className={`px-2.5 py-1.5 text-[11px] ${i >= 5 ? 'text-zinc-600' : 'text-zinc-500'}`}>
            {d}
          </div>
        ))}
      </div>
      {weeks.map((week) => {
        const lanes = threadLanes(events, week)
        return (
          <div
            key={week[0]}
            className="grid grid-cols-7 border-b border-white/[0.07] last:border-b-0"
            style={{ gridTemplateRows: `28px ${lanes.length ? `repeat(${lanes.length}, ${LANE_HEIGHT}px)` : ''} 10px` }}
          >
            {week.map((day, col) => {
              const isToday = day === today
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => onSelectDay(day)}
                  aria-label={`${formatDay(day)}${isToday ? ', dziś' : ''}`}
                  aria-pressed={day === selectedDay}
                  className={`flex items-start border-r border-white/[0.04] px-2.5 pt-2 text-left outline-none last:border-r-0 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/50 ${
                    day === selectedDay ? 'bg-white/[0.05]' : isToday ? 'bg-primary/[0.06]' : 'hover:bg-white/[0.025]'
                  }`}
                  style={{ gridColumn: col + 1, gridRow: '1 / -1' }}
                >
                  <span
                    className={`text-[12px] leading-none ${
                      isToday
                        ? 'font-bold text-primary'
                        : day.startsWith(monthPrefix)
                          ? col >= 5
                            ? 'text-zinc-500'
                            : 'text-zinc-300'
                          : 'text-zinc-700'
                    }`}
                    style={mono}
                  >
                    {Number(day.slice(8))}
                  </span>
                </button>
              )
            })}
            {lanes.map((lane, i) => (
              <div key={lane.projectId ?? 'firma'} style={{ gridColumn: '1 / -1', gridRow: i + 2 }}>
                <Lane lane={lane} week={week} focusId={focusId} onFocusEvent={onFocusEvent} />
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

export const variantC: CalendarVariant = {
  id: 'c',
  name: 'Nici',
  summary:
    'Każdy projekt to nić biegnąca przez miesiąc od pierwszego do ostatniego wydarzenia, z własnym torem w każdym tygodniu. Kolor nici to projekt, koraliki to typy wydarzeń, a pogrubiona nić to dni zdjęciowe i postprodukcja.',
  square: false,
  MonthGrid,
  GroupSwatch: ({ group, on = true }) => {
    const chip = groupChip(group)
    return (
      <span
        className="size-2.5 shrink-0 rounded-full"
        style={{ background: on ? chip.bg : 'transparent', boxShadow: on ? undefined : `inset 0 0 0 1px ${chip.bg}` }}
        aria-hidden
      />
    )
  },
  KindMark: ({ kind }) => {
    const k = eventKind(kind)
    const chip = groupChip(k.group)
    return (
      <span
        className="shrink-0 rounded-full px-1.5 py-[2px] text-[10px] font-semibold leading-none"
        style={{ background: chip.bg, color: chip.text }}
      >
        {k.short}
      </span>
    )
  },
  PairSample: ({ color, group, label }) => {
    const ink = projectInk(color)
    const chip = groupChip(group)
    return (
      <span className="relative block h-[31px] w-[130px]">
        <span className="absolute left-1 top-[3px] text-[10px] font-semibold leading-none" style={{ ...archivo, color: ink }}>
          {color ? 'Projekt' : 'firma'}
        </span>
        {color && (
          <span className="absolute left-2 right-2 h-[2px]" style={{ top: LINE_Y - 1, background: ink, opacity: 0.5 }} />
        )}
        <span
          className="absolute left-1 rounded-full px-1.5 text-[10px] font-semibold leading-[14px]"
          style={{ top: LINE_Y - 7, background: chip.bg, color: chip.text, boxShadow: '0 0 0 2px var(--background)' }}
        >
          {label}
        </span>
        {color && (
          <span className="absolute right-6 h-[8px] w-10 rounded-full" style={{ top: LINE_Y - 4, background: ink }} />
        )}
      </span>
    )
  },
}
