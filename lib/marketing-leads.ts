/**
 * Leady w zakładce Marketing = wydarzenia `lead_in` czytane przez rejestr typów.
 *
 * Odczyt (`readLead`) nigdy nie zmienia zapisu. Zapis (`leadEventFromDraft`)
 * przy edycji startuje od oryginału — pola i klucze `data`, których formularz
 * nie zna (import, nowsza wersja, pola kalendarza), przechodzą nietknięte.
 *
 * Moduł czysty — testy w `marketing-leads.test.ts`.
 */

import { eventData } from './event-kinds'
import { createEventId, isEventDate, type TimelineEvent } from './event-types'
import {
  ADS_TEXT_KEYS,
  AD_CONSENTS,
  generateLeadId,
  hasAds,
  isLeadQuality,
  type LeadAds,
  type LeadQuality,
} from './marketing-types'
import type { ParsedLeadSource } from './lead-source-parse'

export const LEAD_KIND = 'lead_in'

export interface Lead {
  id: string
  /** `YYYY-MM-DD` */
  date: string
  /** `HH:mm` albo `null`. */
  time: string | null
  /** Firma albo osoba, która się zgłosiła. */
  name: string
  projectId: string | null
  quality: LeadQuality | null
  campaignId: string | null
  /** Pochodzenie leada spoza kampanii (klucz `LEAD_SOURCES`), pusty = nieznane. */
  origin: string
  channel: string
  summary: string
  contactName: string
  email: string
  phone: string
  /** Źródło ze strony (`data.ads`); pusty obiekt = lead bez sekcji „Źródło". */
  ads: LeadAds
  notes: string
  event: TimelineEvent
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readAds(value: unknown): LeadAds {
  return isPlainObject(value) ? ({ ...value } as LeadAds) : {}
}

export function isLeadEvent(event: Pick<TimelineEvent, 'kind' | 'deletedAt' | 'start'>): boolean {
  return event.kind === LEAD_KIND && !event.deletedAt && isEventDate(event.start)
}

export function readLead(event: TimelineEvent): Lead {
  const data = eventData(event)
  return {
    id: event.id,
    date: event.start.slice(0, 10),
    time: event.start.length > 10 ? event.start.slice(11, 16) : null,
    name: event.title,
    projectId: event.projectId,
    quality: isLeadQuality(data.quality) ? data.quality : null,
    campaignId: str(data.campaignId) || null,
    origin: str(data.origin),
    channel: str(data.channel),
    summary: str(data.summary),
    contactName: str(data.contactName),
    email: str(data.email),
    phone: str(data.phone),
    ads: readAds(data.ads),
    notes: event.notes,
    event,
  }
}

/** Leady z wydarzeń (bez usuniętych i bez daty), najnowsze u góry. */
export function leadsFromEvents(events: TimelineEvent[]): Lead[] {
  return events
    .filter(isLeadEvent)
    .map(readLead)
    .sort((a, b) => b.event.start.localeCompare(a.event.start) || a.id.localeCompare(b.id))
}

// ── Formularz ────────────────────────────────────────────────────────────────

export interface LeadDraft {
  date: string
  time: string
  name: string
  projectId: string | null
  quality: LeadQuality | null
  campaignId: string | null
  origin: string
  channel: string
  summary: string
  contactName: string
  email: string
  phone: string
  ads: LeadAds
  notes: string
}

export function emptyLeadDraft(params: { date: string; campaignId?: string | null }): LeadDraft {
  return {
    date: params.date,
    time: '',
    name: '',
    projectId: null,
    quality: 'good',
    campaignId: params.campaignId ?? null,
    origin: '',
    channel: '',
    summary: '',
    contactName: '',
    email: '',
    phone: '',
    ads: {},
    notes: '',
  }
}

export function draftFromLead(lead: Lead): LeadDraft {
  return {
    date: lead.date,
    time: lead.time ?? '',
    name: lead.name,
    projectId: lead.projectId,
    quality: lead.quality,
    campaignId: lead.campaignId,
    origin: lead.origin,
    channel: lead.channel,
    summary: lead.summary,
    contactName: lead.contactName,
    email: lead.email,
    phone: lead.phone,
    ads: { ...lead.ads },
    notes: lead.notes,
  }
}

export type LeadProblem = 'date' | 'time' | 'name'

export function leadDraftProblems(draft: LeadDraft): LeadProblem[] {
  const problems: LeadProblem[] = []
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) problems.push('date')
  if (draft.time && !/^\d{2}:\d{2}$/.test(draft.time)) problems.push('time')
  if (!draft.name.trim()) problems.push('name')
  return problems
}

/** Pola `data`, którymi rządzi formularz leada. Puste = usunięte z rekordu. */
const DRAFT_DATA_KEYS = [
  'quality',
  'campaignId',
  'origin',
  'channel',
  'summary',
  'contactName',
  'email',
  'phone',
] as const

/**
 * Czy formularz w ogóle mógł pokazać tę wartość. Jeśli nie (jakość spoza
 * listy z nowszej wersji, liczba zamiast tekstu), puste pole w szkicu nie
 * znaczy „usuń" — wartość zostaje w rekordzie.
 */
function couldNotShow(key: string, value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false
  if (key === 'quality') return !isLeadQuality(value)
  return typeof value !== 'string'
}

/** Czy formularz mógł pokazać tę wartość `ads` (inaczej puste pole nie znaczy „usuń"). */
function adsCouldNotShow(key: string, value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false
  if (key === 'fromAds') return typeof value !== 'boolean'
  if (key === 'consent') return !(AD_CONSENTS as readonly string[]).includes(value as string)
  return typeof value !== 'string'
}

