'use client'

/**
 * „Plan z wyceny" — dawna zakładka Profit kalkulatora, przeniesiona 1:1
 * (decyzja 5 planu: dane zostają w migawce wyceny, przenosimy tylko ekran).
 * Edytuje wycenę wgraną w kalkulator, więc utrwala ją „Zapisz" w nagłówku.
 */

import { useState } from 'react'
import { ChevronDown, PiggyBank } from 'lucide-react'
import type { PlanFigures } from '@/lib/realization-plan'
import { ProfitTab } from '@/components/tabs/profit'
import { pln } from '@/components/calendar/calendar-bits'

export function PlanSection({
  plan,
  unsaved,
  defaultOpen,
}: {
  plan: PlanFigures
  /** Plan w kalkulatorze różni się od zapisanego w projekcie. */
  unsaved: boolean
  defaultOpen: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <section aria-label="Plan z wyceny" className="rounded-xl border border-white/10 bg-zinc-900/20">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-4 py-3 text-left hover:bg-white/[0.02]"
      >
        <PiggyBank className="size-4 text-zinc-500" />
        <span className="text-sm font-bold text-zinc-100">
          {plan.source === 'import' ? 'Plan z importu' : 'Plan z wyceny (Profit)'}
        </span>
        {plan.source !== 'none' && (
          <span className="text-xs tabular-nums text-zinc-500">
            koszty {pln(plan.costs)} · zysk {pln(plan.profit)}
          </span>
        )}
        {unsaved && (
          <span className="rounded-md border border-amber-400/30 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-amber-200">
            zmieniony — kliknij „Zapisz" u góry
          </span>
        )}
        <ChevronDown className={`ml-auto size-4 text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="px-4 pb-4">
          {plan.source === 'quote' ? (
            <>
              <p className="mb-4 text-xs text-zinc-500">
                Koszty wyprowadzone z wyceny (stawki bez marży) z Twoimi poprawkami. To część wyceny: zmiany
                zapisuje „Zapisz" w nagłówku projektu, tak jak zmiany w zakładce Wycena.
              </p>
              <ProfitTab />
            </>
          ) : plan.source === 'import' ? (
            <div className="space-y-2 text-sm">
              <dl className="grid max-w-sm grid-cols-[1fr_auto] gap-x-6 gap-y-1">
                <dt className="text-zinc-500">Przychód netto</dt>
                <dd className="text-right tabular-nums text-zinc-200">{pln(plan.revenue)}</dd>
                <dt className="text-zinc-500">Ryczałt</dt>
                <dd className="text-right tabular-nums text-zinc-200">−{pln(plan.tax)}</dd>
                <dt className="text-zinc-500">Koszty</dt>
                <dd className="text-right tabular-nums text-zinc-200">−{pln(plan.costs)}</dd>
                <dt className="text-zinc-500">Zysk</dt>
                <dd className="text-right font-semibold tabular-nums text-white">{pln(plan.profit)}</dd>
              </dl>
              <p className="text-xs text-zinc-500">
                Projekt nie ma wyceny — to wynik z importu. Plan pozycja po pozycji powstanie, gdy zbudujesz
                wycenę w zakładce Wycena.
              </p>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">
              Projekt nie ma jeszcze wyceny. Zbuduj ją w zakładce Wycena — plan kosztów policzy się sam.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
