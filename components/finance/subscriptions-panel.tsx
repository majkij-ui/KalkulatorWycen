'use client'

/**
 * Subskrypcje na górze zakładki „Koszty stałe i subskrypcje": co płacimy
 * cyklicznie, ile to miesięcznie i rocznie, ile naprawdę wyszło w wybranym
 * roku, i przełącznik „co jeśli" — rok bez danej subskrypcji. Przełącznik
 * niczego nie zapisuje; koniec naprawdę = data końca w formularzu.
 */

import { useMemo, useState } from 'react'
import { Pencil, Plus } from 'lucide-react'
import { COST_CATEGORY_KEYS, COST_CATEGORY_LABELS } from '@/lib/fixed-cost-categories'
import { summarizeMoney, type ProjectMoney } from '@/lib/money-loop'
import { pln, signedPln } from '@/lib/money-loop-labels'
import type { FixedCost } from '@/lib/project-types'
import { CADENCE_LABELS, isSubscriptionCadence, type Subscription } from '@/lib/subscription-types'
import {
  intervalMonths,
  monthlyValue,
  subscriptionCategory,
  subscriptionProblem,
  subscriptionStatus,
  totalsBySubscription,
  withoutSubscriptions,
  yearlyValue,
  type EffectiveFixedCost,
  type SubscriptionProblem,
} from '@/lib/subscriptions'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { dateShort, money, rateText } from './finance-format'
import { SubscriptionForm } from './subscription-form'
import type { FixedCostsState } from './use-fixed-costs'
import type { SubscriptionsState } from './use-subscriptions'

export interface FinanceNotice {
  message: string
  undo?: () => Promise<void>
}

const PROBLEM_LABELS: Record<SubscriptionProblem, string> = {
  start: 'brak daty pierwszej raty — nie liczy się',
  cadence: 'nieznany cykl — nie liczy się',
  rate: 'brak kursu — nie liczy się',
}

function cadenceText(sub: Subscription): string {
  if (!isSubscriptionCadence(sub.cadence)) return sub.cadence
  if (sub.cadence === 'custom') {
    const n = intervalMonths(sub)
    return n ? `co ${n} mies.` : 'co ? mies.'
  }
  return CADENCE_LABELS[sub.cadence]
}

const categoryOrder = (sub: Subscription) => COST_CATEGORY_KEYS.indexOf(subscriptionCategory(sub))

