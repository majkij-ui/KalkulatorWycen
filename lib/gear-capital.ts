/**
 * „Kapitał w sprzęcie" i „Sfinansowano sprzedażą" (wariant C, 10.11.2026).
 *
 * Kapitał = zakupy (cena × sztuki, wg daty zakupu) − sprzedaże (`soldPrice`
 * wg `soldDate`). Widok zarządczy netto; nie rusza Finansów ani ROI. Pozycje
 * bez daty zakupu wchodzą tylko do sumy „od początku" (nie wiadomo, w którym roku).
 * `fundedBySale` jest informacją: ROI, „Na plusie" i spłata liczą pełną cenę.
 * Moduł czysty — testy w `gear-capital.test.ts`.
 */

import { unitsOwned, type EquipmentItem } from './project-types'

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

export interface GearCapital {
  year: number
  /** Zakupy z datą w roku. */
  purchasesInYear: number
  /** Sprzedaże z datą w roku. */
  salesInYear: number
  /** Zakupy − sprzedaże w roku (zmiana kapitału). */
  netInYear: number
  /** Wszystkie zakupy od początku (także bez daty). */
  purchasesTotal: number
  /** Wszystkie sprzedaże od początku. */
  salesTotal: number
  /** Kapitał od początku: zakupy − sprzedaże. */
  netTotal: number
  /** Pozycje z ceną bez daty zakupu (w sumie, nie w roku). */
  undatedCount: number
}

const alive = (items: EquipmentItem[]) => items.filter((item) => !(item as { deletedAt?: unknown }).deletedAt)

/** Cena sprzedaży, gdy pozycja ma datę i cenę sprzedaży; inaczej `null`. */
export function soldPriceOf(item: EquipmentItem): number | null {
  return DATE_KEY.test(item.soldDate ?? '') && typeof item.soldPrice === 'number' && item.soldPrice >= 0
    ? item.soldPrice
    : null
}

export function gearCapital(items: EquipmentItem[], year: number): GearCapital {
  const prefix = `${year}-`
  const result: GearCapital = {
    year,
    purchasesInYear: 0,
    salesInYear: 0,
    netInYear: 0,
    purchasesTotal: 0,
    salesTotal: 0,
    netTotal: 0,
    undatedCount: 0,
  }
  alive(items).forEach((item) => {
    const price = item.purchasePrice * unitsOwned(item)
    if (price > 0) {
      result.purchasesTotal += price
      if (!DATE_KEY.test(item.purchaseDate)) result.undatedCount += 1
      else if (item.purchaseDate.startsWith(prefix)) result.purchasesInYear += price
    }
    const sold = soldPriceOf(item)
    if (sold !== null) {
      result.salesTotal += sold
      if (item.soldDate!.startsWith(prefix)) result.salesInYear += sold
    }
  })
  result.netInYear = result.purchasesInYear - result.salesInYear
  result.netTotal = result.purchasesTotal - result.salesTotal
  return result
}

export interface FundedBySale {
  sources: { id: string; name: string; soldPrice: number }[]
  /** Suma sprzedaży wskazanych pozycji. */
  total: number
  /** Cena zakupu (cena × sztuki). */
  price: number
  /** Realny koszt = cena − sprzedaże, nie mniej niż 0. */
  realCost: number
  /** Ile sprzedaż przekracza cenę (0, gdy nie przekracza). */
  surplus: number
}

/** Sprzedane pozycje, które można wskazać jako źródło sfinansowania (z ceną sprzedaży). */
export function fundingCandidates(items: EquipmentItem[], selfId: string | null): EquipmentItem[] {
  return alive(items).filter((item) => item.id !== selfId && (soldPriceOf(item) ?? 0) > 0)
}

/** `null`, gdy pozycja nie ma wskazanych (istniejących, sprzedanych) źródeł. */
export function fundedBySale(item: EquipmentItem, items: EquipmentItem[]): FundedBySale | null {
  const ids = Array.isArray(item.fundedBySale) ? item.fundedBySale : []
  if (ids.length === 0) return null
  const byId = new Map(alive(items).map((i) => [i.id, i]))
  const sources: FundedBySale['sources'] = []
  new Set(ids).forEach((id) => {
    const source = byId.get(id)
    const sold = source ? soldPriceOf(source) : null
    if (source && sold !== null && id !== item.id) sources.push({ id, name: source.name, soldPrice: sold })
  })
  if (sources.length === 0) return null
  const total = sources.reduce((sum, s) => sum + s.soldPrice, 0)
  const price = item.purchasePrice * unitsOwned(item)
  return { sources, total, price, realCost: Math.max(0, price - total), surplus: Math.max(0, total - price) }
}

/** Tekst dla arkusza pozycji; `fmt` formatuje kwotę (np. `pln`). */
export function fundedBySaleText(info: FundedBySale, fmt: (n: number) => string): string {
  const from = info.sources.map((s) => `${s.name} ${fmt(s.soldPrice)}`).join(', ')
  const cost =
    info.surplus > 0.005 ? `realny koszt ${fmt(0)}, nadwyżka ${fmt(info.surplus)}` : `realny koszt ${fmt(info.realCost)}`
  return `Sfinansowano sprzedażą: ${from} → ${cost}`
}
