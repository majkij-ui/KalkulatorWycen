/**
 * Zakupy z KSeF jako spis wydatków firmy (Sprzęt → „Zakupy KSeF").
 *
 * Każdy WIERSZ faktury zakupu dostaje jedno z trzech rozstrzygnięć:
 *  - sprzęt: pozycja katalogu pamięta fakturę (`EquipmentItem.purchaseInvoices`,
 *    numer KSeF + numer wiersza) — to jedyne miejsce, w którym zapisane jest
 *    powiązanie, więc usunięcie pozycji samo zwraca wiersz „do decyzji";
 *  - kategoria wydatku (paliwo, samochód, subskrypcje, koszt projektu, biuro,
 *    inne): decyzja `purchase_category` w `ksef-decisions.json` — dla wiersza,
 *    całej faktury albo wszystkich faktur sprzedawcy;
 *  - nie dotyczy firmy: ta sama decyzja co w Finansach (`purchase_vat` = 0).
 * Paliwo hub rozpoznaje sam po wierszach (`isFuelInvoice`).
 *
 * Kwoty: koszt wiersza to netto, a przed `VAT_PAYER_SINCE` brutto (bez prawa do
 * odliczenia cały VAT był kosztem). Wiersz podany tylko brutto jest przeliczany
 * stawką z faktury. Wiersze wysyłki nie są osobnymi pozycjami: ich kwota
 * rozkłada się na resztę faktury proporcjonalnie do wartości. Korekta wskazująca
 * fakturę z kopii zmienia jej wiersze (zwrot = wiersz z kosztem 0, „zwrócone").
 *
 * Moduł czysty — testy w `ksef-purchases.test.ts`.
 */

import type { KsefInvoiceLine, KsefSale } from './ksef-invoices'
import type { KsefDecision } from './ksef-reconcile'
import { unitsOwned, type EquipmentItem, type PurchaseInvoiceRef } from './project-types'
import { VAT_PAYER_SINCE, isFuelInvoice, purchaseVatDecisionId } from './taxes'

export const PURCHASE_CATEGORIES = [
  { key: 'fuel', label: 'Paliwo' },
  { key: 'car', label: 'Samochód' },
  { key: 'subscription', label: 'Subskrypcje i usługi stałe' },
  { key: 'project', label: 'Koszt projektu' },
  { key: 'office', label: 'Biuro' },
  { key: 'other', label: 'Inne' },
] as const
export type PurchaseCategory = (typeof PURCHASE_CATEGORIES)[number]['key']

/** Worki w podsumowaniu: kategorie wydatków + dwa rodzaje sprzętu + „nie dotyczy firmy". */
export type PurchaseBucket = PurchaseCategory | 'gear' | 'backstage' | 'private' | 'todo'

export const PURCHASE_BUCKET_LABEL: Record<PurchaseBucket, string> = {
  gear: 'Sprzęt na plan',
  backstage: 'Zaplecze i drobiazgi',
  ...(Object.fromEntries(PURCHASE_CATEGORIES.map((c) => [c.key, c.label])) as Record<PurchaseCategory, string>),
  private: 'Nie dotyczy firmy',
  todo: 'Do decyzji',
}

const CATEGORY_KEYS = new Set<string>(PURCHASE_CATEGORIES.map((c) => c.key))
const isCategory = (value: unknown): value is PurchaseCategory => typeof value === 'string' && CATEGORY_KEYS.has(value)

export type PurchaseLineStatus =
  | { kind: 'gear'; items: { id: string; name: string; onSet: boolean }[] }
  | { kind: 'category'; category: PurchaseCategory; source: 'line' | 'invoice' | 'seller' | 'rule' }
  | { kind: 'private' }
  | { kind: 'todo' }

export interface PurchaseLine {
  /** `<numer KSeF>:<wiersz>` — pod tym kluczem pozycja sprzętu pamięta wiersz. */
  key: string
  index: number
  name: string
  unit: string
  /** Liczba sztuk po korektach. */
  quantity: number
  /** Koszt dla firmy po korektach, z udziałem w wysyłce (netto; przed VAT-em brutto). */
  cost: number
  /** Brutto po korektach, z udziałem w wysyłce. */
  gross: number
  /** Część `cost`, która pochodzi z wierszy wysyłki. */
  shipping: number
  /** Korekta wyzerowała wiersz: nie ma czego rozpisywać. */
  returned: boolean
  status: PurchaseLineStatus
}

