'use client'

/**
 * Lista leadów kampanii (albo spoza kampanii). Jakość ocenia się jednym
 * kliknięciem w wierszu; projekt otwiera się z wiersza; reszta w formularzu.
 */

import { useMemo, useState } from 'react'
import { ArrowRight, Plus } from 'lucide-react'
import type { Lead } from '@/lib/marketing-leads'
import type { LeadQuality } from '@/lib/marketing-types'
import { PROJECT_STATUS_LABELS, leadSourceLabel, type Project } from '@/lib/project-types'
import { STATUS_DOT } from '@/components/projects/project-status-badge'
import { ProjectSwatch, mono } from '@/components/calendar/calendar-bits'
import { QualityPicker } from './marketing-bits'

type QualityFilter = 'all' | LeadQuality | 'unrated'

const FILTERS: { value: QualityFilter; label: string }[] = [
  { value: 'all', label: 'Wszystkie' },
  { value: 'very_good', label: 'Bardzo dobre' },
  { value: 'good', label: 'Dobre' },
  { value: 'fake', label: 'Fałszywe' },
  { value: 'unrated', label: 'Do oceny' },
]

function matches(lead: Lead, filter: QualityFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'unrated') return lead.quality === null
  return lead.quality === filter
}

function formatDate(dateKey: string): string {
  const [y, m, d] = dateKey.split('-')
  return `${d}.${m}.${y}`
}

export function LeadsPanel({
  title,
  leads,
  projects,
  showOrigin,
  onAdd,
  onEdit,
  onRate,
  onOpenProject,
}: {
  title: string
  leads: Lead[]
  projects: Project[]
  /** Dla leadów spoza kampanii — pokazuje ich pochodzenie. */
  showOrigin?: boolean
  onAdd: () => void
  onEdit: (lead: Lead) => void
  onRate: (lead: Lead, quality: LeadQuality) => void
  onOpenProject: (id: string) => void
}) {
  const [filter, setFilter] = useState<QualityFilter>('all')
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])
  const rows = leads.filter((l) => matches(l, filter))

  return (
    <section className="mb-6 rounded-xl border border-white/5 bg-zinc-900/40 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500">
          {title} <span className="text-zinc-600">({leads.length})</span>
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap rounded-lg border border-white/10 bg-black/30 p-0.5" role="radiogroup" aria-label="Filtr jakości">
            {FILTERS.map((f) => {
              const n = leads.filter((l) => matches(l, f.value)).length
              if (f.value === 'unrated' && n === 0) return null
              const active = filter === f.value
              return (
                <button
                  key={f.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setFilter(f.value)}
                  className={`rounded-md px-2 py-1 text-[11px] font-semibold transition-colors ${
                    active ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-200'
                  } ${f.value === 'unrated' && !active ? 'text-amber-300/90' : ''}`}
                >
                  {f.label} <span className="text-zinc-600" style={mono}>{n}</span>
                </button>
              )
            })}
          </div>
          <button
            type="button"
            onClick={onAdd}
            className="flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
          >
            <Plus className="size-3.5" />
            Dodaj lead
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-600">
          {leads.length === 0 ? 'Nie ma tu jeszcze leadów.' : 'Żaden lead nie pasuje do filtra.'}
        </p>
      ) : (
        <ul className="divide-y divide-white/[0.04]">
          {rows.map((lead) => {
            const project = lead.projectId ? projectById.get(lead.projectId) : undefined
            const fake = lead.quality === 'fake'
            return (
              <li key={lead.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2">
                <span className="w-20 shrink-0 text-xs text-zinc-500" style={mono}>
                  {formatDate(lead.date)}
                </span>
                <button
                  type="button"
                  onClick={() => onEdit(lead)}
                  className="min-w-[10rem] flex-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                >
                  <span className={`block truncate text-sm ${fake ? 'text-zinc-500 line-through decoration-zinc-600' : 'text-zinc-100'}`}>
                    {lead.name || 'Bez nazwy'}
                  </span>
                  <span className="block truncate text-[11px] text-zinc-500">
                    {[
                      lead.channel,
                      showOrigin && lead.origin ? leadSourceLabel(lead.origin) : '',
                      lead.summary,
                    ]
                      .filter(Boolean)
                      .join(' · ') || lead.contactName || '—'}
                  </span>
                </button>
                <QualityPicker
                  size="sm"
                  value={lead.quality}
                  onChange={(q) => onRate(lead, q)}
                  label={`Jakość leada ${lead.name}`}
                />
                <div className="flex w-full items-center justify-end gap-2 sm:w-56">
                  {project ? (
                    <button
                      type="button"
                      onClick={() => onOpenProject(project.id)}
                      className="group flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs text-zinc-300 hover:bg-white/5"
                      title="Otwórz projekt"
                    >
                      <ProjectSwatch project={project} />
                      <span className="min-w-0 truncate">{project.name}</span>
                      <span
                        className={`size-1.5 shrink-0 rounded-full ${STATUS_DOT[project.status]}`}
                        title={PROJECT_STATUS_LABELS[project.status]}
                        aria-label={PROJECT_STATUS_LABELS[project.status]}
                      />
                      <ArrowRight className="size-3 shrink-0 text-zinc-600 group-hover:text-zinc-300" />
                    </button>
                  ) : lead.projectId ? (
                    <span className="text-[11px] text-zinc-600">usunięty projekt</span>
                  ) : fake ? null : (
                    <button
                      type="button"
                      onClick={() => onEdit(lead)}
                      className="rounded-md px-1.5 py-1 text-[11px] font-medium text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
                    >
                      + projekt
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
