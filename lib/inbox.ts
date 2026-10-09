/**
 * Skrzynka propozycji — logika ekranu „Skrzynka" (format: `inbox-types.ts`).
 *
 *  - co jeszcze czeka (`pendingProposals`): propozycja znika, gdy jej `ref`
 *    jest w `source.ref` jakiegokolwiek wydarzenia — także usuniętego — albo
 *    ma ostateczną decyzję (przyjęta / odrzucona),
 *  - grupy po wątku Gmaila / kliencie (`groupProposals`),
 *  - podpowiedź projektu (`suggestProjects`, `defaultTarget`),
 *  - akceptacja: wydarzenie z propozycji, uzupełnienie projektu tylko w
 *    pustych polach, nowy projekt, status wyłącznie jako podpowiedź.
 *
 * Moduł czysty — testy w `inbox.test.ts`. Zapisy robi `inbox-context.tsx`
 * przez istniejące store'y (wydarzenia, projekty).
 */

import { clientKey, hasContact } from './clients'
import { draftFromEvent, eventFromDraft, type EventDraft } from './event-draft'
import { eventKind, isKnownKind, statusSuggestion } from './event-kinds'
import { createEventId, isEventDate, type TimelineEvent } from './event-types'
import {
  isFinalDecision,
  PROJECT_UPDATE_FIELDS,
  refMessageId,
  type EventProposal,
  type InboxDecision,
  type InboxDecisionValue,
  type NewProjectFields,
  type ParsedInboxFile,
  type ProjectFields,
  type Proposal,
  type ProposedEvent,
} from './inbox-types'
import { originForPlatform } from './marketing-types'
import type { Project, ProjectContact, ProjectStatus } from './project-types'

// ── Co czeka ─────────────────────────────────────────────────────────────────

export interface PendingProposal {
  /** = `proposal.ref` (unikalny wśród oczekujących). */
  key: string
  /** Nazwa pliku w `inbox/`. */
  file: string
  proposal: Proposal
}

type SourcedEvent = Pick<TimelineEvent, 'source'>

/** Refy, które są już „załatwione": w wydarzeniach (z usuniętymi) albo w decyzjach. */
export function knownRefs(allEvents: SourcedEvent[], decisions: InboxDecision[]): Set<string> {
  const refs = new Set<string>()
  allEvents.forEach((e) => {
    if (e.source?.ref) refs.add(e.source.ref)
  })
  decisions.forEach((d) => {
    if (isFinalDecision(d)) refs.add(d.ref)
  })
  return refs
}

export interface PendingResult {
  pending: PendingProposal[]
  /** Propozycje z plików, które już rozpatrzono (wydarzenie albo decyzja). */
  handled: number
  /** Ten sam `ref` w kilku plikach — liczy się pierwszy (pliki po nazwie). */
  duplicates: number
}

/**
 * Oczekujące propozycje ze wszystkich czytelnych plików. `allEvents` MUSI
 * zawierać usunięte wydarzenia — usunięcie przyjętej propozycji nie może jej
 * wskrzesić przy następnym imporcie.
 */
export function pendingProposals(
  files: ParsedInboxFile[],
  allEvents: SourcedEvent[],
  decisions: InboxDecision[]
): PendingResult {
  const known = knownRefs(allEvents, decisions)
  const seen = new Set<string>()
  const pending: PendingProposal[] = []
  let handled = 0
  let duplicates = 0
  ;[...files]
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((file) => {
      if (file.status !== 'ok') return
      file.proposals.forEach((proposal) => {
        if (known.has(proposal.ref)) handled += 1
        else if (seen.has(proposal.ref)) duplicates += 1
        else {
          seen.add(proposal.ref)
          pending.push({ key: proposal.ref, file: file.name, proposal })
        }
      })
    })
  return { pending, handled, duplicates }
}

// ── Opis propozycji ──────────────────────────────────────────────────────────