export interface PurchaseEntry {
  invoice: KsefSale
  lines: PurchaseLine[]
  /** Korekty wliczone w wiersze tej faktury. */
  corrections: KsefSale[]
  /** Korekta, której hub nie umiał rozłożyć na wiersze: stoi jako osobna faktura. */
  looseCorrection: boolean
  /** Suma kosztu wierszy. */
  cost: number
  /** Ile wierszy czeka na decyzję. */
  todo: number
}

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
const SHIPPING = /wysy[lł]k|kurier|przesy[lł]k|\bdostaw[ay]\b|\btransport|paczkomat|\bdpd\b|\bdhl\b|inpost/i

function nameKey(text: string): string {
  return text
    .toLocaleLowerCase('pl')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/ł/g, 'l')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function vatRate(line: KsefInvoiceLine): number {
  const match = /^\s*(\d+(?:[.,]\d+)?)\s*%?\s*$/.exec(line.vatRate)
  return match ? Number(match[1].replace(',', '.')) / 100 : 0
}

/** Netto i brutto wiersza, także gdy faktura podaje tylko jedną z kwot. */
export function lineAmounts(line: KsefInvoiceLine): { net: number; gross: number; quantity: number } {
  const rate = vatRate(line)
  const quantity = line.quantity ?? 1
  const net =
    line.amountNet ??
    (line.amountGross !== null
      ? line.amountGross / (1 + rate)
      : line.unitPriceNet !== null
        ? line.unitPriceNet * quantity
        : line.unitPriceGross !== null
          ? (line.unitPriceGross * quantity) / (1 + rate)
          : 0)
  const gross = line.amountGross ?? net * (1 + rate)
  return { net: round2(net), gross: round2(gross), quantity }
}

/** Czy firma odliczała VAT w dniu faktury: wtedy kosztem jest netto, wcześniej brutto. */
export function deductsVat(day: string): boolean {
  return day.slice(0, 7) >= VAT_PAYER_SINCE
}

interface Draft {
  index: number
  name: string
  unit: string
  quantity: number
  net: number
  gross: number
  shipping: boolean
}

/**
 * Zmiany, które korekta wnosi do wierszy faktury pierwotnej, po nazwie wiersza.
 * Para wierszy o tej samej nazwie = „było" i „jest"; pojedynczy wiersz = sama
 * różnica. `null`, gdy suma zmian nie zgadza się z kwotą korekty.
 */
function correctionDeltas(correction: KsefSale): Map<string, { net: number; gross: number; quantity: number }> | null {
  const byName = new Map<string, { net: number; gross: number; quantity: number }[]>()
  correction.details.lines.forEach((line) => {
    const key = nameKey(line.name)
    byName.set(key, [...(byName.get(key) ?? []), lineAmounts(line)])
  })
  const deltas = new Map<string, { net: number; gross: number; quantity: number }>()
  byName.forEach((rows, key) => {
    const delta = { net: 0, gross: 0, quantity: 0 }
    if (rows.length % 2 === 0) {
      for (let i = 0; i < rows.length; i += 2) {
        delta.net += rows[i + 1].net - rows[i].net
        delta.gross += rows[i + 1].gross - rows[i].gross
        delta.quantity += rows[i + 1].quantity - rows[i].quantity
      }
    } else {
      rows.forEach((row) => {
        delta.net += row.net
        delta.gross += row.gross
        delta.quantity += row.net < 0 && row.quantity > 0 ? -row.quantity : row.quantity
      })
    }
    deltas.set(key, delta)
  })
  const total = [...deltas.values()].reduce((sum, d) => sum + d.net, 0)
  const tolerance = 0.02 * Math.max(1, correction.details.lines.length)
  return Math.abs(total - correction.netAmount) <= tolerance ? deltas : null
}

