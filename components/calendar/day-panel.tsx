'use client'

import { Plus, Waypoints } from 'lucide-react'
import type { CalendarEntry } from '@/lib/calendar-entries'
import { eventKind } from '@/lib/event-kinds'
import type { Project } from '@/lib/project-types'
import { KindChip, ProjectSwatch, archivo, formatDay, mono, timeOf } from './calendar-bits'

/** Panel wybranego dnia: lista wpisów + „Dodaj". */
export function DayPanel({
  day,
  entries,
  projectsById,
  onAdd,
  onEdit,
  onFocusProject,
}: {
  day: string
  entries: CalendarEntry[]
  projectsById: Map<string, Project>
  onAdd: () => void
  onEdit: (entry: CalendarEntry) => void
  onFocusProject: (projectId: string) => void
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xl font-semibold text-white" style={archivo}>
          {formatDay(day)}
        </h2>
        <button
          type="button"
          onClick={onAdd}
          className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-white/70"
        >
          <Plus className="size-3.5" />
          Dodaj
        </button>
      </div>

      {entries.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">Nic tego dnia. Dodaj wydarzenie albo wybierz inny dzień.</p>
      ) : (
        <ul className="mt-4 space-y-1">
          {entries.map((entry) => {
            const project = entry.projectId ? projectsById.get(entry.projectId) : undefined
            const time = timeOf(entry.start)
            const multi = entry.end && entry.end.slice(0, 10) !== entry.start.slice(0, 10)
            return (
              <li key={entry.id} className="group flex items-start gap-1 rounded-md hover:bg-white/[0.04]">
                <button
                  type="button"
                  onClick={() => onEdit(entry)}
                  className="min-w-0 flex-1 rounded-md px-2 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-white/50"
                >
                  <span className="flex items-center gap-2">
                    <KindChip kind={entry.kind} />
                    <span className="truncate text-sm text-zinc-100">
                      {entry.title || eventKind(entry.kind).label}
                    </span>
                  </span>
                  <span className="mt-1 flex items-center gap-2 pl-0.5 text-xs text-zinc-500">
                    <ProjectSwatch project={project} />
                    <span className="truncate">
                      {project?.name ??
                        (entry.origin === 'gear'
                          ? 'Katalog sprzętu'
                          : entry.projectId
                            ? 'Usunięty projekt'
                            : 'Firma, bez projektu')}
                    </span>
                    {time && <span style={mono}>{time}</span>}
                    {multi && (
                      <span style={mono}>
                        {Number(entry.start.slice(8, 10))}–{Number(entry.end!.slice(8, 10))}.{entry.end!.slice(5, 7)}
                      </span>
                    )}
                  </span>
                </button>
                {project && (
                  <button
                    type="button"
                    onClick={() => onFocusProject(project.id)}
                    aria-label={`Pokaż wątek: ${project.name}`}
                    title="Pokaż wątek projektu"
                    className="mt-1.5 rounded-md p-1.5 text-zinc-600 outline-none hover:bg-white/5 hover:text-zinc-200 focus-visible:ring-2 focus-visible:ring-white/50"
                  >
                    <Waypoints className="size-3.5" />
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
