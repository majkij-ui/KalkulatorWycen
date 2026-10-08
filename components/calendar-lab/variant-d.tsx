'use client'

/**
 * Wariant D „Agenda" — prawie bez wypełnień, jak papierowy planer.
 * Typ = KSZTAŁT i kolor znacznika (koło, kwadrat, trójkąt, romb, plus), więc
 * typ czyta się nawet bez rozróżniania kolorów. Projekt = kolor nazwy.
 * Wydarzenia wielodniowe to cienka linia w kolorze projektu nad listą dnia.
 */

import { EVENT_GROUPS, groupChip, projectInk, type EventGroup } from '@/lib/calendar-palette'
import { eventKind } from '@/lib/event-kinds'
import { daysBetween, dayKey, layoutWeek } from '@/lib/calendar-layout'
import { dayLabel } from '@/lib/pl-plural'
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

const MAX_ITEMS = 4

const GLYPHS: Record<EventGroup, string> = {
  sprzedaz: 'M5 0.8a4.2 4.2 0 1 1 0 8.4a4.2 4.2 0 1 1 0-8.4Z',
  produkcja: 'M1 1h8v8H1Z',
  post: 'M5 0.6L9.6 9.2H0.4Z',
  pieniadze: 'M5 0.2L9.8 5L5 9.8L0.2 5Z',
  firma: 'M3.7 0.6h2.6v3.1h3.1v2.6H6.3v3.1H3.7V6.3H0.6V3.7h3.1Z',
  inne: 'M0.6 3.7h8.8v2.6H0.6Z',
}

function Glyph({ group, size = 9, muted = false }: { group: EventGroup; size?: number; muted?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 10 10"
      className="shrink-0"
      style={{ opacity: muted ? 0.35 : 1 }}
      aria-hidden
    >
      <path d={GLYPHS[group]} fill={groupChip(group).bg} />
    </svg>
  )
}

const groupOrder = (e: DemoEvent) => EVENT_GROUPS.indexOf(eventKind(e.kind).group)

