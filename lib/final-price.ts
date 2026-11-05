/**
 * Cena końcowa projektu (decyzja M.J. 2026-11-05) — czyste funkcje, bez Reacta.
 *
 * Cztery warstwy pieniędzy: kalkulator → PDF (cena) → Realizacja (koszty) →
 * Finanse (ostateczne; faktury wygrywają). Projekt, który już ma faktury albo
 * finanse z importu, ma CENĘ KOŃCOWĄ — ją pokazuje Realizacja, a PDF stoi obok
 * do porównania. Edycja wyceny takiego projektu nigdy jej nie rusza.
 *
 *  (a) status „Zrealizowany" + co najmniej jedna wystawiona faktura z kwotą →
 *      cena = suma faktur (TA SAMA suma co w pętli pieniędzy, `invoiceSum`).
 *      Liczona przy odczycie — bez migracji danych. Zaliczka w trwającym
 *      projekcie NIE blokuje ceny.
 *  (b) projekt miał finanse z importu (`!quote && financials`) w chwili
 *      pierwszego zapisu wyceny → cena = `financials.sumaNetto`, zapisana w
 *      wycenie jako `approvedPrice` ze źródłem `import` (maszyneria U1,
 *      `approved-price.ts`; nie ma drugiej, równoległej ceny).
 *  (c) „Ustaw cenę z wyceny" / „Zmień" po ostrzeżeniu → `approvedPrice` ze
 *      źródłem `override`; wygrywa z fakturami i importem.
 *
 * Wariant wyceny nie zmienia ceny końcowej; wycena bez ceny końcowej działa
 * po staremu (PDF, zatwierdzona cena, „Odśwież").
 */

import { isEventDate } from './event-types'
import { invoiceAmount, type MoneyEvent } from './money-loop'
import { approvedPriceRecord } from './quote-financials'
import type { ApprovedPriceRecord } from './quote-types'
import { threadStats, type InvoiceStats } from './thread-stats'
import type { Project, ProjectFinancials } from './project-types'

export type FinalPriceSource = 'invoices' | 'import' | 'override'

export interface FinalPrice {
  /** Zł netto. */
  pln: number
  source: FinalPriceSource
  /** Numery faktur, z których jest suma (tylko `invoices`). */
  invoiceNumbers: string[]
  /** Skąd cena, po polsku: „faktura 3/03/2026" / „faktury 1/2026, 2/2026" / „import" / „ustawiona ręcznie". */
  label: string
}

export interface InvoiceSum {
  /** `null` = brak wystawionych faktur z kwotą (ani wpłat bez faktury). */
  total: number | null
  /** Wystawione faktury z kwotą. */
  invoices: InvoiceStats[]
}

/**
 * Suma wystawionych faktur projektu — DOKŁADNIE ta, którą liczy pętla pieniędzy
 * (`projectMoney().invoiced`): faktury nie-zaplanowane z kwotą (`invoiceAmount`,
 * czyli kwota z faktury, a bez niej ze sparowanej wpłaty) + wpłaty bez faktury
 * z kwotą. Usunięte wydarzenia nie liczą się (`threadStats`). Kwoty są w zł.
 */
export function invoiceSum(events: MoneyEvent[], projectId: string, today: string): InvoiceSum {
  const own = events.filter((e) => e.projectId === projectId && !e.deletedAt && isEventDate(e.start))
  const { invoices, unpairedPayments } = threadStats(own, today)
  const known = invoices.filter((i) => i.state !== 'planned' && invoiceAmount(i) !== null)
  const payments = unpairedPayments.filter((p) => p.amount !== null)
  const total =
    known.length + payments.length > 0
      ? known.reduce((s, i) => s + invoiceAmount(i)!, 0) + payments.reduce((s, p) => s + p.amount!, 0)
      : null
  return { total, invoices: known }
}

/** Zapisana cena z wyceny (`data.approvedPrice`) albo `null`. */
export function quotePriceRecord(quote: unknown): ApprovedPriceRecord | null {
  const data = quote && typeof quote === 'object' ? (quote as { data?: unknown }).data : null
  const raw = data && typeof data === 'object' ? (data as { approvedPrice?: unknown }).approvedPrice : null
  return approvedPriceRecord(raw)
}

function invoiceLabel(invoices: InvoiceStats[]): { numbers: string[]; label: string } {
  const numbers = invoices.map((i) => i.number).filter((n): n is string => !!n)
  if (numbers.length === 0) return { numbers, label: invoices.length === 1 ? 'faktura' : `faktury (${invoices.length})` }
  return { numbers, label: `${numbers.length === 1 ? 'faktura' : 'faktury'} ${numbers.join(', ')}` }
}

