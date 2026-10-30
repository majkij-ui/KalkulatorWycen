/**
 * Słowa pętli pieniędzy (T6) — co pokazać w komórce projektu w Finansach.
 *
 * Zasada: brak faktur, brak kosztów, brak planu to STAN opisany słowami, nigdy
 * „0 zł". Skąd jest liczba (faktury, plan, Realizacja) mówi słowo, nie sam
 * kolor. Moduł czysty — testy w `money-loop-labels.test.ts`.
 */

import type { ProjectMargin } from './margin-ledger'
import type { OpenInvoice, ProjectMoney } from './money-loop'
import { plural } from './pl-plural'

export function pln(amount: number): string {
  return `${Math.round(amount).toLocaleString('pl-PL', { useGrouping: 'always' })} zł`
}

/** „+1 500 zł" / „−882 zł"; zero jako „± 0 zł" nie ma sensu — wtedy `null`. */
export function signedPln(value: number): string | null {
  const rounded = Math.sign(value) * Math.round(Math.abs(value))
  if (rounded === 0) return null
  return `${rounded > 0 ? '+' : '−'}${pln(Math.abs(rounded))}`
}

export function formatDate(dateKey: string): string {
  const [y, m, d] = dateKey.split('-')
  return y && m && d ? `${d}.${m}.${y}` : dateKey
}

export const shortDate = (dateKey: string) => formatDate(dateKey).slice(0, 5)

export const days = (n: number) => `${n} ${plural(n, 'dzień', 'dni', 'dni')}`
export const afterDays = (n: number) => `${n} ${plural(n, 'dniu', 'dniach', 'dniach')}`

// ── Opisy jednego projektu ───────────────────────────────────────────────────

export type Basis = 'fv' | 'plan' | 'rzecz'

export const BASIS_LABEL: Record<Basis, string> = { fv: 'z faktur', plan: 'plan', rzecz: 'z Realizacji' }

export interface CellText {
  value: string
  basis: Basis | null
  note: string | null
  /** Notatka ostrzega (czegoś brakuje) — inny kolor i słowo. */
  warn?: boolean
  /** Pilne (faktura po terminie). */
  alert?: boolean
  /** Wartość to stan słowny („brak kosztów"), nie kwota. */
  muted?: boolean
}

export function revenueText(money: ProjectMoney): CellText {
  if (money.revenue === null) return { value: 'brak planu', basis: null, note: 'i brak faktur', muted: true }
  const plan = money.plan?.revenue ?? null
  const extras = money.extrasTotal > 0 ? `w tym dodatki ${pln(money.extrasTotal)}` : null
  if (money.revenueBasis === 'invoices') {
    const delta = plan === null ? null : signedPln(money.revenue - plan)
    const vsPlan = plan === null ? 'bez planu' : delta ? `plan ${pln(plan)} · ${delta}` : 'zgodnie z planem'
    const missing = money.revenueNote === 'missing_amount' ? 'faktura bez kwoty' : null
    return { value: pln(money.revenue), basis: 'fv', note: [vsPlan, extras, missing].filter(Boolean).join(' · '), warn: !!missing }
  }
  if (money.revenueNote === 'partial') {
    const next = money.nextPlannedInvoice ? ` · reszta ${shortDate(money.nextPlannedInvoice)}` : ''
    return {
      value: pln(money.revenue),
      basis: 'plan',
      note: [`zafakturowano ${pln(money.invoiced ?? 0)} z ${pln(money.revenue)}${next}`, extras].filter(Boolean).join(' · '),
    }
  }
  if (money.revenueNote === 'planned') {
    const when = money.nextPlannedInvoice ? ` na ${shortDate(money.nextPlannedInvoice)}` : ''
    return { value: pln(money.revenue), basis: 'plan', note: [`faktura zaplanowana${when}`, extras].filter(Boolean).join(' · ') }
  }
  if (money.revenueNote === 'missing_amount') {
    return { value: pln(money.revenue), basis: 'plan', note: 'faktura bez kwoty — wpisz ją', warn: true }
  }
  return { value: pln(money.revenue), basis: 'plan', note: ['brak faktur', extras].filter(Boolean).join(' · ') }
}

export function costsText(money: ProjectMoney): CellText {
  const plan = money.plan?.costs ?? null
  if (money.actualCosts === null) {
    // Plan 0 zł przy braku wpisów to „nie wiemy", nie „nic nie kosztowało".
    if (money.costs === null || money.costs === 0) {
      return { value: 'brak kosztów', basis: null, note: plan === 0 ? 'w planie 0 zł' : null, muted: true }
    }
    return { value: pln(money.costs), basis: 'plan', note: 'brak kosztów w Realizacji' }
  }
  if (money.costsNote === 'partial') {
    return { value: pln(money.costs ?? 0), basis: 'plan', note: `wpisano ${pln(money.actualCosts)} z ${pln(plan ?? 0)}` }
  }
  const delta = plan === null ? null : signedPln(money.actualCosts - plan)
  return {
    value: pln(money.actualCosts),
    basis: 'rzecz',
    note: plan === null ? 'bez planu' : delta ? `plan ${pln(plan)} · ${delta}` : 'zgodnie z planem',
  }
}

