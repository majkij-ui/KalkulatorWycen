'use client'

/**
 * Koszty stałe miesiąc po miesiącu (zakładka „Koszty stałe i subskrypcje").
 *
 * Pokazujemy KAŻDY miesiąc okresu, także pusty: brak ZUS-u w marcu ma być
 * widoczny od razu. W miesiącu są trzy rodzaje wierszy:
 *  - rata subskrypcji („auto") — liczona, nie zapisana; kliknięcie kwoty albo
 *    „Pomiń" zapisuje poprawkę tego miesiąca (decyzja C),
 *  - poprawka raty — ręczna pozycja z `subscriptionId`; „Przywróć auto" ją
 *    (miękko) usuwa i wraca rata wyliczona,
 *  - zwykły ręczny koszt — kategoria, opis i kwota edytowane w miejscu.
 * Szybkie dodawanie: wiersz pod miesiącem, Enter zapisuje i zostaje otwarty.
 * Usuwanie miękkie, z „Cofnij".
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, RotateCcw, X } from 'lucide-react'
import { parseAmount } from '@/lib/event-draft'
import { periodMonths, summarizeFixedCosts, type Period } from '@/lib/finance-calc'
import {
  COST_CATEGORY_KEYS,
  COST_CATEGORY_LABELS,
  fixedCostCategory,
  withCategory,
  type CostCategory,
} from '@/lib/fixed-cost-categories'
import { pln } from '@/lib/money-loop-labels'
import type { FixedCost } from '@/lib/project-types'
import type { Subscription } from '@/lib/subscription-types'
import { chargeInMonth, subscriptionCorrection, type EffectiveFixedCost } from '@/lib/subscriptions'
import { amountDraft, money, monthName, rateText } from './finance-format'
import type { FinanceNotice } from './subscriptions-panel'
import type { FixedCostsState } from './use-fixed-costs'

const inputClass =
  'h-7 min-w-0 rounded-md border border-white/10 bg-black/40 px-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-white/30'

const categoryRank = (cost: FixedCost) => COST_CATEGORY_KEYS.indexOf(fixedCostCategory(cost))

// ── Pola edytowane w miejscu ─────────────────────────────────────────────────

/** Kwota: przycisk, a po kliknięciu pole; Enter albo wyjście zapisuje, Esc anuluje. */
function InlineAmount({
  amount,
  label,
  onCommit,
  muted = false,
}: {
  amount: number
  label: string
  onCommit: (value: number) => Promise<void> | void
  muted?: boolean
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = async () => {
    if (draft === null) return
    const value = parseAmount(draft)
    setDraft(null)
    if (value !== undefined && Math.abs(value - amount) > 0.001) await onCommit(value)
  }
  if (draft === null) {
    return (
      <button
        type="button"
        onClick={() => setDraft(amountDraft(amount))}
        aria-label={`Zmień kwotę: ${label}`}
        title="Zmień kwotę"
        className={`w-24 shrink-0 rounded px-1.5 text-right tabular-nums hover:bg-white/5 ${muted ? 'text-zinc-400' : 'text-zinc-100'}`}
      >
        {money(amount)}
      </button>
    )
  }
  return (
    <input
      autoFocus
      inputMode="decimal"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') setDraft(null)
      }}
      aria-label={`Kwota: ${label}`}
      className={`${inputClass} w-24 shrink-0 text-right tabular-nums`}
    />
  )
}

/** Opis: tekst, a po kliknięciu pole. */
function InlineText({ value, onCommit }: { value: string; onCommit: (value: string) => Promise<void> }) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = async () => {
    if (draft === null) return
    const next = draft.trim()
    setDraft(null)
    if (next !== value) await onCommit(next)
  }
  if (draft === null) {
    return (
      <button
        type="button"
        onClick={() => setDraft(value)}
        title="Zmień opis"
        className="min-w-0 flex-1 truncate rounded px-1 text-left text-zinc-300 hover:bg-white/5"
      >
        {value || <span className="text-zinc-600">dodaj opis</span>}
      </button>
    )
  }
  return (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') setDraft(null)
      }}
      aria-label="Opis"
      className={`${inputClass} flex-1`}
    />
  )
}

