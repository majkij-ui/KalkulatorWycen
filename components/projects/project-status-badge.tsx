'use client'

/**
 * Odznaka statusu projektu.
 *
 * Kolor niesie informację z notatek: „na realne projekty, np. innym kolorem,
 * zaznaczone, że to jest projekt, który miał miejsce". Wyceny są chłodne
 * i stonowane, realne projekty ciepłe/zielone, odrzucone wygaszone.
 */

import { PROJECT_STATUSES, PROJECT_STATUS_LABELS, type ProjectStatus } from '@/lib/project-types'

const STATUS_STYLES: Record<ProjectStatus, string> = {
  quote: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  won: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  done: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  lost: 'border-zinc-600/40 bg-zinc-700/20 text-zinc-500',
}

/** Kropka statusu — używana też w wąskich miejscach bez etykiety. */
export const STATUS_DOT: Record<ProjectStatus, string> = {
  quote: 'bg-sky-400',
  won: 'bg-amber-400',
  done: 'bg-emerald-400',
  lost: 'bg-zinc-600',
}

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLES[status]}`}
    >
      <span className={`size-1.5 rounded-full ${STATUS_DOT[status]}`} aria-hidden />
      {PROJECT_STATUS_LABELS[status]}
    </span>
  )
}

/** Przełącznik statusu — „wycena weszła" jednym kliknięciem. */
export function ProjectStatusPicker({
  status,
  onChange,
  disabled,
}: {
  status: ProjectStatus
  onChange: (next: ProjectStatus) => void
  disabled?: boolean
}) {
  return (
    <div
      className="inline-flex items-center rounded-lg border border-white/10 bg-black/40 p-0.5"
      role="group"
      aria-label="Status projektu"
    >
      {PROJECT_STATUSES.map((value) => {
        const active = value === status
        return (
          <button
            key={value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(value)}
            aria-pressed={active}
            className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${
              active
                ? `border ${STATUS_STYLES[value]}`
                : 'border border-transparent text-zinc-500 hover:text-zinc-200'
            }`}
          >
            {PROJECT_STATUS_LABELS[value]}
          </button>
        )
      })}
    </div>
  )
}
