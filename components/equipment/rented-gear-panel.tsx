'use client'

/**
 * „Wynajmowany sprzęt" (U2, plan §17.1): co wypożyczam, jak często i za ile —
 * podstawa do decyzji „kupić zamiast wynajmować". Liczby z wierszy wynajmu w
 * Realizacji (`rentedGearReport`); słownik trzyma tylko nazwy. Liczą się
 * projekty w realizacji i zrealizowane, jak w statystykach własnego sprzętu.
 */

import { useMemo, useState } from 'react'
import { ArrowUpRight, ChevronDown, Loader2, Repeat } from 'lucide-react'
import { useProjectHub } from '@/lib/project-hub-context'
import { useEvents } from '@/lib/events-context'
import { useRentalItems } from '@/lib/use-rental-items'
import { rentedGearReport, type RentedItemStats } from '@/lib/rentals'
import { gearDaysWithCalendarDates } from '@/lib/realization-days'
import { dayLabel, plural } from '@/lib/pl-plural'
import { Input } from '@/components/ui/input'

function pln(amount: number): string {
  return `${Math.round(amount).toLocaleString('pl-PL', { useGrouping: 'always' })} zł`
}

function formatDate(dateKey: string | null | undefined): string {
  if (!dateKey) return '—'
  const [y, m, d] = dateKey.split('-')
  return y && m && d ? `${d}.${m}.${y}` : dateKey
}

function daysText(stats: Pick<RentedItemStats, 'days' | 'daysUnknown'>): string {
  const known = stats.days > 0 ? `${String(stats.days).replace('.', ',')} ${dayLabel(stats.days)}` : ''
  const unknown = stats.daysUnknown > 0 ? `${stats.daysUnknown}× bez dni` : ''
  return [known, unknown].filter(Boolean).join(' + ') || '—'
}

function YearChips({ byYear }: { byYear: Map<number, number> }) {
  const entries = [...byYear.entries()].sort(([a], [b]) => a - b)
  if (entries.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1">
      {entries.map(([year, amount]) => (
        <span key={year} className="rounded bg-white/5 px-1.5 py-px text-[11px] tabular-nums text-zinc-400">
          {year}: {pln(amount)}
        </span>
      ))}
    </div>
  )
}

function ItemCard({
  stats,
  onOpenProject,
  onRename,
  onRemove,
}: {
  stats: RentedItemStats
  onOpenProject?: (id: string) => void
  onRename: (name: string) => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(stats.name)
  return (
    <div className="rounded-xl border border-white/5 bg-zinc-900/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 text-left"
      >
        <div className="min-w-[160px] flex-1">
          <div className="truncate font-semibold text-zinc-100">
            {stats.name}
            {!stats.item && <span className="ml-2 rounded bg-zinc-800 px-1.5 py-px text-[10px] font-normal text-zinc-400">poza słownikiem</span>}
          </div>
          <div className="mt-0.5 text-xs text-zinc-500">
            {stats.times}× · {daysText(stats)}
          </div>
        </div>
        <div className="w-40 shrink-0 text-xs text-zinc-500">
          <div>ostatnio {formatDate(stats.last?.date)}</div>
          <div className="truncate text-zinc-600">{stats.last?.projectName}</div>
        </div>
        <div className="w-28 shrink-0 text-right text-sm font-semibold tabular-nums text-amber-300/90">{pln(stats.total)}</div>
        <ChevronDown className={`size-4 shrink-0 text-zinc-600 transition-transform ${open ? 'rotate-180' : ''}`} />
        <div className="w-full">
          <YearChips byYear={stats.byYear} />
        </div>
      </button>
      {open && (
        <div className="space-y-2 border-t border-white/5 px-4 pb-3 pt-2">
          <ul className="space-y-1">
            {stats.uses.map((use, index) => (
              <li key={`${use.projectId}-${index}`}>
                <button
                  type="button"
                  disabled={!onOpenProject}
                  onClick={() => onOpenProject?.(use.projectId)}
                  className="group flex w-full flex-wrap items-center gap-x-3 rounded-lg px-2 py-1 text-left text-xs enabled:hover:bg-white/5"
                >
                  <span className="w-20 shrink-0 tabular-nums text-zinc-500">{formatDate(use.date)}</span>
                  <span className="min-w-0 flex-1 truncate text-zinc-200">{use.projectName || 'Bez nazwy'}</span>
                  <span className="shrink-0 text-zinc-500">
                    {[use.days === null ? 'bez dni' : `${String(use.days).replace('.', ',')} ${dayLabel(use.days)}`, use.vendor]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  <span className="w-20 shrink-0 text-right tabular-nums text-zinc-300">{pln(use.amount)}</span>
                  {onOpenProject && <ArrowUpRight className="size-3.5 shrink-0 text-zinc-600 group-hover:text-zinc-300" />}
                </button>
              </li>
            ))}
          </ul>
          {stats.item && (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (name.trim() && name.trim() !== stats.name) onRename(name)
              }}
            >
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-label="Nazwa w słowniku"
                className="h-8 max-w-xs border-white/10 bg-black/40 text-sm"
              />
              <button type="submit" className="rounded-md border border-white/10 px-2 py-1 text-xs text-zinc-300 hover:bg-white/5">
                Zmień nazwę
              </button>
              <button type="button" onClick={onRemove} className="rounded-md px-2 py-1 text-xs text-zinc-500 hover:text-red-300">
                Usuń ze słownika
              </button>
              <span className="text-[11px] text-zinc-600">wiersze w projektach zostają</span>
            </form>
          )}
        </div>
      )}
    </div>
  )
}

