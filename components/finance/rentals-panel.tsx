'use client'

/**
 * Wynajem sprzętu w okresie (U2, plan §17.1): jedna liczba — suma wynajmu
 * projektów okresu, część kosztów bezpośrednich (nie dodatkowy koszt). Liczby
 * z `periodRentals` na wierszach rejestru marży (ta sama kotwica i podstawa
 * kosztów co Finanse); tu tylko układ.
 */

import { useMemo } from 'react'
import { ArrowUpRight } from 'lucide-react'
import type { MarginSummary } from '@/lib/margin-ledger'
import type { Project } from '@/lib/project-types'
import { periodRentals } from '@/lib/rentals'
import { useRentalItems } from '@/lib/use-rental-items'
import { pln } from '@/lib/money-loop-labels'

export function RentalsPanel({
  summary,
  projectsById,
  periodLabel,
  onOpenProject,
}: {
  summary: MarginSummary
  projectsById: Map<string, Project>
  periodLabel: string
  onOpenProject?: (id: string) => void
}) {
  const { allItems } = useRentalItems()
  const rentals = useMemo(() => periodRentals(summary.projects, projectsById, allItems), [summary.projects, projectsById, allItems])
  const direct = (summary.scoped ?? summary.totals).costs
  const share = direct > 0 ? Math.round((rentals.total / direct) * 100) : null

  return (
    <section className="mb-6 rounded-xl border border-white/5 bg-zinc-900/40 p-4" aria-label="Wynajem sprzętu">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500">
          Wynajem sprzętu · <span className="tabular-nums text-zinc-300">{pln(rentals.total)}</span>
        </h2>
        <p className="text-[11px] text-zinc-500">
          {periodLabel}: w kosztach bezpośrednich{share !== null ? ` (${share}%)` : ''}, z Realizacji (bez niej — z planu)
        </p>
      </div>
      {rentals.projects.length === 0 ? (
        <p className="text-xs text-zinc-500">W tym okresie nic nie wynajmowano.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <ul className="space-y-0.5">
            {rentals.projects.slice(0, 6).map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={!onOpenProject}
                  onClick={() => onOpenProject?.(p.id)}
                  className="group flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs enabled:hover:bg-white/5"
                >
                  <span className="min-w-0 flex-1 truncate text-zinc-300">{p.name || 'Bez nazwy'}</span>
                  <span className="shrink-0 tabular-nums text-zinc-400">{pln(p.amount)}</span>
                  {onOpenProject && <ArrowUpRight className="size-3.5 shrink-0 text-zinc-600 group-hover:text-zinc-300" />}
                </button>
              </li>
            ))}
          </ul>
          <div className="text-xs">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-zinc-600">Najczęściej wynajmowane</div>
            {rentals.top.length === 0 ? (
              <p className="text-zinc-500">Bez pozycji — wybierz je przy wynajmie w Realizacji.</p>
            ) : (
              <ul className="space-y-0.5">
                {rentals.top.map((item) => (
                  <li key={item.itemId} className="flex items-center gap-2 px-1.5 py-0.5">
                    <span className="min-w-0 flex-1 truncate text-zinc-300">{item.name}</span>
                    <span className="shrink-0 text-zinc-500">{item.times}×</span>
                    <span className="w-20 shrink-0 text-right tabular-nums text-zinc-400">{pln(item.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