/** Data propozycji do sortowania i wyświetlania (`YYYY-MM-DD[THH:mm]`, może być pusta). */
export function proposalDate(proposal: Proposal): string {
  if (proposal.type === 'event') return proposal.event.start
  if (proposal.type === 'project_new' && proposal.project.date) return proposal.project.date
  const date = proposal.evidence?.date ?? ''
  return isEventDate(date.slice(0, 16)) ? date.slice(0, 16) : isEventDate(date.slice(0, 10)) ? date.slice(0, 10) : ''
}

const FIELD_LABELS: Record<string, string> = { contact: 'kontakt', leadSource: 'pochodzenie', client: 'klient' }

export function proposalTitle(proposal: Proposal): string {
  if (proposal.type === 'event') return proposal.event.title.trim() || eventKind(proposal.event.kind).label
  if (proposal.type === 'project_new') return `Nowy projekt: ${proposal.project.name}`
  const fields = PROJECT_UPDATE_FIELDS.filter((key) => proposal.set[key] !== undefined).map((key) => FIELD_LABELS[key])
  return `Uzupełnienie projektu: ${fields.join(', ') || 'brak pól'}`
}

/** Adresy e-mail z propozycji (podpowiedź + kontakt w leadzie / nowym projekcie). */
export function proposalEmails(proposal: Proposal): string[] {
  const out = new Set<string>()
  const add = (value: unknown) => {
    const email = normalizeEmail(value)
    if (email) out.add(email)
  }
  add(proposal.email)
  if (proposal.type === 'event') add(proposal.event.data?.email)
  if (proposal.type === 'project_update') add(proposal.set.contact?.email)
  if (proposal.type === 'project_new') add(proposal.project.contact?.email)
  return [...out]
}

export function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string') return ''
  const match = value.trim().toLowerCase().match(/[^\s<>"']+@[^\s<>"']+\.[a-z]{2,}/)
  return match ? match[0] : ''
}

/** Skrzynki ogólnodostępne — ta sama domena NIE znaczy tu „ta sama firma". */
const FREE_MAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'wp.pl', 'o2.pl', 'onet.pl', 'onet.eu', 'op.pl', 'interia.pl', 'interia.eu',
  'poczta.fm', 'gazeta.pl', 'tlen.pl', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'icloud.com',
  'me.com', 'mac.com', 'yahoo.com', 'proton.me', 'protonmail.com', 'aol.com', 'gmx.com', 'gmx.de', 'web.de',
])

/** Domena firmowa adresu albo pusty string (skrzynki ogólnodostępne się nie liczą). */
export function companyDomain(email: string): string {
  const domain = normalizeEmail(email).split('@')[1] ?? ''
  return domain && !FREE_MAIL_DOMAINS.has(domain) ? domain : ''
}

// ── Grupy ────────────────────────────────────────────────────────────────────

export interface ProposalGroup {
  key: string
  threadId: string | null
  /** Temat wątku albo klient. */
  title: string
  client: string
  emails: string[]
  items: PendingProposal[]
  /** Najpóźniejsza data w grupie — grupy z najświeższą aktywnością u góry. */
  latest: string
}

function rawGroupKey(p: Proposal): string {
  if (p.threadId) return `thread:${p.threadId}`
  const client = clientKey(p.client ?? '')
  if (client) return `client:${client}`
  const email = proposalEmails(p)[0]
  return email ? `email:${email}` : `ref:${p.ref}`
}

/**
 * project_new na górze, potem chronologicznie (bez daty na końcu); przy
 * remisie wydarzenie przed uzupełnieniem projektu.
 */
function itemOrder(a: PendingProposal, b: PendingProposal): number {
  const rank = (p: Proposal) => (p.type === 'project_new' ? 0 : 1)
  const typeTie = (p: Proposal) => (p.type === 'event' ? 0 : 1)
  const date = (p: Proposal) => proposalDate(p) || '9999'
  return (
    rank(a.proposal) - rank(b.proposal) ||
    date(a.proposal).localeCompare(date(b.proposal)) ||
    typeTie(a.proposal) - typeTie(b.proposal) ||
    a.key.localeCompare(b.key)
  )
}