export function RentedGearPanel({ onOpenProject }: { onOpenProject?: (id: string) => void }) {
  const { projects } = useProjectHub()
  const { allEvents } = useEvents()
  const { allItems, isLoading, renameItem, removeItem, restoreItem } = useRentalItems()
  const [notice, setNotice] = useState<{ message: string; undo?: () => void } | null>(null)

  const report = useMemo(
    () =>
      rentedGearReport(projects, allItems, (project) => {
        const days = gearDaysWithCalendarDates(project, allEvents)
        return new Map(days.filter((d) => d.date).map((d) => [d.id, d.date]))
      }),
    [projects, allItems, allEvents]
  )
  const thisYear = new Date().getFullYear()

  if (isLoading) {
    return (
      <div className="flex justify-center py-16 text-zinc-600">
        <Loader2 className="size-5 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <div className="rounded-xl border border-white/5 bg-zinc-900/40 p-4">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">Wynajem razem</div>
          <div className="mt-1 text-xl font-bold tabular-nums text-zinc-100">{pln(report.total)}</div>
          <div className="text-xs text-zinc-500">
            w {thisYear}: {pln(report.byYear.get(thisYear) ?? 0)}
          </div>
        </div>
        <div className="rounded-xl border border-white/5 bg-zinc-900/40 p-4">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">Pozycje</div>
          <div className="mt-1 text-xl font-bold tabular-nums text-zinc-100">{report.items.length}</div>
          <div className="text-xs text-zinc-500">
            {report.items.reduce((sum, i) => sum + i.times, 0)} {plural(report.items.reduce((sum, i) => sum + i.times, 0), 'wynajem', 'wynajmy', 'wynajmów')} z nazwą
          </div>
        </div>
        <div className="col-span-2 rounded-xl border border-white/5 bg-zinc-900/40 p-4 lg:col-span-1">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">Bez pozycji</div>
          <div className="mt-1 text-xl font-bold tabular-nums text-zinc-100">{pln(report.unitemized.total)}</div>
          <div className="text-xs text-zinc-500">
            {report.unitemized.times} {plural(report.unitemized.times, 'wiersz', 'wiersze', 'wierszy')} w {report.unitemized.projects}{' '}
            {plural(report.unitemized.projects, 'projekcie', 'projektach', 'projektach')} — kwota za projekt, stare wiersze, plan
          </div>
        </div>
      </div>

      <p className="text-xs text-zinc-500">
        Z wierszy „Wynajem sprzętu" w Realizacji (na cały projekt i w dniach), projekty w realizacji i zakończone. Pozycję dodasz w
        Realizacji: Koszty projektu → Wynajem sprzętu → „Pozycja z wynajmu".
      </p>

      {notice && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-zinc-300" role="status">
          <span className="flex-1">{notice.message}</span>
          {notice.undo && (
            <button
              type="button"
              onClick={() => {
                notice.undo?.()
                setNotice(null)
              }}
              className="font-semibold text-primary hover:underline"
            >
              Cofnij
            </button>
          )}
        </div>
      )}

      {report.items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/10 py-12 text-center">
          <Repeat className="size-7 text-zinc-700" />
          <p className="mt-3 max-w-sm text-sm text-zinc-500">
            Jeszcze żaden wynajem nie ma pozycji. Wybierz albo dodaj ją przy wynajmie w Realizacji — tu zobaczysz, ile razy i za ile
            wynajmujesz.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {report.items.map((stats) => (
            <ItemCard
              key={stats.itemId}
              stats={stats}
              onOpenProject={onOpenProject}
              onRename={(name) => void renameItem(stats.itemId, name)}
              onRemove={async () => {
                const at = await removeItem(stats.itemId)
                setNotice({ message: `Usunięto „${stats.name}" ze słownika.`, undo: () => void restoreItem(stats.itemId, at) })
              }}
            />
          ))}
        </div>
      )}

      {report.unitemized.total > 0 && (
        <div className="rounded-xl border border-dashed border-white/10 px-4 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm text-zinc-300">Wynajem bez pozycji</span>
            <span className="text-sm font-semibold tabular-nums text-amber-300/80">{pln(report.unitemized.total)}</span>
          </div>
          <div className="mt-1">
            <YearChips byYear={report.unitemized.byYear} />
          </div>
        </div>
      )}
    </div>
  )
}
