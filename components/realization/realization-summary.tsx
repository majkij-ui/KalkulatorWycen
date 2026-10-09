'use client'

/**
 * Plan vs rzeczywistość projektu: koszty, zysk i marża. Rzeczywistość liczy
 * się z kosztów wpisanych w Realizacji przy tym samym przychodzie i ryczałcie
 * co plan (przychód z faktur to T6). Liczby nie trafiają do Finansów.
 */

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { compareByCategory, type ActualFigures, type PlanFigures } from '@/lib/realization-plan'
import { costCategoryLabel } from '@/lib/project-types'
import { pln } from '@/components/calendar/calendar-bits'

function pct(value: number): string {
  return `${value.toLocaleString('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`
}

function signedPln(value: number): string {
  // Zaokrąglamy wartość bezwzględną: −882,5 i +882,5 mają dać tę samą liczbę.
  const rounded = Math.sign(value) * Math.round(Math.abs(value))
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : '±'}${pln(Math.abs(rounded))}`
}

function signedPp(value: number): string {
  const text = Math.abs(value).toLocaleString('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  return `${value > 0.05 ? '+' : value < -0.05 ? '−' : '±'}${text} pp`
}

type Tone = 'good' | 'bad' | 'flat'

const TONE: Record<Tone, string> = {
  good: 'text-emerald-300',
  bad: 'text-red-300',
  flat: 'text-zinc-500',
}

/** Kafel: wartość rzeczywista, pod nią plan i różnica (znak + słowo, nie sam kolor). */
function Tile({
  label,
  value,
  plan,
  delta,
  tone,
}: {
  label: string
  value: string
  plan: string | null
  delta: string | null
  tone: Tone
}) {
  return (
    <div className="min-w-0 rounded-xl border border-white/5 bg-zinc-900/40 px-4 py-3">
      <div className="text-[11px] text-zinc-500">{label}</div>
      <div className="mt-0.5 text-2xl font-semibold text-white">{value}</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 text-xs">
        {plan && <span className="text-zinc-500">plan {plan}</span>}
        {delta && <span className={`font-semibold tabular-nums ${TONE[tone]}`}>{delta}</span>}
      </div>
    </div>
  )
}

function toneOf(diff: number, upIsGood: boolean, epsilon = 0.5): Tone {
  if (Math.abs(diff) < epsilon) return 'flat'
  return diff > 0 === upIsGood ? 'good' : 'bad'
}

export function RealizationSummary({ plan, actual }: { plan: PlanFigures; actual: ActualFigures }) {
  const [showCategories, setShowCategories] = useState(false)
  const known = actual.costCount > 0
  const hasPlan = plan.source !== 'none'
  const hasRevenue = plan.revenue > 0
  const rows = compareByCategory(plan, actual)

  const costDiff = actual.costs - plan.costs
  const profitDiff = actual.profit - plan.profit
  const marginDiff = actual.marginPct - plan.marginPct
  const vsPlan = (text: string) => (hasPlan && known ? `${text} vs plan` : null)

  return (
    <section aria-label="Plan i rzeczywistość" className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile
          label="Koszty rzeczywiste"
          value={known ? pln(actual.costs) : '—'}
          plan={hasPlan ? pln(plan.costs) : null}
          delta={vsPlan(signedPln(costDiff))}
          tone={toneOf(costDiff, false)}
        />
        <Tile
          label="Zysk rzeczywisty"
          value={known && hasRevenue ? pln(actual.profit) : '—'}
          plan={hasPlan ? pln(plan.profit) : null}
          delta={hasRevenue ? vsPlan(signedPln(profitDiff)) : null}
          tone={toneOf(profitDiff, true)}
        />
        <Tile
          label="Marża rzeczywista"
          value={known && hasRevenue ? pct(actual.marginPct) : '—'}
          plan={hasPlan && hasRevenue ? pct(plan.marginPct) : null}
          delta={hasRevenue ? vsPlan(signedPp(marginDiff)) : null}
          tone={toneOf(marginDiff, true, 0.05)}
        />
      </div>

      <p className="text-[11px] text-zinc-500">
        {plan.source === 'quote' &&
          `Przychód w obu kolumnach: kwota przelewu z wyceny (${pln(plan.revenue)}), ryczałt ${pct(plan.taxRatePercent)}.`}
        {plan.source === 'import' &&
          `Projekt bez wyceny: plan to wynik z importu (przychód ${pln(plan.revenue)}, koszty ${pln(plan.costs)}).`}
        {plan.source === 'none' && 'Projekt nie ma wyceny ani przychodu — rzeczywistość pokazuje same koszty.'}
        {!known && ' Wpisz ekipę i koszty poniżej, żeby zobaczyć rzeczywisty wynik.'}
        {' '}Te liczby nie zmieniają Finansów.
      </p>

      {rows.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowCategories((v) => !v)}
            aria-expanded={showCategories}
            className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-400 hover:text-zinc-100"
          >
            <ChevronDown className={`size-3.5 transition-transform ${showCategories ? 'rotate-180' : ''}`} />
            Koszty wg kategorii
          </button>
          {showCategories && (
            <table className="mt-2 w-full max-w-xl text-sm">
              <thead>
                <tr className="text-left text-[11px] text-zinc-500">
                  <th className="py-1 font-normal">Kategoria</th>
                  <th className="py-1 text-right font-normal">Plan</th>
                  <th className="py-1 text-right font-normal">Rzeczywiste</th>
                  <th className="py-1 text-right font-normal">Różnica</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const diff = row.plan === null ? null : row.actual - row.plan
                  return (
                    <tr key={row.category} className="border-t border-white/5">
                      <td className="py-1.5 text-zinc-300">{costCategoryLabel(row.category)}</td>
                      <td className="py-1.5 text-right tabular-nums text-zinc-400">
                        {row.plan === null ? '—' : pln(row.plan)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-zinc-200">{pln(row.actual)}</td>
                      <td
                        className={`py-1.5 text-right tabular-nums ${diff === null ? 'text-zinc-600' : TONE[toneOf(diff, false)]}`}
                      >
                        {diff === null ? '—' : signedPln(diff)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  )
}
