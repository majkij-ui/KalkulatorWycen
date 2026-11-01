/**
 * Eksport konwersji offline do Google Ads (plan: docs/PLAN-GOOGLE-ADS-EXPORT.md, etap B).
 *
 * `planAdsExport` z wydarzeń, projektów, księgi pieniędzy i zapisu poprzednich
 * eksportów składa wiersze do wysłania i powody, dla których lead odpadł.
 * Jeden wiersz = jedno zdarzenie konwersji (`lead` albo `won`). Dzisiejszą datę
 * dostaje z zewnątrz, nigdy z zegara. `buildAdsCsv` zamienia wiersze w plik:
 * e-mail i telefon jadą wyłącznie jako SHA-256.
 *
 * Moduł czysty — testy w `ads-export.test.ts`.
 */

import {
  ADS_EXPORT_CONFIG,
  type AdsConversionKey,
  type AdsExportConfig,
} from './ads-export-config'
import type { AdsExportRecord } from './ads-export-types'
import { isEventDate, type TimelineEvent } from './event-types'
import { leadsFromEvents, type Lead } from './marketing-leads'
import { ADS_CLICK_ID_KEYS, hasAds, isClickId } from './marketing-types'
import type { ProjectStatus } from './project-types'

// ── Wejście i wynik ──────────────────────────────────────────────────────────

export interface AdsProject {
  id: string
  name: string
  status: ProjectStatus
}

/** Wystarczy `id` i `revenue` z `ProjectMoney` (`money-loop.ts`). */
export interface AdsLedgerEntry {
  id: string
  revenue: number | null
}

export type AdsClickIdColumn = (typeof ADS_CLICK_ID_KEYS)[number]

export interface AdsExportRow {
  leadEventId: string
  leadName: string
  /** `ads.leadId` ze strony; pusty, gdy lead go nie ma. */
  leadId: string
  conversionKey: AdsConversionKey
  conversionName: string
  /** Czas lokalny `YYYY-MM-DDTHH:mm:ss` (Europe/Warsaw). */
  conversionTime: string
  value: number
  currency: string
  /** Dokładnie jedna z trzech kolumn click id jest wypełniona (albo żadna). */
  gclid: string
  gbraid: string
  wbraid: string
  /**
   * Znormalizowany kontakt, tylko w pamięci i tylko przy zgodzie `granted`.
   * W pliku jedzie wyłącznie hash.
   */
  email: string
  phone: string
  consent: 'granted' | 'unknown'
}

export const ADS_REJECT_REASONS = [
  'fake',
  'unrated',
  'pre_tracking',
  'no_data',
  'not_ads',
  'consent_denied',
  'no_consent_contact',
  'no_identifier',
  'out_of_window',
  'already_sent',
  'no_won_date',
  'no_amount',
  'won_on_other_lead',
] as const
export type AdsRejectReason = (typeof ADS_REJECT_REASONS)[number]

export interface AdsRejected {
  leadEventId: string
  leadName: string
  conversionKey: AdsConversionKey
  reason: AdsRejectReason
  /** Projekt leada (dla „brak daty wygranej": link do projektu). */
  projectId: string | null
  projectName: string
}

export interface AdsWarning {
  leadEventId: string
  leadName: string
  conversionKey: AdsConversionKey
  daysLeft: number
}

export type AdsCorrectionKind = 'lead_fake' | 'lead_value_changed' | 'project_lost' | 'revenue_changed'

export interface AdsCorrection {
  recordId: string
  leadEventId: string
  leadName: string
  conversionKey: AdsConversionKey
  kind: AdsCorrectionKind
  /** Wartość wysłana do Google (zł); tylko dla zmian wartości. */
  sent: number | null
  /** Wartość teraz (zł); tylko dla zmian wartości. */
  current: number | null
}

export interface AdsExportPlan {
  rows: AdsExportRow[]
  rejected: AdsRejected[]
  warnings: AdsWarning[]
  corrections: AdsCorrection[]
  totals: { rows: number; leads: number; value: number }
}

export interface PlanAdsExportInput {
  events: TimelineEvent[]
  projects: AdsProject[]
  ledger: AdsLedgerEntry[]
  exports: AdsExportRecord[]
  /** Dzień eksportu `YYYY-MM-DD`; od niego liczymy okno Google. */
  today: string
  config?: AdsExportConfig
}

