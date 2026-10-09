/**
 * Mój sprzęt w wycenie (plan G5) — czyste funkcje, bez Reacta.
 *
 * Każdy dzień szczegółowej wyceny może mieć pozycje z katalogu
 * (`ShootingDay.gear`) i sprzęt z wypożyczalni (`ShootingDay.externalRentals`).
 *
 *   wartość     = stawka × sztuki            (także pozycje „gratis")
 *   w wycenie   = wartość × (1 − rabat)      (pozycje „gratis" = 0)
 *   wypożyczalnia = kwota wpisana ręcznie    (bez rabatu i bez marży)
 *
 * Marża z suwaka w nagłówku NIE dotyczy sprzętu z katalogu (decyzja
 * 2026-10-10): stawka rentalowa to już cena rynkowa, a rabat jest jedynym
 * pokrętłem. Stare pola dnia (kamery, obiektywy… standard/rental) liczą się
 * dalej jak dotąd, z marżą — stare wyceny dają identyczne kwoty.
 *
 * W szybkiej wycenie dni szczegółowe nie wchodzą do ceny, więc i ich sprzęt nie.
 */

import { safeArray, safeNum } from './safe-numbers'
import type { QuoteData, QuoteExternalRental, QuoteGearLine, ShootingDay } from './quote-types'

export function clampDiscount(percent: unknown): number {
  const value = safeNum(percent, 0)
  return Math.min(100, Math.max(0, value))
}

function lineValue(line: QuoteGearLine): number {
  return Math.max(0, safeNum(line.rate, 0)) * Math.max(0, safeNum(line.qty, 0))
}

export interface DayGearFigures {
  /** Wartość rynkowa mojego sprzętu w dniu. */
  value: number
  /** Ile z tego jest w cenie dla klienta (po rabacie, bez „gratis"). */
  charged: number
  /** Sprzęt z wypożyczalni: kwota dla klienta = koszt. */
  external: number
  /** Kwota w cenie per pozycja katalogu. */
  byItem: Map<string, number>
}

export function dayGearFigures(
  day: Pick<ShootingDay, 'gear' | 'externalRentals'>,
  discountPercent: number
): DayGearFigures {
  const factor = 1 - clampDiscount(discountPercent) / 100
  const byItem = new Map<string, number>()
  let value = 0
  let charged = 0
  safeArray<QuoteGearLine>(day.gear).forEach((line) => {
    const v = lineValue(line)
    const c = line.gratis ? 0 : v * factor
    value += v
    charged += c
    byItem.set(line.itemId, (byItem.get(line.itemId) ?? 0) + c)
  })
  const external = safeArray<QuoteExternalRental>(day.externalRentals).reduce(
    (sum, rental) => sum + Math.max(0, safeNum(rental.amount, 0)),
    0
  )
  return { value, charged, external, byItem }
}

export interface QuoteGearFigures extends DayGearFigures {
  /** Wartość − w cenie: ile klient dostaje „za darmo" (rabat + gratisy). */
  discount: number
  /** Czy wycena ma jakąkolwiek pozycję z katalogu. */
  hasCatalogGear: boolean
}

/** Sprzęt z katalogu i z wypożyczalni w całej wycenie (tylko tryb szczegółowy). */
export function quoteGearFigures(
  data: Pick<QuoteData, 'isDetailedProdukcja' | 'detailedShootingDays' | 'gearDiscountPercent'>
): QuoteGearFigures {
  const total: QuoteGearFigures = {
    value: 0,
    charged: 0,
    external: 0,
    discount: 0,
    byItem: new Map(),
    hasCatalogGear: false,
  }
  if (!data.isDetailedProdukcja) return total
  safeArray<ShootingDay>(data.detailedShootingDays).forEach((day) => {
    const figures = dayGearFigures(day, data.gearDiscountPercent)
    total.value += figures.value
    total.charged += figures.charged
    total.external += figures.external
    figures.byItem.forEach((amount, itemId) => {
      total.byItem.set(itemId, (total.byItem.get(itemId) ?? 0) + amount)
    })
    if (safeArray(day.gear).length > 0) total.hasCatalogGear = true
  })
  total.discount = total.value - total.charged
  return total
}

/**
 * Pozycje z innymi stawkami lub nazwami niż w katalogu teraz (np. stawki
 * dopisane po zbudowaniu wyceny). Pozycje usunięte z katalogu są pomijane.
 */
export function staleGearLines(
  days: Pick<ShootingDay, 'gear'>[],
  catalog: { id: string; name: string; rentalDayRate: number }[]
): number {
  const byId = new Map(catalog.map((item) => [item.id, item]))
  return days.reduce(
    (count, day) =>
      count +
      safeArray<QuoteGearLine>(day.gear).filter((line) => {
        const item = byId.get(line.itemId)
        return item && (item.rentalDayRate !== line.rate || item.name !== line.name)
      }).length,
    0
  )
}