export function profitText(money: ProjectMoney): CellText {
  if (money.profit === null) return { value: '—', basis: null, note: null, muted: true }
  const margin = money.marginPct === null ? null : `marża ${Math.round(money.marginPct)}%`
  const allPlan = money.revenueBasis === 'plan' && money.costsBasis !== 'actual'
  if (allPlan || !money.plan) return { value: pln(money.profit), basis: allPlan ? 'plan' : null, note: margin }
  const delta = signedPln(money.profit - money.plan.profit)
  return {
    value: pln(money.profit),
    basis: null,
    note: [margin, delta ? `plan ${pln(money.plan.profit)} · ${delta}` : 'zgodnie z planem'].filter(Boolean).join(' · '),
  }
}

/** „44,8 %" — udział z jednym miejscem po przecinku. */
export function sharePct(share: number): string {
  return `${(share * 100).toLocaleString('pl-PL', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`
}

/**
 * Marża na realizacji (S4, warstwa 1) w okresie: przychód − koszty
 * bezpośrednie, przed podatkiem. Projekt bez żadnej kwoty to „brak kwoty".
 */
export function marginText(row: Pick<ProjectMargin, 'money' | 'revenue' | 'costs' | 'margin' | 'known' | 'anchored'>): CellText {
  const { money } = row
  if (!row.known) {
    return {
      value: 'brak kwoty',
      basis: null,
      note: row.costs > 0 ? `koszty ${pln(row.costs)} bez przychodu` : 'ani planu, ani faktur',
      muted: true,
    }
  }
  const pct = row.revenue > 0 ? `${Math.round((row.margin / row.revenue) * 100)}% przychodu` : null
  const allPlan = money.revenueBasis === 'plan' && money.costsBasis !== 'actual'
  if (allPlan || !money.plan || !row.anchored || money.margin === null) {
    return { value: pln(row.margin), basis: allPlan ? 'plan' : null, note: pct, warn: row.margin < 0 }
  }
  const planMargin = money.plan.revenue - money.plan.costs
  const delta = signedPln(money.margin - planMargin)
  return {
    value: pln(row.margin),
    basis: null,
    note: [pct, delta ? `plan ${pln(planMargin)} · ${delta}` : 'zgodnie z planem'].filter(Boolean).join(' · '),
    warn: row.margin < 0,
  }
}

/** Zysk po wszystkich kosztach (S4, warstwa 2) — tylko w widoku roku. */
export function resultText(row: Pick<ProjectMargin, 'result' | 'overhead' | 'share' | 'tax' | 'known'>): CellText {
  if (row.result === null) return { value: '—', basis: null, note: 'tylko w widoku roku', muted: true }
  if (!row.known && row.share === 0 && row.result === 0) return { value: '—', basis: null, note: null, muted: true }
  return {
    value: pln(row.result),
    basis: null,
    note: `podatek ${pln(row.tax)} · koszty firmy ${pln(row.overhead ?? 0)} (${sharePct(row.share ?? 0)})`,
    warn: row.result < 0,
  }
}

export function paymentText(money: ProjectMoney, open: OpenInvoice[]): CellText {
  const late = open.filter((i) => i.daysOverdue > 0)
  if (late.length) {
    const worst = Math.max(...late.map((i) => i.daysOverdue))
    return { value: `${days(worst)} po terminie`, basis: null, note: null, alert: true }
  }
  if (open.length) {
    const waiting = Math.max(...open.map((i) => i.daysOpen))
    return { value: `czeka ${days(waiting)}`, basis: null, note: null }
  }
  if (money.daysToPaid !== null) {
    return { value: `po ${afterDays(Math.round(money.daysToPaid))}`, basis: null, note: 'zapłacono' }
  }
  if (money.paid) return { value: 'zapłacone', basis: null, note: 'bez faktury w hubie' }
  if (money.invoices.some((i) => i.state === 'planned')) return { value: 'faktura zaplanowana', basis: null, note: null, muted: true }
  return { value: '—', basis: null, note: money.invoices.length ? null : 'brak faktur', muted: true }
}

export function dueText(invoice: OpenInvoice): string {
  const due = `termin ${shortDate(invoice.dueDate)}${invoice.dueAssumed ? ' (przyjęto 30 dni)' : ''}`
  if (invoice.daysOverdue > 0) return `${due} · ${days(invoice.daysOverdue)} po terminie`
  if (invoice.daysOverdue === 0) return `${due} · termin dziś`
  return `${due} · zostało ${days(-invoice.daysOverdue)}`
}