function CategorySelect({
  value,
  onChange,
  className = '',
}: {
  value: CostCategory
  onChange: (next: CostCategory) => void
  className?: string
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as CostCategory)}
      aria-label="Kategoria"
      className={`h-7 shrink-0 rounded-md border border-transparent bg-transparent px-1 text-xs text-zinc-500 hover:border-white/10 focus:border-white/30 ${className}`}
    >
      {COST_CATEGORY_KEYS.map((key) => (
        <option key={key} value={key}>
          {COST_CATEGORY_LABELS[key]}
        </option>
      ))}
    </select>
  )
}

function Tag({ children, tone = 'zinc' }: { children: React.ReactNode; tone?: 'zinc' | 'sky' | 'amber' }) {
  const tones = {
    zinc: 'bg-zinc-800 text-zinc-400',
    sky: 'bg-sky-500/10 text-sky-300',
    amber: 'bg-amber-500/10 text-amber-300',
  }
  return <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${tones[tone]}`}>{children}</span>
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex size-7 shrink-0 items-center justify-center rounded-md text-zinc-600 opacity-60 outline-none transition-opacity hover:bg-white/5 hover:text-zinc-200 hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-white/60 group-hover:opacity-100"
    >
      {children}
    </button>
  )
}

// ── Wiersze ──────────────────────────────────────────────────────────────────

function CostRow({
  cost,
  sub,
  future,
  fixed,
  onNotice,
}: {
  cost: EffectiveFixedCost
  /** Subskrypcja raty albo poprawki (nieusunięta). */
  sub: Subscription | undefined
  future: boolean
  fixed: FixedCostsState
  onNotice: (notice: FinanceNotice) => void
}) {
  const category = fixedCostCategory(cost)
  const name = sub?.name ?? cost.label

  // Rata wyliczona: każda zmiana to nowa poprawka tego miesiąca.
  if (cost.derived && sub) {
    const derived = cost.derived
    return (
      <div className={`group flex items-center gap-2 py-0.5 pl-3 text-sm ${future ? 'opacity-70' : ''}`}>
        <span className="w-28 shrink-0 truncate text-xs text-zinc-500">{COST_CATEGORY_LABELS[category]}</span>
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="truncate px-1 text-zinc-300">{name}</span>
          <Tag tone="sky">{future ? 'plan' : 'auto'}</Tag>
          {derived.currency !== 'PLN' && (
            <span className="hidden truncate text-xs text-zinc-500 sm:inline">
              {money(derived.originalAmount, derived.currency)} × {rateText(derived.rate)}
            </span>
          )}
        </span>
        <InlineAmount
          amount={cost.amount}
          label={`${name} ${cost.month}`}
          muted={future}
          onCommit={(value) => fixed.addCosts([subscriptionCorrection(sub, cost.month, value)])}
        />
        <button
          type="button"
          onClick={() => fixed.addCosts([subscriptionCorrection(sub, cost.month, 0)])}
          className="w-14 shrink-0 rounded px-1 text-right text-xs text-zinc-600 opacity-60 hover:text-zinc-200 hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100"
          title="Ten miesiąc bez raty (pauza, nie zapłacono)"
        >
          Pomiń
        </button>
      </div>
    )
  }

  // Poprawka raty: kwota w miejscu, „Przywróć auto" zdejmuje poprawkę.
  if (cost.subscriptionId && sub) {
    const auto = chargeInMonth(sub, cost.month)
    const skipped = cost.amount === 0
    const restore = async () => {
      const stamp = await fixed.removeCosts([cost.id])
      onNotice({
        message: `${name}, ${monthName(cost.month).toLowerCase()}: wraca rata automatyczna${auto ? ` ${money(auto.amount)}` : ''}.`,
        undo: () => fixed.restoreCosts(stamp),
      })
    }
    return (
      <div className="group flex items-center gap-2 py-0.5 pl-3 text-sm">
        <span className="w-28 shrink-0 truncate text-xs text-zinc-500">{COST_CATEGORY_LABELS[category]}</span>
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="truncate px-1 text-zinc-300">{name}</span>
          <Tag tone={skipped ? 'amber' : 'zinc'}>{skipped ? 'pominięta' : auto ? 'poprawiona' : 'dopłata'}</Tag>
          {auto && !skipped && Math.abs(auto.amount - cost.amount) > 0.001 && (
            <span className="hidden truncate text-xs text-zinc-600 sm:inline">auto {money(auto.amount)}</span>
          )}
        </span>
        <InlineAmount
          amount={cost.amount}
          label={`${name} ${cost.month}`}
          onCommit={(value) => fixed.updateCost({ ...stripDerived(cost), amount: value })}
        />
        <button
          type="button"
          onClick={restore}
          className="flex w-14 shrink-0 items-center justify-end gap-1 rounded px-1 text-xs text-zinc-600 opacity-60 hover:text-zinc-200 hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100"
          title={auto ? 'Wróć do raty wyliczonej z subskrypcji' : 'Usuń tę pozycję'}
        >
          <RotateCcw className="size-3" />
          auto
        </button>
      </div>
    )
  }

  // Zwykły koszt (też odczyt z panelu reklam i poprawka usuniętej subskrypcji).
  const remove = async () => {
    const stamp = await fixed.removeCosts([cost.id])
    onNotice({
      message: `Usunięto „${cost.label || COST_CATEGORY_LABELS[category]}" ${money(cost.amount)} (${monthName(cost.month).toLowerCase()}).`,
      undo: () => fixed.restoreCosts(stamp),
    })
  }
  return (
    <div className="group flex items-center gap-2 py-0.5 pl-2 text-sm">
      <CategorySelect
        value={category}
        onChange={(next) => fixed.updateCost(withCategory(stripDerived(cost), next))}
        className="w-[7.25rem]"
      />
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <InlineText value={cost.label} onCommit={(label) => fixed.updateCost({ ...stripDerived(cost), label })} />
        {cost.campaignId && <Tag>kampania</Tag>}
        {cost.subscriptionId && !sub && <Tag>usunięta subskrypcja</Tag>}
      </span>
      <InlineAmount
        amount={cost.amount}
        label={cost.label || COST_CATEGORY_LABELS[category]}
        onCommit={(value) => fixed.updateCost({ ...stripDerived(cost), amount: value })}
      />
      <span className="flex w-14 shrink-0 justify-end">
        <IconButton label={`Usuń ${cost.label || COST_CATEGORY_LABELS[category]}`} onClick={remove}>
          <X className="size-3.5" />
        </IconButton>
      </span>
    </div>
  )
}

