'use client'

/**
 * Wariant B „Montażówka" — miesiąc jak oś czasu w programie do montażu.
 * Prostokątne klipy bez zaokrągleń: projekt = pełne wypełnienie klipu, typ =
 * pasek wzdłuż GÓRNEJ krawędzi + podpis. Dziś = pomarańczowy playhead.
 */

import { clipColors, groupChip } from '@/lib/calendar-palette'
import { eventKind } from '@/lib/event-kinds'
import { hiddenPerDay, layoutWeek } from '@/lib/calendar-layout'
import type { DemoEvent } from './demo-data'
import { WEEKDAYS, dimClass, formatDay, mono, projectsById, type CalendarVariant, type MonthGridProps } from './shared'

const LANES = 3
/** Szew między klipami: ciemna szczelina jak na osi montażowej. */
const SEAM = 'rgba(0,0,0,0.55)'

function Clip({
  event,
  continuesBefore,
  continuesAfter,
  focusId,
  onFocus,
}: {
  event: DemoEvent
  continuesBefore: boolean
  continuesAfter: boolean
  focusId: string | null
  onFocus: () => void
}) {
  const kind = eventKind(event.kind)
  const project = event.projectId ? projectsById.get(event.projectId) : undefined
  const clip = clipColors(project?.color)
  const band = groupChip(kind.group).bg
  // Punkty wejścia/wyjścia klipu mają ciemny szew; krawędź, przez którą klip
  // przechodzi do kolejnego tygodnia, jest otwarta (bez szwu).
  const shadows = [
    `inset 0 3px 0 ${band}`,
    continuesBefore ? null : `inset 1px 0 0 ${SEAM}`,
    continuesAfter ? null : `inset -1px 0 0 ${SEAM}`,
  ].filter(Boolean)
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onFocus()
      }}
      title={`${kind.label}: ${event.title}${project ? ` (${project.name})` : ''}`}
      className={`relative z-10 flex h-full w-full min-w-0 items-center gap-1.5 overflow-hidden px-1.5 pt-[3px] text-left text-[11px] leading-none outline-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-white ${dimClass(focusId, event.projectId)}`}
      style={{ background: clip.fill, color: clip.text, boxShadow: shadows.join(', ') }}
    >
      <span className="hidden shrink-0 font-semibold sm:inline">{kind.short}</span>
      <span className="hidden truncate opacity-80 sm:inline">{project?.short ?? event.title}</span>
    </button>
  )
}

function MonthGrid({ weeks, events, monthPrefix, today, selectedDay, focusId, onSelectDay, onFocusEvent }: MonthGridProps) {
  return (
    <div className="border border-white/[0.1] bg-[oklch(0.135_0.004_260)]">
      <div className="grid grid-cols-7 border-b border-white/[0.1]">
        {WEEKDAYS.map((d, i) => (
          <div
            key={d}
            className={`border-r border-white/[0.06] px-2 py-1 text-[10px] last:border-r-0 ${i >= 5 ? 'text-zinc-600' : 'text-zinc-500'}`}
            style={mono}
          >
            {d}
          </div>
        ))}
      </div>
      {weeks.map((week) => {
        const segments = layoutWeek(events, week)
        const hidden = hiddenPerDay(segments, LANES)
        return (
          <div
            key={week[0]}
            className="grid grid-cols-7 gap-y-px border-b border-white/[0.1] pb-1 last:border-b-0 [grid-template-rows:24px_repeat(3,8px)_14px] sm:[grid-template-rows:24px_repeat(3,22px)_16px]"
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
                  className={`relative flex items-start border-r border-white/[0.06] text-left outline-none last:border-r-0 focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-white/60 ${
                    day === selectedDay ? 'bg-white/[0.05] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)]' : 'hover:bg-white/[0.025]'
                  } ${col >= 5 && day !== selectedDay ? 'bg-black/30' : ''}`}
                  style={{ gridColumn: col + 1, gridRow: '1 / -1' }}
                >
                  {isToday && <span className="absolute inset-y-0 left-0 z-20 w-[2px] bg-primary" aria-hidden />}
                  <span
                    className={`px-1.5 py-[3px] text-[11px] leading-none ${
                      isToday
                        ? 'bg-primary font-semibold text-primary-foreground'
                        : inMonth
                          ? 'text-zinc-400'
                          : 'text-zinc-700'
                    }`}
                    style={mono}
                  >
                    {String(Number(day.slice(8))).padStart(2, '0')}
                  </span>
                </button>
              )
            })}
            {segments
              .filter((s) => s.lane < LANES)
              .map((s) => (
                <div
                  key={`${s.item.id}-${week[0]}`}
                  className="min-w-0"
                  style={{
                    gridColumn: `${s.startCol + 1} / span ${s.span}`,
                    gridRow: s.lane + 2,
                    paddingLeft: s.continuesBefore ? 0 : 2,
                    paddingRight: s.continuesAfter ? 0 : 2,
                  }}
                >
                  <Clip
                    event={s.item}
                    continuesBefore={s.continuesBefore}
                    continuesAfter={s.continuesAfter}
                    focusId={focusId}
                    onFocus={() => onFocusEvent(s.item)}
                  />
                </div>
              ))}
            {hidden.map((n, col) =>
              n > 0 ? (
                <button
                  key={`more-${col}`}
                  type="button"
                  onClick={() => onSelectDay(week[col])}
                  className="z-10 justify-self-start px-1.5 text-left text-[10px] leading-none text-zinc-400 outline-none hover:text-zinc-100 focus-visible:underline sm:text-[11px]"
                  style={{ ...mono, gridColumn: col + 1, gridRow: LANES + 2 }}
                >
                  +{n}
                  <span className="hidden sm:inline"> więcej</span>
                </button>
              ) : null
            )}
          </div>
        )
      })}
    </div>
  )
}

export const variantB: CalendarVariant = {
  id: 'b',
  name: 'Montażówka',
  summary:
    'Miesiąc jak oś czasu w programie do montażu: prostokątne klipy, zero zaokrągleń. Projekt to pełne wypełnienie klipu, typ wydarzenia to pasek wzdłuż górnej krawędzi i podpis. Dzisiejszy dzień zaznacza pomarańczowy playhead.',
  square: true,
  MonthGrid,
  GroupSwatch: ({ group, on = true }) => {
    const band = groupChip(group).bg
    return (
      <span
        className="h-2.5 w-3.5 shrink-0"
        style={{
          background: on ? 'oklch(0.36 0 0)' : 'transparent',
          boxShadow: on ? `inset 0 3px 0 ${band}` : `inset 0 0 0 1px ${band}`,
        }}
        aria-hidden
      />
    )
  },
  KindMark: ({ kind }) => {
    const k = eventKind(kind)
    const chip = groupChip(k.group)
    return (
      <span
        className="shrink-0 px-1 py-[2px] text-[10px] font-semibold leading-none"
        style={{ background: chip.bg, color: chip.text }}
      >
        {k.short}
      </span>
    )
  },
  PairSample: ({ color, group, label }) => {
    const clip = clipColors(color)
    const band = groupChip(group).bg
    return (
      <span
        className="flex h-[22px] w-[130px] items-center gap-1.5 px-1.5 pt-[3px] text-[11px] leading-none"
        style={{
          background: clip.fill,
          color: clip.text,
          boxShadow: `inset 0 3px 0 ${band}, inset 1px 0 0 ${SEAM}, inset -1px 0 0 ${SEAM}`,
        }}
      >
        <span className="font-semibold">{label}</span>
        <span className="opacity-80">Projekt</span>
      </span>
    )
  },
}