function draftsOf(invoice: KsefSale): Draft[] {
  if (invoice.details.lines.length === 0) {
    return [
      {
        index: 0,
        name: invoice.hasDetails === false ? 'Pozycje jeszcze niepobrane' : 'Faktura bez pozycji',
        unit: '',
        quantity: 1,
        net: invoice.netAmount,
        gross: invoice.grossAmount,
        shipping: false,
      },
    ]
  }
  return invoice.details.lines.map((line, index) => {
    const amounts = lineAmounts(line)
    return { index, name: line.name, unit: line.unit, ...amounts, shipping: SHIPPING.test(line.name) }
  })
}

export const purchaseLineKey = (ksefNumber: string, index: number) => `${ksefNumber}:${index}`
export const lineCategoryDecisionId = (ksefNumber: string, index: number) => `cat:${ksefNumber}:${index}`
export const invoiceCategoryDecisionId = (ksefNumber: string) => `cat:${ksefNumber}`
export const sellerCategoryDecisionId = (nip: string) => `cat-seller:${nip}`

/** Faktury zakupu rozpisane na wiersze ze statusem; korekty wliczone w fakturę pierwotną. Od najnowszej. */
export function purchaseBook(input: { invoices: KsefSale[]; decisions: KsefDecision[]; items: EquipmentItem[] }): PurchaseEntry[] {
  const purchases = input.invoices.filter((invoice) => invoice.direction === 'purchase')
  const byKsef = new Map(purchases.map((invoice) => [invoice.ksefNumber, invoice]))

  // Korekty → faktura pierwotna (po numerze KSeF, a bez niego po numerze u tego samego sprzedawcy).
  const folded = new Map<string, { correction: KsefSale; deltas: Map<string, { net: number; gross: number; quantity: number }> }[]>()
  const foldedCorrections = new Set<string>()
  purchases
    .filter((invoice) => invoice.isCorrection)
    .sort((a, b) => a.issueDate.localeCompare(b.issueDate))
    .forEach((correction) => {
      const original =
        byKsef.get(correction.details.correctedKsefNumber) ??
        purchases.find(
          (invoice) =>
            !invoice.isCorrection &&
            !!correction.details.correctedNumber &&
            invoice.invoiceNumber === correction.details.correctedNumber &&
            invoice.counterpartyNip === correction.counterpartyNip
        )
      const deltas = original ? correctionDeltas(correction) : null
      if (!original || !deltas) return
      const names = new Set(original.details.lines.map((line) => nameKey(line.name)))
      if (![...deltas.keys()].every((key) => names.has(key))) return
      folded.set(original.ksefNumber, [...(folded.get(original.ksefNumber) ?? []), { correction, deltas }])
      foldedCorrections.add(correction.ksefNumber)
    })

  const linked = new Map<string, { id: string; name: string; onSet: boolean }[]>()
  input.items.forEach((item) => {
    if ((item as { deletedAt?: unknown }).deletedAt) return
    ;(item.purchaseInvoices ?? []).forEach((ref) => {
      if (!ref.ksefNumber || ref.line === undefined) return
      const key = purchaseLineKey(ref.ksefNumber, ref.line)
      if (linked.get(key)?.some((entry) => entry.id === item.id)) return
      linked.set(key, [...(linked.get(key) ?? []), { id: item.id, name: item.name, onSet: item.onSet !== false }])
    })
  })

  const categoryOf = new Map<string, PurchaseCategory>()
  const privateInvoices = new Set<string>()
  input.decisions.forEach((decision) => {
    if (decision.kind === 'purchase_category' && isCategory(decision.category)) categoryOf.set(decision.id, decision.category)
    if (decision.kind === 'purchase_vat' && decision.amount === 0 && decision.id.startsWith('vat:')) privateInvoices.add(decision.id)
  })

  return purchases
    .filter((invoice) => !foldedCorrections.has(invoice.ksefNumber))
    .map((invoice) => {
      const drafts = draftsOf(invoice)
      const corrections = folded.get(invoice.ksefNumber) ?? []
      corrections.forEach(({ deltas }) => {
        deltas.forEach((delta, key) => {
          const target = drafts.find((draft) => nameKey(draft.name) === key)
          if (!target) return
          target.net = round2(target.net + delta.net)
          target.gross = round2(target.gross + delta.gross)
          target.quantity = Math.max(0, round2(target.quantity + delta.quantity))
        })
      })

      const useNet = deductsVat(invoice.issueDate)
      const goods = drafts.filter((draft) => !draft.shipping)
      // Sama wysyłka na fakturze (np. faktura za kuriera): zostaje zwykłym wierszem.
      const shippingRows = goods.length > 0 ? drafts.filter((draft) => draft.shipping) : []
      const rows = goods.length > 0 ? goods : drafts
      const shippingNet = shippingRows.reduce((sum, draft) => sum + draft.net, 0)
      const shippingGross = shippingRows.reduce((sum, draft) => sum + draft.gross, 0)
      const base = rows.reduce((sum, draft) => sum + Math.max(0, draft.net), 0)
      let leftNet = round2(shippingNet)
      let leftGross = round2(shippingGross)
      const shares = rows.map((draft, i) => {
        const last = i === rows.length - 1
        const part = base > 0 ? Math.max(0, draft.net) / base : last ? 1 : 0
        const net = last ? leftNet : round2(shippingNet * part)
        const gross = last ? leftGross : round2(shippingGross * part)
        leftNet = round2(leftNet - net)
        leftGross = round2(leftGross - gross)
        return { net, gross }
      })

      const isPrivate = privateInvoices.has(purchaseVatDecisionId(invoice.ksefNumber))
      const invoiceCategory = categoryOf.get(invoiceCategoryDecisionId(invoice.ksefNumber))
      const sellerCategory = invoice.counterpartyNip ? categoryOf.get(sellerCategoryDecisionId(invoice.counterpartyNip)) : undefined
      const fuel = isFuelInvoice(invoice)

      const lines: PurchaseLine[] = rows.map((draft, i) => {
        const key = purchaseLineKey(invoice.ksefNumber, draft.index)
        const net = round2(draft.net + shares[i].net)
        const gross = round2(draft.gross + shares[i].gross)
        const returned = corrections.length > 0 && Math.abs(net) < 0.005
        const items = linked.get(key)
        const lineCategory = categoryOf.get(lineCategoryDecisionId(invoice.ksefNumber, draft.index))
        const status: PurchaseLineStatus = items
          ? { kind: 'gear', items }
          : isPrivate
            ? { kind: 'private' }
            : lineCategory
              ? { kind: 'category', category: lineCategory, source: 'line' }
              : invoiceCategory
                ? { kind: 'category', category: invoiceCategory, source: 'invoice' }
                : sellerCategory
                  ? { kind: 'category', category: sellerCategory, source: 'seller' }
                  : fuel
                    ? { kind: 'category', category: 'fuel', source: 'rule' }
                    : { kind: 'todo' }
        return {
          key,
          index: draft.index,
          name: draft.name,
          unit: draft.unit,
          quantity: draft.quantity,
          cost: useNet ? net : gross,
          gross,
          shipping: useNet ? shares[i].net : shares[i].gross,
          returned,
          status,
        }
      })

      return {
        invoice,
        lines,
        corrections: corrections.map((c) => c.correction),
        looseCorrection: invoice.isCorrection,
        cost: round2(lines.reduce((sum, line) => sum + line.cost, 0)),
        todo: lines.filter((line) => line.status.kind === 'todo' && !line.returned).length,
      }
    })
    .sort((a, b) => b.invoice.issueDate.localeCompare(a.invoice.issueDate) || b.invoice.invoiceNumber.localeCompare(a.invoice.invoiceNumber))
}