/**
 * Grupy po wątku (a bez wątku — po kliencie / mailu). Propozycja wskazująca
 * nowy projekt (`newProject`) ląduje w grupie tej propozycji projektu.
 */
export function groupProposals(pending: PendingProposal[]): ProposalGroup[] {
  const keyOf = new Map<PendingProposal, string>()
  pending.forEach((item) => keyOf.set(item, rawGroupKey(item.proposal)))
  pending.forEach((item) => {
    const p = item.proposal
    if (p.type === 'project_new' || !p.newProject) return
    const owner = pending.find(
      (other) => other.file === item.file && other.proposal.type === 'project_new' && other.proposal.id === p.newProject
    )
    if (owner) keyOf.set(item, keyOf.get(owner)!)
  })

  const groups = new Map<string, PendingProposal[]>()
  pending.forEach((item) => {
    const key = keyOf.get(item)!
    groups.set(key, [...(groups.get(key) ?? []), item])
  })

  return [...groups.entries()]
    .map(([key, list]) => {
      const items = [...list].sort(itemOrder)
      const proposals = items.map((i) => i.proposal)
      const subject = proposals.map((p) => p.evidence?.subject?.trim()).find(Boolean)
      const client =
        proposals.map((p) => p.client?.trim()).find(Boolean) ??
        proposals.map((p) => (p.type === 'project_new' ? p.project.client.trim() : '')).find(Boolean) ??
        ''
      const latest = proposals.map(proposalDate).sort().at(-1) ?? ''
      return {
        key,
        threadId: proposals.map((p) => p.threadId).find(Boolean) ?? null,
        title: subject || client || proposalTitle(proposals[0]),
        client,
        emails: [...new Set(proposals.flatMap(proposalEmails))],
        items,
        latest,
      }
    })
    .sort((a, b) => b.latest.localeCompare(a.latest) || a.key.localeCompare(b.key))
}

// ── Dopasowanie do projektu ──────────────────────────────────────────────────

export const SUGGESTION_REASONS = ['claude', 'thread', 'email', 'domain', 'client'] as const
export type SuggestionReason = (typeof SUGGESTION_REASONS)[number]

export const SUGGESTION_LABELS: Record<SuggestionReason, string> = {
  claude: 'wskazany w propozycji',
  thread: 'ten sam wątek',
  email: 'ten sam e-mail',
  domain: 'ta sama domena',
  client: 'ten sam klient',
}

export interface ProjectSuggestion {
  projectId: string
  reason: SuggestionReason
}

type MatchProject = Pick<Project, 'id' | 'client' | 'date' | 'updatedAt' | 'contact'>
type MatchEvent = Pick<TimelineEvent, 'projectId' | 'kind' | 'data' | 'source' | 'deletedAt'>

/** Projekt wskazany przez propozycje grupy (`projectId`), jeśli istnieje. */
function claudePicks(group: ProposalGroup): string[] {
  return group.items
    .map(({ proposal: p }) => (p.type === 'project_new' ? undefined : p.projectId))
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
}

/**
 * Projekty pasujące do grupy, od najpewniejszego: wskazany przez Claude'a →
 * ten sam wątek (wydarzenie z tej samej wiadomości / wątku) → ten sam e-mail
 * → ta sama domena firmowa → ten sam klient. Każdy projekt raz, z najlepszym
 * powodem; przy remisie nowszy projekt wyżej. `projects` = widoczne projekty.
 */
