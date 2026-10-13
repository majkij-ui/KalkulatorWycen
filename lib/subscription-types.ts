/**
 * Subskrypcje i stałe opłaty (S1, plan po teście §3.2): `subscriptions.json`.
 *
 * Subskrypcja to FAKT („Artlist, 2 611,51 zł co rok od 06.2026"). Jej raty w
 * miesiącach NIE są zapisywane — liczy je przy odczycie `subscriptions.ts`.
 * Miesiąc, który był inny (kwota, kurs, pominięty), poprawia się ręczną
 * pozycją kosztów z `subscriptionId` + `month` (decyzja C).
 *
 * Zasady jak w całym hubie (plan §3.4): `.passthrough()`, nowe pola opcjonalne
 * z `.catch`, miękkie usunięcie. Waluta, cykl i kategoria to tekst ze znanymi
 * kluczami — wartość z nowszej wersji zostaje w pliku, a tu nie liczy się po
 * cichu źle (`subscriptions.ts` oznacza ją jako nieliczoną).
 */

import { z } from 'zod'

export const SUBSCRIPTION_CURRENCIES = ['PLN', 'EUR', 'USD'] as const
export type SubscriptionCurrency = (typeof SUBSCRIPTION_CURRENCIES)[number]

export const SUBSCRIPTION_CADENCES = ['monthly', 'yearly', 'custom'] as const
export type SubscriptionCadence = (typeof SUBSCRIPTION_CADENCES)[number]

export const CADENCE_LABELS: Record<SubscriptionCadence, string> = {
  monthly: 'co miesiąc',
  yearly: 'co rok',
  custom: 'co N miesięcy',
}

const dateKey = /^\d{4}-\d{2}-\d{2}$/

export const subscriptionSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().catch(''),
    /** Klucz z `fixed-cost-categories.ts` (oprogramowanie, bank…). */
    category: z.string().min(1).catch('other'),
    /** Kwota jednej raty w walucie `currency`. */
    amount: z.number().finite().nonnegative().catch(0),
    /** `PLN` / `EUR` / `USD`. */
    currency: z.string().min(1).catch('PLN'),
    /** Kurs: ile złotych za 1 jednostkę waluty (dla PLN pomijany). Edytowalny. */
    rate: z.number().finite().positive().optional().catch(undefined),
    /** `monthly` / `yearly` / `custom` (co `everyMonths` miesięcy). */
    cadence: z.string().min(1).catch('monthly'),
    everyMonths: z.number().int().min(1).max(120).optional().catch(undefined),
    /** Pierwsza rata `YYYY-MM-DD`; kolejne tego samego dnia miesiąca. */
    startDate: z.string().regex(dateKey).catch(''),
    /** Ostatni dzień, w którym rata może jeszcze wpaść. Brak = trwa. */
    endDate: z.string().regex(dateKey).optional().catch(undefined),
    notes: z.string().optional().catch(undefined),
    createdAt: z.string().optional().catch(undefined),
    updatedAt: z.string().optional().catch(undefined),
    /** Miękkie usunięcie (ISO); „Cofnij" zdejmuje znacznik. */
    deletedAt: z.string().optional().catch(undefined),
  })
  .passthrough()
export type Subscription = z.infer<typeof subscriptionSchema>

export function isSubscriptionCurrency(value: unknown): value is SubscriptionCurrency {
  return typeof value === 'string' && (SUBSCRIPTION_CURRENCIES as readonly string[]).includes(value)
}

export function isSubscriptionCadence(value: unknown): value is SubscriptionCadence {
  return typeof value === 'string' && (SUBSCRIPTION_CADENCES as readonly string[]).includes(value)
}

function randomSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function createSubscriptionId(): string {
  return `sub-${randomSuffix()}`
}

export function createSubscription(
  params: Partial<Omit<Subscription, 'id'>> & { name: string; startDate: string },
  now = new Date().toISOString()
): Subscription {
  return {
    category: 'other',
    amount: 0,
    currency: 'PLN',
    cadence: 'monthly',
    ...params,
    id: createSubscriptionId(),
    createdAt: now,
    updatedAt: now,
  }
}
