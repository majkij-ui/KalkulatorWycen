'use client'

/**
 * Wątek projektu: liczby wyliczone z wydarzeń (`thread-stats.ts`) i oś czasu.
 * Otwiera się klikiem w kafel — reszta kalendarza jest wtedy przygaszona.
 * `ThreadStatsList` i `ThreadTimeline` pokazuje też zakładka „Oś czasu" projektu.
 */

import { FolderOpen, Plus, X } from 'lucide-react'
import { groupChip, type TileColors } from '@/lib/calendar-palette'
import type { CalendarEntry } from '@/lib/calendar-entries'
import { eventKind } from '@/lib/event-kinds'
import type { Project } from '@/lib/project-types'
import { describeThreadStats, threadStats } from '@/lib/thread-stats'
import { ProjectStatusBadge } from '@/components/projects/project-status-badge'
import { KindChip, ProjectSwatch, archivo, formatDay, mono, tileFor, timeOf } from './calendar-bits'

/** Liczby wątku („Odpowiedź po 4 h", „Zapłacono po 23 dniach") na kaflu w kolorze projektu. */
export function ThreadStatsList({
  entries,
  today,
  tile,
  inline = false,
  className = '',
}: {
  entries: CalendarEntry[]
  today: string
  tile: TileColors
  /** W jednym wierszu (nagłówek osi czasu projektu) zamiast listy. */
  inline?: boolean
  className?: string
}) {
  const stats = describeThreadStats(threadStats(entries, today))
  if (stats.length === 0) return null
  return (
    <ul
      className={`${
        inline ? 'flex flex-wrap gap-x-5 gap-y-1' : 'space-y-1'
      } rounded-lg px-3 py-2.5 text-sm ${className}`}
      style={{ background: tile.bg, color: tile.text, boxShadow: inline ? `inset 3px 0 0 ${tile.edge}` : undefined }}
    >
      {stats.map((s) => (
        <li key={s}>{s}</li>
      ))}
    </ul>
  )
}

/** Oś czasu: wydarzenia wątku od najstarszego, przyszłe przygaszone. */
export function ThreadTimeline({
  entries,
  today,
  tile,
  onEdit,
}: {
  entries: CalendarEntry[]
  today: string
  tile: TileColors
  onEdit: (entry: CalendarEntry) => void
}) {
  return (
    <ol className="relative space-y-1 pl-5">
      <span
        className="absolute bottom-3 left-[5px] top-3 w-px"
        style={{ background: tile.edge, opacity: 0.4 }}
        aria-hidden
      />
      {entries.map((entry) => {
        const chip = groupChip(eventKind(entry.kind).group)
        const time = timeOf(entry.start)
        const future = entry.start.slice(0, 10) > today
        return (
          <li key={entry.id} className={`relative ${future ? 'opacity-60' : ''}`}>
            <span
              className="absolute -left-5 top-3 size-[11px] rounded-full border-2"
              style={{ background: future ? 'var(--background)' : chip.bg, borderColor: chip.bg }}
              aria-hidden
            />
            <button
              type="button"
              onClick={() => onEdit(entry)}
              className="w-full rounded-md px-1.5 py-1.5 text-left outline-none hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-white/50"
            >
              <span className="block text-xs text-zinc-500" style={mono}>
                {formatDay(entry.start)}
                {entry.end && entry.end.slice(0, 10) !== entry.start.slice(0, 10) && ` – ${formatDay(entry.end)}`}
                {time && `, ${time}`}
              </span>
              <span className="mt-0.5 flex items-center gap-2 text-sm text-zinc-100">
                <KindChip kind={entry.kind} />
                <span className="min-w-0 truncate">{entry.title || eventKind(entry.kind).label}</span>
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

export function ThreadPanel({
  project,
  entries,
  today,
  onClose,
  onAdd,
  onEdit,
  onOpenProject,
}: {
  project: Project
  entries: CalendarEntry[]
  today: string
  onClose: () => void
  onAdd: () => void
  onEdit: (entry: CalendarEntry) => void
  onOpenProject: () => void
}) {
  const tile = tileFor(project)
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs text-zinc-500">
            <ProjectSwatch project={project} />
            {project.client || 'Bez klienta'}
          </p>
          <h2 className="mt-1 text-xl font-semibold leading-tight text-white" style={archivo}>
            {project.name}
          </h2>
          <div className="mt-2">
            <ProjectStatusBadge status={project.status} />
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Zamknij wątek"
          className="rounded-md p-1 text-zinc-500 outline-none hover:bg-white/5 hover:text-zinc-200 focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={onAdd}
          className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-white/70"
        >
          <Plus className="size-3.5" />
          Dodaj do wątku
        </button>
        <button
          type="button"
          onClick={onOpenProject}
          className="flex items-center gap-1 rounded-md border border-white/10 px-2.5 py-1 text-xs font-semibold text-zinc-300 outline-none hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <FolderOpen className="size-3.5" />
          Otwórz projekt
        </button>
      </div>

      <ThreadStatsList entries={entries} today={today} tile={tile} className="mt-4" />

      {entries.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">Ten projekt nie ma jeszcze wydarzeń w kalendarzu.</p>
      ) : (
        <div className="mt-5">
          <ThreadTimeline entries={entries} today={today} tile={tile} onEdit={onEdit} />
        </div>
      )}
    </div>
  )
}
