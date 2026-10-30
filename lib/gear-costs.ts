/**
 * Zakupy sprzętu jako koszt firmy (S4, decyzja B z 2026-10-13).
 *
 * Jedno źródło: KATALOG (cena zakupu × sztuki, data zakupu — `gearPurchases`
 * z Z1, na plan i zaplecze razem). Dwa widoki, przełącznik „Rozłóż duże
 * zakupy sprzętu":
 *  - ROZŁOŻONY (włączony): zakup od progu (domyślnie 5 000 zł netto, cała
 *    pozycja: cena × sztuki) liczy się po równo przez 36 miesięcy od miesiąca
 *    zakupu; tańszy — w całości w swoim miesiącu.
 *  - W CAŁOŚCI (wyłączony): każdy zakup w całości w swoim miesiącu — tak, jak
 *    zakupy uderzyły w konto.
 *  - Wycofany / sprzedany sprzęt przestaje się rozkładać po miesiącu
 *    wycofania; nierozłożona reszta jest pokazywana, ale się nie liczy (nie ma
 *    jeszcze ceny sprzedaży). W widoku „w całości" wycofanie niczego nie zmienia.
 *  - Bez daty zakupu: nie wiadomo, w którym miesiącu — nie liczy się nigdzie,
 *    jest na liście do uzupełnienia. Bez ceny: to samo.
 *
 * Ręczne pozycje kosztów stałych w kategorii `gear` („Sprzęt spoza
 * katalogu") liczą się w całości w swoim miesiącu w obu widokach (to sumy
 * drobiazgów). Pozycja z `catalogueItemIds` obejmowała zakup, który jest też w
 * katalogu: liczy się z niej tylko reszta (kwota − ceny tych pozycji), a
 * zakup — z katalogu. Tak nic nie liczy się dwa razy.
 *
 * Widok zarządczy, nie amortyzacja podatkowa. Moduł czysty — testy w
 * `gear-costs.test.ts`.
 */

import { fixedCostCategory } from './fixed-cost-categories'
import { isInPeriod, periodMonths, type Period } from './finance-calc'
import { gearPurchases, type GearPurchase } from './gear-backstage'
import { isLiveFixedCost, unitsOwned, type EquipmentItem, type FixedCost } from './project-types'

export interface GearSpreadSettings {
  /** Zakup od tej kwoty (zł netto, cena × sztuki) się rozkłada. */
  thresholdPln: number
  /** Na ile miesięcy. */
  months: number
}

export const DEFAULT_GEAR_SPREAD: GearSpreadSettings = { thresholdPln: 5000, months: 36 }

/**
 * Jak nazywamy widok kosztów sprzętu na ekranie i w raporcie (V1): „rozłożone na
 * N mies." albo „liczone jednorazowo" — zamiast dawnego „rozłożony" / „w całości",
 * które nie mówiły, o co chodzi. Klucze w kodzie (`spread` / `full`) bez zmian.
 */
export function gearViewLabel(spread: boolean, months: number): string {
  return spread ? `zakupy sprzętu rozłożone na ${months} mies.` : 'zakupy sprzętu liczone jednorazowo'
}

/** Próg i liczba miesięcy z company.json; zła albo brakująca wartość = domyślna. */
export function gearSpreadSettings(
  company?: { gearSpreadThresholdPln?: unknown; gearSpreadMonths?: unknown } | null
): GearSpreadSettings {
  const threshold = company?.gearSpreadThresholdPln
  const months = company?.gearSpreadMonths
  return {
    thresholdPln:
      typeof threshold === 'number' && Number.isFinite(threshold) && threshold >= 0
        ? threshold
        : DEFAULT_GEAR_SPREAD.thresholdPln,
    months: typeof months === 'number' && Number.isInteger(months) && months >= 1 ? months : DEFAULT_GEAR_SPREAD.months,
  }
}

// ── Miesiące ─────────────────────────────────────────────────────────────────

