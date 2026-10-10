/**
 * Ścisła walidacja propozycji PRZED zapisem do `inbox/` (`npm run data -- inbox`).
 *
 * Aplikacja czyta skrzynkę wyrozumiale (`parseInboxFile`): uszkodzona
 * propozycja po cichu odpada albo `.catch` podmienia złe pole. Przy zapisie
 * ma być odwrotnie — głośno. Te same schematy, ale:
 *  - błąd schematu ALBO pole, które schemat by „poprawił", zatrzymuje zapis,
 *  - wydarzenie przechodzi przez `eventSchema` i schemat `data` swojego typu,
 *  - wskazany projekt / kampania / nowy projekt muszą istnieć,
 *  - `event_update`: wydarzenie musi istnieć, zmienia tylko projekt (gdy go
 *    nie ma), godzinę i pola `data` (przez schemat typu); propozycja, która
 *    niczego by nie zmieniła, jest pomijana,
 *  - status projektu nie może być częścią propozycji,
 *  - `ref` już znany (wydarzenia — `source.ref` i `updatedFrom`, także
 *    usunięte; decyzje; inne pliki skrzynki) → propozycja pominięta, nie błąd:
 *    ponowny import jest no-opem.
 *
 * Moduł czysty — testy w `inbox.test.ts`.
 */

