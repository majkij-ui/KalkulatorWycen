'use client'

/**
 * Zakładka „Sprzęt" projektu: co pojechało na plan, dzień po dniu.
 *
 * Siatka: wiersze to sprzęt z katalogu, kolumny to dni zdjęciowe. Klik w
 * komórkę zmienia jeden dzień, klik w nazwę wszystkie dni naraz (najczęstszy
 * przypadek: ten sam zestaw przez całe zdjęcia). Pozycje z kilkoma sztukami
 * przełączają się po kolei: komplet → o jedną mniej → … → brak.
 *
 * Nic tu nie zmienia kwot wyceny ani finansów projektu (plan G, decyzja 1),
 * więc projektom z 2026 można dopisać sprzęt bez przebudowy wyceny.
 *
 * Zapis: lokalna kopia dni + zapis z krótkim opóźnieniem. Każdy zapis kopiuje
 * projekt z ostatniego renderu, więc bez lokalnej kopii szybkie klikanie
 * gubiłoby wcześniejsze zmiany.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useReactToPrint } from 'react-to-print'
import { Copy, Package, PackageOpen, Plus, Printer, Search, Trash2 } from 'lucide-react'
import { useEquipment } from '@/lib/equipment-context'
import { useEvents } from '@/lib/events-context'
import { useProjectHub } from '@/lib/project-hub-context'
import {
  addGearDay,
  buildPackingList,
  cycleGearQty,
  duplicateGearDay,
  gearDayLabel,
  projectShootDates,
  quoteShootDayCount,
  removeGearDay,
  setGearLine,
  suggestGearDays,
  toggleGearItemAllDays,
  updateGearDay,
} from '@/lib/gear-usage'
import { summarizeProjectGear } from '@/lib/equipment-roi'
import {
  countsTowardRevenue,
  equipmentCategoryLabel,
  equipmentCategoryRank,
  unitsOwned,
  type EquipmentItem,
  type GearDay,
  type Project,
} from '@/lib/project-types'
import { dayLabel, itemLabel, plural } from '@/lib/pl-plural'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

const SAVE_DELAY_MS = 250

function pln(amount: number): string {
  return `${Math.round(amount).toLocaleString('pl-PL', { useGrouping: 'always' })} zł`
}

/** `YYYY-MM-DD` → `DD.MM.YYYY`. */
function formatDate(dateKey: string): string {
  const [y, m, d] = dateKey.split('-')
  return y && m && d ? `${d}.${m}.${y}` : dateKey
}

/** `YYYY-MM-DD` → „pon 02.03". */
function shortDate(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  if (!y || !m || !d) return dateKey
  const weekday = new Date(y, m - 1, d).toLocaleDateString('pl-PL', { weekday: 'short' })
  return `${weekday} ${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}`
}

