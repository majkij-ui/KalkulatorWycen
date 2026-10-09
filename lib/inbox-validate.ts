/**
 * Ścisła walidacja propozycji PRZED zapisem do `inbox/` (`npm run data -- inbox`).
 *
 * Aplikacja czyta skrzynkę wyrozumiale (`parseInboxFile`): uszkodzona
 * propozycja po cichu odpada albo `.catch` podmienia złe pole. Przy zapisie
 * ma być odwrotnie — głośno. Te same schematy, ale:
 *  - błąd schematu ALBO pole, które schemat by „poprawił", zatrzymuje zapis,
 *  - wydarzenie przechodzi przez `eventSchema` i schemat `data` swojego typu,
 *  - wskazany projekt / kampania / nowy projekt muszą istnieć,
 *  - status projektu nie może być częścią propozycji,
 *  - `ref` już znany (wydarzenia — także usunięte, decyzje, inne pliki
 *    skrzynki) → propozycja pominięta, nie błąd: ponowny import jest no-opem.
 *
 * Moduł czysty — testy w `inbox.test.ts`.
 */

import { isDeepStrictEqual } from 'node:util'
import { eventKind, isKnownKind } from './event-kinds'
import { eventSchema, type TimelineEvent } from './event-types'
import { eventFromProposal, proposalDate, proposalTitle, similarEvents } from './inbox'
import {
  INBOX_FORMAT,
  INBOX_VERSION,
  isFinalDecision,
  PROJECT_UPDATE_FIELDS,
  proposalSchema,
  type InboxDecision,
  type Proposal,
} from './inbox-types'

export interface StrictContext {
  /** Wszystkie projekty, łącznie z usuniętymi. */
  projects: { id: string; name: string; deletedAt?: string }[]
  /** Wszystkie wydarzenia, łącznie z usuniętymi. */
  events: TimelineEvent[]
  campaigns: { id: string }[]
  decisions: InboxDecision[]
  /** `ref` → plik skrzynki, w którym już czeka. */
  pendingRefs: Map<string, string>
  /** `YYYY-MM-DD` — ostrzeżenie o datach z przyszłości. */
  today: string
}

export interface StrictResult {
  errors: string[]
  warnings: string[]
  skipped: { ref: string; title: string; why: string }[]
  /** Propozycje do zapisu, w kolejności z pliku. */
  proposals: Proposal[]
  note: string
}

/** Pierwsza ścieżka, pod którą schemat zmieniłby wartość wejściową. */
function catchDiff(input: unknown, output: unknown, path: string): string | null {
  if (input === undefined) return null
  if (input && typeof input === 'object' && !Array.isArray(input) && output && typeof output === 'object') {
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      const diff = catchDiff(value, (output as Record<string, unknown>)[key], path ? `${path}.${key}` : key)
      if (diff) return diff
    }
    return null
  }
  return isDeepStrictEqual(input, output) ? null : path || '(całość)'
}

/** Typy sprzedaży i pieniędzy — data z przyszłości to raczej pomyłka. */
const PAST_ONLY_KINDS = new Set([
  'lead_in',
  'reply_sent',
  'quote_sent',
  'follow_up',
  'won',
  'lost',
  'invoice_sent',
  'invoice_paid',
])