import { isDeepStrictEqual } from 'node:util'
import { eventKind, isKnownKind } from './event-kinds'
import { eventSchema, type TimelineEvent } from './event-types'
import {
  eventFromProposal,
  eventUpdateRefs,
  planEventUpdate,
  proposalDate,
  proposalTitle,
  similarEvents,
} from './inbox'
import {
  EVENT_UPDATE_FIELDS,
  INBOX_FORMAT,
  INBOX_VERSION,
  inboxSyncSchema,
  isFinalDecision,
  PROJECT_UPDATE_FIELDS,
  proposalSchema,
  type InboxDecision,
  type InboxSync,
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
  /** `ref` propozycji `project_new` z innych plików skrzynki → plik (cel `newProjectRef`). */
  projectNewRefs: Map<string, string>
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
  /** Okno przeglądu poczty z nagłówka (`npm run data -- inbox-status` liczy od niego). */
  sync?: InboxSync
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
  if (header.sync !== undefined) {
    const sync = inboxSyncSchema.safeParse(header.sync)
    const from = sync.success ? Date.parse(sync.data.from) : NaN
    const to = sync.success ? Date.parse(sync.data.to) : NaN
    if (!sync.success) result.errors.push(`sync: ${sync.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
    else if (Number.isNaN(from) || Number.isNaN(to)) result.errors.push('sync: „from" i „to" muszą być datami (ISO)')
    else if (from > to) result.errors.push('sync: „from" po „to"')
    else result.sync = sync.data
  }

  const liveProjects = new Map(ctx.projects.filter((p) => !p.deletedAt).map((p) => [p.id, p]))
  const deletedProjects = new Set(ctx.projects.filter((p) => p.deletedAt).map((p) => p.id))
  const campaigns = new Set(ctx.campaigns.map((c) => c.id))
  const eventRefs = new Map<string, TimelineEvent>()
  ctx.events.forEach((e) => {
    if (e.source?.ref) eventRefs.set(e.source.ref, e)
    eventUpdateRefs(e).forEach((ref) => eventRefs.set(ref, e))
  })
  const eventsById = new Map(ctx.events.map((e) => [e.id, e]))
  const decisions = new Map(ctx.decisions.filter(isFinalDecision).map((d) => [d.ref, d]))
  const rawProposals = header.proposals as unknown[]
  const projectNews = rawProposals.filter(
    (p): p is { type: string; id: string; ref: string } =>
      !!p && typeof p === 'object' && (p as { type?: unknown }).type === 'project_new'
  )
  const newProjectIds = new Set(projectNews.map((p) => p.id))
  const newProjectRefs = new Set(projectNews.map((p) => p.ref))
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

    const checkProject = (projectId: string | null | undefined, newProject: string | undefined, newProjectRef?: string) => {
      if (projectId) {
        if (deletedProjects.has(projectId)) error(`projekt ${projectId} jest usunięty`)
        else if (!liveProjects.has(projectId)) error(`nie ma projektu ${projectId}`)
      }
      if (newProject && !newProjectIds.has(newProject)) error(`newProject „${newProject}" nie wskazuje propozycji project_new z tego pliku`)
      if (newProjectRef) {
        const decision = ctx.decisions.find((d) => d.ref === newProjectRef && isFinalDecision(d))
        if (decision?.decision === 'rejected') error(`newProjectRef „${newProjectRef}": ten nowy projekt odrzucono`)
        else if (decision?.decision === 'accepted') {
          warn(`newProjectRef „${newProjectRef}": projekt już założony${decision.projectId ? ` (${decision.projectId}) — prościej podać projectId` : ''}`)
        } else if (!newProjectRefs.has(newProjectRef) && !ctx.projectNewRefs.has(newProjectRef)) {
          error(`newProjectRef „${newProjectRef}" nie wskazuje propozycji project_new w skrzynce`)
        }
      }
      if ([projectId, newProject, newProjectRef].filter(Boolean).length > 1) {
        error('podaj tylko jedno z: projectId, newProject, newProjectRef')
      }
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
      checkProject(proposal.projectId, proposal.newProject, proposal.newProjectRef)

      const event = eventFromProposal(proposal, proposal.projectId ?? null, 'walidacja')
      const stored = eventSchema.safeParse(event)
      const storedChanged = stored.success ? catchDiff(event, stored.data, 'wydarzenie') : 'wydarzenie'
      if (storedChanged) error(`zapis wydarzenia poprawiłby pole „${storedChanged}"`)

      if (PAST_ONLY_KINDS.has(kind) && start.slice(0, 10) > ctx.today) warn(`data z przyszłości (${start})`)
      if (!skip) {
        const similar = similarEvents(proposal.event, proposal.projectId ?? null, ctx.events)
        similar.forEach((e) => warn(`podobne wydarzenie już jest: ${e.start} ${e.title || e.kind} (${e.id})`))
      }
      if (
        spec.scope === 'project' &&
        proposal.projectId === undefined &&
        !proposal.newProject &&
        !proposal.newProjectRef &&
        !proposal.client &&
        !proposal.email
      ) {
        warn('bez projektu i bez podpowiedzi (klient / e-mail) — projekt wybierzesz w aplikacji')
      }
    } else if (proposal.type === 'event_update') {
      const keys = Object.keys(proposal.set).filter((k) => proposal.set[k as keyof typeof proposal.set] !== undefined)
      const extra = keys.filter((k) => !(EVENT_UPDATE_FIELDS as readonly string[]).includes(k))
      if (extra.some((k) => ['status', 'kind', 'start', 'end', 'deletedAt', 'projectId'].includes(k))) {
        error(`event_update nie zmienia: ${extra.join(', ')} (dozwolone: ${EVENT_UPDATE_FIELDS.join(', ')}; projekt przez linkProject)`)
      } else if (extra.length) error(`pola spoza listy: ${extra.join(', ')} (dozwolone: ${EVENT_UPDATE_FIELDS.join(', ')})`)
      if (proposal.set.linkProject === false) error('linkProject: tylko true (odpinanie od projektu nie jest propozycją)')
      const hasData = !!proposal.set.data && Object.keys(proposal.set.data).length > 0
      if (!proposal.set.linkProject && !proposal.set.time && !hasData) error('„set" niczego nie zmienia')
      if ((proposal.projectId || proposal.newProject || proposal.newProjectRef) && !proposal.set.linkProject) {
        error('projekt podany bez linkProject')
      }
      checkProject(proposal.projectId, proposal.newProject, proposal.newProjectRef)

      const event = eventsById.get(proposal.eventId)
      if (!event) {
        error(`nie ma wydarzenia ${proposal.eventId}`)
      } else if (!event.deletedAt) {
        const spec = eventKind(event.kind)
        if (proposal.set.time && !spec.timed) error(`typ „${event.kind}" nie ma godziny`)
        if (proposal.set.linkProject && spec.scope === 'business') error(`typ „${event.kind}" nie należy do projektu`)
        if (proposal.set.linkProject && event.projectId && proposal.ifMissing) {
          warn(`wydarzenie jest już w projekcie ${event.projectId} — przy ifMissing zostaje`)
        }
        if (hasData) {
          const merged = { ...event.data, ...proposal.set.data }
          const parsed = spec.data.safeParse(merged)
          const dataChanged = parsed.success ? catchDiff(proposal.set.data, parsed.data, 'set.data') : 'set.data'
          if (dataChanged) error(`schemat typu „${event.kind}" poprawiłby pole „${dataChanged}"`)
          if (typeof proposal.set.data?.campaignId === 'string' && !campaigns.has(proposal.set.data.campaignId)) {
            error(`nie ma kampanii ${proposal.set.data.campaignId}`)
          }
        }
      }
    } else if (proposal.type === 'project_update') {
      const keys = Object.keys(proposal.set).filter((k) => proposal.set[k as keyof typeof proposal.set] !== undefined)
      const extra = keys.filter((k) => !(PROJECT_UPDATE_FIELDS as readonly string[]).includes(k))
      if (extra.includes('status')) error('status nie jest częścią propozycji — wynika z wydarzeń jako podpowiedź')
      if (extra.length) error(`pola spoza listy: ${extra.join(', ')} (dozwolone: ${PROJECT_UPDATE_FIELDS.join(', ')})`)
      if (keys.length === 0) error('„set" jest pusty')
      checkProject(proposal.projectId, proposal.newProject, proposal.newProjectRef)
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

    // Zmiana, która niczego by nie zmieniła (wydarzenie usunięte albo pola już
    // wypełnione), nie trafia do skrzynki. Projekt do wyboru w aplikacji liczy
    // się jako zmiana, gdy wydarzenie projektu nie ma.
    let noOp: string | null = null
    if (!skip && proposal.type === 'event_update') {
      const event = eventsById.get(proposal.eventId)
      if (event?.deletedAt) noOp = 'wydarzenie jest usunięte'
      else if (event) {
        const pickInApp = proposal.set.linkProject && !proposal.projectId && (!event.projectId || !proposal.ifMissing)
        const changes = planEventUpdate(event, proposal, proposal.projectId ?? null)
        if (!changes.length && !pickInApp && !proposal.newProject && !proposal.newProjectRef) noOp = 'nic do zmiany'
      }
    }

    const title = proposalTitle(proposal, proposal.type === 'event_update' ? eventsById.get(proposal.eventId)?.title : undefined)
    if (skip || noOp) result.skipped.push({ ref: proposal.ref, title, why: skip ?? noOp! })
    else result.proposals.push(proposal)
  })

  if (result.errors.length) result.proposals = []
  return result
}

/** Linijka podsumowania propozycji dla konsoli. */
export function describeProposal(
  proposal: Proposal,
  projectName: (id: string) => string | undefined,
  eventTitle: (id: string) => string | undefined = () => undefined
): string {
  const date = proposalDate(proposal) || 'bez daty'
  const label = proposal.type === 'event' ? proposal.event.kind : proposal.type
  const needsProject = proposal.type !== 'event_update' || !!proposal.set.linkProject
  const target =
    proposal.type === 'project_new' || !needsProject
      ? ''
      : proposal.projectId
        ? ` → ${projectName(proposal.projectId) ?? proposal.projectId}`
        : proposal.newProject
          ? ` → nowy projekt (${proposal.newProject})`
          : proposal.newProjectRef
            ? ` → nowy projekt (${proposal.newProjectRef})`
            : proposal.type === 'event' && proposal.projectId === null
              ? ' → bez projektu'
              : ' → projekt do wyboru'
  const title = proposalTitle(proposal, proposal.type === 'event_update' ? eventTitle(proposal.eventId) : undefined)
  return `[${label}] ${date} · ${title}${target}`
}
