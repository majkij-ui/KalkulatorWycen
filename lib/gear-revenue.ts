/**
 * Ile klienci realnie zapłacili za sprzęt w projekcie — z samej migawki wyceny.
 *
 * Każda wycena ma kwotę za sprzęt (`sprzetNetto`). Liczymy z niej:
 *
 *   naliczone     = sprzetNetto × (przelew / suma netto)   ← rabat na całość obejmuje też sprzęt
 *   z katalogu    = pozycje mojego sprzętu w dniach wyceny (G5), po rabacie,
 *                   × ta sama skala — DOKŁADNIE per pozycja
 *   dorentalowane = pozycje planu „wynajem" (ręczny „Rental sprzętu" i
 *                   wypożyczalnia wpisana w dniu), jeśli są kosztem
 *   reszta        = naliczone − z katalogu − dorentalowane   (nie mniej niż 0)
 *
 * „Reszta" to sprzęt wyceniony po staremu (pakiet, kamery standard/rental…):
 * wiadomo ile, ale nie za co — `equipment-roi.ts` rozkłada ją na pozycje
 * użyte w projekcie proporcjonalnie do wartości rentalowej, jako SZACUNEK.
 * Koszt wypożyczalni zmniejsza tylko resztę: pozycje z katalogu to mój sprzęt.
 */

import { getProductionEkipaCastSprzetNetto } from './quote-calc'
import { isRentalCostKey } from './profit-calc'
import { quoteGearFigures } from './quote-gear'
import { quotePlnPlan, resolveSnapshot, type FinancialsSource } from './quote-financials'
import { toPln } from './quote-currency'

export interface GearRevenue {
  /** Kwota za sprzęt w wycenie, przeskalowana do faktycznego przelewu. */
  charged: number
  /** Ile z tego poszło na sprzęt dorentalowany (koszt z planu). */
  rentedIn: number
  /** Co zostało dla mojego sprzętu: `itemized` + `unitemized`. */
  ownGear: number
  /** Zapłata za pozycje z katalogu, dokładnie per pozycja (id → zł). */
  byItem: Map<string, number>
  /** Suma `byItem`. */
  itemized: number
  /** Mój sprzęt wyceniony po staremu — do rozłożenia na użyte pozycje (szacunek). */
  unitemized: number
}

export function snapshotGearRevenue(snapshot: FinancialsSource | null | undefined): GearRevenue | null {
  const resolved = resolveSnapshot(snapshot)
  if (!resolved) return null
  const { data, pricing, margin } = resolved

  // Wycena w EUR (S3): kwoty dla klienta w euro × kurs; koszty z planu w zł.
  const { views, sumaNettoPln: sumaNetto, sections } = quotePlnPlan(data, pricing, margin)
  const { money, client } = views
  const { sprzetNetto } = getProductionEkipaCastSprzetNetto(client.data, margin, client.pricing)
  const transfer = data.profitTransferAmount ?? sumaNetto
  const scale = sumaNetto > 0 ? transfer / sumaNetto : 1
  const charged = Math.max(0, toPln(sprzetNetto, money) * scale)

  const byItem = new Map<string, number>()
  quoteGearFigures(client.data).byItem.forEach((amount, itemId) => {
    if (amount > 0) byItem.set(itemId, toPln(amount, money) * scale)
  })
  const itemized = [...byItem.values()].reduce((sum, amount) => sum + amount, 0)

  const rentedIn = sections
    .flatMap((section) => section.lines)
    .filter((line) => isRentalCostKey(line.key))
    .reduce((sum, line) => sum + line.total, 0)

  const unitemized = Math.max(0, charged - itemized - rentedIn)
  return { charged, rentedIn, ownGear: itemized + unitemized, byItem, itemized, unitemized }
}

/** `null` = projekt bez wyceny (np. retro-import): nie wiadomo, ile zapłacono za sprzęt. */
export function projectGearRevenue(project: { quote: unknown }): GearRevenue | null {
  return project.quote ? snapshotGearRevenue(project.quote as FinancialsSource) : null
}
