'use client'

/**
 * Sekcja „Sprzęt": mój sprzęt i to, jak na siebie zarabia.
 *
 * Dwie liczby na pozycję (plan G, decyzja 3):
 *  - Odpracował: ile kosztowałby rental za każdy dzień, w którym był na planie,
 *  - Zarobił: ile zapłacili za niego klienci (szacunek z wycen do czasu G5).
 * Klik w pozycję otwiera panel z edycją, statystykami i historią projektów.
 * Samo zaznaczanie sprzętu dzieje się w zakładce Realizacja projektu; daty
 * dni pochodzą z kalendarza.
 */

import { useMemo, useState } from 'react'
import { AlertTriangle, ArrowUpRight, ChevronDown, Loader2, Package, Plus, Search } from 'lucide-react'
import { useEquipment } from '@/lib/equipment-context'
import { useEvents } from '@/lib/events-context'
import { useProjectHub } from '@/lib/project-hub-context'
import { computeGearReport, type EquipmentRoi, type MissingGearProject } from '@/lib/equipment-roi'
import { equipmentCategoryLabel, equipmentCategoryRank, unitsOwned, type EquipmentItem } from '@/lib/project-types'
import { dayLabel, plural } from '@/lib/pl-plural'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { EquipmentItemSheet, formatPayoff } from './equipment-item-sheet'

function pln(amount: number): string {
  return `${Math.round(amount).toLocaleString('pl-PL', { useGrouping: 'always' })} zł`
}

function formatDate(dateKey: string | null): string {
  if (!dateKey) return '—'
  const [y, m, d] = dateKey.split('-')
  return y && m && d ? `${d}.${m}.${y}` : dateKey
}

