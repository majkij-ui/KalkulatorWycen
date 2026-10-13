/**
 * Waluta wyceny (S3, decyzja E z 2026-10-13) — czyste funkcje, bez Reacta.
 *
 * Walutę wybiera się dla wyceny (`QuoteData.currency`). W EUR wszystkie ceny
 * w kalkulatorze i w PDF są w euro; finanse zostają w złotych po kursie
 * zamrożonym w wycenie (`exchangeRate`: ile zł za 1 €, z NBP z wybranego dnia
 * albo wpisany ręcznie).
 *
 * Gdzie leżą kwoty (i w jakiej walucie):
 *
 *   cennik, stawki sprzętu z katalogu, stawki ról     PLN zawsze (jeden cennik)
 *     → w EUR: zł ÷ kurs, zaokrąglone do PEŁNYCH euro (decyzja M.J.), i wycena
 *       liczy się z tych zaokrąglonych cen (stawka × ilość = pozycja)
 *   kwoty wpisane w samej wycenie (`TYPED_AMOUNT_FIELDS`) w walucie wyceny
 *     → zmiana kursu ich nie rusza; zmiana waluty przelicza je raz
 *   moje koszty: stawki osób, koszt roli, plan       PLN zawsze
 *     (nadpisania, własne pozycje, kwota przelewu, cena paliwa)
 *
 * Wycena w PLN (każda stara) przechodzi przez te funkcje NIETKNIĘTA: te same
 * obiekty, te same liczby — stare wyceny liczą się i drukują jak dawniej
 * (`quote-currency-legacy.test.ts`).
 */

import type { QuoteData, ShootingDay } from './quote-types'
import type { PricingConfigShape } from './pricing-config'
import { safeArray, safeNum } from './safe-numbers'

export const QUOTE_CURRENCIES = ['PLN', 'EUR'] as const
export type QuoteCurrency = (typeof QUOTE_CURRENCIES)[number]

export type ExchangeRateSource = 'nbp' | 'manual'

/** Waluta wyceny i kurs: ile zł za 1 jednostkę waluty (PLN → 1). */
export interface QuoteMoney {
  currency: QuoteCurrency
  rate: number
}

export const PLN_MONEY: QuoteMoney = Object.freeze({ currency: 'PLN', rate: 1 }) as QuoteMoney

/** Kurs, z którym da się liczyć: skończony i dodatni. */
export function isValidRate(rate: unknown): rate is number {
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0
}

/**
 * Waluta wyceny. EUR tylko z poprawnym kursem — bez kursu wycena liczy się w
 * PLN (aplikacja zawsze zapisuje EUR razem z kursem). Nieznana waluta z
 * nowszej wersji zostaje w danych, a tu czyta się jako PLN.
 */
export function quoteMoney(data: Partial<Pick<QuoteData, 'currency' | 'exchangeRate'>> | null | undefined): QuoteMoney {
  if (data?.currency === 'EUR' && isValidRate(data.exchangeRate)) {
    return { currency: 'EUR', rate: data.exchangeRate }
  }
  return PLN_MONEY
}

export function isForeign(money: QuoteMoney): boolean {
  return money.currency !== 'PLN'
}

/**
 * Cena z cennika / katalogu / roli (PLN) w walucie wyceny. W EUR: zł ÷ kurs,
 * zaokrąglone do pełnych euro (decyzja M.J. 2026-10-13).
 */
export function priceFromPln(pln: number, money: QuoteMoney): number {
  if (!isForeign(money)) return pln
  return Math.round(safeNum(pln, 0) / money.rate)
}

/**
 * Cena cennika wpisana w walucie wyceny → PLN do zapisu w cenniku (€ × kurs).
 * Pełne euro wracają z `priceFromPln` dokładnie takie, jak je wpisano.
 */
export function priceToPln(price: number, money: QuoteMoney): number {
  if (!isForeign(money)) return price
  return safeNum(price, 0) * money.rate
}

