'use client'

/**
 * Dosprzedaż w Finansach firmy (U1, U-DOSPRZEDAŻ): jak często dosprzedaję,
 * średnia kwota, gdy się zdarza, i podział na kategorie i fazy — dla projektów
 * zakotwiczonych w okresie (jak ich koszty). Liczby: `extraSaleStats`.
 */

import { extraSaleStats, type ExtraSaleGroup } from '@/lib/extra-sales'
import type { MarginSummary } from '@/lib/margin-ledger'
import { plural } from '@/lib/pl-plural'
import { pln } from '@/lib/money-loop-labels'

function pct(value: number | null): string {
  return value === null ? '—' : `${Math.round(value).toLocaleString('pl-PL')} %`
}

function GroupList({ title, groups }: { title: string; groups: ExtraSaleGroup[] }) {
  const max = Math.max(1, ...groups.map((g) => g.total))
  return (
    <div className="min-w-0">
      <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-600">{title}</h3>
      <ul className="space-y-1">
        {groups.map((g) => (
          <li key={g.key || 'none'} className="text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className={`min-w-0 truncate ${g.key ? 'text-zinc-300' : 'text-zinc-500'}`}>{g.label}</span>
              <span className="shrink-0 tabular-nums text-zinc-200">
                {pln(g.total)}
                <span className="ml-1.5 text-xs text-zinc-500">
                  × {g.count}
                  {g.average !== null && g.count > 1 ? ` · śr. ${pln(g.average)}` : ''}
                </span>
              </span>
            </div>
            <div className="mt-0.5 h-1 rounded bg-white/5">
              <div className="h-1 rounded bg-primary/60" style={{ width: `${(g.total / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function ExtraSalesPanel({ summary, periodLabel, scoped }: { summary: MarginSummary; periodLabel: string; scoped: boolean }) {
  const stats = extraSaleStats(summary.projects)
  return (
    <section aria-label="Dosprzedaż" className="mb-6 rounded-xl border border-white/5 bg-zinc-900/40 p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-200">Dosprzedaż · {periodLabel}{scoped ? ' (filtr klienta)' : ''}</h2>
        <span className="text-xs text-zinc-500">projekty zakotwiczone w okresie</span>
      </div>
      {stats.projects === 0 ? (
        <p className="text-sm text-zinc-600">Brak projektów w okresie.</p>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div>
              <div className="text-[11px] text-zinc-500">Jak często</div>
              <div className="tabular-nums text-lg font-semibold text-zinc-100">{pct(stats.sharePct)}</div>
              <div className="text-xs text-zinc-500">
                {stats.withExtras} z {stats.projects} {plural(stats.projects, 'projektu', 'projektów', 'projektów')}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-zinc-500">Średnio, gdy się zdarza</div>
              <div className="tabular-nums text-lg font-semibold text-zinc-100">{stats.averagePerProject === null ? '—' : pln(stats.averagePerProject)}</div>
              <div className="text-xs text-zinc-500">na projekt z dosprzedażą</div>
            </div>
            <div>
              <div className="text-[11px] text-zinc-500">Razem</div>
              <div className="tabular-nums text-lg font-semibold text-zinc-100">{pln(stats.total)}</div>
              <div className="text-xs text-zinc-500">
                {stats.count} {plural(stats.count, 'dosprzedaż', 'dosprzedaże', 'dosprzedaży')} · część przychodu
              </div>
            </div>
          </div>
          {stats.count > 0 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <GroupList title="Wg kategorii" groups={stats.byCategory} />
              <GroupList title="Wg fazy" groups={stats.byPhase} />
            </div>
          )}
        </>
      )}
    </section>
  )
}