/** Polskie opisy powodów — kolejność = kolejność w oknie eksportu. */
export const ADS_REASON_LABELS: Record<AdsRejectReason, string> = {
  fake: 'Fałszywy lead',
  unrated: 'Lead bez oceny jakości',
  pre_tracking: 'Sprzed śledzenia reklam',
  no_data: 'Brak danych ze źródła (sekcji „Źródło")',
  not_ads: 'Lead nie z reklamy',
  consent_denied: 'Odmowa zgody: nic nie jedzie',
  no_consent_contact: 'Brak click id i brak zgody na kontakt',
  no_identifier: 'Brak click id oraz użytecznego e-maila lub telefonu',
  out_of_window: 'Poza oknem Google (90 dni od kliknięcia, 63 po samym kontakcie)',
  already_sent: 'Już wysłane (czeka na potwierdzenie albo potwierdzone)',
  no_won_date: 'Projekt wygrany, ale bez wydarzenia „Wygrane" w kalendarzu',
  no_amount: 'Projekt wygrany, ale bez kwoty lub za 0 zł',
  won_on_other_lead: 'Wygrana liczy się z wcześniejszego leada tego projektu',
}

export const ADS_CORRECTION_LABELS: Record<AdsCorrectionKind, string> = {
  lead_fake: 'Lead jest teraz oznaczony jako fałszywy',
  lead_value_changed: 'Zmieniła się ocena leada, więc inna wartość niż wysłana',
  project_lost: 'Projekt jest teraz przegrany',
  revenue_changed: 'Kwota zlecenia różni się od wysłanej',
}

// ── Normalizacja ─────────────────────────────────────────────────────────────

/** E-mail: przycięty, małe litery, w gmail.com / googlemail.com bez kropek przed domeną. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim().toLowerCase()
  if (!value || /\s/.test(value)) return null
  const at = value.lastIndexOf('@')
  if (at < 1 || at === value.length - 1) return null
  let local = value.slice(0, at)
  const domain = value.slice(at + 1)
  if (local.includes('@') || !/^[^.][^@]*\.[^.@]+$/.test(domain)) return null
  if (domain === 'gmail.com' || domain === 'googlemail.com') local = local.replace(/\./g, '')
  return local ? `${local}@${domain}` : null
}

/**
 * Telefon w E.164: `+` i 8–15 cyfr; goły numer z 9 cyframi dostaje `+48`;
 * wszystko inne = brak telefonu. Spacje, myślniki, kropki i nawiasy są ignorowane.
 */
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim().replace(/[\s\-.()]/g, '')
  if (/^\+\d{8,15}$/.test(value)) return value
  if (/^\d{9}$/.test(value)) return `+48${value}`
  return null
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

// ── Czas ─────────────────────────────────────────────────────────────────────

const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/

/** `YYYY-MM-DDTHH:mm[:ss]` → `YYYY-MM-DDTHH:mm:ss`; nieczytelne = `null`. */
export function normalizeLocalTime(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const m = LOCAL_TIME.exec(value.trim())
  if (!m) return null
  const [, y, mo, d, h, mi, s = '00'] = m
  if (Number(h) > 23 || Number(mi) > 59 || Number(s) > 59) return null
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)))
  if (date.getUTCFullYear() !== Number(y) || date.getUTCMonth() !== Number(mo) - 1 || date.getUTCDate() !== Number(d)) {
    return null
  }
  return `${y}-${mo}-${d}T${h}:${mi}:${s}`
}

/** Start wydarzenia jako pełny czas: sama data = 12:00:00. */
function eventTime(start: string): string {
  return start.length > 10 ? `${start}:00` : `${start}T12:00:00`
}

function addMinute(time: string): string {
  const m = LOCAL_TIME.exec(time)
  if (!m) return time
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0)) + 60_000
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
}

function dayNumber(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000)
}

// ── Lead: kwalifikacja ───────────────────────────────────────────────────────

interface Identity {
  clickId: { column: AdsClickIdColumn; value: string } | null
  email: string
  phone: string
  consent: 'granted' | 'unknown'
}

type LeadVerdict = { ok: true; identity: Identity; quality: 'good' | 'very_good' } | { ok: false; reason: AdsRejectReason }

