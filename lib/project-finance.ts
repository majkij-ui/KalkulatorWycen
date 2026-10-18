/**
 * Zakładka „Finanse" projektu (R2, plan §13.1 C1–C4) — liczby bez Reacta.
 *
 * Cztery warstwy pieniędzy (ARCHITECTURE.md): PDF to cena, Finanse projektu to
 * ostatnie słowo — z PDF domyślnie, z ręczną kwotą przelewu, a faktury wygrywają.
 *
 *  - ZATWIERDZONA CENA = suma PDF wybranego wariantu (EUR × kurs wyceny), a bez
 *    szkicu PDF — kalkulator (`approvedPrice`). Projekt bez wyceny: przychód z importu.
 *  - KWOTA FINALNEGO PRZELEWU = zatwierdzona cena + dosprzedaż (`extra_sale`);
 *    wpisana ręcznie (`profitTransferAmount`) to cały przelew. Różnica do ceny +
 *    dosprzedaży da się zapisać jako dosprzedaż — nigdy sama.
 *  - Wynik jak w pętli pieniędzy (`projectMoney`, ta sama reguła co Finanse
 *    firmy): zysk netto = „Marża" (po kosztach zewnętrznych i podatku), marża
 *    producencka = zysk − wartość mojej pracy.
 *
 * Liczy się z dokumentu wyceny NA ŻYWO (niezapisane zmiany widać od razu); po
 * zapisie te same liczby ma `Project.financials`.
 */

import { projectMoney, type ExtraSale, type MoneyEvent, type ProjectMoney } from './money-loop'
import { isBlankQuoteData } from './project-save'
import type { Project, ProjectFinancials } from './project-types'
import { approvedPrice, computeSnapshotFinancials, resolveSnapshot, type ApprovedPrice, type FinancialsSource } from './quote-financials'
import { actualFigures, compareByCategory, projectPlan, type ActualFigures, type CategoryRow, type PlanFigures } from './realization-plan'
import { liveCosts } from './project-costs'

/** Grosze: różnica mniejsza niż pół grosza to brak różnicy. */
const EPSILON = 0.005

export interface TransferView {
  /** Kwota wpisana ręcznie; `null` = pole pokazuje cenę + dosprzedaż. */
  typed: number | null
  /** Co pokazuje pole „Kwota finalnego przelewu". */
  shown: number
  /** Zatwierdzona cena + dosprzedaż. */
  expected: number
  /** Wpisana − (cena + dosprzedaż); `null` = nic nie wpisano albo zgadza się co do grosza. */
  gap: number | null
}

export interface ProjectFinanceView {
  /** Projekt z wyceną (albo wyceną właśnie budowaną) — pola da się edytować. */
  hasQuote: boolean
  /** `null` = projekt bez wyceny (retro-import). */
  approved: ApprovedPrice | null
  /** Przychód z importu (projekt bez wyceny); `null` przy wycenie. */
  imported: number | null
  extras: ExtraSale[]
  extrasTotal: number
  transfer: TransferView | null
  /** Najlepsza wiedza (jak Finanse firmy). */
  money: ProjectMoney
  plan: PlanFigures
  /** `null` = w Realizacji jeszcze nic nie zapisano (koszty z planu). */
  actual: ActualFigures | null
  /** Plan a Realizacja wg kategorii (C3); bez Realizacji — pusto. */
  categories: CategoryRow[]
}

export type LiveQuote = FinancialsSource & { data: NonNullable<FinancialsSource['data']> }

/**
 * Widok zakładki. `live` = dokument wyceny projektu (z niezapisanymi zmianami)
 * albo `null`, gdy go jeszcze nie ma.
 */
export function projectFinanceView(
  project: Pick<Project, 'id' | 'status' | 'date' | 'quote' | 'financials' | 'costs'>,
  live: LiveQuote | null,
  events: MoneyEvent[],
  today: string
): ProjectFinanceView {
  const hasQuote = !!live && (!!project.quote || !isBlankQuoteData(live.data))
  const source: FinancialsSource | null = hasQuote ? live : (project.quote as FinancialsSource | null)
  const resolved = hasQuote ? resolveSnapshot(source) : null
  const approved = resolved ? approvedPrice(resolved.data, resolved.pricing, resolved.margin, source?.pdfDraft) : null
  const financials: ProjectFinancials | null = hasQuote ? computeSnapshotFinancials(source) : project.financials
  const money = projectMoney({ ...project, financials }, events, today)
  const plan = projectPlan(project, live)
  const started = liveCosts(project.costs).length > 0
  const actual = started ? actualFigures(plan, project.costs) : null

  let transfer: TransferView | null = null
  if (approved && resolved) {
    const typed = resolved.data.profitTransferAmount
    const expected = approved.pln + money.extrasTotal
    const gap = typed === null || typed === undefined ? null : typed - expected
    transfer = {
      typed: typed ?? null,
      shown: typed ?? expected,
      expected,
      gap: gap !== null && Math.abs(gap) >= EPSILON ? gap : null,
    }
  }

  return {
    hasQuote,
    approved,
    imported: hasQuote ? null : (project.financials?.sumaNetto ?? null),
    extras: money.extras,
    extrasTotal: money.extrasTotal,
    transfer,
    money,
    plan,
    actual,
    categories: actual ? compareByCategory(plan, actual) : [],
  }
}

/**
 * „Zapisz różnicę jako dosprzedaż": wydarzenie `extra_sale` na różnicę i kwota
 * przelewu z powrotem „z ceny" (ta sama kwota, teraz z dosprzedażą). Tylko
 * dodatnia różnica — mniej niż cena to rabat, nie dosprzedaż.
 */
export function gapAsExtraSale(transfer: TransferView | null): { amountNetto: number; what: string } | null {
  if (!transfer || transfer.gap === null || transfer.gap <= 0) return null
  return { amountNetto: Math.round(transfer.gap * 100) / 100, what: 'Różnica w kwocie przelewu' }
}

/** Skąd przychód, po polsku — do podpisu kafla. */
export function revenueSourceText(view: Pick<ProjectFinanceView, 'money' | 'approved' | 'transfer' | 'imported'>): string {
  const { money } = view
  if (money.revenue === null) return 'brak kwoty'
  if (money.revenueBasis === 'invoices') return 'z faktur'
  if (view.transfer?.typed !== null && view.transfer?.typed !== undefined) return 'kwota przelewu wpisana ręcznie'
  const extras = money.extrasTotal > 0 ? ' + dosprzedaż' : ''
  if (view.approved?.source === 'pdf') return `z PDF${extras}`
  if (view.approved?.source === 'calculator') return `z kalkulatora (bez szkicu PDF)${extras}`
  if (view.imported !== null) return `z importu${extras}`
  return 'plan'
}
