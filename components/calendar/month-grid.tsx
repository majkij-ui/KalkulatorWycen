'use client'

/**
 * Siatka miesiąca. Wydarzenia wielodniowe to paski przez kolejne dni (także
 * przez granicę tygodnia), maksymalnie 3 tory na tydzień, reszta jako
 * „+N więcej" pod dniem. Układ liczy `lib/calendar-layout.ts`.
 */

import { groupChip } from '@/lib/calendar-palette'
import { hiddenPerDay, layoutWeek } from '@/lib/calendar-layout'
import type { CalendarEntry } from '@/lib/calendar-entries'
import { eventKind } from '@/lib/event-kinds'
import type { Project } from '@/lib/project-types'
import { WEEKDAYS, formatDay, mono, tileFor } from './calendar-bits'

const LANES = 3

function entryLabel(entry: CalendarEntry, project: Project | undefined): string {
  if (project) return project.name
  if (entry.projectId) return entry.title || 'Usunięty projekt'
  return entry.title || eventKind(entry.kind).label
}

function Tile({
  entry,
  project,
  continuesBefore,
  continuesAfter,
  dimmed,
  onClick,
}: {
  entry: CalendarEntry
  project: Project | undefined
  continuesBefore: boolean
  continuesAfter: boolean
  dimmed: boolean
  onClick: () => void
}) {
  const kind = eventKind(entry.kind)
  const tile = tileFor(project)
  const chip = groupChip(kind.group)
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      title={`${kind.label}${entry.title ? `: ${entry.title}` : ''}${project ? ` (${project.name})` : ''}`}
      className={`relative z-10 flex h-full w-full min-w-0 items-center gap-1 overflow-hidden px-1 text-left text-[11px] font-medium leading-none outline-none transition-opacity duration-200 focus-visible:ring-2 focus-visible:ring-white/70 ${
        continuesBefore ? 'rounded-l-none' : 'rounded-l-[5px]'
      } ${continuesAfter ? 'rounded-r-none' : 'rounded-r-[5px]'} ${dimmed ? 'opacity-[0.18]' : 'opacity-100'}`}
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
      <span className="hidden truncate sm:inline">{entryLabel(entry, project)}</span>
    </button>
  )
}

export function MonthGrid({
  weeks,
  entries,
  projectsById,
  monthPrefix,
  today,
  selectedDay,
  focusId,
  onSelectDay,
  onEntryClick,
}: {
  weeks: string[][]
  entries: CalendarEntry[]
  projectsById: Map<string, Project>
  monthPrefix: string
  today: string
  selectedDay: string | null
  focusId: string | null
  onSelectDay: (day: string) => void
  onEntryClick: (entry: CalendarEntry) => void
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.07] bg-black/20">
      <div className="grid grid-cols-7 border-b border-white/[0.07] bg-white/[0.02]">
        {WEEKDAYS.map((d, i) => (
          <div key={d} className={`px-2 py-1.5 text-[11px] font-medium ${i >= 5 ? 'text-zinc-600' : 'text-zinc-500'}`}>
            {d}
          </div>
        ))}
      </div>
      {weeks.map((week) => {
        const segments = layoutWeek(entries, week)
        const hidden = hiddenPerDay(segments, LANES)
        return (
          <div
            key={week[0]}
            className="grid grid-cols-7 gap-y-[3px] border-b border-white/[0.07] pb-1 last:border-b-0 [grid-template-rows:26px_repeat(3,8px)_14px] sm:[grid-template-rows:28px_repeat(3,21px)_16px]"
          >
            {week.map((day, col) => {
              const isToday = day === today
              const isSelected = day === selectedDay
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => onSelectDay(day)}
                  aria-label={`${formatDay(day)}${isToday ? ', dziś' : ''}`}
                  aria-pressed={isSelected}
                  className={`flex items-start border-r border-white/[0.07] px-2 pt-1.5 text-left outline-none last:border-r-0 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/50 ${
                    col >= 5 ? 'bg-white/[0.012]' : ''
                  } ${isSelected ? 'bg-white/[0.045]' : 'hover:bg-white/[0.025]'}`}
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
                    entry={s.item}
                    project={s.item.projectId ? projectsById.get(s.item.projectId) : undefined}
                    continuesBefore={s.continuesBefore}
                    continuesAfter={s.continuesAfter}
                    dimmed={!!focusId && s.item.projectId !== focusId}
                    onClick={() => onEntryClick(s.item)}
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