export function suggestProjects(
  group: ProposalGroup,
  projects: MatchProject[],
  events: MatchEvent[]
): ProjectSuggestion[] {
  const visible = new Map(projects.map((p) => [p.id, p]))
  const best = new Map<string, SuggestionReason>()
  const offer = (projectId: string | null | undefined, reason: SuggestionReason) => {
    if (!projectId || !visible.has(projectId)) return
    const current = best.get(projectId)
    if (!current || SUGGESTION_REASONS.indexOf(reason) < SUGGESTION_REASONS.indexOf(current)) best.set(projectId, reason)
  }

  claudePicks(group).forEach((id) => offer(id, 'claude'))

  const messageIds = new Set(group.items.map((i) => refMessageId(i.key)))
  if (group.threadId) messageIds.add(group.threadId)
  const liveEvents = events.filter((e) => !e.deletedAt && e.projectId)
  liveEvents.forEach((e) => {
    const ref = e.source?.ref ?? ''
    const threadId = typeof e.source?.threadId === 'string' ? e.source.threadId : ''
    if ((ref && messageIds.has(refMessageId(ref))) || (threadId && threadId === group.threadId)) offer(e.projectId, 'thread')
  })

  const emails = new Set(group.emails)
  const domains = new Set([...emails].map(companyDomain).filter(Boolean))
  const projectEmails = new Map<string, Set<string>>()
  const addProjectEmail = (projectId: string | null, value: unknown) => {
    const email = normalizeEmail(value)
    if (!projectId || !email) return
    projectEmails.set(projectId, new Set([...(projectEmails.get(projectId) ?? []), email]))
  }
  projects.forEach((p) => addProjectEmail(p.id, p.contact?.email))
  liveEvents.forEach((e) => {
    if (e.kind === 'lead_in') addProjectEmail(e.projectId, e.data?.email)
  })
  projectEmails.forEach((list, projectId) => {
    if ([...list].some((email) => emails.has(email))) offer(projectId, 'email')
    else if ([...list].some((email) => domains.has(companyDomain(email)))) offer(projectId, 'domain')
  })

  const key = clientKey(group.client)
  if (key) projects.forEach((p) => clientKey(p.client ?? '') === key && offer(p.id, 'client'))

  const recency = (id: string) => {
    const p = visible.get(id)!
    return `${p.date ?? ''}|${p.updatedAt ?? ''}`
  }
  return [...best.entries()]
    .map(([projectId, reason]) => ({ projectId, reason }))
    .sort(
      (a, b) =>
        SUGGESTION_REASONS.indexOf(a.reason) - SUGGESTION_REASONS.indexOf(b.reason) ||
        recency(b.projectId).localeCompare(recency(a.projectId))
    )
}

// ── Cel grupy ────────────────────────────────────────────────────────────────

export type InboxTarget =
  | { type: 'existing'; projectId: string }
  /** `fromRef` = propozycja `project_new`, z której pochodzą pola (jej akceptacja zakłada projekt). */
  | { type: 'new'; fields: NewProjectFields; fromRef?: string }
  /** Świadomie bez projektu (np. fałszywy lead). */
  | { type: 'none' }
  /** Jeszcze nie wybrano — wydarzenia projektu czekają na wybór. */
  | { type: 'unset' }

/**
 * Projekt założony już z propozycji `project_new` tej grupy: wskazanej przez
 * `newProject` albo z tego samego wątku. Reszta wątku trafia wtedy do niego,
 * zamiast proponować drugi nowy projekt.
 */
export function acceptedNewProjectId(
  group: ProposalGroup,
  files: ParsedInboxFile[],
  decisions: InboxDecision[]
): string | null {
  const accepted = (ref: string) => decisions.find((d) => d.ref === ref && d.decision === 'accepted')?.projectId ?? null
  for (const { file, proposal } of group.items) {
    if (proposal.type === 'project_new' || !proposal.newProject) continue
    const source = files.find((f) => f.name === file)
    const owner =
      source?.status === 'ok'
        ? source.proposals.find((p) => p.type === 'project_new' && p.id === proposal.newProject)
        : undefined
    const projectId = owner ? accepted(owner.ref) : null
    if (projectId) return projectId
  }
  if (!group.threadId) return null
  for (const file of files) {
    if (file.status !== 'ok') continue
    for (const p of file.proposals) {
      const projectId = p.type === 'project_new' && p.threadId === group.threadId ? accepted(p.ref) : null
      if (projectId) return projectId
    }
  }
  return null
}