function adsText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Powody na poziomie leada, w kolejności z planu; potem tożsamość wiersza. */
function judgeLead(lead: Lead, config: AdsExportConfig): LeadVerdict {
  if (lead.quality === 'fake') return { ok: false, reason: 'fake' }
  if (lead.quality === null) return { ok: false, reason: 'unrated' }
  const ads = lead.ads
  if (!hasAds(ads)) {
    return { ok: false, reason: lead.date < config.trackingStart ? 'pre_tracking' : 'no_data' }
  }
  if (ads.fromAds !== true) return { ok: false, reason: 'not_ads' }
  const consent = ads.consent === 'granted' ? 'granted' : ads.consent === 'denied' ? 'denied' : 'unknown'
  if (consent === 'denied') return { ok: false, reason: 'consent_denied' }

  let clickId: Identity['clickId'] = null
  for (const column of ADS_CLICK_ID_KEYS) {
    const value = adsText(ads[column])
    if (isClickId(value)) {
      clickId = { column, value }
      break
    }
  }
  const email = normalizeEmail(lead.email)
  const phone = normalizePhone(lead.phone)
  if (!clickId) {
    if (consent !== 'granted') return { ok: false, reason: 'no_consent_contact' }
    if (!email && !phone) return { ok: false, reason: 'no_identifier' }
  }
  const granted = consent === 'granted'
  return {
    ok: true,
    quality: lead.quality,
    identity: { clickId, email: granted ? (email ?? '') : '', phone: granted ? (phone ?? '') : '', consent },
  }
}

/** Okno Google liczone od kliknięcia do DNIA EKSPORTU (nie do czasu konwersji). */
function windowOf(lead: Lead, identity: Identity, today: string, config: AdsExportConfig) {
  const startTime = normalizeLocalTime(lead.ads.clickedAt) ?? normalizeLocalTime(lead.ads.submittedAt)
  const startDay = startTime ? startTime.slice(0, 10) : lead.date
  const limit = identity.clickId ? config.windowDaysClickId : config.windowDaysContact
  const elapsed = Math.max(0, dayNumber(today) - dayNumber(startDay))
  return { out: elapsed > limit, daysLeft: limit - elapsed }
}

// ── Plan ─────────────────────────────────────────────────────────────────────

const ACTIVE: ReadonlySet<string> = new Set(['pending', 'confirmed'])
const pairKey = (leadEventId: string, key: string) => `${leadEventId}\u0000${key}`
const round2 = (n: number) => Math.round(n * 100) / 100

