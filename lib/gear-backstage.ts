/**
 * Zaplecze i drobiazgi (Z1) — sprzęt, który nigdy nie jedzie na plan.
 *
 * Laptop, magic arm, karty SD, kable: kosztują, więc je liczymy, ale nie mają
 * trafiać do list wyboru (wycena, zestawy, siatka sprzętu w Realizacji, listy
 * pakowania, karta dnia) ani do statystyk „odpracował / zarobił / spłata".
 * Znacznik to `EquipmentItem.onSet === false`; brak pola = na plan, więc
 * wszystkie dotychczasowe pozycje zostają, jak były.
 *
 * Czyste funkcje. Filtr siedzi przy źródle (`useEquipment().items` oddaje samo
 * „na plan"), a tu są też zakupy dla przyszłego rejestru kosztów (S4).
 */

import { unitsOwned, type EquipmentItem } from './project-types'

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

/** Pozycja jedzie na plan (brak znacznika = tak). */
export function isOnSet(item: Pick<EquipmentItem, 'onSet'>): boolean {
  return item.onSet !== false
}

export function onSetItems<T extends Pick<EquipmentItem, 'onSet'>>(items: T[]): T[] {
  return items.filter(isOnSet)
}

export function backstageItems<T extends Pick<EquipmentItem, 'onSet'>>(items: T[]): T[] {
  return items.filter((item) => !isOnSet(item))
}

/**
 * Pozycja przeniesiona między rodzajami. Na plan = pole znika (nie zapisujemy
 * `true`), więc plik wygląda tak, jak przed Z1. Reszta rekordu bez zmian.
 */
export function withOnSet(item: EquipmentItem, onSet: boolean): EquipmentItem {
  const next: EquipmentItem = { ...item }
  if (onSet) delete next.onSet
  else next.onSet = false
  return next
}

// ── Zakupy dla rejestru kosztów (S4) ─────────────────────────────────────────

export interface GearPurchase {
  itemId: string
  name: string
  /** `YYYY-MM-DD`; `null` = brak (albo błędnej) daty zakupu — patrz `undated`. */
  date: string | null
  /** Cena zakupu × sztuki (PLN netto). 0 = cena nieznana. */
  price: number
  quantity: number
  onSet: boolean
  /** Pozycja bez daty zakupu: koszt jest, ale nie wiadomo, w którym miesiącu. */
  undated: boolean
}

/**
 * Zakupy sprzętu jako wiersze kosztów: cena zakupu jednej sztuki × liczba
 * sztuk. Wchodzą WSZYSTKIE pozycje, także zaplecze i wycofane (sprzedaż nie
 * cofa wydatku). Pozycje bez daty zostają na liście z `undated: true`, żeby
 * rejestr mógł je pokazać do uzupełnienia, a nie po cichu zgubić.
 * Kolejność: po dacie rosnąco, bez daty na końcu, potem nazwa.
 */
export function gearPurchases(items: EquipmentItem[]): GearPurchase[] {
  return items
    .map((item) => {
      const quantity = unitsOwned(item)
      const date = DATE_KEY.test(item.purchaseDate) ? item.purchaseDate : null
      return {
        itemId: item.id,
        name: item.name,
        date,
        price: item.purchasePrice * quantity,
        quantity,
        onSet: isOnSet(item),
        undated: date === null,
      }
    })
    .sort((a, b) => {
      if (a.date !== b.date) {
        if (a.date === null) return 1
        if (b.date === null) return -1
        return a.date.localeCompare(b.date)
      }
      return a.name.localeCompare(b.name, 'pl')
    })
}

export interface InvestedSplit {
  /** Zainwestowane w sprzęt na plan (cena × sztuki, także wycofany). */
  onSet: number
  backstage: number
  total: number
  backstageCount: number
  /** Pozycje zaplecza bez ceny zakupu / bez daty — do uzupełnienia. */
  backstageUnpriced: number
  backstageUndated: number
}

/** Kafelek „Zainwestowane": na plan i zaplecze osobno, liczone tak samo (cena × sztuki). */
export function investedSplit(items: EquipmentItem[]): InvestedSplit {
  const split: InvestedSplit = {
    onSet: 0,
    backstage: 0,
    total: 0,
    backstageCount: 0,
    backstageUnpriced: 0,
    backstageUndated: 0,
  }
  items.forEach((item) => {
    const invested = item.purchasePrice * unitsOwned(item)
    if (isOnSet(item)) {
      split.onSet += invested
      return
    }
    split.backstage += invested
    split.backstageCount += 1
    if (item.purchasePrice <= 0) split.backstageUnpriced += 1
    if (!DATE_KEY.test(item.purchaseDate)) split.backstageUndated += 1
  })
  split.total = split.onSet + split.backstage
  return split
}

// ── Szybkie wpisywanie wierszy ───────────────────────────────────────────────

export interface BackstageRowInput {
  name: string
  purchasePrice: number
  /** `YYYY-MM-DD` albo '' */
  purchaseDate: string
  quantity: number
  notes: string
}

/** „1 234,50 zł" → 1234.5; nie liczba albo ujemna → 0. */
export function parseMoney(text: string): number {
  const cleaned = text
    .replace(/zł|pln/gi, '')
    .replace(/[\s ]/g, '')
    .replace(',', '.')
  const value = Number(cleaned)
  return Number.isFinite(value) && value > 0 ? value : 0
}

/** `2025-03-12` albo `12.03.2025` (też `12/03/2025`, `12-03-2025`) → `YYYY-MM-DD`; inaczej ''. */
export function parseDateText(text: string): string {
  const trimmed = text.trim()
  if (DATE_KEY.test(trimmed)) return isRealDate(trimmed) ? trimmed : ''
  const match = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(trimmed)
  if (!match) return ''
  const key = `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`
  return isRealDate(key) ? key : ''
}

function isRealDate(key: string): boolean {
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

/**
 * Wklejona lista → wiersze zaplecza. Jedna pozycja na linię, pola:
 * `nazwa ; cena ; data ; sztuk ; notatka` rozdzielone średnikiem albo tabulatorem
 * (tak wklejają się komórki z arkusza). Ważna jest tylko nazwa; reszta może
 * być pusta lub pominięta. Pusta linia = pominięta. Zwraca też numery linii,
 * w których coś zostało odrzucone (data, której nie da się odczytać) — nic
 * nie jest zgadywane po cichu.
 */
export function parseBackstageRows(text: string): { rows: BackstageRowInput[]; badDates: number[] } {
  const rows: BackstageRowInput[] = []
  const badDates: number[] = []
  text.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return
    const separator = line.includes('\t') ? '\t' : ';'
    const [name = '', price = '', date = '', qty = '', ...rest] = line.split(separator).map((cell) => cell.trim())
    if (!name) return
    const parsedDate = parseDateText(date)
    if (date && !parsedDate) badDates.push(index + 1)
    const quantity = Math.floor(parseMoney(qty))
    rows.push({
      name,
      purchasePrice: parseMoney(price),
      purchaseDate: parsedDate,
      quantity: quantity >= 1 ? quantity : 1,
      notes: rest.join(separator === '\t' ? ' ' : '; ').trim(),
    })
  })
  return { rows, badDates }
}