/** Kwota w walucie wyceny → PLN (finanse, plan), dokładnie, bez zaokrąglania. */
export function toPln(amount: number, money: QuoteMoney): number {
  if (!isForeign(money)) return amount
  return amount * money.rate
}

/** Kwota w PLN → waluta wyceny, dokładnie (np. koszt paliwa przenoszony na klienta). */
export function fromPln(pln: number, money: QuoteMoney): number {
  if (!isForeign(money)) return pln
  return pln / money.rate
}

// ── Kwoty wpisane w wycenie ──────────────────────────────────────────────────

/**
 * Pola kwot wpisywanych w samej wycenie — trzymane w walucie wyceny. Rabat /
 * dopłata dnia i wypożyczalnia siedzą w dniach (`ShootingDay.dayAdjustment`,
 * `externalRentals[].amount`).
 */
export const TYPED_AMOUNT_FIELDS = [
  'actorRightsTransferAmount',
  'cateringRate',
  'lodgingRate',
  'extraRevisionPrice',
  'overtimeHourlyRate',
] as const satisfies readonly (keyof QuoteData)[]

type AmountMapper = (amount: number) => number

function mapTypedAmounts(data: QuoteData, map: AmountMapper): QuoteData {
  const next: QuoteData = { ...data }
  for (const field of TYPED_AMOUNT_FIELDS) {
    const value = data[field]
    if (typeof value === 'number' && Number.isFinite(value)) next[field] = map(value)
  }
  next.detailedShootingDays = safeArray<ShootingDay>(data.detailedShootingDays).map((day) => {
    const nextDay: ShootingDay = { ...day }
    if (typeof day.dayAdjustment === 'number' && Number.isFinite(day.dayAdjustment)) {
      nextDay.dayAdjustment = map(day.dayAdjustment)
    }
    if (Array.isArray(day.externalRentals)) {
      nextDay.externalRentals = day.externalRentals.map((rental) =>
        typeof rental.amount === 'number' && Number.isFinite(rental.amount) ? { ...rental, amount: map(rental.amount) } : rental
      )
    }
    return nextDay
  })
  return next
}

// ── Widoki wyceny ────────────────────────────────────────────────────────────

/**
 * Cennik w walucie wyceny: każda cena zł ÷ kurs, pełne euro. Procent dopłaty
 * za prawa zostaje procentem; stawka zł/km (nieużywana w cenie) dokładnie.
 */
export function clientPricing(pricing: PricingConfigShape, money: QuoteMoney): PricingConfigShape {
  if (!isForeign(money)) return pricing
  const section = <T extends Record<string, number>>(values: T): T => {
    const out: Record<string, number> = {}
    for (const [key, value] of Object.entries(values)) out[key] = priceFromPln(value, money)
    return out as T
  }
  return {
    preprodukcja: section(pricing.preprodukcja),
    produkcja: section(pricing.produkcja),
    postprodukcja: section(pricing.postprodukcja),
    dodatkowe: {
      ...pricing.dodatkowe,
      kosztDojazduKm: fromPln(pricing.dodatkowe.kosztDojazduKm, money),
      pelnePrzekazaniePrawProcent: pricing.dodatkowe.pelnePrzekazaniePrawProcent,
    },
  }
}

/**
 * Dane wyceny w walucie wyceny — wejście kalkulatora ceny dla klienta.
 * Stawki sprzętu z katalogu i stawki ról (PLN, zamrożone) w pełnych euro;
 * cena paliwa dokładnie (dojazd to koszt przenoszony na klienta). Mój koszt
 * w pozycjach ekipy (`costRate`) zostaje w zł.
 */
export function clientQuoteData(data: QuoteData, money: QuoteMoney): QuoteData {
  if (!isForeign(money)) return data
  return {
    ...data,
    profitFuelPricePerLiter: fromPln(safeNum(data.profitFuelPricePerLiter, 6.5, 0), money),
    detailedShootingDays: safeArray<ShootingDay>(data.detailedShootingDays).map((day) => ({
      ...day,
      ...(Array.isArray(day.gear)
        ? { gear: day.gear.map((line) => ({ ...line, rate: priceFromPln(safeNum(line.rate, 0), money) })) }
        : {}),
      ...(Array.isArray(day.crew)
        ? { crew: day.crew.map((line) => ({ ...line, clientRate: priceFromPln(safeNum(line.clientRate, 0), money) })) }
        : {}),
    })),
  }
}