export function planAdsExport(input: PlanAdsExportInput): AdsExportPlan {
  const { events, projects, ledger, exports, today } = input
  const config = input.config ?? ADS_EXPORT_CONFIG

  const leads = leadsFromEvents(events)
  const projectById = new Map(projects.map((p) => [p.id, p]))
  const revenueById = new Map(ledger.map((m) => [m.id, m.revenue]))

  const records = new Map<string, AdsExportRecord[]>()
  exports.forEach((r) => {
    const k = pairKey(r.leadEventId, r.conversionKey)
    records.set(k, [...(records.get(k) ?? []), r])
  })
  const isSent = (leadId: string, key: AdsConversionKey) =>
    (records.get(pairKey(leadId, key)) ?? []).some((r) => ACTIVE.has(r.status))
  /** Czas z ostatniego cofniętego eksportu: ponowny plik nie zrobi drugiej konwersji. */
  const cancelledTime = (leadId: string, key: AdsConversionKey): string | null => {
    const cancelled = (records.get(pairKey(leadId, key)) ?? [])
      .filter((r) => r.status === 'cancelled' && normalizeLocalTime(r.conversionTime))
      .sort((a, b) => a.exportedAt.localeCompare(b.exportedAt) || (a.cancelledAt ?? '').localeCompare(b.cancelledAt ?? ''))
    return cancelled.length ? normalizeLocalTime(cancelled[cancelled.length - 1].conversionTime) : null
  }

  const rows: AdsExportRow[] = []
  const rejected: AdsRejected[] = []
  const warnings: AdsWarning[] = []

  const reject = (lead: Lead, key: AdsConversionKey, reason: AdsRejectReason) =>
    rejected.push({
      leadEventId: lead.id,
      leadName: lead.name,
      conversionKey: key,
      reason,
      projectId: lead.projectId,
      projectName: (lead.projectId && projectById.get(lead.projectId)?.name) || '',
    })

  const verdicts = new Map(leads.map((lead) => [lead.id, judgeLead(lead, config)]))
  const eligible = leads
    .filter((l) => verdicts.get(l.id)?.ok)
    .sort((a, b) => a.event.start.localeCompare(b.event.start) || a.id.localeCompare(b.id))

  // Kto dostaje wygraną projektu: ten, z którego już wysłano; inaczej najwcześniejszy lead.
  const wonOwner = new Map<string, string>()
  leads.forEach((l) => {
    if (l.projectId && isSent(l.id, 'won') && !wonOwner.has(l.projectId)) wonOwner.set(l.projectId, l.id)
  })
  eligible.forEach((l) => {
    if (l.projectId && !wonOwner.has(l.projectId)) wonOwner.set(l.projectId, l.id)
  })

  const wonEventOf = (projectId: string): TimelineEvent | null =>
    events
      .filter((e) => e.kind === 'won' && e.projectId === projectId && !e.deletedAt && isEventDate(e.start))
      .sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id))[0] ?? null

  const rowOf = (
    lead: Lead,
    identity: Identity,
    key: AdsConversionKey,
    conversionTime: string,
    value: number
  ): AdsExportRow => ({
    leadEventId: lead.id,
    leadName: lead.name,
    leadId: adsText(lead.ads.leadId),
    conversionKey: key,
    conversionName: config.actionNames[key],
    conversionTime: cancelledTime(lead.id, key) ?? conversionTime,
    value: round2(value),
    currency: config.currency,
    gclid: identity.clickId?.column === 'gclid' ? identity.clickId.value : '',
    gbraid: identity.clickId?.column === 'gbraid' ? identity.clickId.value : '',
    wbraid: identity.clickId?.column === 'wbraid' ? identity.clickId.value : '',
    email: identity.email,
    phone: identity.phone,
    consent: identity.consent,
  })

  /** Wygrana leada: powód odrzucenia (`null` = nic do zgłoszenia) albo wydarzenie i kwota. */
  const judgeWon = (lead: Lead): { reason: AdsRejectReason | null } | { event: TimelineEvent; revenue: number } => {
    if (isSent(lead.id, 'won')) return { reason: 'already_sent' }
    const project = lead.projectId ? projectById.get(lead.projectId) : undefined
    if (!project || (project.status !== 'won' && project.status !== 'done')) return { reason: null }
    if (wonOwner.get(project.id) !== lead.id) return { reason: 'won_on_other_lead' }
    const event = wonEventOf(project.id)
    if (!event) return { reason: 'no_won_date' }
    const revenue = revenueById.get(project.id)
    if (!revenue || revenue <= 0) return { reason: 'no_amount' }
    if (windowOf(lead, (verdicts.get(lead.id) as Extract<LeadVerdict, { ok: true }>).identity, today, config).out) {
      return { reason: 'out_of_window' }
    }
    return { event, revenue }
  }

  leads.forEach((lead) => {
    const verdict = verdicts.get(lead.id) as LeadVerdict
    if (!verdict.ok) {
      reject(lead, 'lead', verdict.reason)
      return
    }
    const { identity, quality } = verdict
    const window = windowOf(lead, identity, today, config)
    const accept = (row: AdsExportRow) => {
      rows.push(row)
      if (window.daysLeft < config.warnDaysLeft) {
        warnings.push({ leadEventId: lead.id, leadName: lead.name, conversionKey: row.conversionKey, daysLeft: window.daysLeft })
      }
    }

    // Wiersz „Lead realny".
    const leadTime = normalizeLocalTime(lead.ads.submittedAt) ?? eventTime(lead.event.start)
    if (isSent(lead.id, 'lead')) reject(lead, 'lead', 'already_sent')
    else if (window.out) reject(lead, 'lead', 'out_of_window')
    else accept(rowOf(lead, identity, 'lead', leadTime, config.leadValues[quality]))

    // Wiersz „Zlecenie wygrane".
    const won = judgeWon(lead)
    if ('reason' in won) {
      if (won.reason) reject(lead, 'won', won.reason)
      return
    }
    let wonTime = eventTime(won.event.start)
    // Google odrzuca konwersję sprzed kliknięcia: wygrana tego samego dnia jedzie minutę po leadzie.
    if (wonTime <= leadTime) wonTime = addMinute(leadTime)
    accept(rowOf(lead, identity, 'won', wonTime, won.revenue))
  })

  rows.sort(
    (a, b) =>
      a.conversionTime.localeCompare(b.conversionTime) ||
      a.leadEventId.localeCompare(b.leadEventId) ||
      a.conversionKey.localeCompare(b.conversionKey)
  )

  return {
    rows,
    rejected,
    warnings,
    corrections: findCorrections({ leads, records: exports, projectById, revenueById, config }),
    totals: {
      rows: rows.length,
      leads: new Set(rows.map((r) => r.leadEventId)).size,
      value: round2(rows.reduce((sum, r) => sum + r.value, 0)),
    },
  }
}

