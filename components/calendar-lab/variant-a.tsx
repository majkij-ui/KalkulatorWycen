'use client'

/**
 * Wariant A „Kafle" — pierwsza propozycja.
 * Projekt = ciemny kafel z kolorową krawędzią po lewej, typ = jasny chip z podpisem.
 */

import { NEUTRAL_TILE, groupChip, projectTile } from '@/lib/calendar-palette'
import { eventKind } from '@/lib/event-kinds'
import { hiddenPerDay, layoutWeek } from '@/lib/calendar-layout'
import type { DemoEvent } from './demo-data'
import { WEEKDAYS, dimClass, formatDay, mono, projectsById, type CalendarVariant, type MonthGridProps } from './shared'

const LANES = 3

function Tile({
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
  const tile = project ? projectTile(project.color) : NEUTRAL_TILE
  const chip = groupChip(kind.group)
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onFocus()
      }}
      title={`${kind.label}: ${event.title}${project ? ` (${project.name})` : ''}`}
      className={`relative z-10 flex h-full w-full min-w-0 items-center gap-1 overflow-hidden px-1 text-left text-[11px] font-medium leading-none outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
        continuesBefore ? 'rounded-l-none' : 'rounded-l-[5px]'
      } ${continuesAfter ? 'rounded-r-none' : 'rounded-r-[5px]'} ${dimClass(focusId, event.projectId)}`}
      style={{
        background: tile.bg,
        color: tile.text,
        boxShadow: continuesBefore ? undefined : `inset 3px 0 0 ${tile.edge}`,
        paddingLeft: continuesBefore ? 4 : 6,
      }}
    >
      <span
        className="hidden shrink-0 rounded-[3px] px-1 py-[2px] text-[10px] font-semibold sm:inline"
        style={{ background: chip.bg, color: chip.text }}
      >
        {kind.short}
      </span>
      <span className="hidden truncate sm:inline">{project?.short ?? event.title}</span>
    </button>
  )
}

function MonthGrid({ weeks, events, monthPrefix, today, selectedDay, focusId, onSelectDay, onFocusEvent }: MonthGridProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.07]">
      <div className="grid grid-cols-7 border-b border-white/[0.07] bg-white/[0.02]">
        {WEEKDAYS.map((d, i) => (
          <div key={d} className={`px-2 py-1.5 text-[11px] font-medium ${i >= 5 ? 'text-zinc-600' : 'text-zinc-500'}`}>
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
            className="grid grid-cols-7 gap-y-[3px] border-b border-white/[0.07] pb-1 last:border-b-0 [grid-template-rows:26px_repeat(3,8px)_14px] sm:[grid-template-rows:28px_repeat(3,21px)_16px]"
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
                  className={`flex items-start border-r border-white/[0.07] px-2 pt-1.5 text-left outline-none last:border-r-0 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/50 ${
                    col >= 5 ? 'bg-white/[0.012]' : ''
                  } ${day === selectedDay ? 'bg-white/[0.045]' : 'hover:bg-white/[0.025]'}`}
                  style={{ gridColumn: col + 1, gridRow: '1 / -1' }}
                >
                  <span
                    className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[12px] ${
                      isToday
                        ? 'bg-primary font-semibold text-primary-foreground'
                        : day.startsWith(monthPrefix)
                          ? 'text-zinc-300'
                          : 'text-zinc-700'
                    }`}
                    style={mono}
                  >
                    {Number(day.slice(8))}
                  </span>
                </button>
              )
            })}
            {segments
              .filter((s) => s.lane < LANES)
              .map((s) => (
                <div
                  key={`${s.item.id}-${week[0]}`}
                  className="min-w-0 px-[3px]"
                  style={{ gridColumn: `${s.startCol + 1} / span ${s.span}`, gridRow: s.lane + 2 }}
                >
                  <Tile
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
                  className="z-10 justify-self-start px-2 text-left text-[10px] font-semibold leading-none text-zinc-400 outline-none hover:text-zinc-100 focus-visible:underline sm:text-[11px]"
                  style={{ gridColumn: col + 1, gridRow: LANES + 2 }}
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

export const variantA: CalendarVariant = {
  id: 'a',
  name: 'Kafle',
  summary:
    'Pierwsza propozycja. Projekt to ciemny kafel z kolorową krawędzią po lewej, typ wydarzenia to jasny chip z podpisem.',
  square: false,
  MonthGrid,
  GroupSwatch: ({ group, on = true }) => {
    const chip = groupChip(group)
    return (
      <span
        className="size-2.5 shrink-0 rounded-[3px]"
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
        className="shrink-0 rounded-[3px] px-1 py-[2px] text-[10px] font-semibold leading-none"
        style={{ background: chip.bg, color: chip.text }}
      >
        {k.short}
      </span>
    )
  },
  PairSample: ({ color, group, label }) => {
    const tile = color ? projectTile(color) : NEUTRAL_TILE
    const chip = groupChip(group)
    return (
      <span
        className="flex h-[21px] w-[130px] items-center gap-1 rounded-[5px] px-1 pl-1.5 text-[11px] font-medium"
        style={{ background: tile.bg, color: tile.text, boxShadow: `inset 3px 0 0 ${tile.edge}` }}
      >
        <span
          className="rounded-[3px] px-1 py-[2px] text-[10px] font-semibold leading-none"
          style={{ background: chip.bg, color: chip.text }}
        >
          {label}
        </span>
        Projekt
      </span>
    )
  },
}