function normalize(text: string): string {
  return text.toLocaleLowerCase('pl').normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

const SORTS = [
  { value: 'kategoria', label: 'Kategoriami' },
  { value: 'odpracowal', label: 'Najwięcej odpracował' },
  { value: 'zarobil', label: 'Najwięcej zarobił' },
  { value: 'czestosc', label: 'Najczęściej na planie' },
  { value: 'splata', label: 'Najbliżej spłaty' },
  { value: 'nieuzywany', label: 'Najdłużej nieużywany' },
] as const
type Sort = (typeof SORTS)[number]['value']

const byName = (a: EquipmentRoi, b: EquipmentRoi) => a.item.name.localeCompare(b.item.name, 'pl')
const nullsLast = (a: number | null, b: number | null) => (b ?? -Infinity) - (a ?? -Infinity)

const COMPARE: Record<Exclude<Sort, 'kategoria'>, (a: EquipmentRoi, b: EquipmentRoi) => number> = {
  odpracowal: (a, b) => b.rentValue - a.rentValue || byName(a, b),
  zarobil: (a, b) => b.clientPaid - a.clientPaid || byName(a, b),
  czestosc: (a, b) => nullsLast(a.daysPerMonth, b.daysPerMonth) || byName(a, b),
  splata: (a, b) => nullsLast(a.rentValuePct, b.rentValuePct) || byName(a, b),
  // Nigdy nieużywany na górze, potem najdawniej użyty.
  nieuzywany: (a, b) => (a.lastUsed ?? '').localeCompare(b.lastUsed ?? '') || byName(a, b),
}

/**
 * Pasek spłaty w dwóch odcieniach: jasny = odpracował, pełny = zarobił
 * (zwykle mniejszy, bo nie za każdy sprzęt klient płaci).
 */
function PayoffBar({ roi }: { roi: EquipmentRoi }) {
  if (roi.rentValuePct === null) {
    return <div className="text-[11px] text-zinc-600">brak ceny zakupu</div>
  }
  const rent = Math.min(100, roi.rentValuePct)
  const client = Math.min(100, roi.clientPaidPct ?? 0)
  return (
    <div>
      <div
        className="relative h-1.5 w-28 overflow-hidden rounded-full bg-zinc-800"
        role="img"
        aria-label={`Odpracował ${Math.round(roi.rentValuePct)}%, zarobił ${Math.round(roi.clientPaidPct ?? 0)}% ceny zakupu`}
      >
        <div className="absolute inset-y-0 left-0 rounded-full bg-emerald-500/35" style={{ width: `${rent}%` }} />
        <div className="absolute inset-y-0 left-0 rounded-full bg-emerald-400" style={{ width: `${client}%` }} />
      </div>
      <div className="mt-1 text-[11px] tabular-nums text-zinc-500">
        {roi.paidOffByRent ? (
          <span className="text-emerald-400">spłacony</span>
        ) : (
          <>
            {Math.round(roi.rentValuePct)}%
            {roi.rentPayoffMonth && <span className="text-zinc-600"> · {formatPayoff(roi.rentPayoffMonth)}</span>}
          </>
        )}
      </div>
    </div>
  )
}

function ItemRow({ roi, onOpen }: { roi: EquipmentRoi; onOpen: () => void }) {
  const { item } = roi
  const units = unitsOwned(item)
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex w-full flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border px-4 py-3 text-left transition-colors hover:border-white/15 ${
        item.retiredAt ? 'border-white/5 bg-zinc-900/20 opacity-60' : 'border-white/5 bg-zinc-900/40'
      }`}
    >
      <div className="min-w-[180px] flex-1">
        <div className="truncate font-semibold text-zinc-100">
          {item.name}
          {units > 1 && <span className="ml-1.5 text-xs font-normal text-zinc-500">×{units}</span>}
          {item.retiredAt && (
            <span className="ml-2 rounded bg-zinc-800 px-1.5 py-px text-[10px] font-normal text-zinc-400">wycofany</span>
          )}
        </div>
        <div className="mt-0.5 text-xs text-zinc-500">
          {item.purchasePrice > 0 ? `zakup ${pln(item.purchasePrice)}${units > 1 ? '/szt.' : ''}` : 'zakup —'}
          {' · '}
          {item.rentalDayRate > 0 ? (
            `rental ${pln(item.rentalDayRate)}/dzień`
          ) : (
            <span className="text-amber-300/70">brak stawki rentalowej</span>
          )}
        </div>
      </div>

      <div className="w-36 shrink-0 text-xs text-zinc-500">
        {roi.projectsUsed === 0 ? (
          'nieużywany'
        ) : (
          <>
            <div>
              {roi.projectsUsed} proj. · {roi.daysUsed} {dayLabel(roi.daysUsed)}
            </div>
            <div className="text-zinc-600">ostatnio {formatDate(roi.lastUsed)}</div>
          </>
        )}
      </div>

      <div className="w-28 shrink-0 text-right tabular-nums">
        <div className="text-sm font-semibold text-zinc-100">{pln(roi.rentValue)}</div>
        <div className="text-xs text-zinc-500">~{pln(roi.clientPaid)}</div>
      </div>

      <div className="w-32 shrink-0">
        <PayoffBar roi={roi} />
      </div>
    </button>
  )
}

function MissingGearBanner({
  missing,
  onOpenProject,
}: {
  missing: MissingGearProject[]
  onOpenProject?: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  if (missing.length === 0) return null
  return (
    <section className="mb-6 rounded-xl border border-amber-500/20 bg-amber-500/5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <AlertTriangle className="size-4 shrink-0 text-amber-300/80" />
        <span className="flex-1 text-sm text-amber-100/90">
          {missing.length}{' '}
          {plural(missing.length, 'projekt nie ma', 'projekty nie mają', 'projektów nie ma')} wpisanego sprzętu
          <span className="text-amber-100/50"> (w realizacji i zrealizowane)</span>
        </span>
        <ChevronDown className={`size-4 text-amber-300/60 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-amber-500/10 px-4 pb-3 pt-2">
          <p className="mb-2 text-xs text-zinc-400">
            Otwórz projekt i zaznacz sprzęt w jego zakładce Realizacja. Kwota przy projekcie to zapłata klienta za
            sprzęt, która czeka na przypisanie. „Brak wyceny" znaczy, że Zarobił policzy się dopiero po odbudowie
            wyceny.
          </p>
          <ul className="flex flex-col gap-1">
            {missing.map(({ project, revenue }) => (
              <li key={project.id}>
                <button
                  type="button"
                  disabled={!onOpenProject}
                  onClick={() => onOpenProject?.(project.id)}
                  className="group flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors enabled:hover:bg-white/5"
                >
                  <span className="w-24 shrink-0 text-xs tabular-nums text-zinc-500">{formatDate(project.date)}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">
                    {project.name || 'Bez nazwy'}
                    {project.client && <span className="text-zinc-500"> · {project.client}</span>}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-zinc-400">
                    {revenue === null
                      ? 'brak wyceny'
                      : revenue.ownGear > 0
                        ? `za sprzęt ${pln(revenue.ownGear)}`
                        : 'bez sprzętu w wycenie'}
                  </span>
                  {onOpenProject && (
                    <ArrowUpRight className="size-4 shrink-0 text-zinc-600 group-hover:text-zinc-300" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

export function EquipmentSection({ onOpenProject }: { onOpenProject?: (id: string) => void }) {
  const { items, isLoading } = useEquipment()
  const { projects } = useProjectHub()
  const { allEvents } = useEvents()

  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('kategoria')
  const [showRetired, setShowRetired] = useState(false)
  /** `undefined` = panel zamknięty, `null` = nowa pozycja, id = edycja. */
  const [sheetItemId, setSheetItemId] = useState<string | null | undefined>(undefined)

  const report = useMemo(
    () => computeGearReport(items, projects, { events: allEvents }),
    [items, projects, allEvents]
  )
  const { totals } = report

  const active = items.filter((i) => !i.retiredAt)
  const missingRate = active.filter((i) => i.rentalDayRate <= 0).length
  const missingPrice = active.filter((i) => i.purchasePrice <= 0).length

  const visible = useMemo(() => {
    const needle = normalize(query.trim())
    return report.items.filter(
      (r) => (showRetired || !r.item.retiredAt) && (!needle || normalize(r.item.name).includes(needle))
    )
  }, [report, query, showRetired])

  const groups = useMemo(() => {
    if (sort !== 'kategoria') return [{ category: '', rows: [...visible].sort(COMPARE[sort]) }]
    const map = new Map<string, EquipmentRoi[]>()
    visible.forEach((r) => {
      const bucket = map.get(r.item.category) ?? []
      bucket.push(r)
      map.set(r.item.category, bucket)
    })
    return [...map.entries()]
      .sort(([a], [b]) => equipmentCategoryRank(a) - equipmentCategoryRank(b) || a.localeCompare(b, 'pl'))
      .map(([category, rows]) => ({ category, rows: rows.sort(byName) }))
  }, [visible, sort])

  const sheetItem: EquipmentItem | null = sheetItemId ? (items.find((i) => i.id === sheetItemId) ?? null) : null
  const sheetRoi = sheetItemId ? report.items.find((r) => r.item.id === sheetItemId) : undefined
  const sheetOpen = sheetItemId === null || sheetItem !== null

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-white">Sprzęt</h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-500">
          Twój sprzęt i to, jak na siebie zarabia. <span className="text-zinc-300">Odpracował</span>: ile
          kosztowałby rental za każdy dzień na planie. <span className="text-zinc-300">Zarobił</span>: ile zapłacili
          za niego klienci (szacunek z wycen). Liczą się projekty w realizacji i zrealizowane.
        </p>
      </header>

      {items.length > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile
            label="Zainwestowane"
            value={pln(totals.invested)}
            lines={[
              `${totals.activeCount} ${plural(totals.activeCount, 'pozycja', 'pozycje', 'pozycji')}${
                totals.retiredCount > 0
                  ? ` · ${totals.retiredCount} ${plural(totals.retiredCount, 'wycofana', 'wycofane', 'wycofanych')}`
                  : ''
              }`,
            ]}
            warn={missingPrice > 0 ? `${missingPrice} bez ceny zakupu` : undefined}
          />
          <Tile
            label="Odpracował"
            value={pln(totals.rentValue)}
            good={totals.rentValue > 0}
            lines={[
              totals.rentValuePct === null ? '' : `${Math.round(totals.rentValuePct)}% zainwestowanego`,
              `spłacone: ${totals.paidOffByRentCount}`,
            ]}
            warn={missingRate > 0 ? `${missingRate} bez stawki rentalowej` : undefined}
          />
          <Tile
            label="Zarobił"
            value={`~${pln(totals.clientPaid)}`}
            good={totals.clientPaid > 0}
            lines={[
              totals.clientPaidPct === null
                ? 'szacunek z wycen'
                : `${Math.round(totals.clientPaidPct)}% zainwestowanego`,
              `spłacone: ${totals.paidOffByClientsCount}`,
            ]}
            warn={totals.unassignedClientPaid > 0 ? `+${pln(totals.unassignedClientPaid)} nieprzypisane` : undefined}
          />
          <Tile label="Nieużywane" value={String(totals.unusedCount)} lines={['aktywne pozycje bez dnia na planie']} />
        </div>
      )}

      <MissingGearBanner missing={report.missingGear} onOpenProject={onOpenProject} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-600" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Szukaj sprzętu"
            aria-label="Szukaj sprzętu"
            className="h-9 border-white/10 bg-black/40 pl-8 text-sm"
          />
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          aria-label="Sortowanie"
          className="h-9 rounded-md border border-white/10 bg-black/40 px-2 text-sm text-zinc-200"
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        {totals.retiredCount > 0 && (
          <label className="flex items-center gap-1.5 text-xs text-zinc-400">
            <input
              type="checkbox"
              checked={showRetired}
              onChange={(e) => setShowRetired(e.target.checked)}
              className="accent-emerald-500"
            />
            Pokaż wycofane ({totals.retiredCount})
          </label>
        )}
        <Button onClick={() => setSheetItemId(null)} className="h-9 gap-2">
          <Plus className="size-4" />
          Dodaj sprzęt
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16 text-zinc-600">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/10 py-16 text-center">
          <Package className="size-8 text-zinc-700" />
          <p className="mt-3 max-w-sm text-sm text-zinc-500">
            Dodaj sprzęt z ceną zakupu i stawką rentalową za dzień, żeby liczyć, ile odpracował i zarobił w
            projektach.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {visible.length === 0 && (
            <p className="py-8 text-center text-sm text-zinc-600">Nic nie pasuje do wyszukiwania.</p>
          )}
          {groups.map((group) =>
            group.rows.length === 0 ? null : (
              <section key={group.category || 'all'}>
                <div className="mb-2 flex items-end justify-between gap-3">
                  <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500">
                    {group.category
                      ? equipmentCategoryLabel(group.category)
                      : SORTS.find((s) => s.value === sort)?.label}
                  </h2>
                  <div className="hidden text-[10px] uppercase tracking-wide text-zinc-600 sm:block">
                    odpracował / <span className="text-zinc-500">~zarobił</span>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  {group.rows.map((roi) => (
                    <ItemRow key={roi.item.id} roi={roi} onOpen={() => setSheetItemId(roi.item.id)} />
                  ))}
                </div>
              </section>
            )
          )}
        </div>
      )}

      <Sheet open={sheetOpen} onOpenChange={(open) => !open && setSheetItemId(undefined)}>
        <SheetContent
          side="right"
          aria-describedby={undefined}
          // Edycja: bez fokusu na nazwie, żeby pierwsze naciśnięcie klawisza jej nie nadpisało.
          onOpenAutoFocus={(e) => {
            if (sheetItemId) e.preventDefault()
          }}
          className="overflow-y-auto border-l border-white/10 bg-zinc-950/95 p-5 text-white backdrop-blur-2xl sm:max-w-md"
        >
          <SheetTitle className="sr-only">{sheetItem ? sheetItem.name : 'Nowy sprzęt'}</SheetTitle>
          {sheetOpen && (
            <EquipmentItemSheet
              key={sheetItemId ?? 'new'}
              item={sheetItem}
              roi={sheetRoi}
              onClose={() => setSheetItemId(undefined)}
              onOpenProject={onOpenProject}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}

function Tile({
  label,
  value,
  lines,
  warn,
  good,
}: {
  label: string
  value: string
  lines: string[]
  warn?: string
  good?: boolean
}) {
  return (
    <div className="rounded-xl border border-white/5 bg-zinc-900/40 p-4">
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-1 tabular-nums text-xl font-bold ${good ? 'text-emerald-400' : 'text-zinc-100'}`}>
        {value}
      </div>
      {lines.filter(Boolean).map((line) => (
        <div key={line} className="text-xs text-zinc-500">
          {line}
        </div>
      ))}
      {warn && <div className="mt-0.5 text-xs text-amber-300/80">{warn}</div>}
    </div>
  )
}