/** Do którego worka trafia wiersz w podsumowaniu. */
export function lineBucket(line: PurchaseLine): PurchaseBucket {
  if (line.status.kind === 'gear') return line.status.items.some((item) => item.onSet) ? 'gear' : 'backstage'
  if (line.status.kind === 'category') return line.status.category
  return line.status.kind
}

/** Auto używane także prywatnie: do wydatków firmy liczy się połowa paliwa (decyzja M.J., 16.11.2026). */
export const FUEL_COMPANY_SHARE = 0.5

export interface PurchaseTotals {
  /** Koszt wg worka, pełne kwoty z faktur; „nie dotyczy firmy" nie wchodzi w `company`. */
  byBucket: Partial<Record<PurchaseBucket, number>>
  /** Wydatki firmy: wszystko poza „nie dotyczy firmy", paliwo w połowie. */
  company: number
  /** Ile wierszy czeka na decyzję. */
  todo: number
  invoices: number
}

export function purchaseTotals(entries: PurchaseEntry[]): PurchaseTotals {
  const byBucket: Partial<Record<PurchaseBucket, number>> = {}
  let todo = 0
  entries.forEach((entry) => {
    todo += entry.todo
    entry.lines.forEach((line) => {
      const bucket = lineBucket(line)
      byBucket[bucket] = round2((byBucket[bucket] ?? 0) + line.cost)
    })
  })
  const company = round2(
    Object.entries(byBucket)
      .filter(([bucket]) => bucket !== 'private')
      .reduce((sum, [bucket, value]) => sum + (value ?? 0) * (bucket === 'fuel' ? FUEL_COMPANY_SHARE : 1), 0)
  )
  return { byBucket, company, todo, invoices: entries.length }
}