function SubscriptionRow({
  sub,
  today,
  inYear,
  year,
  excluded,
  onToggle,
  onEdit,
}: {
  sub: Subscription
  today: string
  inYear: number
  year: number
  excluded: boolean
  onToggle: (on: boolean) => void
  onEdit: () => void
}) {
  const status = subscriptionStatus(sub, today)
  const problem = subscriptionProblem(sub)
  const monthly = monthlyValue(sub)
  const yearly = yearlyValue(sub)
  const ended = status === 'ended'
  return (
    <div
      className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-lg px-3 py-2 sm:grid-cols-[minmax(0,1fr)_6.5rem_6.5rem_6.5rem_4.5rem] ${
        excluded ? 'bg-sky-500/5' : ''
      } ${ended ? 'opacity-60' : ''}`}
    >
      <button type="button" onClick={onEdit} className="group min-w-0 text-left" aria-label={`Edytuj: ${sub.name}`}>
        <span className={`flex items-center gap-1.5 text-sm text-zinc-100 ${excluded ? 'line-through decoration-sky-400/60' : ''}`}>
          <span className="truncate">{sub.name || 'Bez nazwy'}</span>
          <Pencil className="size-3 shrink-0 text-zinc-600 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
        </span>
        <span className="block truncate text-xs text-zinc-500">
          {COST_CATEGORY_LABELS[subscriptionCategory(sub)]} · {money(sub.amount, sub.currency)} {cadenceText(sub)}
          {sub.currency !== 'PLN' && sub.rate ? ` · kurs ${rateText(sub.rate)}` : ''}
          {status === 'planned' && ` · od ${dateShort(sub.startDate)}`}
          {sub.endDate && ` · ${ended ? 'zakończona' : 'do'} ${dateShort(sub.endDate)}`}
          {sub.notes && ` · ${sub.notes}`}
        </span>
        {problem && <span className="block text-xs text-amber-300/80">{PROBLEM_LABELS[problem]}</span>}
      </button>
      <span className="hidden text-right text-sm tabular-nums text-zinc-300 sm:block">
        {monthly === null ? '—' : pln(monthly)}
      </span>
      <span className="hidden text-right text-sm tabular-nums text-zinc-300 sm:block">
        {yearly === null ? '—' : pln(yearly)}
      </span>
      <span className="text-right text-sm font-semibold tabular-nums text-zinc-100">
        {inYear ? pln(inYear) : <span className="font-normal text-zinc-600">—</span>}
        <span className="block text-[11px] font-normal text-zinc-500 sm:hidden">
          {monthly === null ? '' : `${pln(monthly)}/mies. · `}w {year}
        </span>
      </span>
      <span className="col-span-2 flex items-center justify-end gap-2 sm:col-span-1">
        <span className="text-[11px] text-zinc-500 sm:hidden">co jeśli bez</span>
        <Switch
          checked={excluded}
          onCheckedChange={onToggle}
          aria-label={`Co jeśli bez: ${sub.name}`}
          className="data-[state=checked]:bg-sky-500"
        />
      </span>
    </div>
  )
}

export function SubscriptionsPanel({
  subs,
  fixed,
  yearCosts,
  year,
  ledger,
  today,
  onNotice,
}: {
  subs: SubscriptionsState
  fixed: FixedCostsState
  /** Koszty stałe roku z ratami (`fixedCostsInYear`). */
  yearCosts: EffectiveFixedCost[]
  year: number
  ledger: ProjectMoney[]
  today: string
  onNotice: (notice: FinanceNotice) => void
}) {
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set())

  const rows = useMemo(
    () =>
      [...subs.subscriptions].sort(
        (a, b) =>
          Number(subscriptionStatus(a, today) === 'ended') - Number(subscriptionStatus(b, today) === 'ended') ||
          categoryOrder(a) - categoryOrder(b) ||
          a.name.localeCompare(b.name, 'pl')
      ),
    [subs.subscriptions, today]
  )
  const inYear = useMemo(() => totalsBySubscription(yearCosts), [yearCosts])
  const running = rows.filter((s) => subscriptionStatus(s, today) !== 'ended')
  const monthlyTotal = running.reduce((sum, s) => sum + (monthlyValue(s) ?? 0), 0)
  const yearlyTotal = running.reduce((sum, s) => sum + (yearlyValue(s) ?? 0), 0)
  const inYearTotal = rows.reduce((sum, s) => sum + (inYear.get(s.id) ?? 0), 0)

  const whatIf = useMemo(() => {
    const live = new Set([...excluded].filter((id) => rows.some((s) => s.id === id)))
    if (live.size === 0) return null
    const period = { kind: 'year' as const, year }
    const before = summarizeMoney(ledger, yearCosts, period)
    const after = summarizeMoney(ledger, withoutSubscriptions(yearCosts, live), period)
    return { count: live.size, before, after }
  }, [excluded, rows, ledger, yearCosts, year])

  const toggle = (id: string, on: boolean) =>
    setExcluded((current) => {
      const next = new Set(current)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  const save = async (sub: Subscription, keep: FixedCost[]) => {
    await fixed.addCosts(keep)
    await subs.save(sub)
    setEditing(null)
  }

  const remove = async (sub: Subscription) => {
    await subs.remove(sub.id)
    setEditing(null)
    onNotice({
      message: `Usunięto subskrypcję „${sub.name}". Jej raty już się nie liczą; ręczne poprawki zostają.`,
      undo: () => subs.restore(sub.id),
    })
  }

  const editedSub = editing && editing !== 'new' ? rows.find((s) => s.id === editing) : undefined

  return (
    <section className="mb-6 rounded-xl border border-white/5 bg-zinc-900/40 p-4" aria-label="Subskrypcje">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Subskrypcje i stałe opłaty</h2>
        {editing === null && (
          <Button size="sm" variant="ghost" onClick={() => setEditing('new')} className="h-7 gap-1.5 text-xs">
            <Plus className="size-3.5" />
            Dodaj subskrypcję
          </Button>
        )}
      </div>

      {editing === 'new' && (
        <SubscriptionForm costs={fixed.costs} today={today} onSave={save} onCancel={() => setEditing(null)} />
      )}

      {rows.length === 0 && editing !== 'new' ? (
        <p className="px-3 py-2 text-sm text-zinc-500">
          Brak subskrypcji. Dodaj to, co płacisz cyklicznie (ZUS, oprogramowanie, bank, księgowość) — raty policzą się
          same w każdym miesiącu, a koszty stałe poniżej przestaną wymagać przepisywania.
        </p>
      ) : (
        rows.length > 0 && (
          <>
            <div className="hidden grid-cols-[minmax(0,1fr)_6.5rem_6.5rem_6.5rem_4.5rem] gap-x-3 px-3 pb-1 text-[11px] uppercase tracking-wide text-zinc-600 sm:grid">
              <span>Subskrypcja</span>
              <span className="text-right">Miesięcznie</span>
              <span className="text-right">Rocznie</span>
              <span className="text-right">W {year}</span>
              <span className="text-right">Co jeśli</span>
            </div>
            <div className="flex flex-col divide-y divide-white/5">
              {rows.map((sub) =>
                editing === sub.id && editedSub ? (
                  <div key={sub.id} className="py-2">
                    <SubscriptionForm
                      initial={editedSub}
                      costs={fixed.costs}
                      today={today}
                      onSave={save}
                      onCancel={() => setEditing(null)}
                      onDelete={() => remove(editedSub)}
                    />
                  </div>
                ) : (
                  <SubscriptionRow
                    key={sub.id}
                    sub={sub}
                    today={today}
                    inYear={inYear.get(sub.id) ?? 0}
                    year={year}
                    excluded={excluded.has(sub.id)}
                    onToggle={(on) => toggle(sub.id, on)}
                    onEdit={() => setEditing(sub.id)}
                  />
                )
              )}
            </div>
            <div className="mt-1 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-t border-white/10 px-3 pt-2 text-sm sm:grid-cols-[minmax(0,1fr)_6.5rem_6.5rem_6.5rem_4.5rem]">
              <span className="text-xs text-zinc-500">
                Razem bez zakończonych
                <span className="block sm:hidden">
                  {pln(monthlyTotal)}/mies. · {pln(yearlyTotal)}/rok
                </span>
              </span>
              <span className="hidden text-right font-semibold tabular-nums text-zinc-100 sm:block">{pln(monthlyTotal)}</span>
              <span className="hidden text-right font-semibold tabular-nums text-zinc-100 sm:block">{pln(yearlyTotal)}</span>
              <span className="text-right font-semibold tabular-nums text-zinc-100">{pln(inYearTotal)}</span>
            </div>
            <p className="mt-2 px-3 text-[11px] text-zinc-600">
              Miesięcznie i rocznie: tyle kosztuje dziś (roczna rata rozłożona na 12). „W {year}": raty i poprawki,
              które naprawdę wpadają w {year} — rata roczna w miesiącu, w którym jest płacona.
            </p>
          </>
        )
      )}

      {whatIf && (
        <div className="mt-3 rounded-lg border border-sky-500/20 bg-sky-500/5 p-3 text-sm" role="status">
          <p className="text-xs font-semibold uppercase tracking-wide text-sky-300">
            Co jeśli bez {whatIf.count === 1 ? 'tej subskrypcji' : `${whatIf.count} subskrypcji`} — rok {year}
          </p>
          <p className="mt-1 tabular-nums text-zinc-200">
            Koszty stałe {pln(whatIf.before.fixedCosts.total)} → {pln(whatIf.after.fixedCosts.total)}
            <span className="text-emerald-300">
              {' '}
              ({signedPln(whatIf.after.fixedCosts.total - whatIf.before.fixedCosts.total) ?? '± 0 zł'})
            </span>
          </p>
          <p className="tabular-nums text-zinc-200">
            Wynik firmy {pln(whatIf.before.netResult)} → {pln(whatIf.after.netResult)}
            {whatIf.after.netMarginPct !== null && (
              <span className="text-zinc-500"> · marża {Math.round(whatIf.after.netMarginPct)}%</span>
            )}
          </p>
          <p className="mt-1 text-[11px] text-zinc-500">
            Bez {whatIf.count === 1 ? 'jej' : 'ich'} rat i poprawek w całym {year}. Nic się nie zapisuje — żeby zakończyć naprawdę, wpisz datę końca.
            {year === Number(today.slice(0, 4)) && ` Rezygnacja dziś oszczędzi w ${year} tylko raty po ${dateShort(today)}.`}
          </p>
        </div>
      )}
    </section>
  )
}