/** Stawki i nazwy pozycji dnia z bieżącego katalogu (świadome „Zaktualizuj stawki"). */
export function refreshGearLines(
  lines: QuoteGearLine[] | undefined,
  catalog: { id: string; name: string; rentalDayRate: number }[]
): QuoteGearLine[] | undefined {
  if (!lines) return lines
  const byId = new Map(catalog.map((item) => [item.id, item]))
  return lines.map((line) => {
    const item = byId.get(line.itemId)
    return item ? { ...line, name: item.name, rate: item.rentalDayRate } : line
  })
}

/**
 * Dodaje pozycję katalogu do dnia albo zmienia jej liczbę sztuk; `qty <= 0`
 * usuwa. Stawka i nazwa są brane z katalogu tylko przy DODANIU — istniejąca
 * pozycja zachowuje zamrożoną stawkę.
 */
export function setQuoteGearLine(
  lines: QuoteGearLine[] | undefined,
  item: { id: string; name: string; rentalDayRate: number },
  qty: number
): QuoteGearLine[] {
  const list = lines ?? []
  const count = Math.floor(qty)
  const exists = list.some((line) => line.itemId === item.id)
  if (count <= 0) return list.filter((line) => line.itemId !== item.id)
  if (exists) return list.map((line) => (line.itemId === item.id ? { ...line, qty: count } : line))
  return [...list, { itemId: item.id, name: item.name, rate: item.rentalDayRate, qty: count }]
}

/** Pozycje zestawu dochodzą do dnia; te, które już są, zostają bez zmian. */
export function addKitToQuoteGear(
  lines: QuoteGearLine[] | undefined,
  kit: { itemId: string; qty: number }[],
  catalog: { id: string; name: string; rentalDayRate: number; retiredAt?: string }[]
): QuoteGearLine[] {
  const byId = new Map(catalog.map((item) => [item.id, item]))
  let next = lines ?? []
  kit.forEach((entry) => {
    const item = byId.get(entry.itemId)
    if (!item || item.retiredAt || next.some((line) => line.itemId === entry.itemId)) return
    next = setQuoteGearLine(next, item, entry.qty)
  })
  return next
}

/** Czy dzień używa starych pól sprzętu (sprzed katalogu) — wtedy pokazujemy je rozwinięte. */
export function hasLegacyGear(
  day: Pick<ShootingDay, 'kameraSony' | 'kameraRed' | 'obiektywy' | 'stabilizacja' | 'podglad' | 'swiatlo' | 'dron'>
): boolean {
  return (
    safeNum(day.kameraSony, 0) > 0 ||
    safeNum(day.kameraRed, 0) > 0 ||
    [day.obiektywy, day.stabilizacja, day.podglad, day.swiatlo, day.dron].some((v) => !!v && v !== 'brak')
  )
}

export interface GearPdfLabels {
  opisOwnGear: string
  opisRentedGear: string
  opisGearValue: string
  opisGearDiscount: string
}

/**
 * Zdania o sprzęcie do opisu wiersza „Sprzęt" w PDF: lista mojego sprzętu
 * (z największą liczbą sztuk w jednym dniu), wypożyczalnia i — gdy włączone
 * i jest co pokazać — wartość rynkowa z rabatem, żeby klient widział, co
 * dostaje w cenie. Kwoty formatuje `money` (waluta PDF).
 */
export function pdfGearSentences(
  data: Pick<QuoteData, 'isDetailedProdukcja' | 'detailedShootingDays' | 'gearDiscountPercent' | 'gearValueInPdf'>,
  labels: GearPdfLabels,
  money: (pln: number) => string
): string[] {
  if (!data.isDetailedProdukcja) return []
  const days = safeArray<ShootingDay>(data.detailedShootingDays)
  const own = new Map<string, { name: string; qty: number }>()
  const rented: string[] = []
  days.forEach((day) => {
    safeArray<QuoteGearLine>(day.gear).forEach((line) => {
      const prev = own.get(line.itemId)
      own.set(line.itemId, { name: line.name, qty: Math.max(prev?.qty ?? 0, safeNum(line.qty, 1)) })
    })
    safeArray<QuoteExternalRental>(day.externalRentals).forEach((rental) => {
      const label = rental.label?.trim()
      if (label && safeNum(rental.amount, 0) > 0 && !rented.includes(label)) rented.push(label)
    })
  })

  const sentences: string[] = []
  if (own.size > 0) {
    const names = [...own.values()].map(({ name, qty }) => (qty > 1 ? `${qty}× ${name}` : name))
    sentences.push(`${labels.opisOwnGear}: ${names.join(', ')}.`)
  }
  if (rented.length > 0) sentences.push(`${labels.opisRentedGear}: ${rented.join(', ')}.`)

  const figures = quoteGearFigures(data)
  if (data.gearValueInPdf && figures.discount > 0.5) {
    sentences.push(
      `${labels.opisGearValue}: ${money(figures.value)}, ${labels.opisGearDiscount}: −${money(figures.discount)}.`
    )
  }
  return sentences
}
