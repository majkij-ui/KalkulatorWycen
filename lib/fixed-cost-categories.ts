/**
 * Kategorie kosztów stałych i subskrypcji (S1) — rejestr w kodzie, nie w danych.
 *
 * Stary zapis zna tylko `type`: `zus` / `marketing` / `other`, i tak zostaje
 * (enum z `.catch('other')`, starsze buildy czytają go bez zmian). Kategoria to
 * DODATKOWE pole tekstowe `category` ze znanymi kluczami: nowa pozycja
 * „Oprogramowanie" ma `type: 'other'` i `category: 'software'`, więc stary
 * build widzi ją jako „Inne", a nowy — jako oprogramowanie. Klucze są na
 * zawsze; etykiety można zmieniać. Nieznany klucz (z nowszej wersji) zostaje
 * w pliku, a tu liczy się jako „Inne".
 *
 * `gear` (S4): zakupy sprzętu wpisane ręcznie, spoza katalogu (drobiazgi,
 * miesięczne sumy z arkusza). Sprzęt z katalogu liczy rejestr marży sam
 * (`gear-costs.ts`); ta kategoria trzyma resztę w wierszu „Sprzęt" kosztów
 * firmy, a nie w „Inne".
 *
 * Moduł czysty — testy w `fixed-cost-categories.test.ts`.
 */

import type { FixedCostType } from './project-types'

export const COST_CATEGORY_KEYS = [
  'zus',
  'marketing',
  'software',
  'bank',
  'office',
  'telecom',
  'insurance',
  'gear',
  'other',
] as const
export type CostCategory = (typeof COST_CATEGORY_KEYS)[number]

export const COST_CATEGORY_LABELS: Record<CostCategory, string> = {
  zus: 'ZUS',
  marketing: 'Marketing',
  software: 'Oprogramowanie',
  bank: 'Bank',
  office: 'Księgowość / biuro',
  telecom: 'Telefon i internet',
  insurance: 'Ubezpieczenia',
  gear: 'Sprzęt spoza katalogu',
  other: 'Inne',
}

/** Krótkie etykiety do kafli i wąskich kolumn. */
export const COST_CATEGORY_SHORT: Record<CostCategory, string> = {
  zus: 'ZUS',
  marketing: 'mark.',
  software: 'oprogr.',
  bank: 'bank',
  office: 'biuro',
  telecom: 'tel.',
  insurance: 'ubezp.',
  gear: 'sprzęt',
  other: 'inne',
}

export function isCostCategory(value: unknown): value is CostCategory {
  return typeof value === 'string' && (COST_CATEGORY_KEYS as readonly string[]).includes(value)
}

/**
 * Kategoria pozycji: znane `category`, a bez niego — ze starego `type`
 * (`zus` → ZUS, `marketing` → Marketing, reszta → Inne).
 */
export function fixedCostCategory(cost: { type: FixedCostType; category?: unknown }): CostCategory {
  if (isCostCategory(cost.category)) return cost.category
  if (cost.type === 'zus') return 'zus'
  if (cost.type === 'marketing') return 'marketing'
  return 'other'
}

/** `type` zapisywany razem z kategorią — tak, żeby starszy build liczył ją we właściwym worku. */
export function typeForCategory(category: CostCategory): FixedCostType {
  if (category === 'zus') return 'zus'
  if (category === 'marketing') return 'marketing'
  return 'other'
}

/**
 * Pola do zapisu pozycji w danej kategorii. ZUS, marketing i „inne" mają
 * swój `type` i nie potrzebują `category` — pliki zostają takie, jak były.
 */
export function categoryFields(category: CostCategory): { type: FixedCostType; category?: CostCategory } {
  const type = typeForCategory(category)
  return category === type ? { type } : { type, category }
}

/** Ta sama pozycja w innej kategorii — stare `category` znika, gdy nowa go nie potrzebuje. */
export function withCategory<T extends { type: FixedCostType; category?: unknown }>(item: T, category: CostCategory): T {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { category: previous, ...rest } = item
  return { ...rest, ...categoryFields(category) } as T
}

export function costCategoryLabel(category: CostCategory): string {
  return COST_CATEGORY_LABELS[category]
}
