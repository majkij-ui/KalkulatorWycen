'use client'

/**
 * Pochodzenie klientów — wszystkie projekty pogrupowane po `leadSource`:
 * ile projektów, ile zleceń, ile pieniędzy z każdego kanału. Przy Google Ads
 * obok stoi wydatek na reklamy w tym roku, więc widać zwrot z kanału.
 *
 * Projekty bez pochodzenia są wypisane z rozwijaną listą — da się je
 * uzupełnić od ręki, bez otwierania każdego projektu.
 */

import { useMemo, useState } from 'react'
import { originBreakdown } from '@/lib/marketing-calc'
import { LEAD_SOURCES, LEAD_SOURCE_LABELS, toYear, type Project } from '@/lib/project-types'
import { plural } from '@/lib/pl-plural'
import { ProjectStatusBadge } from '@/components/projects/project-status-badge'
import { mono } from '@/components/calendar/calendar-bits'
import { pln } from './marketing-bits'

export function OriginsPanel({
  projects,
  adsSpendForYear,
  onSetOrigin,
  onOpenProject,
}: {
  projects: Project[]
  /** Wydatek na Google Ads w roku (`null` = cały czas). */
  adsSpendForYear: (year: number | null) => number
  onSetOrigin: (projectId: string, origin: string) => void
  onOpenProject: (id: string) => void
}) {
  const years = useMemo(() => {
    const set = new Set<number>([new Date().getFullYear()])
    projects.forEach((p) => {
      const y = toYear(p.date)
      if (y !== null) set.add(y)
    })
    return [...set].sort((a, b) => b - a)
  }, [projects])
  const [year, setYear] = useState<number | null>(() => new Date().getFullYear())

  const rows = useMemo(() => originBreakdown(projects, year), [projects, year])
  const unknown = projects.filter((p) => (year === null || toYear(p.date) === year) && !p.leadSource?.trim())
  const adsSpend = adsSpendForYear(year)
  const maxRevenue = Math.max(1, ...rows.map((r) => r.revenue))

  return (
    <section className="mb-6 rounded-xl border border-white/5 bg-zinc-900/40 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Pochodzenie klientów</h3>
          <p className="mt-0.5 text-[11px] text-zinc-600">
            Wszystkie projekty wg daty księgowej. Pochodzenie ustawiasz w pasku otwartego projektu albo poniżej.
          </p>
        </div>
        <div className="flex rounded-lg border border-white/10 bg-black/30 p-0.5" role="radiogroup" aria-label="Rok">
          {[...years.map((y) => ({ value: y as number | null, label: String(y) })), { value: null, label: 'Cały czas' }].map((opt) => {
            const active = opt.value === year
            return (
              <button
                key={opt.label}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setYear(opt.value)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  active ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-200'
                }`}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="-mx-1 overflow-x-auto">
        <table className="w-full min-w-[560px] text-xs">
          <thead>
            <tr className="text-[11px] text-zinc-500">
              <th className="py-1 pr-2 text-left font-medium">Pochodzenie</th>
              <th className="px-2 text-right font-medium">Projekty</th>
              <th className="px-2 text-right font-medium">Zlecenia</th>
              <th className="w-[30%] px-2 text-left font-medium">Przychód netto</th>
              <th className="px-2 text-right font-medium">Zysk</th>
              <th className="pl-2 text-right font-medium">W wycenach</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const empty = r.projects === 0
              return (
                <tr key={r.key || 'unknown'} className={`border-t border-white/[0.04] ${empty ? 'text-zinc-600' : 'text-zinc-200'}`}>
                  <td className="py-1.5 pr-2">
                    <span className={r.key === '' ? 'text-amber-300/90' : ''}>{r.label}</span>
                    {r.key === 'google_ads' && adsSpend > 0 && (
                      <span className="block text-[11px] text-zinc-500">
                        reklamy {pln(adsSpend)}
                        {r.revenue > 0 && ` · zwrot ${(r.revenue / adsSpend).toLocaleString('pl-PL', { maximumFractionDigits: 1 })}×`}
                      </span>
                    )}
                  </td>
                  <td className="px-2 text-right" style={mono}>
                    {r.projects}
                  </td>
                  <td className="px-2 text-right" style={mono}>
                    {r.won}
                  </td>
                  <td className="px-2">
                    <div className="flex items-center gap-2" title={`${r.label}: ${pln(r.revenue)}`}>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${(r.revenue / maxRevenue) * 100}%`, background: '#0284c7' }}
                        />
                      </div>
                      <span className="w-24 shrink-0 text-right" style={mono}>
                        {r.revenue ? pln(r.revenue) : '—'}
                      </span>
                    </div>
                  </td>
                  <td className="px-2 text-right" style={mono}>
                    {r.profit ? pln(r.profit) : '—'}
                  </td>
                  <td className="pl-2 text-right text-zinc-500" style={mono}>
                    {r.pipeline ? pln(r.pipeline) : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {unknown.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-500/15 bg-amber-500/[0.03] p-3">
          <p className="mb-2 text-xs text-amber-200/90">
            {unknown.length} {plural(unknown.length, 'projekt nie ma', 'projekty nie mają', 'projektów nie ma')} ustalonego
            pochodzenia klienta:
          </p>
          <ul className="space-y-1">
            {unknown.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => onOpenProject(p.id)}
                  className="min-w-0 flex-1 truncate text-left text-xs text-zinc-300 hover:text-white"
                >
                  {p.name || 'Bez nazwy'}
                  {p.client && p.client !== p.name && <span className="text-zinc-500"> · {p.client}</span>}
                </button>
                <ProjectStatusBadge status={p.status} />
                <select
                  aria-label={`Pochodzenie klienta: ${p.name}`}
                  value=""
                  onChange={(e) => e.target.value && onSetOrigin(p.id, e.target.value)}
                  className="h-7 rounded-md border border-white/10 bg-black/40 px-1.5 text-xs text-zinc-200 [color-scheme:dark]"
                >
                  <option value="">Ustaw…</option>
                  {LEAD_SOURCES.map((s) => (
                    <option key={s} value={s}>
                      {LEAD_SOURCE_LABELS[s]}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