/**
 * Dane wyceny w PLN — wejście planu kosztów (Profit), Realizacji i finansów.
 * Kwoty wpisane w walucie wyceny × kurs, dokładnie (catering i noclegi,
 * wypożyczalnia, honorarium aktorów są też moim kosztem).
 */
export function costQuoteData(data: QuoteData, money: QuoteMoney): QuoteData {
  if (!isForeign(money)) return data
  return mapTypedAmounts(data, (amount) => amount * money.rate)
}

// ── Zmiana waluty i kursu ────────────────────────────────────────────────────

export interface ExchangeRateChoice {
  rate: number
  /** Dzień tabeli NBP (YYYY-MM-DD); pusty przy kursie wpisanym ręcznie. */
  date?: string
  source?: ExchangeRateSource
}

/**
 * Przełącza walutę wyceny. Kwoty wpisane w wycenie przeliczają się RAZ po
 * kursie i zaokrąglają do pełnych jednostek (euro albo złotych); cennik,
 * katalog i role nie wymagają przeliczenia (są w zł). Powrót do PLN zostawia
 * kurs w danych — przy ponownym przejściu na EUR podpowiada się sam.
 */
export function switchQuoteCurrency(data: QuoteData, next: QuoteCurrency, choice?: ExchangeRateChoice): QuoteData {
  const from = quoteMoney(data)
  if (next === 'EUR') {
    if (!choice || !isValidRate(choice.rate)) throw new Error('Kurs EUR jest wymagany')
    const to: QuoteMoney = { currency: 'EUR', rate: choice.rate }
    const converted =
      from.currency === 'EUR'
        ? data
        : mapTypedAmounts(data, (amount) => Math.round(amount / to.rate))
    return withRate({ ...converted, currency: 'EUR' }, choice)
  }
  if (from.currency === 'PLN') return data.currency === 'EUR' ? { ...data, currency: 'PLN' } : data
  const converted = mapTypedAmounts(data, (amount) => Math.round(amount * from.rate))
  return { ...converted, currency: 'PLN' }
}

/** Nowy kurs dla wyceny w EUR: ceny z cennika idą za kursem, wpisane kwoty nie. */
export function withRate(data: QuoteData, choice: ExchangeRateChoice): QuoteData {
  if (!isValidRate(choice.rate)) return data
  const next: QuoteData = {
    ...data,
    exchangeRate: choice.rate,
    exchangeRateSource: choice.source ?? 'manual',
  }
  if (choice.date) next.exchangeRateDate = choice.date
  else delete next.exchangeRateDate
  return next
}

// ── Etykiety ─────────────────────────────────────────────────────────────────

/**
 * Jedna konwencja etykiet (decyzja M.J. 2026-10-13): po polsku „zł", w
 * angielskim PDF „PLN"; euro zawsze „€".
 */
export function currencyUnit(currency: QuoteCurrency, lang: 'pl' | 'en' = 'pl'): string {
  if (currency === 'EUR') return '€'
  return lang === 'en' ? 'PLN' : 'zł'
}

/** Kwota z jednostką, polski zapis liczb, np. „1 500,00 zł" / „351,00 €". */
export function formatMoney(
  amount: number,
  currency: QuoteCurrency,
  options: { decimals?: number; lang?: 'pl' | 'en' } = {}
): string {
  const decimals = options.decimals ?? 2
  const safe = Number.isFinite(amount) ? amount : 0
  const text = safe.toLocaleString('pl-PL', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  return `${text} ${currencyUnit(currency, options.lang)}`
}

/** Kurs po polsku z czterema miejscami, np. „4,3699". */
export function formatRate(rate: number): string {
  return rate.toLocaleString('pl-PL', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
}
