/**
 * Rentowność własnego sprzętu — czyste funkcje, bez zależności od zapisu.
 *
 * Idea z notatek: skoro sprzęt wciągnięty do produkcji zastępuje rental, to
 * "zarabia" tyle, ile kosztowałby wynajem. Sumujemy tę hipotetyczną wartość
 * przez wszystkie ZREALIZOWANE projekty i zestawiamy z ceną zakupu — widać,
 * czy i kiedy zakup się zwrócił.
 *
 * Uwaga: to wartość ZAOSZCZĘDZONA (uniknięty koszt rentalu), nie przychód —
 * nie sumuje się z przychodem firmy i nie wchodzi do wyniku w `finance-calc`.
 */

import type { EquipmentItem, Project } from './project-types'
import { countsTowardRevenue } from './project-types'

export interface EquipmentRoi {
  item: EquipmentItem
  /** Liczba projektów, w których sprzęt był użyty. */
  timesUsed: number
  /** Łączna liczba dni zdjęciowych. */
  totalDays: number
  /** Dni × średnia stawka rentalowa — wartość, której nie trzeba było wynająć. */
  earned: number
  /** `earned` / cena zakupu × 100. `null` gdy cena zakupu nieznana (0). */
  roiPct: number | null
  /** Ile jeszcze brakuje do spłaty zakupu. 0 = spłacony. `null` gdy brak ceny. */
  remainingToBreakEven: number | null
  /** Czy sprzęt zwrócił już cenę zakupu. */
  isPaidOff: boolean
}

/**
 * ROI pojedynczej pozycji. Liczone TYLKO z projektów wliczanych do wyników
 * (won/done) — wycena, która nie weszła, niczego nie zarobiła.
 */
export function computeEquipmentRoi(item: EquipmentItem, projects: Project[]): EquipmentRoi {
  let timesUsed = 0
  let totalDays = 0

  projects.forEach((project) => {
    if (!countsTowardRevenue(project.status)) return
    const usage = project.equipment.find((u) => u.itemId === item.id)
    if (!usage || usage.days <= 0) return
    timesUsed += 1
    totalDays += usage.days
  })

  const earned = totalDays * item.rentalDayRate
  const hasPrice = item.purchasePrice > 0
  const roiPct = hasPrice ? (earned / item.purchasePrice) * 100 : null
  const remaining = hasPrice ? Math.max(0, item.purchasePrice - earned) : null

  return {
    item,
    timesUsed,
    totalDays,
    earned,
    roiPct,
    remainingToBreakEven: remaining,
    isPaidOff: hasPrice ? earned >= item.purchasePrice : false,
  }
}

/** ROI całego katalogu, posortowane malejąco po zarobku. */
export function computeCatalogRoi(items: EquipmentItem[], projects: Project[]): EquipmentRoi[] {
  return items
    .map((item) => computeEquipmentRoi(item, projects))
    .sort((a, b) => b.earned - a.earned)
}

export interface CatalogRoiTotals {
  /** Łączna cena zakupu pozycji z podaną ceną. */
  totalInvested: number
  /** Łączna wartość „zaoszczędzonego rentalu". */
  totalEarned: number
  /** Ile pozycji zwróciło już swoją cenę. */
  paidOffCount: number
  /** Pozycje ani razu nie użyte w zrealizowanym projekcie. */
  unusedCount: number
  /** Zwrot całego katalogu w % (null gdy nic nie ma podanej ceny zakupu). */
  roiPct: number | null
}

export function computeCatalogTotals(roi: EquipmentRoi[]): CatalogRoiTotals {
  let totalInvested = 0
  let totalEarned = 0
  let paidOffCount = 0
  let unusedCount = 0

  roi.forEach((r) => {
    totalInvested += r.item.purchasePrice
    totalEarned += r.earned
    if (r.isPaidOff) paidOffCount += 1
    if (r.timesUsed === 0) unusedCount += 1
  })

  return {
    totalInvested,
    totalEarned,
    paidOffCount,
    unusedCount,
    roiPct: totalInvested > 0 ? (totalEarned / totalInvested) * 100 : null,
  }
}

/**
 * Lista rzeczy do spakowania na projekt — sprzęt z niezerową liczbą dni,
 * pogrupowany po kategorii i posortowany alfabetycznie.
 */
export function buildPackingList(
  project: Project,
  catalog: EquipmentItem[]
): { category: string; items: { item: EquipmentItem; days: number }[] }[] {
  const byId = new Map(catalog.map((i) => [i.id, i]))
  const groups = new Map<string, { item: EquipmentItem; days: number }[]>()

  project.equipment.forEach((usage) => {
    const item = byId.get(usage.itemId)
    if (!item || usage.days <= 0) return
    const bucket = groups.get(item.category) ?? []
    bucket.push({ item, days: usage.days })
    groups.set(item.category, bucket)
  })

  return [...groups.entries()]
    .map(([category, items]) => ({
      category,
      items: items.sort((a, b) => a.item.name.localeCompare(b.item.name, 'pl')),
    }))
    .sort((a, b) => a.category.localeCompare(b.category, 'pl'))
}
