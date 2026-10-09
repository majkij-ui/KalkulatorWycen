/**
 * Ile klienci realnie zapłacili za sprzęt w projekcie — z samej migawki wyceny.
 *
 * Każda wycena ma już kwotę za sprzęt (`sprzetNetto`: pakiet w szybkiej
 * wycenie, kamery/obiektywy/światło… w szczegółowej). Z niej liczymy:
 *
 *   naliczone   = sprzetNetto × (przelew / suma netto)   ← rabat na całość obejmuje też sprzęt
 *   dorentalowane = pozycja „Rental sprzętu" z zakładki Profit, jeśli zaznaczona jako koszt
 *   własny sprzęt = naliczone − dorentalowane            (nie mniej niż 0)
 *
 * Kwota dla własnego sprzętu jest potem rozkładana na pozycje użyte w projekcie
 * (`equipment-roi.ts`). Dopóki wycena nie wycenia sprzętu pozycja po pozycji
 * (G5), to SZACUNEK — rozkład proporcjonalny do wartości rentalowej.
 */

import { getProductionEkipaCastSprzetNetto } from './quote-calc'
import { resolveProfitSections } from './profit-calc'
import {
  computeQuoteTotals,
  computeTotalCrewDays,
  resolveSnapshot,
  type FinancialsSource,
} from './quote-financials'

/** Klucz pozycji „Rental sprzętu" w zakładce Profit (`profit-calc.ts`). */
const RENTAL_LINE_KEY = 'pro:rentalSprzetu'

export interface GearRevenue {
  /** Kwota za sprzęt w wycenie, przeskalowana do faktycznego przelewu. */
  charged: number
  /** Ile z tego poszło na sprzęt dorentalowany (koszt z zakładki Profit). */
  rentedIn: number
  /** Co zostało dla własnego sprzętu — to rozkładamy na pozycje katalogu. */
  ownGear: number
}

export function snapshotGearRevenue(snapshot: FinancialsSource | null | undefined): GearRevenue | null {
  const resolved = resolveSnapshot(snapshot)
  if (!resolved) return null
  const { data, pricing, margin } = resolved

  const { sprzetNetto } = getProductionEkipaCastSprzetNetto(data, margin, pricing)
  const { sumaNetto } = computeQuoteTotals(data, margin, pricing)
  const transfer = data.profitTransferAmount ?? sumaNetto
  const scale = sumaNetto > 0 ? transfer / sumaNetto : 1
  const charged = Math.max(0, sprzetNetto * scale)

  const { sections } = resolveProfitSections(data, pricing, computeTotalCrewDays(data))
  const rentedIn = sections
    .flatMap((section) => section.lines)
    .filter((line) => line.key === RENTAL_LINE_KEY)
    .reduce((sum, line) => sum + line.total, 0)

  return { charged, rentedIn, ownGear: Math.max(0, charged - rentedIn) }
}

/** `null` = projekt bez wyceny (np. retro-import): nie wiadomo, ile zapłacono za sprzęt. */
export function projectGearRevenue(project: { quote: unknown }): GearRevenue | null {
  return project.quote ? snapshotGearRevenue(project.quote as FinancialsSource) : null
}