export function validateInboxDraft(raw: unknown, ctx: StrictContext): StrictResult {
  const result: StrictResult = { errors: [], warnings: [], skipped: [], proposals: [], note: '' }
  const header = (raw ?? {}) as Record<string, unknown>
  if (header.format !== INBOX_FORMAT) result.errors.push(`format: oczekiwano "${INBOX_FORMAT}"`)
  if (header.version !== INBOX_VERSION) result.errors.push(`version: oczekiwano ${INBOX_VERSION}`)
  if (header.note !== undefined && typeof header.note !== 'string') result.errors.push('note: oczekiwano tekstu')
  if (!Array.isArray(header.proposals)) {
    result.errors.push('proposals: oczekiwano listy')
    return result
  }
  result.note = typeof header.note === 'string' ? header.note : ''

  const liveProjects = new Map(ctx.projects.filter((p) => !p.deletedAt).map((p) => [p.id, p]))
  const deletedProjects = new Set(ctx.projects.filter((p) => p.deletedAt).map((p) => p.id))
  const campaigns = new Set(ctx.campaigns.map((c) => c.id))
  const eventRefs = new Map(
    ctx.events.filter((e) => e.source?.ref).map((e) => [e.source.ref as string, e] as const)
  )
  const decisions = new Map(ctx.decisions.filter(isFinalDecision).map((d) => [d.ref, d]))
  const rawProposals = header.proposals as unknown[]
  const newProjectIds = new Set(
    rawProposals
      .filter((p): p is { type: string; id: string } => !!p && typeof p === 'object' && (p as { type?: unknown }).type === 'project_new')
      .map((p) => p.id)
  )
  const ids = new Set<string>()
  const refs = new Set<string>()

  rawProposals.forEach((entry, index) => {
    const where = `proposals[${index}] (${(entry as { ref?: string })?.ref ?? 'bez ref'})`
    const error = (message: string) => result.errors.push(`${where}: ${message}`)
    const warn = (message: string) => result.warnings.push(`${where}: ${message}`)

    const parsed = proposalSchema.safeParse(entry)
    if (!parsed.success) {
      error(parsed.error.issues.map((i) => `${i.path.join('.') || 'type'}: ${i.message}`).join('; '))
      return
    }
    const proposal = parsed.data
    const changed = catchDiff(entry, proposal, '')
    if (changed) {
      error(`schemat poprawiłby pole „${changed}"`)
      return
    }

    if (ids.has(proposal.id)) error(`id „${proposal.id}" powtarza się w pliku`)
    ids.add(proposal.id)
    if (refs.has(proposal.ref)) error(`ref „${proposal.ref}" powtarza się w pliku`)
    refs.add(proposal.ref)
    if (!/^[a-z]+:\S+$/.test(proposal.ref)) error('ref: oczekiwano „źródło:id", np. gmail:<id wiadomości>')

    const known = eventRefs.get(proposal.ref)
    const decided = decisions.get(proposal.ref)
    const waiting = ctx.pendingRefs.get(proposal.ref)
    const skip = known
      ? `już jest w wydarzeniach${known.deletedAt ? ' (usunięte)' : ''}: ${known.title || known.kind}`
      : decided
        ? `${decided.decision === 'accepted' ? 'przyjęta' : 'odrzucona'} wcześniej (${decided.at.slice(0, 10)})`
        : waiting
          ? `już czeka w skrzynce (${waiting})`
          : null

    const checkProject = (projectId: string | null | undefined, newProject: string | undefined) => {
      if (projectId) {
        if (deletedProjects.has(projectId)) error(`projekt ${projectId} jest usunięty`)
        else if (!liveProjects.has(projectId)) error(`nie ma projektu ${projectId}`)
      }
      if (newProject && !newProjectIds.has(newProject)) error(`newProject „${newProject}" nie wskazuje propozycji project_new z tego pliku`)
      if (projectId && newProject) error('podaj projectId albo newProject, nie oba')
    }

    if (proposal.type === 'event') {
      const { kind, start, end, data } = proposal.event
      const spec = eventKind(kind)
      if (!isKnownKind(kind)) error(`nieznany typ wydarzenia „${kind}"`)
      else if (kind === 'gear_purchase') error('zakup sprzętu zapisuje się w katalogu Sprzęt, nie w skrzynce')
      if (end && !spec.range) error(`typ „${kind}" jest jednodniowy — bez „end"`)
      if (end && end.slice(0, 10) < start.slice(0, 10)) error('koniec przed początkiem')
      if (start.length > 10 && !spec.timed) error(`typ „${kind}" nie ma godziny — sama data`)
      const dataParsed = spec.data.safeParse(data)
      const dataChanged = dataParsed.success ? catchDiff(data, dataParsed.data, 'event.data') : 'event.data'
      if (dataChanged) error(`schemat typu poprawiłby pole „${dataChanged}"`)
      if (kind === 'lead_in' && typeof data.campaignId === 'string' && !campaigns.has(data.campaignId)) {
        error(`nie ma kampanii ${data.campaignId}`)
      }
      if (proposal.projectId === null && spec.scope === 'project') error(`typ „${kind}" wymaga projektu`)
      checkProject(proposal.projectId, proposal.newProject)

      const event = eventFromProposal(proposal, proposal.projectId ?? null, 'walidacja')
      const stored = eventSchema.safeParse(event)
      const storedChanged = stored.success ? catchDiff(event, stored.data, 'wydarzenie') : 'wydarzenie'
      if (storedChanged) error(`zapis wydarzenia poprawiłby pole „${storedChanged}"`)

      if (PAST_ONLY_KINDS.has(kind) && start.slice(0, 10) > ctx.today) warn(`data z przyszłości (${start})`)
      if (!skip) {
        const similar = similarEvents(proposal.event, proposal.projectId ?? null, ctx.events)
        similar.forEach((e) => warn(`podobne wydarzenie już jest: ${e.start} ${e.title || e.kind} (${e.id})`))
      }
      if (spec.scope === 'project' && proposal.projectId === undefined && !proposal.newProject && !proposal.client && !proposal.email) {
        warn('bez projektu i bez podpowiedzi (klient / e-mail) — projekt wybierzesz w aplikacji')
      }
    } else if (proposal.type === 'project_update') {
      const keys = Object.keys(proposal.set).filter((k) => proposal.set[k as keyof typeof proposal.set] !== undefined)
      const extra = keys.filter((k) => !(PROJECT_UPDATE_FIELDS as readonly string[]).includes(k))
      if (extra.includes('status')) error('status nie jest częścią propozycji — wynika z wydarzeń jako podpowiedź')
      if (extra.length) error(`pola spoza listy: ${extra.join(', ')} (dozwolone: ${PROJECT_UPDATE_FIELDS.join(', ')})`)
      if (keys.length === 0) error('„set" jest pusty')
      checkProject(proposal.projectId, proposal.newProject)
    } else {
      if (!proposal.project.name.trim()) error('nowy projekt bez nazwy')
      const extra = Object.keys(proposal.project).filter(
        (k) => !['name', 'client', 'date', 'leadSource', 'contact'].includes(k)
      )
      if (extra.includes('status')) error('status nie jest częścią propozycji — nowy projekt startuje jako wycena')
      else if (extra.length) error(`pola spoza listy: ${extra.join(', ')}`)
    }
    if (!proposal.threadId && !proposal.client && !proposal.email) {
      warn('bez wątku, klienta i e-maila — będzie osobną grupą w skrzynce')
    }

    if (skip) result.skipped.push({ ref: proposal.ref, title: proposalTitle(proposal), why: skip })
    else result.proposals.push(proposal)
  })

  if (result.errors.length) result.proposals = []
  return result
}

/** Linijka podsumowania propozycji dla konsoli. */
export function describeProposal(proposal: Proposal, projectName: (id: string) => string | undefined): string {
  const date = proposalDate(proposal) || 'bez daty'
  const label = proposal.type === 'event' ? proposal.event.kind : proposal.type
  const target =
    proposal.type === 'project_new'
      ? ''
      : proposal.projectId
        ? ` → ${projectName(proposal.projectId) ?? proposal.projectId}`
        : proposal.newProject
          ? ` → nowy projekt (${proposal.newProject})`
          : proposal.type === 'event' && proposal.projectId === null
            ? ' → bez projektu'
            : ' → projekt do wyboru'
  return `[${label}] ${date} · ${proposalTitle(proposal)}${target}`
}