/**
 * Cena końcowa projektu albo `null` (projekt bez ceny końcowej — działa po
 * staremu). `record` = `approvedPrice` z wyceny (zapisanej albo żywej).
 */
export function finalPrice(
  project: Pick<Project, 'id' | 'status'>,
  record: ApprovedPriceRecord | null,
  events: MoneyEvent[],
  today: string
): FinalPrice | null {
  if (record?.source === 'override') {
    return { pln: record.pln, source: 'override', invoiceNumbers: [], label: 'ustawiona ręcznie' }
  }
  if (project.status === 'done') {
    const sum = invoiceSum(events, project.id, today)
    if (sum.total !== null && sum.invoices.length > 0) {
      const { numbers, label } = invoiceLabel(sum.invoices)
      return { pln: sum.total, source: 'invoices', invoiceNumbers: numbers, label }
    }
  }
  if (record?.source === 'import') return { pln: record.pln, source: 'import', invoiceNumbers: [], label: 'import' }
  return null
}

type SnapshotLike = { data?: unknown }

function withRecord<S extends SnapshotLike>(snapshot: S, record: ApprovedPriceRecord): S {
  const data = snapshot.data && typeof snapshot.data === 'object' ? (snapshot.data as object) : {}
  return { ...snapshot, data: { ...data, approvedPrice: record } } as S
}

/**
 * Pierwszy zapis wyceny projektu z finansami z importu: cena końcowa = przychód
 * z importu (źródło `import`). Bez przychodu (≤ 0) — bez zmian.
 */
export function stampImportedPrice<S extends SnapshotLike>(snapshot: S, imported: Pick<ProjectFinancials, 'sumaNetto'>, at: string): S {
  if (!(imported.sumaNetto > 0)) return snapshot
  return withRecord(snapshot, { pln: imported.sumaNetto, source: 'import', at })
}

/** „Ustaw cenę z wyceny" / „Zmień" po potwierdzeniu: ręczne nadpisanie ceny końcowej. */
export function overrideFinalPrice<S extends SnapshotLike>(snapshot: S, pln: number, at: string): S {
  return withRecord(snapshot, { pln: Math.round(pln * 100) / 100, source: 'override', at })
}

/**
 * Zmiana wybranego wariantu NIE zmienia ceny końcowej zapisanej w wycenie
 * (`import` / `override`): nowa migawka przejmuje rekord z dotychczasowej. Projekt
 * z finansami z importu, który jeszcze nie ma wyceny, dostaje cenę z importu
 * (jak przy pierwszym zapisie wyceny). Bez ceny do przeniesienia — ta sama migawka.
 * Cena z faktur (a) jest liczona przy odczycie, więc nie wymaga przenoszenia.
 */
export function carryFinalPrice<S extends SnapshotLike>(
  project: Pick<Project, 'quote' | 'financials'>,
  chosen: S,
  at: string
): S {
  if (!project.quote) return project.financials ? stampImportedPrice(chosen, project.financials, at) : chosen
  const record = quotePriceRecord(project.quote)
  if (record?.source !== 'import' && record?.source !== 'override') return chosen
  const own = quotePriceRecord(chosen)
  if (own && own.source === record.source && own.pln === record.pln && own.at === record.at) return chosen
  return withRecord(chosen, record)
}

export interface FinalPriceStrip {
  /** Wycena (PDF wybranego wariantu) teraz. */
  quotePln: number
  finalPln: number
  /** Wycena − cena końcowa (+ wycena droższa). */
  diff: number
  label: string
}

/** Pasek nad wyceną: przeliczany przy każdej zmianie, nic nie blokuje. */
export function finalPriceStrip(quotePln: number, final: FinalPrice): FinalPriceStrip {
  return { quotePln, finalPln: final.pln, diff: quotePln - final.pln, label: final.label }
}

/** Ostrzeżenie przed ustawieniem ceny z wyceny: źródło, kwota, numery faktur. */
export function overrideWarning(final: FinalPrice, newPln: number): string {
  const fmt = (n: number) => `${Math.round(n).toLocaleString('pl-PL')} zł`
  const source =
    final.source === 'invoices'
      ? `sumy wystawionych faktur (${final.label})`
      : final.source === 'import'
        ? 'finansów z importu'
        : 'ceny ustawionej wcześniej ręcznie'
  return `Cena końcowa pochodzi z ${source}: ${fmt(final.pln)}. Zmienić ją na ${fmt(newPln)} z wyceny? Faktury i finanse firmy się nie zmienią — zmieni się tylko cena w Realizacji i Finansach projektu.`
}
