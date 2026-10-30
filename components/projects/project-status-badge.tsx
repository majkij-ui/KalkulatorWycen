'use client'

/**
 * Odznaka statusu projektu.
 *
 * Kolor niesie informację z notatek: „na realne projekty, np. innym kolorem,
 * zaznaczone, że to jest projekt, który miał miejsce". Wyceny są chłodne
 * i stonowane, realne projekty ciepłe/zielone, odrzucone wygaszone.
 *
 * V1: odznaka i przełącznik mówią też o podstatusie — etapie „W realizacji"
 * (Przedprodukcja / Realizacja / Postprodukcja, pole `stage`) i wpłacie przy
 * „Zakończony" (Oczekuje na zapłatę / Zapłacony, pochodna wydarzeń wpłat).
 * Reguły pieniędzy czytają dalej tylko `status`.
 */

import { useEvents } from '@/lib/events-context'
import { paymentState } from '@/lib/payments'
import {
  PROJECT_STAGES,
  PROJECT_STAGE_LABELS,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  effectiveStage,
  projectBadgeLabel,
  toDateKey,
  type Project,
  type ProjectStage,
  type ProjectStatus,
} from '@/lib/project-types'
import { PaymentSubStatus } from './paid-toggle'

const STATUS_STYLES: Record<ProjectStatus, string> = {
  quote: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  won: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  done: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  lost: 'border-zinc-600/40 bg-zinc-700/20 text-zinc-500',
}

/** „Zakończony", który jeszcze czeka na wpłatę: ta sama zieleń, ale wygaszona. */
const AWAITING_STYLE = 'border-emerald-500/20 bg-transparent text-emerald-400/70'

/** Kropka statusu — używana też w wąskich miejscach bez etykiety. */
export const STATUS_DOT: Record<ProjectStatus, string> = {
  quote: 'bg-sky-400',
  won: 'bg-amber-400',
  done: 'bg-emerald-400',
  lost: 'bg-zinc-600',
}

/**
 * `stage` i `paid` są opcjonalne: bez nich odznaka mówi sam status. `paid`
 * podaje ekran, który zna wpłatę (np. `ProjectMoney.paid`); kto jej nie zna,
 * używa `ProjectBadge`.
 */
export function ProjectStatusBadge({
  status,
  stage,
  paid,
}: {
  status: ProjectStatus
  stage?: ProjectStage | null
  paid?: boolean
}) {
  const awaiting = status === 'done' && paid === false
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
        awaiting ? AWAITING_STYLE : STATUS_STYLES[status]
      }`}
    >
      <span className={`size-1.5 rounded-full ${STATUS_DOT[status]}`} aria-hidden />
      {projectBadgeLabel({ status, stage, paid })}
    </span>
  )
}

/** Odznaka z samego projektu: wpłatę „Zakończonego" czyta z wydarzeń (pojedynczy projekt, tanio). */
export function ProjectBadge({ project }: { project: Pick<Project, 'id' | 'status' | 'stage'> }) {
  const { events } = useEvents()
  const paid =
    project.status === 'done' ? paymentState(events, project.id, toDateKey(new Date())).paid : undefined
  return <ProjectStatusBadge status={project.status} stage={project.stage} paid={paid} />
}

/** Drugi rząd dla „W realizacji": etap zlecenia. Klik zmienia tylko `stage`. */
function StagePills({
  stage,
  onChange,
  disabled,
}: {
  stage: ProjectStage
  onChange: (next: ProjectStage) => void
  disabled?: boolean
}) {
  return (
    <div className="inline-flex items-center gap-1" role="group" aria-label="Etap projektu">
      {PROJECT_STAGES.map((value) => {
        const active = value === stage
        return (
          <button
            key={value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(value)}
            aria-pressed={active}
            className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-colors disabled:opacity-50 ${
              active ? STATUS_STYLES.won : 'border-transparent text-zinc-500 hover:text-zinc-200'
            }`}
          >
            {PROJECT_STAGE_LABELS[value]}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Przełącznik statusu — „wycena weszła" jednym kliknięciem.
 *
 * Z `project` rozwija drugi rząd małych pastylek: etap dla „W realizacji"
 * (`onStageChange`), wpłatę dla „Zakończony". Główny rząd dalej idzie przez
 * `onChange` (u wywołującego: `requestStatus`, więc pytanie o wariant zostaje).
 */
export function ProjectStatusPicker({
  status,
  onChange,
  disabled,
  project,
  onStageChange,
}: {
  status: ProjectStatus
  onChange: (next: ProjectStatus) => void
  disabled?: boolean
  project?: Project
  onStageChange?: (next: ProjectStage) => void
}) {
  return (
    <div className="flex flex-col items-end gap-1.5">
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
      {project && status === 'won' && onStageChange && (
        <StagePills stage={effectiveStage(project.stage)} onChange={onStageChange} disabled={disabled} />
      )}
      {project && status === 'done' && <PaymentSubStatus project={project} />}
    </div>
  )
}