/**
 * `data.ads` ze szkicu. Bazą jest oryginał, więc klucze, których formularz nie
 * zna (nowsza wersja, ręczny import), zostają; szkic zmienia tylko znane.
 * `null` = nic do zapisania.
 */
function adsFromDraft(draftAds: LeadAds, originalAds: unknown): Record<string, unknown> | null {
  const ads: Record<string, unknown> = isPlainObject(originalAds) ? { ...originalAds } : {}
  const known = [...ADS_TEXT_KEYS, 'fromAds', 'consent'] as const
  known.forEach((key) => {
    const raw = draftAds[key]
    const value = typeof raw === 'string' ? raw.trim() : raw
    if (value !== undefined && value !== null && value !== '') ads[key] = value
    else if (!adsCouldNotShow(key, ads[key])) delete ads[key]
  })
  return Object.keys(ads).length ? ads : null
}

/**
 * Wklejone „Źródło" do szkicu. `ads` bierze wszystko z wklejki; e-mail,
 * telefon, godzinę i (gdy `fillDate`, czyli data nie jest wpisana ręcznie) datę
 * uzupełnia tylko tam, gdzie jest pusto. Nic wpisanego nie nadpisuje.
 */
export function applyLeadSource(draft: LeadDraft, parsed: ParsedLeadSource, options: { fillDate?: boolean } = {}): LeadDraft {
  const ads: Record<string, unknown> = { ...draft.ads }
  Object.entries(parsed).forEach(([key, value]) => {
    if (key !== 'problems' && key !== 'email' && key !== 'phone' && value !== undefined) ads[key] = value
  })
  const next: LeadDraft = { ...draft, ads: ads as LeadAds }
  if (!next.email.trim() && parsed.email) next.email = parsed.email
  if (!next.phone.trim() && parsed.phone) next.phone = parsed.phone
  const at = parsed.submittedAt
  if (at) {
    if (options.fillDate || !next.date) next.date = at.slice(0, 10)
    if (!next.time && next.date === at.slice(0, 10)) next.time = at.slice(11, 16)
  }
  return next
}

/**
 * Przełącznik „Z reklamy". Włączenie bez `leadId` generuje go (alfabet strony);
 * wyłączenie zapisuje jawne „nie", jeśli lead ma jakiekolwiek inne dane źródła.
 */
export function setLeadFromAds(draft: LeadDraft, on: boolean, random: () => number = Math.random): LeadDraft {
  const ads: LeadAds = { ...draft.ads }
  delete ads.fromAds
  if (on) {
    ads.fromAds = true
    if (!ads.leadId?.trim()) ads.leadId = generateLeadId(random)
  } else if (hasAds(ads)) {
    ads.fromAds = false
  }
  return { ...draft, ads }
}

/**
 * Wydarzenie `lead_in` ze szkicu. `original` = edytowany lead (jego nieznane
 * pola zostają). Pochodzenie ma sens tylko bez kampanii — z kampanią wynika z
 * jej platformy, więc go wtedy nie zapisujemy. `now` jawnie — powtarzalne testy.
 */
export function leadEventFromDraft(
  draft: LeadDraft,
  original: TimelineEvent | null,
  now: Date = new Date()
): TimelineEvent {
  const data: Record<string, unknown> = { ...(original?.data ?? {}) }
  const values: Record<(typeof DRAFT_DATA_KEYS)[number], string> = {
    quality: draft.quality ?? '',
    campaignId: draft.campaignId ?? '',
    origin: draft.campaignId ? '' : draft.origin,
    channel: draft.channel,
    summary: draft.summary,
    contactName: draft.contactName,
    email: draft.email,
    phone: draft.phone,
  }
  DRAFT_DATA_KEYS.forEach((key) => {
    const value = values[key].trim()
    if (value) data[key] = value
    else if (!couldNotShow(key, original?.data?.[key])) delete data[key]
  })

  const originalAds = original?.data?.ads
  const ads = adsFromDraft(draft.ads, originalAds)
  if (ads) data.ads = ads
  else if (originalAds === undefined || isPlainObject(originalAds)) delete data.ads

  const nowIso = now.toISOString()
  const start = draft.time ? `${draft.date}T${draft.time}` : draft.date
  return {
    ...(original ?? {}),
    id: original?.id ?? createEventId(),
    kind: LEAD_KIND,
    projectId: draft.projectId,
    start: isEventDate(start) ? start : draft.date,
    end: undefined,
    title: draft.name.trim(),
    notes: draft.notes.trim(),
    data,
    source: original?.source ?? { type: 'manual' },
    createdAt: original?.createdAt || nowIso,
    updatedAt: nowIso,
  }
}

/**
 * Szybka zmiana z listy (jakość, kampania, projekt) bez formularza. Dotyka
 * tylko podanych kluczy; przypisanie kampanii czyści pochodzenie spoza niej.
 */
export function patchLeadEvent(
  event: TimelineEvent,
  patch: { quality?: LeadQuality | null; campaignId?: string | null; projectId?: string | null },
  now: Date = new Date()
): TimelineEvent {
  const data: Record<string, unknown> = { ...event.data }
  const put = (key: string, value: string | null | undefined) => {
    if (value) data[key] = value
    else delete data[key]
  }
  if ('quality' in patch) put('quality', patch.quality)
  if ('campaignId' in patch) {
    put('campaignId', patch.campaignId)
    if (patch.campaignId) delete data.origin
  }
  return {
    ...event,
    projectId: 'projectId' in patch ? (patch.projectId ?? null) : event.projectId,
    data,
    updatedAt: now.toISOString(),
  }
}
