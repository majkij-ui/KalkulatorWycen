/**
 * Marketing: kampanie reklamowe i ocena leadów.
 *
 * Co gdzie leży (każdy fakt w jednym miejscu, plan §3.4):
 *  - KAMPANIA (`campaigns.json`) — nazwa, platforma, start/koniec i budżet
 *    dzienny ustawiony w panelu (z historią zmian).
 *  - WYDATKI z panelu — miesięczne pozycje kosztów stałych typu `marketing`
 *    z `campaignId` (+ kliknięcia, wyświetlenia). Dzięki temu Finanse widzą
 *    te same złotówki bez żadnego mostu i nic się nie liczy podwójnie.
 *  - LEAD — wydarzenie `lead_in` w `events.json`, z jakością i kampanią w
 *    `data`. Kalendarz pokazuje je bez dodatkowego kodu, a powiązany projekt
 *    dostaje lead w swoim wątku.
 *
 * Statystyki (koszt leada, ROAS…) liczy `marketing-calc.ts`, nic z nich nie
 * jest zapisywane. Moduł czysty — bez Tauri/React.
 */

import { z } from 'zod'

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

// ── Jakość leada ─────────────────────────────────────────────────────────────

/** Klucze na zawsze (zapisane w wydarzeniach); etykiety wolno zmieniać. */
export const LEAD_QUALITIES = ['fake', 'good', 'very_good'] as const
export type LeadQuality = (typeof LEAD_QUALITIES)[number]

export const LEAD_QUALITY_LABELS: Record<LeadQuality, string> = {
  fake: 'Fałszywy',
  good: 'Dobry',
  very_good: 'Bardzo dobry',
}

export const LEAD_QUALITY_HINTS: Record<LeadQuality, string> = {
  fake: 'szuka pracy, spam, sprawa niezwiązana — nie klient',
  good: 'realny klient z realną potrzebą',
  very_good: 'konkretny projekt, budżet i termin — warto walczyć',
}

export function isLeadQuality(value: unknown): value is LeadQuality {
  return typeof value === 'string' && (LEAD_QUALITIES as readonly string[]).includes(value)
}

// ── Źródło leada (Google Ads) ────────────────────────────────────────────────

/**
 * `lead_in.data.ads`: fakty ze stopki „Źródło" maila ze strony (plan:
 * docs/PLAN-GOOGLE-ADS-EXPORT.md §3). Wszystko opcjonalne i tolerancyjne jak
 * reszta `data`; nieznane klucze przechodzą (`passthrough`). E-mail i telefon
 * zostają w `data.email` / `data.phone`. Format click id sprawdzają parser i
 * walidacja propozycji, nie schemat, żeby odczyt starych danych nic nie gubił.
 */
export const AD_CONSENTS = ['granted', 'denied', 'unknown'] as const
export type AdConsent = (typeof AD_CONSENTS)[number]

/** Klucze `ads`, którymi rządzi formularz (reszta kluczy zostaje nietknięta). */
export const ADS_TEXT_KEYS = [
  'leadId',
  'gclid',
  'gbraid',
  'wbraid',
  'clickedAt',
  'submittedAt',
  'utmSource',
  'utmMedium',
  'utmCampaign',
  'utmTerm',
  'landingPath',
] as const
export const ADS_CLICK_ID_KEYS = ['gclid', 'gbraid', 'wbraid'] as const

const adsText = z.string().trim().optional().catch(undefined)

export const leadAdsSchema = z
  .object({
    leadId: adsText,
    gclid: adsText,
    gbraid: adsText,
    wbraid: adsText,
    /** Osobny fakt od `campaignId`: kampania mówi tylko o oknie dat. */
    fromAds: z.boolean().optional().catch(undefined),
    /** Czas lokalny `YYYY-MM-DDTHH:mm:ss` (Europe/Warsaw). */
    clickedAt: adsText,
    submittedAt: adsText,
    consent: z.enum(AD_CONSENTS).optional().catch(undefined),
    utmSource: adsText,
    utmMedium: adsText,
    utmCampaign: adsText,
    utmTerm: adsText,
    landingPath: adsText,
  })
  .passthrough()

export type LeadAds = z.infer<typeof leadAdsSchema>

/** Jak strona zapisuje i wysyła click id; Claude przepisuje go z maila ręcznie. */
export const CLICK_ID_PATTERN = /^[A-Za-z0-9_-]{10,512}$/
export function isClickId(value: unknown): value is string {
  return typeof value === 'string' && CLICK_ID_PATTERN.test(value)
}

/** Alfabet i długość `leadId` ze strony (lead wpisany ręcznie dostaje ten sam format). */
export const LEAD_ID_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
export const LEAD_ID_LENGTH = 8

