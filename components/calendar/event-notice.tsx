'use client'

/**
 * Komunikat po zapisie lub usunięciu wydarzenia — w kalendarzu i na osi czasu
 * projektu: „Usunięto … Cofnij" albo sugestia statusu do potwierdzenia
 * (aplikacja nigdy nie zmienia statusu sama).
 */

import { eventKind, statusSuggestion } from '@/lib/event-kinds'
import type { TimelineEvent } from '@/lib/event-types'
import { useEvents } from '@/lib/events-context'
import { useProjectHub } from '@/lib/project-hub-context'
import { PROJECT_STATUS_LABELS, type ProjectStatus } from '@/lib/project-types'
import type { SavedInfo } from './event-form'

export type EventNoticeState =
  | { type: 'deleted'; event: TimelineEvent }
  | { type: 'status'; projectId: string; projectName: string; to: ProjectStatus }

/** Sugestia statusu po zapisie wydarzenia (np. faktura opłacona → „Zrealizowany"). */
export function noticeAfterSave({ kind, project }: SavedInfo): EventNoticeState | null {
  const suggested = project ? statusSuggestion(project.status, kind) : null
  return project && suggested ? { type: 'status', projectId: project.id, projectName: project.name, to: suggested } : null
}

export function EventNotice({
  notice,
  onDone,
  className = '',
}: {
  notice: EventNoticeState
  onDone: () => void
  className?: string
}) {
  const { restore } = useEvents()
  const { setStatus } = useProjectHub()
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-zinc-300 ${className}`}
      role="status"
    >
      {notice.type === 'deleted' ? (
        <>
          <span className="min-w-0 flex-1">Usunięto „{notice.event.title || eventKind(notice.event.kind).label}".</span>
          <button
            type="button"
            onClick={async () => {
              await restore(notice.event.id)
              onDone()
            }}
            className="font-semibold text-primary outline-none hover:underline focus-visible:underline"
          >
            Cofnij
          </button>
        </>
      ) : (
        <>
          <span className="min-w-0 flex-1">
            Ustawić status „{PROJECT_STATUS_LABELS[notice.to]}" dla {notice.projectName}?
          </span>
          <button
            type="button"
            onClick={async () => {
              await setStatus(notice.projectId, notice.to)
              onDone()
            }}
            className="font-semibold text-primary outline-none hover:underline focus-visible:underline"
          >
            Ustaw
          </button>
          <button
            type="button"
            onClick={onDone}
            className="font-semibold text-zinc-500 outline-none hover:text-zinc-200 focus-visible:underline"
          >
            Zostaw
          </button>
        </>
      )}
    </div>
  )
}