// ── Sprzęt z wiersza faktury ─────────────────────────────────────────────────

/** Ile sztuk zapisać w katalogu: całe sztuki z faktury, a przy ułamku (godziny, litry) jedna. */
export function lineUnits(line: Pick<PurchaseLine, 'quantity'>): number {
  return Number.isInteger(line.quantity) && line.quantity >= 1 ? line.quantity : 1
}

export function invoiceRef(entry: PurchaseEntry, line: PurchaseLine): PurchaseInvoiceRef {
  return {
    ksefNumber: entry.invoice.ksefNumber,
    line: line.index,
    number: entry.invoice.invoiceNumber,
    seller: entry.invoice.counterpartyName,
    date: entry.invoice.issueDate,
    quantity: lineUnits(line),
    net: line.cost,
  }
}

/** Nowa pozycja katalogu z wiersza faktury: data, cena za sztukę i liczba sztuk z faktury. */
export function newItemFromLine(entry: PurchaseEntry, line: PurchaseLine, onSet: boolean) {
  const units = lineUnits(line)
  const pln = entry.invoice.currency === 'PLN'
  return {
    name: line.name.replace(/\s+/g, ' ').trim(),
    category: 'inne',
    purchasePrice: pln ? round2(line.cost / units) : 0,
    quantity: units,
    purchaseDate: entry.invoice.issueDate,
    onSet,
    purchaseInvoices: [invoiceRef(entry, line)],
  }
}

/** Cena za sztukę i data wynikające z przypiętych faktur; `null`, gdy pozycja ich nie ma. */
export function priceFromInvoices(item: Pick<EquipmentItem, 'purchaseInvoices'>): { price: number; date: string; units: number } | null {
  const refs = (item.purchaseInvoices ?? []).filter((ref) => ref.quantity > 0)
  if (refs.length === 0) return null
  const units = refs.reduce((sum, ref) => sum + ref.quantity, 0)
  const dates = refs.map((ref) => ref.date).filter(Boolean).sort()
  return { price: round2(refs.reduce((sum, ref) => sum + ref.net, 0) / units), date: dates[0] ?? '', units }
}

/**
 * Przypina wiersz faktury do istniejącej pozycji. `adopt` = cena i data zakupu
 * przechodzą na te z faktur (średnia za sztukę ze wszystkich przypiętych,
 * najwcześniejsza data); bez tego faktura jest tylko śladem przy pozycji.
 */
export function linkLine(item: EquipmentItem, entry: PurchaseEntry, line: PurchaseLine, adopt: boolean): EquipmentItem {
  const ref = invoiceRef(entry, line)
  const others = (item.purchaseInvoices ?? []).filter((r) => !(r.ksefNumber === ref.ksefNumber && r.line === ref.line))
  const next: EquipmentItem = { ...item, purchaseInvoices: [...others, ref] }
  if (!adopt || entry.invoice.currency !== 'PLN') return next
  const fromInvoices = priceFromInvoices(next)
  if (!fromInvoices) return next
  next.purchasePrice = fromInvoices.price
  if (fromInvoices.date) next.purchaseDate = fromInvoices.date
  return next
}

