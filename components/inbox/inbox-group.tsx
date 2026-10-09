'use client'

/**
 * Jedna grupa skrzynki = jeden wątek (albo klient). Na górze wybór projektu,
 * do którego trafi cały wątek (podpowiedź po wątku / mailu / kliencie albo
 * „nowy projekt"), pod spodem propozycje: podgląd, edycja, akceptuj / odrzuć,
 * na dole „zaakceptuj wszystkie z wątku".
 */

import { useId, useMemo, useState } from 'react'
import { AlertTriangle, ArrowRight, Check, ChevronDown, FolderPlus, Loader2, Mail, Pencil, UserRound, X } from 'lucide-react'
import { eventData, eventKind } from '@/lib/event-kinds'
import {
  acceptedNewProjectId,
  defaultTarget,
  newProjectFieldsFor,
  PROPOSAL_PROBLEM_TEXT,
  proposalDate,
  proposalProblems,
  proposalTitle,
  similarEvents,
  suggestProjects,
  SUGGESTION_LABELS,
  type InboxTarget,
  type PendingProposal,
  type ProposalGroup,
} from '@/lib/inbox'
import type { Proposal } from '@/lib/inbox-types'
import { useInbox, type AcceptResult } from '@/lib/inbox-context'
import { useEvents } from '@/lib/events-context'
import { useProjectHub } from '@/lib/project-hub-context'
import { LEAD_QUALITY_LABELS, isLeadQuality } from '@/lib/marketing-types'
import { PROJECT_STATUS_LABELS, leadSourceLabel, type Project } from '@/lib/project-types'
import { plural } from '@/lib/pl-plural'
import { KindChip, ProjectSwatch, formatDay, mono, pln, timeOf } from '@/components/calendar/calendar-bits'
import { STATUS_DOT } from '@/components/projects/project-status-badge'
import { FieldLabel, inputClass } from '@/components/marketing/marketing-bits'
import { ContactFields, LeadSourceSelect, ProposalEditor } from './proposal-editor'

const NEW = '__new__'
const NONE = '__none__'

function when(value: string): string {
  if (!value) return ''
  const time = timeOf(value)
  return `${formatDay(value)} ${value.slice(0, 4)}${time ? `, ${time}` : ''}`
}

/** Krótki opis pól wydarzenia (kwota, numer, jakość leada…). */
function eventDetails(proposal: Extract<Proposal, { type: 'event' }>, campaignName: (id: string) => string): string {
  const data = eventData({ kind: proposal.event.kind, data: proposal.event.data })
  const kind = eventKind(proposal.event.kind)
  const parts: string[] = []
  if (proposal.event.kind === 'lead_in') {
    if (isLeadQuality(data.quality)) parts.push(LEAD_QUALITY_LABELS[data.quality])
    if (typeof data.campaignId === 'string') parts.push(campaignName(data.campaignId))
    else if (typeof data.origin === 'string' && data.origin) parts.push(leadSourceLabel(data.origin))
  }
  kind.fields?.forEach((field) => {
    const value = data[field.key]
    if (value === undefined || value === '') return
    parts.push(field.type === 'number' && typeof value === 'number' ? pln(value) : field.type === 'date' ? `${field.label.toLowerCase()} ${value}` : String(value))
  })
  if (proposal.event.kind === 'lead_in') {
    const contact = [data.contactName, data.email, data.phone].filter((v) => typeof v === 'string' && v).join(', ')
    if (contact) parts.push(contact)
  }
  if (proposal.event.end) parts.push(`do ${formatDay(proposal.event.end)}`)
  return parts.join(' · ')
}