/** Co zmieniło się po wysłaniu. Tylko informacja: korekty robi się ręcznie. */
function findCorrections(input: {
  leads: Lead[]
  records: AdsExportRecord[]
  projectById: Map<string, AdsProject>
  revenueById: Map<string, number | null>
  config: AdsExportConfig
}): AdsCorrection[] {
  const { leads, records, projectById, revenueById, config } = input
  const leadById = new Map(leads.map((l) => [l.id, l]))
  const out: AdsCorrection[] = []
  records
    .filter((r) => ACTIVE.has(r.status) && (r.conversionKey === 'lead' || r.conversionKey === 'won'))
    .forEach((record) => {
      const lead = leadById.get(record.leadEventId)
      if (!lead) return
      const key = record.conversionKey as AdsConversionKey
      const add = (kind: AdsCorrectionKind, sent: number | null = null, current: number | null = null) =>
        out.push({ recordId: record.id, leadEventId: lead.id, leadName: lead.name, conversionKey: key, kind, sent, current })

      if (lead.quality === 'fake') add('lead_fake')
      if (key === 'lead' && (lead.quality === 'good' || lead.quality === 'very_good')) {
        const now = config.leadValues[lead.quality]
        if (now !== record.value) add('lead_value_changed', record.value, now)
      }
      if (key === 'won' && lead.projectId) {
        if (projectById.get(lead.projectId)?.status === 'lost') add('project_lost')
        if (revenueById.has(lead.projectId)) {
          const now = revenueById.get(lead.projectId) ?? 0
          if (Math.abs(now - record.value) > config.revenueToleranceZl) add('revenue_changed', record.value, round2(now))
        }
      }
    })
  return out
}

/** Odrzucone wiersze pogrupowane po powodzie, w kolejności z `ADS_REJECT_REASONS`. */
export function groupRejected(rejected: AdsRejected[]): { reason: AdsRejectReason; items: AdsRejected[] }[] {
  return ADS_REJECT_REASONS.map((reason) => ({ reason, items: rejected.filter((r) => r.reason === reason) })).filter(
    (g) => g.items.length > 0
  )
}

// ── CSV ──────────────────────────────────────────────────────────────────────

export const ADS_CSV_COLUMNS = [
  'leadId',
  'gclid',
  'gbraid',
  'wbraid',
  'email_sha256',
  'phone_sha256',
  'conversion_name',
  'conversion_time',
  'value',
  'currency',
  'ad_user_data',
  'ad_personalization',
] as const

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** Liczba w pliku: kropka dziesiętna, bez zbędnych zer. */
export function formatAdsValue(value: number): string {
  return String(round2(value))
}

/**
 * Plik CSV (UTF-8, bez BOM, nagłówek, cudzysłowy tam, gdzie trzeba). Zgoda
 * `granted` daje `Granted` w obu kolumnach; `unknown` zostawia je puste.
 * W pliku nie ma jawnego e-maila ani telefonu.
 */
export async function buildAdsCsv(rows: AdsExportRow[], config: AdsExportConfig = ADS_EXPORT_CONFIG): Promise<string> {
  const lines: string[] = [ADS_CSV_COLUMNS.join(',')]
  for (const row of rows) {
    const email = row.email ? await sha256Hex(row.email) : ''
    const phone = row.phone ? await sha256Hex(row.phone) : ''
    const consent = row.consent === 'granted' ? 'Granted' : ''
    lines.push(
      [
        row.leadId,
        row.gclid,
        row.gbraid,
        row.wbraid,
        email,
        phone,
        row.conversionName,
        `${row.conversionTime} ${config.timeZone}`,
        formatAdsValue(row.value),
        row.currency,
        consent,
        consent,
      ]
        .map(csvCell)
        .join(',')
    )
  }
  return `${lines.join('\n')}\n`
}

/** Rekordy `pending` dla wierszy właśnie zapisanego pliku (czas i wartość zamrożone). */
export function pendingRecordsFor(rows: AdsExportRow[], exportedAt: string, newId: () => string): AdsExportRecord[] {
  return rows.map((row) => ({
    id: newId(),
    leadEventId: row.leadEventId,
    leadId: row.leadId,
    conversionKey: row.conversionKey,
    conversionName: row.conversionName,
    conversionTime: row.conversionTime,
    value: row.value,
    currency: row.currency,
    status: 'pending' as const,
    exportedAt,
  }))
}