/** Pola nowego projektu z grupy: z propozycji `project_new` albo z leada. */
export function newProjectFieldsFor(
  group: ProposalGroup,
  campaigns: { id: string; platform: string }[] = []
): { fields: NewProjectFields; fromRef?: string } {
  const proposed = group.items.find((i) => i.proposal.type === 'project_new')
  if (proposed && proposed.proposal.type === 'project_new') {
    return { fields: { ...proposed.proposal.project }, fromRef: proposed.key }
  }
  const lead = group.items
    .map((i) => i.proposal)
    .find((p): p is EventProposal => p.type === 'event' && p.event.kind === 'lead_in')
  const first = group.items[0]?.proposal
  const data = lead?.event.data ?? {}
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
  const contact: ProjectContact = {
    name: text(data.contactName),
    email: text(data.email) || group.emails[0] || '',
    phone: text(data.phone),
  }
  const campaign = campaigns.find((c) => c.id === text(data.campaignId))
  const leadSource = campaign ? originForPlatform(campaign.platform) : text(data.origin)
  const name = group.client || lead?.event.title.trim() || (first ? proposalTitle(first) : '')
  const date = (lead?.event.start ?? (first ? proposalDate(first) : '')).slice(0, 10)
  return {
    fields: {
      name,
      client: group.client,
      ...(/^\d{4}-\d{2}-\d{2}$/.test(date) ? { date } : {}),
      ...(leadSource ? { leadSource } : {}),
      ...(hasContact(contact) ? { contact } : {}),
    },
  }
}

/**
 * Domyślny cel grupy. Kolejność: projekt założony już z tej grupy → projekt
 * wskazany przez Claude'a → proponowany nowy projekt → JEDYNY projekt z tego
 * samego wątku albo z tym samym e-mailem → „bez projektu", gdy Claude tak
 * wskazał → nie wybrano. Domena i nazwa klienta tylko podpowiadają (u
 * stałych klientów jest kilka projektów).
 */
export function defaultTarget(
  group: ProposalGroup,
  suggestions: ProjectSuggestion[],
  acceptedProjectId: string | null,
  campaigns: { id: string; platform: string }[] = []
): InboxTarget {
  if (acceptedProjectId) return { type: 'existing', projectId: acceptedProjectId }

  const claude = suggestions.filter((s) => s.reason === 'claude')
  if (claude.length === 1) return { type: 'existing', projectId: claude[0].projectId }

  if (group.items.some((i) => i.proposal.type === 'project_new')) {
    const { fields, fromRef } = newProjectFieldsFor(group, campaigns)
    return { type: 'new', fields, fromRef }
  }

  for (const reason of ['thread', 'email'] as const) {
    const matches = suggestions.filter((s) => s.reason === reason)
    if (matches.length === 1) return { type: 'existing', projectId: matches[0].projectId }
    if (matches.length > 1) return { type: 'unset' }
  }

  const events = group.items.map((i) => i.proposal).filter((p): p is EventProposal => p.type === 'event')
  if (events.length === group.items.length && events.every((p) => p.projectId === null)) return { type: 'none' }
  return { type: 'unset' }
}

// ── Akceptacja ───────────────────────────────────────────────────────────────

export type ProposalProblem = 'kind' | 'date' | 'end' | 'project' | 'projectName'

export const PROPOSAL_PROBLEM_TEXT: Record<ProposalProblem, string> = {
  kind: 'Tego typu wydarzenia nie da się przyjąć ze skrzynki.',
  date: 'Niepoprawna data.',
  end: 'Koniec nie może być przed początkiem.',
  project: 'Wybierz projekt albo „Nowy projekt".',
  projectName: 'Nadaj nazwę nowemu projektowi.',
}

/** Typy, których nie przyjmujemy ze skrzynki: zakup sprzętu żyje w katalogu (plan §3.4). */
const NOT_FROM_INBOX = new Set(['gear_purchase'])