function projectDetails(proposal: Extract<Proposal, { type: 'project_update' | 'project_new' }>): string {
  const fields = proposal.type === 'project_new' ? proposal.project : proposal.set
  const contact = fields.contact ? [fields.contact.name, fields.contact.email, fields.contact.phone].filter(Boolean).join(', ') : ''
  return [
    proposal.type === 'project_new' && proposal.project.client ? `klient: ${proposal.project.client}` : '',
    proposal.type === 'project_update' && proposal.set.client ? `klient: ${proposal.set.client}` : '',
    fields.leadSource ? `pochodzenie: ${leadSourceLabel(fields.leadSource)}` : '',
    contact ? `kontakt: ${contact}` : '',
    proposal.type === 'project_update' ? (proposal.ifMissing ? 'tylko puste pola' : 'nadpisze pola') : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

function TypeChip({ proposal }: { proposal: Proposal }) {
  if (proposal.type === 'event') return <KindChip kind={proposal.event.kind} />
  const Icon = proposal.type === 'project_new' ? FolderPlus : UserRound
  return (
    <span className="flex shrink-0 items-center gap-1 rounded-[3px] bg-zinc-700 px-1 py-[2px] text-[10px] font-semibold leading-none text-zinc-100">
      <Icon className="size-2.5" aria-hidden />
      {proposal.type === 'project_new' ? 'projekt' : 'dane'}
    </span>
  )
}

function ProposalRow({
  item,
  proposal,
  target,
  edited,
  busy,
  onEdit,
  onAccept,
  onReject,
}: {
  item: PendingProposal
  proposal: Proposal
  target: InboxTarget
  edited: boolean
  busy: boolean
  onEdit: (next: Proposal | null) => void
  onAccept: () => void
  onReject: () => void
}) {
  const { events } = useEvents()
  const { projects } = useProjectHub()
  const { campaigns } = useInbox()
  const [preview, setPreview] = useState(false)
  const [editing, setEditing] = useState(false)

  const problems = proposalProblems(proposal, target)
  const projectId = target.type === 'existing' ? target.projectId : null
  const similar = proposal.type === 'event' ? similarEvents(proposal.event, projectId, events) : []
  const projectName = (id: string | null) => projects.find((p) => p.id === id)?.name ?? 'bez projektu'
  const campaignName = (id: string) => campaigns.find((c) => c.id === id)?.name || 'kampania'
  const details =
    proposal.type === 'event' ? eventDetails(proposal, campaignName) : projectDetails(proposal)
  const evidence = proposal.evidence

  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
        <div className="flex min-w-[14rem] flex-1 items-start gap-2">
          <span className="mt-0.5">
            <TypeChip proposal={proposal} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="truncate text-sm text-zinc-100">{proposalTitle(proposal)}</span>
              {edited && <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-300/90">zmieniona</span>}
            </div>
            <div className="text-[11px] text-zinc-500">
              <span style={mono}>{when(proposalDate(proposal))}</span>
              {details && <span>{proposalDate(proposal) ? ' · ' : ''}{details}</span>}
            </div>
            {proposal.reason && <p className="mt-0.5 text-[11px] italic text-zinc-500">{proposal.reason}</p>}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1">
          {evidence && (
            <button
              type="button"
              onClick={() => setPreview((v) => !v)}
              aria-expanded={preview}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-zinc-500 outline-none hover:bg-white/5 hover:text-zinc-200 focus-visible:ring-2 focus-visible:ring-white/60"
            >
              <Mail className="size-3" />
              Podgląd
            </button>
          )}
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            aria-expanded={editing}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-zinc-500 outline-none hover:bg-white/5 hover:text-zinc-200 focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <Pencil className="size-3" />
            Edytuj
          </button>
          <button
            type="button"
            onClick={onReject}
            disabled={busy}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-zinc-500 outline-none hover:bg-red-500/10 hover:text-red-300 focus-visible:ring-2 focus-visible:ring-white/60 disabled:opacity-50"
          >
            <X className="size-3" />
            Odrzuć
          </button>
          <button
            type="button"
            onClick={onAccept}
            disabled={busy || problems.length > 0}
            title={problems.map((p) => PROPOSAL_PROBLEM_TEXT[p]).join(' ') || undefined}
            className="flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-semibold text-primary-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-40"
          >
            <Check className="size-3" />
            Akceptuj
          </button>
        </div>
      </div>

      {problems.length > 0 && (
        <p className="mt-1 pl-1 text-[11px] text-amber-300/90">{problems.map((p) => PROPOSAL_PROBLEM_TEXT[p]).join(' ')}</p>
      )}
      {similar.length > 0 && (
        <p className="mt-1 flex items-start gap-1.5 pl-1 text-[11px] text-amber-300/90">
          <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden />
          <span>
            Podobne już jest:{' '}
            {similar
              .slice(0, 3)
              .map((e) => `${e.title || eventKind(e.kind).label} (${formatDay(e.start)}, ${projectName(e.projectId)})`)
              .join('; ')}
            . Jeśli to to samo — odrzuć.
          </span>
        </p>
      )}

      {preview && evidence && (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 rounded-lg border border-white/5 bg-black/30 p-2.5 text-[11px]">
          {evidence.from && (
            <>
              <dt className="text-zinc-600">Od</dt>
              <dd className="min-w-0 break-words text-zinc-300">{evidence.from}</dd>
            </>
          )}
          {evidence.to && (
            <>
              <dt className="text-zinc-600">Do</dt>
              <dd className="min-w-0 break-words text-zinc-300">{evidence.to}</dd>
            </>
          )}
          {evidence.subject && (
            <>
              <dt className="text-zinc-600">Temat</dt>
              <dd className="min-w-0 break-words text-zinc-300">{evidence.subject}</dd>
            </>
          )}
          {evidence.date && (
            <>
              <dt className="text-zinc-600">Data</dt>
              <dd className="text-zinc-300" style={mono}>
                {evidence.date.replace('T', ' ').slice(0, 16)}
              </dd>
            </>
          )}
          {evidence.snippet && (
            <>
              <dt className="text-zinc-600">Treść</dt>
              <dd className="min-w-0 whitespace-pre-line break-words text-zinc-400">{evidence.snippet}</dd>
            </>
          )}
          <dt className="text-zinc-600">Źródło</dt>
          <dd className="min-w-0 break-all text-zinc-600" style={mono}>
            {item.key} · {item.file}
          </dd>
        </dl>
      )}

      {editing && (
        <ProposalEditor
          proposal={proposal}
          onApply={(next) => {
            onEdit(next)
            setEditing(false)
          }}
          onCancel={() => setEditing(false)}
        />
      )}
      {edited && !editing && (
        <button
          type="button"
          onClick={() => onEdit(null)}
          className="mt-1 pl-1 text-[11px] text-zinc-600 underline-offset-2 hover:text-zinc-300 hover:underline"
        >
          Przywróć propozycję Claude’a
        </button>
      )}
    </li>
  )
}

function ProjectOption({ project, hint }: { project: Project; hint?: string }) {
  return (
    <option value={project.id}>
      {project.name}
      {project.client ? ` (${project.client})` : ''} · {PROJECT_STATUS_LABELS[project.status]}
      {hint ? ` — ${hint}` : ''}
    </option>
  )
}

export function InboxGroup({
  group,
  onAccepted,
  onOpenProject,
}: {
  group: ProposalGroup
  onAccepted: (result: AcceptResult) => void
  onOpenProject: (id: string) => void
}) {
  const id = useId()
  const { projects } = useProjectHub()
  const { allEvents } = useEvents()
  const { files, decisions, campaigns, accept, reject } = useInbox()
  const [override, setOverride] = useState<InboxTarget | null>(null)
  const [edits, setEdits] = useState<Map<string, Proposal>>(new Map())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const suggestions = useMemo(() => suggestProjects(group, projects, allEvents), [group, projects, allEvents])
  const fallback = useMemo(
    () => defaultTarget(group, suggestions, acceptedNewProjectId(group, files, decisions), campaigns),
    [group, suggestions, files, decisions, campaigns]
  )
  // Wybór sprzed chwili może wskazywać projekt, którego już nie ma.
  const target =
    override && !(override.type === 'existing' && !projects.some((p) => p.id === override.projectId))
      ? override
      : fallback
  const project = target.type === 'existing' ? projects.find((p) => p.id === target.projectId) : undefined

  const current = (item: PendingProposal) => edits.get(item.key) ?? item.proposal
  const acceptable = group.items.filter((item) => proposalProblems(current(item), target).length === 0)

  const run = async (items: PendingProposal[]) => {
    setBusy(true)
    setError(null)
    try {
      const result = await accept(
        items.map((item) => ({ item, proposal: current(item) })),
        target
      )
      if (result.createdProject && result.project) setOverride({ type: 'existing', projectId: result.project.id })
      if (result.failed.length) setError(`Nie przyjęto ${result.failed.length} — popraw je albo wybierz projekt.`)
      onAccepted(result)
    } catch {
      setError('Zapis się nie udał — spróbuj ponownie.')
    } finally {
      setBusy(false)
    }
  }

  const rejectItems = async (items: PendingProposal[]) => {
    setBusy(true)
    try {
      await reject(items)
    } finally {
      setBusy(false)
    }
  }

  const choose = (value: string) => {
    if (value === NEW) {
      const { fields, fromRef } = newProjectFieldsFor(group, campaigns)
      setOverride({ type: 'new', fields, fromRef })
    } else if (value === NONE) setOverride({ type: 'none' })
    else if (value) setOverride({ type: 'existing', projectId: value })
    else setOverride({ type: 'unset' })
  }
  const setNewFields = (patch: Partial<Extract<InboxTarget, { type: 'new' }>['fields']>) => {
    if (target.type === 'new') setOverride({ ...target, fields: { ...target.fields, ...patch } })
  }

  const meta = [group.client && group.client !== group.title ? group.client : '', group.emails.join(', ')]
    .filter(Boolean)
    .join(' · ')
  const suggestedIds = new Set(suggestions.map((s) => s.projectId))
  const selectValue =
    target.type === 'existing' ? target.projectId : target.type === 'new' ? NEW : target.type === 'none' ? NONE : ''

  return (
    <section className="rounded-xl border border-white/5 bg-zinc-900/40 p-4">
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-zinc-100">{group.title}</h2>
          {(meta || !group.client) && (
            <p className="truncate text-[11px] text-zinc-500">{meta || 'Bez danych klienta'}</p>
          )}
        </div>
        <span className="shrink-0 text-[11px] text-zinc-600" style={mono}>
          {group.items.length} {plural(group.items.length, 'propozycja', 'propozycje', 'propozycji')}
        </span>
      </header>

      <div className="mb-2 rounded-lg border border-white/5 bg-black/20 p-2.5">
        <FieldLabel htmlFor={`${id}-project`}>Projekt dla tego wątku</FieldLabel>
        <div className="flex flex-wrap items-center gap-2">
          <select
            id={`${id}-project`}
            value={selectValue}
            onChange={(e) => choose(e.target.value)}
            className={`${inputClass} max-w-xl flex-1`}
          >
            <option value="">Wybierz projekt…</option>
            <option value={NEW}>+ Nowy projekt…</option>
            <option value={NONE}>Bez projektu (np. fałszywy lead)</option>
            {suggestions.length > 0 && (
              <optgroup label="Podpowiedzi">
                {suggestions.map((s) => {
                  const p = projects.find((x) => x.id === s.projectId)
                  return p ? <ProjectOption key={p.id} project={p} hint={SUGGESTION_LABELS[s.reason]} /> : null
                })}
              </optgroup>
            )}
            <optgroup label="Wszystkie projekty">
              {projects
                .filter((p) => !suggestedIds.has(p.id))
                .map((p) => (
                  <ProjectOption key={p.id} project={p} />
                ))}
            </optgroup>
          </select>
          {project && (
            <button
              type="button"
              onClick={() => onOpenProject(project.id)}
              className="group flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
              title="Otwórz projekt"
            >
              <ProjectSwatch project={project} />
              <span className={`size-1.5 shrink-0 rounded-full ${STATUS_DOT[project.status]}`} aria-hidden />
              Otwórz
              <ArrowRight className="size-3 text-zinc-600 group-hover:text-zinc-300" />
            </button>
          )}
        </div>
        {target.type === 'existing' && (
          <p className="mt-1 text-[11px] text-zinc-600">
            {suggestions.find((s) => s.projectId === target.projectId)
              ? `Podpowiedź: ${SUGGESTION_LABELS[suggestions.find((s) => s.projectId === target.projectId)!.reason]}.`
              : 'Wybrany ręcznie.'}{' '}
            Status projektu się nie zmieni — po akceptacji zapytam.
          </p>
        )}
        {target.type === 'new' && (
          <div className="mt-2 space-y-2">
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <FieldLabel htmlFor={`${id}-new-name`}>Nazwa projektu</FieldLabel>
                <input
                  id={`${id}-new-name`}
                  value={target.fields.name}
                  onChange={(e) => setNewFields({ name: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <FieldLabel htmlFor={`${id}-new-client`}>Klient</FieldLabel>
                <input
                  id={`${id}-new-client`}
                  value={target.fields.client}
                  onChange={(e) => setNewFields({ client: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <FieldLabel htmlFor={`${id}-new-date`}>Data księgowa</FieldLabel>
                <input
                  id={`${id}-new-date`}
                  type="date"
                  value={target.fields.date ?? ''}
                  onChange={(e) => setNewFields({ date: e.target.value || undefined })}
                  className={inputClass}
                />
              </div>
              <div>
                <FieldLabel htmlFor={`${id}-new-source`}>Pochodzenie klienta</FieldLabel>
                <LeadSourceSelect
                  id={`${id}-new-source`}
                  value={target.fields.leadSource}
                  onChange={(leadSource) => setNewFields({ leadSource })}
                />
              </div>
            </div>
            <ContactFields
              idPrefix={`${id}-new-contact`}
              value={target.fields.contact}
              onChange={(contact) => setNewFields({ contact })}
            />
            <p className="text-[11px] text-zinc-600">Projekt (bez wyceny) powstanie przy pierwszej akceptacji.</p>
          </div>
        )}
      </div>

      <ul className="divide-y divide-white/[0.04]">
        {group.items.map((item) => (
          <ProposalRow
            key={item.key}
            item={item}
            proposal={current(item)}
            target={target}
            edited={edits.has(item.key)}
            busy={busy}
            onEdit={(next) =>
              setEdits((map) => {
                const copy = new Map(map)
                if (next) copy.set(item.key, next)
                else copy.delete(item.key)
                return copy
              })
            }
            onAccept={() => void run([item])}
            onReject={() => void rejectItems([item])}
          />
        ))}
      </ul>

      {error && <p className="mt-2 text-xs text-red-300" role="alert">{error}</p>}

      {group.items.length > 1 && (
        <footer className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-white/5 pt-3">
          {acceptable.length < group.items.length && (
            <span className="mr-auto text-[11px] text-zinc-500">
              {group.items.length - acceptable.length} czeka na wybór projektu albo poprawkę.
            </span>
          )}
          <button
            type="button"
            onClick={() => void rejectItems(group.items)}
            disabled={busy}
            className="rounded-md px-3 py-1.5 text-xs font-semibold text-zinc-500 outline-none hover:bg-red-500/10 hover:text-red-300 focus-visible:ring-2 focus-visible:ring-white/60 disabled:opacity-50"
          >
            Odrzuć wszystkie
          </button>
          <button
            type="button"
            onClick={() => void run(acceptable)}
            disabled={busy || acceptable.length === 0}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-40"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ChevronDown className="size-3.5 -rotate-90" />}
            Zaakceptuj wszystkie z wątku ({acceptable.length})
          </button>
        </footer>
      )}
    </section>
  )
}