/** Odpina wiersz od pozycji; cena i data zostają, jak są. */
export function unlinkLine(item: EquipmentItem, key: string): EquipmentItem {
  const rest = (item.purchaseInvoices ?? []).filter((ref) => !(ref.ksefNumber && ref.line !== undefined && purchaseLineKey(ref.ksefNumber, ref.line) === key))
  const next: EquipmentItem = { ...item }
  if (rest.length > 0) next.purchaseInvoices = rest
  else delete next.purchaseInvoices
  return next
}

/** Czy przypięte faktury pokrywają wszystkie sztuki pozycji — wtedy cena z faktur jest pełna. */
export function invoicesCoverItem(item: EquipmentItem, extraUnits = 0): boolean {
  const units = (item.purchaseInvoices ?? []).reduce((sum, ref) => sum + ref.quantity, 0) + extraUnits
  return units >= unitsOwned(item)
}

const DAY_MS = 86_400_000
const near = (a: number, b: number) => b > 0 && Math.abs(a - b) <= Math.max(1, b * 0.02)

/**
 * Pozycje katalogu, które wyglądają na ten sam zakup. Warunek: dwa wspólne
 * słowa w nazwie, jedno wspólne słowo i zgodna cena albo zgodna cena przy
 * zbliżonej dacie (cena netto lub brutto z faktury — stare wpisy bywały brutto).
 * Pozycja kupiona w innym czasie nie pasuje nigdy.
 */
export function suggestedItems(entry: PurchaseEntry, line: PurchaseLine, items: EquipmentItem[]): EquipmentItem[] {
  const units = lineUnits(line)
  const unitCost = line.cost / units
  const unitGross = line.gross / units
  const words = new Set(nameKey(line.name).split(' ').filter((word) => word.length >= 3))
  const day = Date.parse(entry.invoice.issueDate)
  return items
    .filter((item) => !(item as { deletedAt?: unknown }).deletedAt)
    .filter((item) => !(item.purchaseInvoices ?? []).some((ref) => ref.ksefNumber === entry.invoice.ksefNumber && ref.line === line.index))
    .flatMap((item) => {
      const bought = Date.parse(item.purchaseDate)
      const dated = !!item.purchaseDate && Number.isFinite(bought) && Number.isFinite(day)
      const close = dated && Math.abs(bought - day) <= 45 * DAY_MS
      if (dated && !close) return []
      const price = near(item.purchasePrice, unitCost) || near(item.purchasePrice, unitGross)
      const shared = nameKey(item.name).split(' ').filter((word) => word.length >= 3 && words.has(word)).length
      if (!(shared >= 2 || (shared === 1 && price) || (close && price))) return []
      return [{ item, score: (close ? 2 : 0) + (price ? 3 : 0) + Math.min(3, shared) }]
    })
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name, 'pl'))
    .slice(0, 3)
    .map(({ item }) => item)
}

// ── Decyzje o kategorii ──────────────────────────────────────────────────────

export type CategoryScope = 'line' | 'invoice' | 'seller'

/** Decyzja „ten wydatek to <kategoria>" dla wiersza, całej faktury albo sprzedawcy. */
export function categoryDecision(scope: CategoryScope, entry: PurchaseEntry, line: PurchaseLine | null, category: PurchaseCategory, at: string): KsefDecision {
  const { ksefNumber, counterpartyNip } = entry.invoice
  const id =
    scope === 'seller' && counterpartyNip
      ? sellerCategoryDecisionId(counterpartyNip)
      : scope === 'line' && line
        ? lineCategoryDecisionId(ksefNumber, line.index)
        : invoiceCategoryDecisionId(ksefNumber)
  return { id, kind: 'purchase_category', projectId: '', ksefNumber, category, at }
}

/** Identyfikatory decyzji o kategorii, które dotyczą tej faktury (do cofnięcia wyboru). */
export function categoryDecisionIds(entry: PurchaseEntry): string[] {
  return [invoiceCategoryDecisionId(entry.invoice.ksefNumber), ...entry.lines.map((line) => lineCategoryDecisionId(entry.invoice.ksefNumber, line.index))]
}