export function proposalProblems(proposal: Proposal, target: InboxTarget): ProposalProblem[] {
  const problems: ProposalProblem[] = []
  const hasProject = target.type === 'existing' || target.type === 'new'
  if (target.type === 'new' && !target.fields.name.trim()) problems.push('projectName')
  if (proposal.type === 'event') {
    const { kind, start, end } = proposal.event
    if (!isKnownKind(kind) || NOT_FROM_INBOX.has(kind)) problems.push('kind')
    if (!isEventDate(start)) problems.push('date')
    if (end && (!isEventDate(end) || end.slice(0, 10) < start.slice(0, 10))) problems.push('end')
    if (eventKind(kind).scope === 'project' && !hasProject) problems.push('project')
  } else if (!hasProject) {
    problems.push('project')
  }
  return problems
}

/** Źródło przyjętego wydarzenia — `ref` deduplikuje kolejne importy. */
export function inboxEventSource(proposal: Proposal, file: string): TimelineEvent['source'] {
  return {
    type: proposal.ref.startsWith('gmail:') ? 'gmail' : 'inbox',
    ref: proposal.ref,
    ...(proposal.threadId ? { threadId: proposal.threadId } : {}),
    inboxFile: file,
  }
}

/** Wydarzenie do zapisu z (ew. poprawionej) propozycji. `now` jawnie — testy. */
export function eventFromProposal(
  proposal: EventProposal,
  projectId: string | null,
  file: string,
  now: Date = new Date()
): TimelineEvent {
  const kind = eventKind(proposal.event.kind)
  const { start, end, title, notes, data } = proposal.event
  const nowIso = now.toISOString()
  return {
    id: createEventId(),
    kind: proposal.event.kind,
    projectId: kind.scope === 'business' ? null : projectId,
    start,
    end: kind.range && end && end.slice(0, 10) > start.slice(0, 10) ? end : undefined,
    title: title.trim(),
    notes: notes.trim(),
    data: { ...data },
    source: inboxEventSource(proposal, file),
    createdAt: nowIso,
    updatedAt: nowIso,
  }
}

type ProjectUpdateFieldKey = 'client' | 'leadSource' | 'contact'

