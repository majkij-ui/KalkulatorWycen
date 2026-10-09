/**
 * Skrzynka propozycji — format plików `inbox/*.json` w folderze danych huba
 * (plan §5a, „Lane 1: inbox").
 *
 * Wszystko, co pochodzi z poczty, trafia do aplikacji jako PROPOZYCJA. Claude
 * (rozmowa z konektorem Gmail) zapisuje pliki przez `npm run data -- inbox`,
 * aplikacja je tylko CZYTA i pokazuje w ekranie „Skrzynka". Dopiero akceptacja
 * zapisuje wydarzenie / projekt przez zwykłe store'y; decyzję (przyjęta albo
 * odrzucona) aplikacja zapamiętuje we własnym pliku `inbox-decisions.json`.
 * Pliki w `inbox/` zostają nietknięte — to ślad, co i kiedy zaproponowano.
 *
 * Trzy rodzaje propozycji (`type`):
 *  - `event`          — nowe wydarzenie w wątku (lead, odpowiedź, wycena
 *                       wysłana, akceptacja, faktura wysłana/opłacona…),
 *  - `project_update` — uzupełnienie projektu (kontakt, pochodzenie, klient),
 *  - `project_new`    — nowy projekt (bez wyceny).
 *
 * `ref` to klucz deduplikacji: `gmail:<id wiadomości>`, a gdy jedna wiadomość
 * daje kilka faktów — z przyrostkiem (`gmail:<id>#contact`, `#reply`). Ten
 * sam `ref` ląduje w `source.ref` przyjętego wydarzenia, więc propozycja nie
 * wraca ani po akceptacji, ani po usunięciu wydarzenia (usunięcie jest
 * miękkie), ani po odrzuceniu (decyzja w `inbox-decisions.json`).
 *
 * Schematy celowo wyrozumiałe przy ODCZYCIE (passthrough, `.catch`), jak cała
 * reszta danych v3. Ścisła walidacja — w `inbox-validate.ts`, przy zapisie.
 * Status projektu NIGDY nie jest częścią propozycji: wynika z wydarzeń jako
 * podpowiedź do potwierdzenia, tak jak w kalendarzu.
 *
 * Moduł czysty — bez Tauri/React.
 */

import { z } from 'zod'
import { EVENT_DATE_PATTERN } from './event-types'
import { projectContactSchema } from './project-types'

/** Podfolder folderu danych huba, z którego aplikacja czyta propozycje. */
export const INBOX_DIR = 'inbox'
/** Plik decyzji (przyjęte / odrzucone) — pisze go wyłącznie aplikacja. */
export const INBOX_DECISIONS_FILE = 'inbox-decisions.json'

export const INBOX_FORMAT = 'nonoise-hub-inbox'
/**
 * Wersja formatu. Zmiany addytywne (nowe pola) NIE podbijają wersji. Plik z
 * wyższą wersją aplikacja pokazuje jako „nowszy format" i go nie przetwarza —
 * nie zgaduje znaczenia zmiany łamiącej.
 */
export const INBOX_VERSION = 1

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

/** Pola projektu, które propozycja może uzupełnić. Status celowo nie. */
export const PROJECT_UPDATE_FIELDS = ['contact', 'leadSource', 'client'] as const
export type ProjectUpdateField = (typeof PROJECT_UPDATE_FIELDS)[number]

const optionalText = z.string().optional().catch(undefined)

/** Skąd wiadomo — pokazywane w podglądzie propozycji. */
export const inboxEvidenceSchema = z
  .object({
    from: optionalText,
    to: optionalText,
    subject: optionalText,
    /** Data wiadomości (ISO z godziną albo `YYYY-MM-DD`). */
    date: optionalText,
    /** Krótki wycinek treści. */
    snippet: optionalText,
  })
  .passthrough()
export type InboxEvidence = z.infer<typeof inboxEvidenceSchema>

const proposalBase = {
  /** Id propozycji, unikalne w obrębie pliku. */
  id: z.string().min(1),
  /** Klucz deduplikacji (`gmail:<id wiadomości>[#fakt]`). */
  ref: z.string().min(1),
  /** Wątek Gmaila — grupowanie i dopasowanie do projektu. */
  threadId: optionalText,
  /** Podpowiedź: klient (firma), z którym toczy się wątek. */
  client: optionalText,
  /** Podpowiedź: adres e-mail klienta. */
  email: optionalText,
  /** Dlaczego Claude to proponuje (jedno zdanie). */
  reason: z.string().catch(''),
  evidence: inboxEvidenceSchema.optional().catch(undefined),
}

/** Wydarzenie tak, jak zapisze się w `events.json` (bez id, projektu i dat zapisu). */
export const proposedEventSchema = z
  .object({
    kind: z.string().min(1),
    start: z.string().regex(EVENT_DATE_PATTERN),
    end: z.string().regex(EVENT_DATE_PATTERN).optional().catch(undefined),
    title: z.string().catch(''),
    notes: z.string().catch(''),
    data: z.record(z.unknown()).catch({}),
  })
  .passthrough()
export type ProposedEvent = z.infer<typeof proposedEventSchema>

export const eventProposalSchema = z
  .object({
    ...proposalBase,
    type: z.literal('event'),
    /**
     * Projekt wskazany przez Claude'a: id istniejącego, `null` = świadomie bez
     * projektu (np. fałszywy lead), brak = bez zdania (podpowie aplikacja).
     */
    projectId: z.string().min(1).nullable().optional().catch(undefined),
    /** Id propozycji `project_new` z tego samego pliku. */
    newProject: optionalText,
    event: proposedEventSchema,
  })
  .passthrough()