function MonthGrid({ weeks, events, monthPrefix, today, selectedDay, focusId, onSelectDay, onFocusEvent }: MonthGridProps) {
  return (
    <div>
      <div className="grid grid-cols-7 border-b border-white/[0.12] pb-2">
        {WEEKDAYS.map((d, i) => (
          <div key={d} className={`px-2 text-[11px] ${i >= 5 ? 'text-zinc-600' : 'text-zinc-500'}`}>
            {d}
          </div>
        ))}
      </div>
      {weeks.map((week) => {
        const rules = layoutWeek(events.filter(isRange), week)
        const ruleLanes = rules.reduce((max, s) => Math.max(max, s.lane + 1), 0)
        const listRow = ruleLanes + 2
        return (
          <div
            key={week[0]}
            className="grid grid-cols-7 border-b border-white/[0.07]"
            style={{ gridTemplateRows: `38px ${ruleLanes ? `repeat(${ruleLanes}, 6px)` : ''} minmax(72px, auto)` }}
          >
            {week.map((day, col) => {
              const isToday = day === today
              const inMonth = day.startsWith(monthPrefix)
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => onSelectDay(day)}
                  aria-label={`${formatDay(day)}${isToday ? ', dziś' : ''}`}
                  aria-pressed={day === selectedDay}
                  className={`m-[2px] flex items-start gap-1.5 rounded-lg px-2 pt-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-white/50 ${
                    day === selectedDay ? 'bg-white/[0.05]' : 'hover:bg-white/[0.025]'
                  }`}
                  style={{ gridColumn: col + 1, gridRow: '1 / -1' }}
                >
                  <span
                    className={`text-[22px] leading-none ${
                      isToday
                        ? 'font-semibold text-primary'
                        : inMonth
                          ? col >= 5
                            ? 'font-light text-zinc-500'
                            : 'font-light text-zinc-200'
                          : 'font-light text-zinc-700'
                    }`}
                    style={archivo}
                  >
                    {Number(day.slice(8))}
                  </span>
                  {isToday && <span className="pt-[3px] text-[10px] font-semibold text-primary">dziś</span>}
                </button>
              )
            })}

            {rules.map((s) => {
              const project = s.item.projectId ? projectsById.get(s.item.projectId) : undefined
              return (
                <button
                  key={`rule-${s.item.id}`}
                  type="button"
                  tabIndex={-1}
                  onClick={() => onFocusEvent(s.item)}
                  title={`${eventKind(s.item.kind).label}: ${s.item.title}`}
                  className={`z-10 h-[3px] self-center outline-none ${s.continuesBefore ? '' : 'ml-2 rounded-l-full'} ${
                    s.continuesAfter ? '' : 'mr-2 rounded-r-full'
                  } ${dimClass(focusId, s.item.projectId)}`}
                  style={{
                    gridColumn: `${s.startCol + 1} / span ${s.span}`,
                    gridRow: s.lane + 2,
                    background: projectInk(project?.color),
                  }}
                />
              )
            })}

            {week.map((day, col) => {
              const items = events
                .filter((e) => dayKey(e.start) === day || (col === 0 && dayKey(e.start) < day && eventEnd(e) >= day))
                .sort((a, b) => groupOrder(a) - groupOrder(b) || a.start.localeCompare(b.start))
              if (!items.length) return null
              const shown = items.slice(0, items.length > MAX_ITEMS ? MAX_ITEMS - 1 : MAX_ITEMS)
              const rest = items.length - shown.length
              return (
                <ul
                  key={`list-${day}`}
                  className="pointer-events-none z-10 flex min-w-0 flex-col gap-[3px] px-2.5 pb-2 pt-1.5"
                  style={{ gridColumn: col + 1, gridRow: listRow }}
                >
                  {shown.map((e) => {
                    const kind = eventKind(e.kind)
                    const project = e.projectId ? projectsById.get(e.projectId) : undefined
                    const continued = dayKey(e.start) < day
                    const length = daysBetween(e.start, eventEnd(e)) + 1
                    return (
                      <li key={e.id} className={dimClass(focusId, e.projectId)}>
                        <button
                          type="button"
                          onClick={() => onFocusEvent(e)}
                          title={`${kind.label}: ${e.title}${project ? ` (${project.name})` : ''}`}
                          className="pointer-events-auto flex w-full min-w-0 items-center gap-1.5 rounded-sm text-left text-[11.5px] leading-tight outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                        >
                          <Glyph group={kind.group} />
                          <span
                            className={`hidden min-w-0 shrink-[0.15] truncate sm:inline ${project ? 'font-medium' : 'text-zinc-400'}`}
                            style={project ? { color: projectInk(project.color) } : undefined}
                          >
                            {project?.short ?? e.title}
                          </span>
                          {project && (
                            <span className="hidden min-w-0 truncate text-[10px] text-zinc-500 sm:inline">
                              {kind.short}
                              {isRange(e) && (
                                <span style={mono}> {continued ? 'cd.' : `${length} ${dayLabel(length)}`}</span>
                              )}
                            </span>
                          )}
                        </button>
                      </li>
                    )
                  })}
                  {rest > 0 && (
                    <li>
                      <button
                        type="button"
                        onClick={() => onSelectDay(day)}
                        className="pointer-events-auto text-[11px] text-zinc-500 outline-none hover:text-zinc-200 focus-visible:underline"
                      >
                        +{rest} więcej
                      </button>
                    </li>
                  )}
                </ul>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

export const variantD: CalendarVariant = {
  id: 'd',
  name: 'Agenda',
  summary:
    'Prawie bez wypełnień, jak papierowy planer. Typ wydarzenia to kształt i kolor znacznika: koło sprzedaż, kwadrat produkcja, trójkąt postprodukcja, romb pieniądze, plus firma. Projekt to kolor nazwy, a wydarzenia wielodniowe to cienka linia nad listą dnia.',
  square: false,
  MonthGrid,
  GroupSwatch: ({ group, on = true }) => <Glyph group={group} size={10} muted={!on} />,
  KindMark: ({ kind }) => {
    const k = eventKind(kind)
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium" style={{ color: groupChip(k.group).bg }}>
        <Glyph group={k.group} />
        {k.short}
      </span>
    )
  },
  PairSample: ({ color, group, label }) => {
    const ink = projectInk(color)
    return (
      <span className="flex w-[130px] flex-col gap-1.5 py-0.5">
        <span className="flex items-center gap-1.5 text-[11.5px] leading-tight">
          <Glyph group={group} />
          <span className="font-medium" style={{ color: ink }}>
            {color ? 'Projekt' : 'Firma'}
          </span>
          <span className="text-[10px] text-zinc-500">{label}</span>
        </span>
        <span className="mx-0.5 h-[3px] rounded-full" style={{ background: ink }} />
      </span>
    )
  },
}