function filled(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Zmiana projektu z pól propozycji. `ifMissing` (domyślnie) uzupełnia tylko
 * puste pola — także w kontakcie pole po polu — i nigdy nie nadpisuje tego,
 * co użytkownik już wpisał. Inne pola niż `PROJECT_UPDATE_FIELDS` (np.
 * status) są ignorowane. Pusty obiekt = nic do zmiany.
 */
export function projectPatchFromFields(
  project: Pick<Project, 'client' | 'leadSource' | 'contact'>,
  fields: ProjectFields,
  ifMissing = true
): Partial<Pick<Project, ProjectUpdateFieldKey>> {
  const patch: Partial<Pick<Project, ProjectUpdateFieldKey>> = {}
  if (filled(fields.client) && (!ifMissing || !filled(project.client)) && fields.client!.trim() !== project.client) {
    patch.client = fields.client!.trim()
  }
  if (
    filled(fields.leadSource) &&
    (!ifMissing || !filled(project.leadSource)) &&
    fields.leadSource !== project.leadSource
  ) {
    patch.leadSource = fields.leadSource!.trim()
  }
  if (fields.contact && hasContact(fields.contact)) {
    const current = project.contact ?? { name: '', email: '', phone: '' }
    const next = { ...current }
    ;(['name', 'email', 'phone'] as const).forEach((key) => {
      const value = fields.contact?.[key]
      if (filled(value) && (!ifMissing || !filled(current[key]))) next[key] = value!.trim()
    })
    if ((['name', 'email', 'phone'] as const).some((key) => next[key] !== current[key])) patch.contact = next
  }
  return patch
}

/**
 * Status do ZAPROPONOWANIA po przyjęciu kilku wydarzeń naraz (np. „zaakceptuj
 * wszystkie z wątku"): najdalszy krok naprzód, jak w kalendarzu. `null` = nic.
 */
export function statusAfter(current: ProjectStatus, kinds: string[]): ProjectStatus | null {
  let status = current
  kinds.forEach((kind) => {
    status = statusSuggestion(status, kind) ?? status
  })
  return status === current ? null : status
}

/** Rekord decyzji (id = ref, więc jedna decyzja na propozycję). */
export function decisionRecord(
  item: PendingProposal,
  decision: InboxDecisionValue,
  extra: { projectId?: string; eventId?: string } = {},
  now: Date = new Date()
): InboxDecision {
  return {
    id: item.key,
    ref: item.key,
    decision,
    at: now.toISOString(),
    type: item.proposal.type,
    title: proposalTitle(item.proposal),
    file: item.file,
    proposalId: item.proposal.id,
    ...(extra.projectId ? { projectId: extra.projectId } : {}),
    ...(extra.eventId ? { eventId: extra.eventId } : {}),
  }
}

// ── Edycja przed akceptacją ──────────────────────────────────────────────────

function proposalAsEvent(proposal: EventProposal): TimelineEvent {
  return {
    id: proposal.id,
    kind: proposal.event.kind,
    projectId: null,
    start: proposal.event.start,
    end: proposal.event.end,
    title: proposal.event.title,
    notes: proposal.event.notes,
    data: proposal.event.data,
    source: { type: 'inbox', ref: proposal.ref },
    createdAt: '',
    updatedAt: '',
  }
}

/** Szkic formularza wydarzenia (ten sam co w kalendarzu) z propozycji. */
export function draftFromProposal(proposal: EventProposal): EventDraft {
  return draftFromEvent(proposalAsEvent(proposal))
}

/**
 * Propozycja po edycji. Reguły jak w kalendarzu (`eventFromDraft`): klucze
 * `data`, których formularz nie zna (jakość, kampania, kontakt leada), zostają;
 * godzina tylko dla typów z godziną, koniec tylko dla zakresów.
 */
export function proposalWithDraft(proposal: EventProposal, draft: EventDraft): EventProposal {
  const event = eventFromDraft({ ...draft, projectId: null }, proposalAsEvent(proposal))
  return {
    ...proposal,
    event: {
      ...proposal.event,
      kind: event.kind,
      start: event.start,
      end: event.end,
      title: event.title,
      notes: event.notes,
      data: event.data,
    },
  }
}

// ── Możliwe duplikaty ────────────────────────────────────────────────────────

function invoiceNumber(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, '').toLowerCase() : ''
}

function dayDistance(a: string, b: string): number {
  const toDay = (value: string) => Date.UTC(+value.slice(0, 4), +value.slice(5, 7) - 1, +value.slice(8, 10))
  return Math.abs(toDay(a) - toDay(b)) / 86_400_000
}

/**
 * Istniejące wydarzenia, które wyglądają na to samo (inny `ref`, np. wpis
 * ręczny albo import z arkusza): ten sam typ w tym samym projekcie tego
 * samego dnia, faktura o tym samym numerze, lead z tego samego adresu w
 * ciągu tygodnia. Tylko ostrzeżenie — decyzja należy do użytkownika.
 */
export function similarEvents(
  event: Pick<ProposedEvent, 'kind' | 'start' | 'data'>,
  projectId: string | null,
  events: TimelineEvent[]
): TimelineEvent[] {
  const day = event.start.slice(0, 10)
  const number = invoiceNumber(event.data?.number)
  const email = normalizeEmail(event.data?.email)
  return events.filter((e) => {
    if (e.deletedAt || e.kind !== event.kind || !isEventDate(e.start)) return false
    if (projectId && e.projectId === projectId && e.start.slice(0, 10) === day) return true
    if (number && (e.kind === 'invoice_sent' || e.kind === 'invoice_paid') && invoiceNumber(e.data?.number) === number) {
      return true
    }
    return (
      e.kind === 'lead_in' && !!email && normalizeEmail(e.data?.email) === email && dayDistance(e.start, day) <= 7
    )
  })
}