/** Zapis bez pól liczonych przy odczycie. */
function stripDerived(cost: EffectiveFixedCost): FixedCost {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { derived, ...rest } = cost
  return rest
}

/** Szybki wpis pod miesiącem: kategoria, opis, kwota, Enter. Zostaje otwarty na kolejny. */
function QuickAddRow({
  month,
  defaultCategory,
  onAdd,
  onClose,
}: {
  month: string
  defaultCategory: CostCategory
  onAdd: (params: { month: string; category: CostCategory; label: string; amount: number }) => Promise<void>
  onClose: () => void
}) {
  const [category, setCategory] = useState<CostCategory>(defaultCategory)
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('')
  const labelRef = useRef<HTMLInputElement>(null)
  const value = parseAmount(amount)
  const valid = value !== undefined && value > 0

  useEffect(() => labelRef.current?.focus(), [])

  const submit = async () => {
    if (!valid) return
    await onAdd({ month, category, label: label.trim(), amount: value })
    setLabel('')
    setAmount('')
    labelRef.current?.focus()
  }
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') submit()
    if (e.key === 'Escape') onClose()
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 rounded-lg bg-black/30 py-1.5 pl-2 pr-1" aria-label={`Nowy koszt: ${monthName(month)}`}>
      <CategorySelect value={category} onChange={setCategory} className="w-[7.25rem] border-white/10" />
      <input
        ref={labelRef}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={keys}
        placeholder="Opis, np. Adobe CC, telefon"
        aria-label="Opis"
        className={`${inputClass} min-w-[8rem] flex-1`}
      />
      <input
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        onKeyDown={keys}
        placeholder="Kwota zł"
        aria-label="Kwota"
        className={`${inputClass} w-24 text-right tabular-nums`}
      />
      <button
        type="button"
        onClick={submit}
        disabled={!valid}
        className="h-7 rounded-md bg-zinc-800 px-2.5 text-xs font-medium text-zinc-100 hover:bg-zinc-700 disabled:opacity-40"
      >
        Dodaj
      </button>
      <IconButton label="Zamknij dodawanie" onClick={onClose}>
        <X className="size-3.5" />
      </IconButton>
    </div>
  )
}

// ── Panel ────────────────────────────────────────────────────────────────────