export type EventProposal = z.infer<typeof eventProposalSchema>

export const projectFieldsSchema = z
  .object({
    contact: projectContactSchema.optional().catch(undefined),
    leadSource: optionalText,
    client: optionalText,
  })
  .passthrough()
export type ProjectFields = z.infer<typeof projectFieldsSchema>

export const projectUpdateProposalSchema = z
  .object({
    ...proposalBase,
    type: z.literal('project_update'),
    projectId: z.string().min(1).optional().catch(undefined),
    newProject: optionalText,
    set: projectFieldsSchema,
    /** Domyślnie uzupełnia tylko puste pola — nie nadpisuje decyzji użytkownika. */
    ifMissing: z.boolean().catch(true),
  })
  .passthrough()
export type ProjectUpdateProposal = z.infer<typeof projectUpdateProposalSchema>

export const newProjectSchema = z
  .object({
    name: z.string().min(1),
    client: z.string().catch(''),
    /** Data księgowa (`YYYY-MM-DD`), zwykle dzień zapytania. */
    date: z.string().regex(DATE_KEY).optional().catch(undefined),
    leadSource: optionalText,
    contact: projectContactSchema.optional().catch(undefined),
  })
  .passthrough()
export type NewProjectFields = z.infer<typeof newProjectSchema>

export const projectNewProposalSchema = z
  .object({
    ...proposalBase,
    type: z.literal('project_new'),
    project: newProjectSchema,
  })
  .passthrough()
export type ProjectNewProposal = z.infer<typeof projectNewProposalSchema>

export const proposalSchema = z.discriminatedUnion('type', [
  eventProposalSchema,
  projectUpdateProposalSchema,
  projectNewProposalSchema,
])
export type Proposal = z.infer<typeof proposalSchema>
export type ProposalType = Proposal['type']

/** Nagłówek pliku; propozycje czytane pojedynczo (`parseInboxFile`). */
export const inboxFileSchema = z
  .object({
    format: z.literal(INBOX_FORMAT),
    version: z.number().int().positive(),
    createdAt: z.string().catch(''),
    /** Co i skąd (np. „Gmail 1.09–9.10.2026"). */
    note: z.string().catch(''),
    proposals: z.array(z.unknown()).catch([]),
  })
  .passthrough()

// ── Decyzje ──────────────────────────────────────────────────────────────────

/** `reopened` = odrzucenie cofnięte — propozycja znów czeka. */
export const INBOX_DECISIONS = ['accepted', 'rejected', 'reopened'] as const
export type InboxDecisionValue = (typeof INBOX_DECISIONS)[number]

/** Jedna decyzja na `ref` (id rekordu = ref). */
export const inboxDecisionSchema = z
  .object({
    id: z.string().min(1),
    ref: z.string().min(1),
    decision: z.enum(INBOX_DECISIONS).catch('rejected'),
    at: z.string().catch(''),
    /** Co to było — do listy „Rozpatrzone". */
    type: z.string().catch(''),
    title: z.string().catch(''),
    file: optionalText,
    proposalId: optionalText,
    /** Projekt, którego dotyczyła akceptacja (także świeżo założony). */
    projectId: optionalText,
    eventId: optionalText,
  })
  .passthrough()
export type InboxDecision = z.infer<typeof inboxDecisionSchema>

/** Czy decyzja zamyka propozycję (przyjęta albo odrzucona). */
export function isFinalDecision(decision: Pick<InboxDecision, 'decision'>): boolean {
  return decision.decision === 'accepted' || decision.decision === 'rejected'
}

// ── Odczyt pliku ─────────────────────────────────────────────────────────────

export type ParsedInboxFile =
  | {
      name: string
      status: 'ok'
      note: string
      createdAt: string
      proposals: Proposal[]
      /** Propozycje, których nie dało się odczytać (pominięte, nie zgubione — plik zostaje). */
      unreadable: number
    }
  | { name: string; status: 'newer'; version: number }
  | { name: string; status: 'error'; error: string }

/**
 * Odczyt jednego pliku skrzynki. Nigdy nie rzuca: uszkodzona propozycja
 * jest liczona i pomijana, reszta pliku się wczytuje.
 */
export function parseInboxFile(name: string, raw: unknown): ParsedInboxFile {
  const header = inboxFileSchema.safeParse(raw)
  if (!header.success) {
    const formatOk = !!raw && typeof raw === 'object' && (raw as { format?: unknown }).format === INBOX_FORMAT
    return { name, status: 'error', error: formatOk ? 'uszkodzony nagłówek pliku' : 'to nie jest plik skrzynki' }
  }
  if (header.data.version > INBOX_VERSION) return { name, status: 'newer', version: header.data.version }

  const proposals: Proposal[] = []
  let unreadable = 0
  header.data.proposals.forEach((entry) => {
    const parsed = proposalSchema.safeParse(entry)
    if (parsed.success) proposals.push(parsed.data)
    else unreadable += 1
  })
  return { name, status: 'ok', note: header.data.note, createdAt: header.data.createdAt, proposals, unreadable }
}

/** Część `ref` przed `#` bez prefiksu źródła: `gmail:abc#reply` → `abc`. */
export function refMessageId(ref: string): string {
  return ref.replace(/^[a-z]+:/i, '').split('#')[0]
}
