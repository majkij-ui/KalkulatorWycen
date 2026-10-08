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