export function generateLeadId(random: () => number = Math.random): string {
  let id = ''
  for (let i = 0; i < LEAD_ID_LENGTH; i += 1) {
    id += LEAD_ID_ALPHABET[Math.min(LEAD_ID_ALPHABET.length - 1, Math.floor(random() * LEAD_ID_ALPHABET.length))]
  }
  return id
}

export function hasAds(ads: LeadAds | null | undefined): boolean {
  return !!ads && Object.values(ads).some((v) => v !== undefined && v !== '')
}

/**
 * Błędy `ads` z propozycji (Claude przepisuje je z maila): `ads` musi być
 * obiektem, a click id mieć format ze strony. Zwraca komunikaty po polsku.
 */
export function adsProblems(ads: unknown, path = 'ads'): string[] {
  if (ads === undefined) return []
  if (!ads || typeof ads !== 'object' || Array.isArray(ads)) return [`${path}: oczekiwano obiektu`]
  const problems: string[] = []
  ADS_CLICK_ID_KEYS.forEach((key) => {
    const value = (ads as Record<string, unknown>)[key]
    if (value === undefined) return
    if (!isClickId(value)) {
      problems.push(`${path}.${key}: nieprawidłowy click id (litery, cyfry, „_" i „-", 10–512 znaków) — przepisz go dosłownie z maila`)
    }
  })
  return problems
}

// ── Kampania ─────────────────────────────────────────────────────────────────

export const CAMPAIGN_PLATFORMS = ['google_ads', 'meta_ads', 'inne'] as const

export const CAMPAIGN_PLATFORM_LABELS: Record<(typeof CAMPAIGN_PLATFORMS)[number], string> = {
  google_ads: 'Google Ads',
  meta_ads: 'Meta Ads',
  inne: 'Inna',
}

export function platformLabel(platform: string): string {
  return CAMPAIGN_PLATFORM_LABELS[platform as keyof typeof CAMPAIGN_PLATFORM_LABELS] ?? platform
}

/**
 * Pochodzenie klienta (`Project.leadSource`) dla projektu założonego z leada
 * tej platformy. Lista pochodzeń nie ma „Meta Ads", więc reszta to „inne".
 */
export function originForPlatform(platform: string): string {
  return platform === 'google_ads' ? 'google_ads' : 'inne'
}

/** Budżet dzienny obowiązujący od dnia `from` (do następnej zmiany). */
export const budgetStepSchema = z.object({
  from: z.string().regex(DATE_KEY),
  daily: z.number().finite().nonnegative(),
})
export type BudgetStep = z.infer<typeof budgetStepSchema>

/**
 * Jedna uszkodzona zmiana budżetu nie kasuje pozostałych — odpada tylko ona.
 */
const budgetSteps = z
  .array(z.unknown())
  .catch([])
  .transform((steps) =>
    steps
      .map((step) => budgetStepSchema.safeParse(step))
      .filter((r): r is z.SafeParseSuccess<BudgetStep> => r.success)
      .map((r) => r.data)
      .sort((a, b) => a.from.localeCompare(b.from))
  )

export const campaignSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().catch(''),
    /** Klucz z `CAMPAIGN_PLATFORMS` albo dowolny tekst. */
    platform: z.string().catch('google_ads'),
    /** Pusty = niepoprawna data; kampania zostaje, ale nie ma okna aktywności. */
    startDate: z.string().regex(DATE_KEY).catch(''),
    /** Ostatni dzień emisji WŁĄCZNIE; brak = kampania trwa. */
    endDate: z.string().regex(DATE_KEY).optional().catch(undefined),
    /**
     * Budżet dzienny z panelu. Pierwsza pozycja obowiązuje od startu kampanii
     * (niezależnie od jej `from`), kolejne od swoich dat.
     */
    budgets: budgetSteps,
    notes: z.string().catch(''),
    createdAt: z.string().catch(''),
    updatedAt: z.string().catch(''),
  })
  .passthrough()
export type Campaign = z.infer<typeof campaignSchema>

export function createCampaignId(): string {
  return `cmp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function createCampaign(params: {
  name: string
  platform?: string
  startDate: string
  endDate?: string
  dailyBudget: number
  notes?: string
}): Campaign {
  const now = new Date().toISOString()
  return {
    id: createCampaignId(),
    name: params.name.trim(),
    platform: params.platform ?? 'google_ads',
    startDate: params.startDate,
    endDate: params.endDate || undefined,
    budgets: [{ from: params.startDate, daily: params.dailyBudget }],
    notes: params.notes ?? '',
    createdAt: now,
    updatedAt: now,
  }
}