const monthIndex = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1
const monthFromIndex = (index: number) =>
  `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

// ── Pozycje katalogu ─────────────────────────────────────────────────────────

export interface GearCostLine {
  itemId: string
  name: string
  /** Data zakupu `YYYY-MM-DD`. */
  date: string
  /** Cena × sztuki. */
  price: number
  onSet: boolean
  /** `spread` = po równo przez miesiące, `full` = w całości w miesiącu zakupu. */
  mode: 'spread' | 'full'
  firstMonth: string
  /** Ostatni miesiąc z kosztem (przy wycofaniu — miesiąc wycofania). */
  lastMonth: string
  /** Koszt jednego miesiąca (`full`: cała cena). */
  monthly: number
  /** Miesiąc wycofania `YYYY-MM`; `null` = w użyciu. */
  retiredMonth: string | null
  /** Rozkładanie przerwane wycofaniem: ta reszta się nie liczy (brak ceny sprzedaży). */
  unspread: number
}

export interface GearCostLines {
  lines: GearCostLine[]
  /** Pozycje z ceną bez daty zakupu — nie liczą się w żadnym miesiącu. */
  undated: GearPurchase[]
  /** Pozycje bez ceny zakupu (z datą albo bez). */
  unpriced: GearPurchase[]
}

/** Każdy zakup z katalogu jako wiersz kosztu w wybranym widoku. */
export function gearCostLines(items: EquipmentItem[], spread: boolean, settings: GearSpreadSettings): GearCostLines {
  const live = items.filter((item) => !(item as { deletedAt?: unknown }).deletedAt)
  const byId = new Map(live.map((item) => [item.id, item]))
  const lines: GearCostLine[] = []
  const undated: GearPurchase[] = []
  const unpriced: GearPurchase[] = []
  gearPurchases(live).forEach((purchase) => {
    if (!(purchase.price > 0)) {
      unpriced.push(purchase)
      return
    }
    if (purchase.date === null) {
      undated.push(purchase)
      return
    }
    const item = byId.get(purchase.itemId)
    const retiredAt = item?.retiredAt && DATE_KEY.test(item.retiredAt) ? item.retiredAt : null
    const retiredMonth = retiredAt ? retiredAt.slice(0, 7) : null
    const first = monthIndex(purchase.date)
    const isSpread = spread && purchase.price >= settings.thresholdPln
    if (!isSpread) {
      lines.push({
        itemId: purchase.itemId,
        name: purchase.name,
        date: purchase.date,
        price: purchase.price,
        onSet: purchase.onSet,
        mode: 'full',
        firstMonth: monthFromIndex(first),
        lastMonth: monthFromIndex(first),
        monthly: purchase.price,
        retiredMonth,
        unspread: 0,
      })
      return
    }
    const monthly = purchase.price / settings.months
    let last = first + settings.months - 1
    // Wycofany przed końcem: ostatni miesiąc to miesiąc wycofania (co
    // najmniej miesiąc zakupu — wycofany „przed zakupem" to błąd daty).
    if (retiredMonth) last = Math.min(last, Math.max(first, monthIndex(retiredMonth)))
    const counted = last - first + 1
    lines.push({
      itemId: purchase.itemId,
      name: purchase.name,
      date: purchase.date,
      price: purchase.price,
      onSet: purchase.onSet,
      mode: 'spread',
      firstMonth: monthFromIndex(first),
      lastMonth: monthFromIndex(last),
      monthly,
      retiredMonth,
      unspread: counted < settings.months ? purchase.price - monthly * counted : 0,
    })
  })
  return { lines, undated, unpriced }
}

/** Koszt wiersza w miesiącach `from`..`to` (`YYYY-MM`, włącznie). */
export function lineAmountInMonths(line: GearCostLine, from: string, to: string): number {
  const start = Math.max(monthIndex(line.firstMonth), monthIndex(from))
  const end = Math.min(monthIndex(line.lastMonth), monthIndex(to))
  if (end < start) return 0
  if (line.mode === 'full') return line.price
  return line.monthly * (end - start + 1)
}

// ── Ręczne pozycje powiązane z katalogiem ────────────────────────────────────

export interface LinkedCost {
  costId: string
  month: string
  /** Kwota z pliku. */
  amount: number
  /** Ceny powiązanych pozycji katalogu (cena × sztuki), które liczy katalog. */
  linkedTotal: number
  linked: { itemId: string; name: string; price: number }[]
  /** Identyfikatory, których nie ma w katalogu — nic za nie nie odejmujemy. */
  missing: string[]
  /** To, co liczy się z pozycji: kwota − powiązane. */
  remainder: number
}

/** Pozycja kosztów z odjętymi zakupami z katalogu, które obejmowała. */
export function linkedCost(cost: FixedCost, items: EquipmentItem[]): LinkedCost | null {
  const ids = cost.catalogueItemIds ?? []
  if (ids.length === 0) return null
  const byId = new Map(items.map((item) => [item.id, item]))
  const linked: LinkedCost['linked'] = []
  const missing: string[] = []
  new Set(ids).forEach((id) => {
    const item = byId.get(id)
    if (!item) missing.push(id)
    else linked.push({ itemId: id, name: item.name, price: item.purchasePrice * unitsOwned(item) })
  })
  const amount = Number.isFinite(cost.amount) ? cost.amount : 0
  const linkedTotal = linked.reduce((sum, l) => sum + l.price, 0)
  return { costId: cost.id, month: cost.month, amount, linkedTotal, linked, missing, remainder: amount - linkedTotal }
}

/** Ile liczy się z ręcznej pozycji: kwota, a przy powiązaniu z katalogiem — reszta. */
export function countedAmount(cost: FixedCost, items: EquipmentItem[]): number {
  const link = linkedCost(cost, items)
  if (link) return link.remainder
  return Number.isFinite(cost.amount) ? cost.amount : 0
}

// ── Okres ────────────────────────────────────────────────────────────────────

export interface GearPeriodLine {
  line: GearCostLine
  /** Koszt w okresie. */
  amount: number
  /** Zakup sprzed początku okresu (reszta rozkładania wcześniejszych lat). */
  carried: boolean
}

export interface GearPeriodCost {
  spread: boolean
  settings: GearSpreadSettings
  /** Z katalogu (oba rodzaje). */
  catalogue: number
  /** …w tym reszta rozkładania zakupów sprzed okresu. */
  carried: number
  /** Ręczne „Sprzęt spoza katalogu" (po odjęciu powiązanych z katalogiem). */
  manual: number
  total: number
  /** Wiersze katalogu z kosztem w okresie: najpierw przeniesione, potem wg daty. */
  lines: GearPeriodLine[]
  /** Ręczne pozycje sprzętu w okresie (kwota liczona, opis, powiązania). */
  manualCosts: { cost: FixedCost; counted: number; link: LinkedCost | null }[]
  /** Wycofane w okresie z nierozłożoną resztą. */
  retired: GearCostLine[]
  undated: GearPurchase[]
  unpriced: GearPurchase[]
}

/**
 * Sprzęt w kosztach firmy za okres. `fixedCosts` to koszty stałe (ręczne +
 * raty) — stąd biorą się ręczne pozycje „Sprzęt spoza katalogu".
 */
export function gearCostInPeriod(
  items: EquipmentItem[],
  fixedCosts: FixedCost[],
  period: Period,
  spread: boolean,
  settings: GearSpreadSettings,
  /** Ostatni miesiąc (`YYYY-MM`), do którego liczymy (trwający okres: bieżący); `null` = cały okres. */
  through: string | null = null
): GearPeriodCost {
  const months = periodMonths(period)
  const from = months[0]
  const to = through && through < months[months.length - 1] ? through : months[months.length - 1]
  const { lines, undated, unpriced } = gearCostLines(items, spread, settings)

  const periodLines: GearPeriodLine[] = []
  lines.forEach((line) => {
    const amount = lineAmountInMonths(line, from, to)
    if (amount === 0) return
    periodLines.push({ line, amount, carried: line.firstMonth < from })
  })
  periodLines.sort((a, b) => Number(b.carried) - Number(a.carried) || a.line.date.localeCompare(b.line.date))
  const catalogue = periodLines.reduce((sum, l) => sum + l.amount, 0)
  const carried = periodLines.filter((l) => l.carried).reduce((sum, l) => sum + l.amount, 0)

  const manualCosts = fixedCosts
    .filter((cost) => isLiveFixedCost(cost) && fixedCostCategory(cost) === 'gear' && isInPeriod(cost.month, period))
    .map((cost) => ({ cost, counted: countedAmount(cost, items), link: linkedCost(cost, items) }))
    .sort((a, b) => a.cost.month.localeCompare(b.cost.month))
  const manual = manualCosts.reduce((sum, m) => sum + m.counted, 0)

  return {
    spread,
    settings,
    catalogue,
    carried,
    manual,
    total: catalogue + manual,
    lines: periodLines,
    manualCosts,
    retired: lines.filter((l) => l.unspread > 0.005 && l.retiredMonth !== null && l.retiredMonth >= from && l.retiredMonth <= to),
    undated,
    unpriced,
  }
}