function normalize(text: string): string {
  return text.toLocaleLowerCase('pl').normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

export function ProjectEquipment() {
  const { activeProject } = useProjectHub()
  if (!activeProject) return null
  // Klucz = id projektu: przejście do innego projektu zaczyna od jego danych.
  return <GearPlanner key={activeProject.id} project={activeProject} />
}

function GearPlanner({ project }: { project: Project }) {
  const { items, isLoading } = useEquipment()
  const { updateProject } = useProjectHub()
  const { events } = useEvents()

  // `null` = projekt nie ma jeszcze zapisanych dni; pokazujemy podpowiedź,
  // która zapisze się dopiero przy pierwszej zmianie.
  const [savedDays, setSavedDays] = useState<GearDay[] | null>(project.gearDays ?? null)
  const suggested = useMemo(() => suggestGearDays(project, events), [project, events])
  const days = savedDays ?? suggested

  const saveRef = useRef(updateProject)
  useEffect(() => {
    saveRef.current = updateProject
  }, [updateProject])
  const pendingRef = useRef<GearDay[] | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flush = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    const next = pendingRef.current
    if (!next) return
    pendingRef.current = null
    // Stary kształt (`equipment`) czyścimy: od teraz liczą się tylko dni.
    void saveRef.current(project.id, { gearDays: next, equipment: [] })
  }, [project.id])

  // Wyjście z zakładki albo projektu nie może zgubić ostatniej zmiany.
  useEffect(() => flush, [flush])

  const commit = useCallback(
    (next: GearDay[]) => {
      setSavedDays(next)
      pendingRef.current = next
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(flush, SAVE_DELAY_MS)
    },
    [flush]
  )

  const [query, setQuery] = useState('')
  const [onlyUsed, setOnlyUsed] = useState(false)
  const [packingDay, setPackingDay] = useState('all')

  const summary = useMemo(
    () => summarizeProjectGear({ ...project, gearDays: days }, items),
    [project, days, items]
  )
  const usedIds = useMemo(() => new Set(summary.items.map((u) => u.itemId)), [summary])
  const valueById = useMemo(() => new Map(summary.items.map((u) => [u.itemId, u.rentValue])), [summary])

  /** Pozycje w siatce: bez wycofanych (chyba że były w tym projekcie), pogrupowane. */
  const groups = useMemo(() => {
    const needle = normalize(query.trim())
    const visible = items.filter(
      (item) =>
        (!item.retiredAt || usedIds.has(item.id)) &&
        (!onlyUsed || usedIds.has(item.id)) &&
        (!needle || normalize(item.name).includes(needle))
    )
    const map = new Map<string, EquipmentItem[]>()
    visible.forEach((item) => {
      const bucket = map.get(item.category) ?? []
      bucket.push(item)
      map.set(item.category, bucket)
    })
    return [...map.entries()]
      .sort(([a], [b]) => equipmentCategoryRank(a) - equipmentCategoryRank(b) || a.localeCompare(b, 'pl'))
      .map(([category, list]) => ({
        category,
        items: list.sort((a, b) => a.name.localeCompare(b.name, 'pl')),
      }))
  }, [items, usedIds, onlyUsed, query])

  const qtyOf = (day: GearDay, itemId: string) => day.lines.find((l) => l.itemId === itemId)?.qty ?? 0

  // Skąd się wzięły podpowiedziane dni — żeby było wiadomo, czemu są 3, a nie 1.
  const suggestionSource = useMemo(() => {
    if (savedDays) return null
    if (project.equipment.some((u) => u.days > 0)) return 'z wcześniej zaznaczonego sprzętu'
    const dates = projectShootDates(project.id, events)
    if (dates.length > 0) {
      return `z kalendarza (${dates.length} ${plural(dates.length, 'dzień zdjęciowy', 'dni zdjęciowe', 'dni zdjęciowych')})`
    }
    if (quoteShootDayCount(project.quote) > 0) return 'z liczby dni w wycenie'
    return null
  }, [savedDays, project, events])

  const packingDayExists = packingDay === 'all' || days.some((d) => d.id === packingDay)
  const packingDayId = packingDayExists && packingDay !== 'all' ? packingDay : undefined
  const packing = buildPackingList({ ...project, gearDays: days }, items, packingDayId)
  const packingIndex = days.findIndex((d) => d.id === packingDayId)
  const packingTitle =
    packingIndex === -1
      ? formatDate(project.date)
      : `${gearDayLabel(days[packingIndex], packingIndex)}${days[packingIndex].date ? ` · ${formatDate(days[packingIndex].date)}` : ''}`

  const printRef = useRef<HTMLDivElement>(null)
  // Ten sam mechanizm co wydruk oferty: react-to-print izoluje treść, więc nie
  // potrzeba globalnych reguł @media print, które kolidowałyby z eksportem PDF.
  const handlePrint = useReactToPrint({
    contentRef: printRef,
    pageStyle: `
      @page { size: A4; margin: 16mm 14mm; }
      @media print {
        body * { visibility: hidden !important; }
        #packing-list { visibility: visible !important; display: block !important; }
        #packing-list * { visibility: visible !important; }
      }
    `,
  })

  const counts = countsTowardRevenue(project.status)
  const gridColumns = `minmax(190px, 1fr) repeat(${days.length}, 64px) 84px`

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      {/* Widok do druku — normalnie ukryty */}
      <div id="packing-list" ref={printRef} className="hidden">
        <h1 className="text-xl font-bold">Lista pakowania: {project.name}</h1>
        <p className="mt-1 text-sm text-zinc-600">{packingTitle}</p>
        <hr className="mt-3 border-zinc-300" />
        {packing.map((group) => (
          <section key={group.category} className="mt-4 break-inside-avoid">
            <h2 className="text-xs font-bold uppercase tracking-widest">{equipmentCategoryLabel(group.category)}</h2>
            <ul className="mt-1">
              {group.items.map(({ item, qty, days: count }) => (
                <li key={item.id} className="flex items-center gap-2 py-0.5 text-sm">
                  <span className="inline-block size-3 border border-zinc-500" aria-hidden />
                  <span>
                    {qty > 1 ? `${qty}× ` : ''}
                    {item.name}
                  </span>
                  {!packingDayId && days.length > 1 && (
                    <span className="text-zinc-500">
                      ({count} {dayLabel(count)})
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-bold tracking-tight text-white">Sprzęt na planie</h2>
          <p className="mt-1 max-w-md text-xs text-zinc-500">
            Co realnie pojechało, dzień po dniu. Nie zmienia kwot wyceny. Liczy, ile sprzęt odpracował
            i zarobił, i układa listę pakowania.
          </p>
          {!counts && (
            <p className="mt-2 max-w-md text-xs text-amber-300/80">
              To jeszcze wycena: do statystyk sprzętu wejdzie, gdy projekt będzie w realizacji.
            </p>
          )}
        </div>
        <div className="flex gap-3">
          <SummaryTile
            label="Odpracował"
            value={pln(summary.rentValue)}
            hint="tyle kosztowałby rental"
            tone={summary.rentValue > 0 ? 'good' : 'muted'}
          />
          <EarnedTile summary={summary} />
        </div>
      </header>

      {isLoading ? null : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/10 py-12 text-center">
          <Package className="size-7 text-zinc-700" />
          <p className="mt-3 max-w-sm text-sm text-zinc-500">
            Katalog sprzętu jest pusty. Dodaj pozycje w sekcji „Sprzęt" w pasku bocznym, żeby móc je tutaj
            zaznaczać.
          </p>
        </div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[180px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-600" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Szukaj sprzętu"
                aria-label="Szukaj sprzętu"
                className="h-8 border-white/10 bg-black/40 pl-8 text-sm"
              />
            </div>
            <div className="flex rounded-lg border border-white/10 bg-black/30 p-0.5 text-xs" role="group">
              {[
                { value: false, label: 'Cały katalog' },
                { value: true, label: `Na planie (${usedIds.size})` },
              ].map((option) => (
                <button
                  key={option.label}
                  type="button"
                  aria-pressed={onlyUsed === option.value}
                  onClick={() => setOnlyUsed(option.value)}
                  className={`rounded-md px-2.5 py-1 transition-colors ${
                    onlyUsed === option.value ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => commit(addGearDay(days))}
              className="h-8 gap-1.5 border-white/10 text-xs"
            >
              <Plus className="size-3.5" />
              Dzień
            </Button>
          </div>

          {suggestionSource && (
            <p className="mb-2 text-[11px] text-zinc-500">
              Dni podpowiedziane {suggestionSource}. Zapiszą się przy pierwszej zmianie.
            </p>
          )}

          <div className="overflow-x-auto rounded-xl border border-white/5 bg-zinc-900/30">
            <div className="min-w-max">
              {/* Nagłówek: dni */}
              <div
                className="grid items-end gap-x-1 border-b border-white/5 bg-zinc-950/60 px-3 py-2"
                style={{ gridTemplateColumns: gridColumns }}
              >
                <div className="text-[11px] text-zinc-500">
                  Klik w nazwę: wszystkie dni · w kratkę: jeden dzień
                </div>
                {days.map((day, index) => (
                  <DayHeader
                    key={day.id}
                    day={day}
                    index={index}
                    canRemove={days.length > 1}
                    onRename={(label) => commit(updateGearDay(days, day.id, { label }))}
                    onDate={(date) => commit(updateGearDay(days, day.id, { date }))}
                    onDuplicate={() => commit(duplicateGearDay(days, day.id))}
                    onRemove={() => commit(removeGearDay(days, day.id))}
                  />
                ))}
                <div className="text-right text-[11px] text-zinc-500">Odpracował</div>
              </div>

              {days.length === 0 && (
                <div className="px-3 pt-4 text-center text-sm text-zinc-500">
                  Projekt nie ma dni zdjęciowych. Dodaj dzień przyciskiem „Dzień", żeby zaznaczać sprzęt.
                </div>
              )}

              {groups.length === 0 && (
                <div className="px-3 py-6 text-center text-sm text-zinc-600">
                  {onlyUsed ? 'Nic jeszcze nie zaznaczono.' : 'Nic nie pasuje do wyszukiwania.'}
                </div>
              )}

              {groups.map((group) => (
                <section key={group.category}>
                  <h3 className="px-3 pb-1 pt-3 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                    {equipmentCategoryLabel(group.category)}
                  </h3>
                  {group.items.map((item) => {
                    const owned = unitsOwned(item)
                    const value = valueById.get(item.id) ?? 0
                    const inAny = usedIds.has(item.id)
                    return (
                      <div
                        key={item.id}
                        className={`grid items-center gap-x-1 px-3 py-1 transition-colors hover:bg-white/[0.02] ${
                          inAny ? 'bg-emerald-500/[0.03]' : ''
                        }`}
                        style={{ gridTemplateColumns: gridColumns }}
                      >
                        <button
                          type="button"
                          onClick={() => commit(toggleGearItemAllDays(days, item.id, owned))}
                          title={days.length > 1 ? 'Wszystkie dni naraz' : undefined}
                          className="min-w-0 rounded-md px-1 py-1 text-left"
                        >
                          <div className={`truncate text-sm ${inAny ? 'text-zinc-100' : 'text-zinc-400'}`}>
                            {item.name}
                            {owned > 1 && <span className="ml-1.5 text-xs text-zinc-500">×{owned}</span>}
                            {item.retiredAt && (
                              <span className="ml-1.5 rounded bg-zinc-800 px-1 py-px text-[10px] text-zinc-400">
                                wycofany
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-zinc-600">
                            {item.rentalDayRate > 0
                              ? `${pln(item.rentalDayRate)}/dzień${owned > 1 ? ' za szt.' : ''}`
                              : 'bez stawki rentalowej'}
                          </div>
                        </button>
                        {days.map((day, index) => {
                          const qty = qtyOf(day, item.id)
                          const on = qty > 0
                          return (
                            <div key={day.id} className="flex justify-center">
                              <button
                                type="button"
                                aria-pressed={on}
                                aria-label={`${item.name}, ${gearDayLabel(day, index)}: ${on ? `${qty} szt.` : 'nie jedzie'}`}
                                title={owned > 1 ? 'Kliknij, żeby zmienić liczbę sztuk' : undefined}
                                onClick={() => commit(setGearLine(days, day.id, item.id, cycleGearQty(qty, owned)))}
                                className={`flex size-8 items-center justify-center rounded-lg border text-xs font-semibold tabular-nums transition-colors ${
                                  on
                                    ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                                    : 'border-white/10 text-zinc-700 hover:border-white/25 hover:text-zinc-400'
                                }`}
                              >
                                {on ? (owned > 1 ? qty : '✓') : '·'}
                              </button>
                            </div>
                          )
                        })}
                        <div
                          className={`text-right text-xs tabular-nums ${value > 0 ? 'text-emerald-400/80' : 'text-zinc-700'}`}
                        >
                          {value > 0 ? pln(value) : '—'}
                        </div>
                      </div>
                    )
                  })}
                </section>
              ))}

              {/* Stopka: odpracowane per dzień */}
              <div
                className="mt-2 grid items-center gap-x-1 border-t border-white/5 px-3 py-2"
                style={{ gridTemplateColumns: gridColumns }}
              >
                <div className="text-xs text-zinc-500">Odpracował w dniu</div>
                {summary.perDay.map((d) => (
                  <div key={d.dayId} className="text-center text-[11px] tabular-nums text-zinc-400">
                    {d.rentValue > 0 ? pln(d.rentValue) : '—'}
                  </div>
                ))}
                <div className="text-right text-sm font-semibold tabular-nums text-emerald-400">
                  {pln(summary.rentValue)}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Podgląd listy pakowania */}
      {packing.length > 0 || usedIds.size > 0 ? (
        <section className="mt-8 rounded-xl border border-white/10 bg-zinc-900/40 p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <PackageOpen className="size-4 text-zinc-500" />
            <h3 className="text-sm font-bold text-zinc-200">Lista pakowania</h3>
            <span className="text-xs text-zinc-600">
              {packing.reduce((n, g) => n + g.items.length, 0)}{' '}
              {itemLabel(packing.reduce((n, g) => n + g.items.length, 0))}
            </span>
            <div className="ml-auto flex items-center gap-2">
              {days.length > 1 && (
                <select
                  value={packingDayExists ? packingDay : 'all'}
                  onChange={(e) => setPackingDay(e.target.value)}
                  aria-label="Lista pakowania dla"
                  className="h-8 rounded-md border border-white/10 bg-black/40 px-2 text-xs text-zinc-200"
                >
                  <option value="all">Cały projekt</option>
                  {days.map((day, index) => (
                    <option key={day.id} value={day.id}>
                      {gearDayLabel(day, index)}
                      {day.date ? ` · ${shortDate(day.date)}` : ''}
                    </option>
                  ))}
                </select>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePrint()}
                disabled={packing.length === 0}
                className="h-8 gap-1.5 border-white/10 text-xs"
              >
                <Printer className="size-3.5" />
                Drukuj
              </Button>
            </div>
          </div>
          {packing.length === 0 ? (
            <p className="text-xs text-zinc-600">W tym dniu nic nie jedzie.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {packing.map((group) => (
                <div key={group.category}>
                  <div className="text-[11px] font-bold uppercase tracking-wide text-zinc-500">
                    {equipmentCategoryLabel(group.category)}
                  </div>
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {group.items.map(({ item, qty, days: count }) => (
                      <li key={item.id} className="flex justify-between gap-2 text-sm text-zinc-300">
                        <span className="truncate">
                          {qty > 1 && <span className="text-zinc-500">{qty}× </span>}
                          {item.name}
                        </span>
                        {!packingDayId && days.length > 1 && (
                          <span className="shrink-0 tabular-nums text-zinc-500">
                            {count} {dayLabel(count)}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  )
}

function SummaryTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string
  hint: string
  tone: 'good' | 'muted'
}) {
  return (
    <div className="min-w-[132px] rounded-xl border border-white/5 bg-zinc-900/40 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`tabular-nums text-lg font-bold ${tone === 'good' ? 'text-emerald-400' : 'text-zinc-400'}`}>
        {value}
      </div>
      <div className="text-[11px] text-zinc-600">{hint}</div>
    </div>
  )
}

/** „Zarobił": ile klient zapłacił za sprzęt w tym projekcie (z wyceny, szacunek). */
function EarnedTile({ summary }: { summary: ReturnType<typeof summarizeProjectGear> }) {
  const { revenue } = summary
  if (!revenue) {
    return <SummaryTile label="Zarobił" value="—" hint="projekt bez wyceny" tone="muted" />
  }
  if (revenue.charged <= 0) {
    return <SummaryTile label="Zarobił" value={pln(0)} hint="wycena nie nalicza sprzętu" tone="muted" />
  }
  const unassigned = summary.clientPaidAssigned === 0 && revenue.ownGear > 0
  const hint = unassigned
    ? 'zaznacz sprzęt, żeby przypisać'
    : revenue.rentedIn > 0
      ? `z ${pln(revenue.charged)}, −${pln(revenue.rentedIn)} rental`
      : 'szacunek z wyceny'
  return (
    <SummaryTile
      label="Zarobił"
      value={`~${pln(revenue.ownGear)}`}
      hint={hint}
      tone={unassigned || revenue.ownGear <= 0 ? 'muted' : 'good'}
    />
  )
}

function DayHeader({
  day,
  index,
  canRemove,
  onRename,
  onDate,
  onDuplicate,
  onRemove,
}: {
  day: GearDay
  index: number
  canRemove: boolean
  onRename: (label: string) => void
  onDate: (date: string) => void
  onDuplicate: () => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const label = gearDayLabel(day, index)

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setConfirm(false)
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex min-w-0 flex-col items-center rounded-md px-1 py-1 text-center transition-colors hover:bg-white/5"
          aria-label={`${label}: zmień nazwę, datę albo usuń`}
        >
          <span className="w-full truncate text-xs font-semibold text-zinc-200">{label}</span>
          <span className="text-[10px] tabular-nums text-zinc-500">{day.date ? shortDate(day.date) : 'bez daty'}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-64 border-white/10 bg-zinc-950 p-3 text-white">
        <div className="flex flex-col gap-2">
          <label className="text-[11px] text-zinc-500">
            Nazwa dnia
            <Input
              value={day.label}
              placeholder={`Dzień ${index + 1}`}
              onChange={(e) => onRename(e.target.value)}
              className="mt-1 h-8 border-white/10 bg-black/40 text-sm"
            />
          </label>
          <label className="text-[11px] text-zinc-500">
            Data
            <Input
              type="date"
              value={day.date}
              onChange={(e) => onDate(e.target.value)}
              className="mt-1 h-8 border-white/10 bg-black/40 text-sm [color-scheme:dark]"
            />
          </label>
          <div className="mt-1 flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onDuplicate()
                setOpen(false)
              }}
              className="h-8 flex-1 gap-1.5 border-white/10 text-xs"
            >
              <Copy className="size-3.5" />
              Powiel
            </Button>
            {canRemove &&
              (confirm ? (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    onRemove()
                    setOpen(false)
                  }}
                  className="h-8 flex-1 text-xs"
                >
                  Usuń dzień
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (day.lines.length > 0) {
                      setConfirm(true)
                      return
                    }
                    onRemove()
                    setOpen(false)
                  }}
                  className="h-8 flex-1 gap-1.5 text-xs text-zinc-400 hover:text-red-400"
                >
                  <Trash2 className="size-3.5" />
                  Usuń
                </Button>
              ))}
          </div>
          {confirm && (
            <p className="text-[11px] text-zinc-500">
              W tym dniu jest {day.lines.length} {itemLabel(day.lines.length)}. Kliknij jeszcze raz, żeby usunąć.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