export function FixedCostsPanel({
  period,
  today,
  yearCosts,
  subscriptions,
  fixed,
  onNotice,
}: {
  period: Period
  today: string
  /** Koszty stałe roku z ratami (`fixedCostsInYear`). */
  yearCosts: EffectiveFixedCost[]
  /** Nieusunięte subskrypcje. */
  subscriptions: Subscription[]
  fixed: FixedCostsState
  onNotice: (notice: FinanceNotice) => void
}) {
  const [adding, setAdding] = useState<string | null>(null)
  const [lastCategory, setLastCategory] = useState<CostCategory>('other')
  const months = useMemo(() => periodMonths(period), [period])
  const currentMonth = today.slice(0, 7)
  const subsById = useMemo(() => new Map(subscriptions.map((s) => [s.id, s])), [subscriptions])
  const summary = useMemo(() => summarizeFixedCosts(yearCosts, period), [yearCosts, period])
  const byMonth = useMemo(() => {
    const map = new Map<string, EffectiveFixedCost[]>()
    yearCosts.forEach((c) => map.set(c.month, [...(map.get(c.month) ?? []), c]))
    map.forEach((items) =>
      items.sort(
        (a, b) =>
          categoryRank(a) - categoryRank(b) ||
          (subsById.get(a.subscriptionId ?? '')?.name ?? a.label).localeCompare(
            subsById.get(b.subscriptionId ?? '')?.name ?? b.label,
            'pl'
          )
      )
    )
    return map
  }, [yearCosts, subsById])

  const add = async (params: { month: string; category: CostCategory; label: string; amount: number }) => {
    setLastCategory(params.category)
    await fixed.addCost(params)
  }

  const categories = COST_CATEGORY_KEYS.filter((key) => summary.byCategory[key])

  return (
    <section className="rounded-xl border border-white/5 bg-zinc-900/40 p-4" aria-label="Koszty stałe miesiącami">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Koszty stałe miesiącami</h2>
        <span className="text-sm tabular-nums text-zinc-300">
          razem <span className="font-semibold text-zinc-100">{pln(summary.total)}</span>
          {summary.derived > 0 && <span className="text-zinc-500"> · w tym raty auto {pln(summary.derived)}</span>}
        </span>
      </div>
      {categories.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {categories.map((key) => (
            <span key={key} className="rounded-md bg-black/30 px-2 py-1 text-xs text-zinc-400">
              {COST_CATEGORY_LABELS[key]} <span className="tabular-nums text-zinc-200">{pln(summary.byCategory[key] ?? 0)}</span>
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-col divide-y divide-white/5">
        {months.map((month) => {
          const items = byMonth.get(month) ?? []
          const total = items.reduce((sum, c) => sum + c.amount, 0)
          const future = month > currentMonth
          const missingZus = !items.some((c) => fixedCostCategory(c) === 'zus')
          return (
            <div key={month} className="py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-medium text-zinc-300">
                  {monthName(month)}
                  {future && <span className="text-[11px] font-normal text-zinc-600">zaplanowane</span>}
                </span>
                <span className="flex items-center gap-2">
                  {missingZus && <Tag>bez ZUS</Tag>}
                  <span className="tabular-nums text-sm font-semibold text-zinc-100">{pln(total)}</span>
                  {adding !== month && (
                    <IconButton label={`Dodaj koszt: ${monthName(month)}`} onClick={() => setAdding(month)}>
                      <Plus className="size-3.5" />
                    </IconButton>
                  )}
                </span>
              </div>
              {items.map((cost) => (
                <CostRow
                  key={cost.id}
                  cost={cost}
                  sub={cost.subscriptionId ? subsById.get(cost.subscriptionId) : undefined}
                  future={future}
                  fixed={fixed}
                  onNotice={onNotice}
                />
              ))}
              {adding === month && (
                <QuickAddRow month={month} defaultCategory={lastCategory} onAdd={add} onClose={() => setAdding(null)} />
              )}
            </div>
          )
        })}
      </div>
      <p className="mt-2 text-[11px] text-zinc-600">
        „Auto" to rata z subskrypcji — kliknij kwotę, żeby wpisać, ile naprawdę zapłacono w tym miesiącu, albo „Pomiń".
        Co miesiąc to samo? Dodaj subskrypcję u góry zamiast przepisywać.
      </p>
    </section>
  )
}
