'use client'

/**
 * Mój sprzęt w wycenie (plan G5): wybór z katalogu w dniu zdjęciowym, rabat
 * na sprzęt dla całej wyceny, „gratis" per pozycja i sprzęt z wypożyczalni.
 *
 * Ceny: stawka rentalowa × sztuki, minus rabat, BEZ marży z nagłówka; stawka
 * i nazwa zamrożone w chwili dodania (`lib/quote-gear.ts`). Zestawy (G6)
 * dodają kilka pozycji jednym klikiem.
 */

import { useMemo, useState } from 'react'
import { Check, Gift, Layers, Minus, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react'
import { useQuote } from '@/lib/quote-context'
import { useEquipment } from '@/lib/equipment-context'
import { useCrew } from '@/lib/crew-context'
import { addKitCrewToQuote, kitCrewFromLines } from '@/lib/quote-crew'
import {
  addKitToQuoteGear,
  dayGearFigures,
  quoteGearFigures,
  refreshGearLines,
  setQuoteGearLine,
  staleGearLines,
} from '@/lib/quote-gear'
import {
  equipmentCategoryLabel,
  equipmentCategoryRank,
  unitsOwned,
  type EquipmentItem,
  type GearKit,
} from '@/lib/project-types'
import {
  createExternalRentalId,
  type QuoteExternalRental,
  type QuoteGearLine,
  type ShootingDay,
} from '@/lib/quote-types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'

function normalize(text: string): string {
  return text.toLocaleLowerCase('pl').normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

function amountOf(text: string): number {
  const value = Number(text.replace(',', '.'))
  return Number.isFinite(value) && value > 0 ? value : 0
}

// ── Panel całej wyceny ───────────────────────────────────────────────────────

/** Rabat na sprzęt, sumy, PDF i odświeżenie stawek — nad dniami zdjęciowymi. */
export function GearQuotePanel() {
  const { data, updateField, updateShootingDay, formatCurrency } = useQuote()
  const { items } = useEquipment()
  const figures = useMemo(() => quoteGearFigures(data), [data])
  const days = data.detailedShootingDays ?? []
  const stale = useMemo(() => staleGearLines(days, items), [days, items])
  const noRate = useMemo(() => {
    const used = new Set(days.flatMap((d) => (d.gear ?? []).map((l) => l.itemId)))
    return items.filter((i) => used.has(i.id) && i.rentalDayRate <= 0).length
  }, [days, items])

  if (!figures.hasCatalogGear && figures.external <= 0) {
    return (
      <p className="rounded-xl border border-white/5 bg-zinc-900/30 px-4 py-3 text-xs text-zinc-500">
        Sprzęt dobierasz w każdym dniu z własnego katalogu („Dodaj z mojego sprzętu"). Cena = stawka rentalowa ×
        sztuki, a tutaj pojawi się rabat na sprzęt dla całej wyceny.
      </p>
    )
  }

  const refresh = () => {
    days.forEach((day) => {
      if (day.gear?.length) updateShootingDay(day.id, 'gear', refreshGearLines(day.gear, items))
    })
  }

  return (
    <div className="rounded-xl border border-white/10 bg-zinc-900/40 p-4 backdrop-blur-xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-semibold text-white">Mój sprzęt w wycenie</p>
          <p className="mt-0.5 text-xs text-zinc-400">
            Stawki rentalowe z katalogu, bez marży. Rabat obniża cały mój sprzęt, „gratis" zeruje pozycję.
          </p>
        </div>
        <div className="text-right text-xs tabular-nums">
          <div className="text-zinc-400">
            wartość <span className="text-zinc-200">{formatCurrency(Math.round(figures.value))}</span>
          </div>
          {figures.discount > 0 && (
            <div className="text-amber-300/80">rabat i gratisy −{formatCurrency(Math.round(figures.discount))}</div>
          )}
          <div className="text-sm font-semibold text-emerald-400">
            w wycenie {formatCurrency(Math.round(figures.charged))}
          </div>
          {figures.external > 0 && (
            <div className="text-zinc-500">+ wypożyczalnia {formatCurrency(Math.round(figures.external))}</div>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-4">
        <span className="w-24 shrink-0 text-xs text-zinc-400">Rabat na sprzęt</span>
        <Slider
          value={[data.gearDiscountPercent]}
          min={0}
          max={100}
          step={5}
          onValueChange={([v]) => updateField('gearDiscountPercent', v)}
          aria-label="Rabat na mój sprzęt"
          className="flex-1"
        />
        <span className="w-12 text-right text-sm font-semibold tabular-nums text-white">{data.gearDiscountPercent}%</span>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          <Switch
            checked={data.gearValueInPdf}
            onCheckedChange={(v) => updateField('gearValueInPdf', v)}
            aria-label="W PDF pokaż wartość sprzętu i rabat"
          />
          W PDF pokaż wartość sprzętu i rabat
        </label>
        {stale > 0 && (
          <button
            type="button"
            onClick={refresh}
            className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/30 px-2.5 py-1 text-xs text-amber-200 hover:bg-amber-500/10"
          >
            <RefreshCw className="size-3.5" />
            {stale} {stale === 1 ? 'pozycja ma' : 'pozycje mają'} inną stawkę niż katalog · zaktualizuj
          </button>
        )}
      </div>
      {noRate > 0 && (
        <p className="mt-2 text-xs text-amber-300/80">
          {noRate} {noRate === 1 ? 'pozycja nie ma' : 'pozycje nie mają'} stawki rentalowej w katalogu, więc liczy się
          za 0 zł. Uzupełnij stawkę w sekcji Sprzęt, potem „zaktualizuj".
        </p>
      )}
    </div>
  )
}

// ── Sprzęt w dniu ────────────────────────────────────────────────────────────

export function DayGearSection({
  day,
  onUpdate,
}: {
  day: ShootingDay
  onUpdate: <K extends keyof ShootingDay>(field: K, value: ShootingDay[K]) => void
}) {
  const { data, formatCurrency } = useQuote()
  const { items, kits, addKit } = useEquipment()
  // Zestawy niosą też ekipę (T9b): dodanie zestawu dokłada role i ludzi do dnia.
  const { roles, people } = useCrew()
  const crewLines = day.crew ?? []
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  const lines = day.gear ?? []
  const rentals = day.externalRentals ?? []
  const discount = data.gearDiscountPercent
  const factor = 1 - discount / 100
  const figures = dayGearFigures(day, discount)

  const setGear = (next: QuoteGearLine[]) => onUpdate('gear', next)
  const setRentals = (next: QuoteExternalRental[]) => onUpdate('externalRentals', next)

  const setQty = (line: QuoteGearLine, qty: number) => {
    if (qty <= 0) return setGear(lines.filter((l) => l.itemId !== line.itemId))
    setGear(lines.map((l) => (l.itemId === line.itemId ? { ...l, qty } : l)))
  }
  const toggleGratis = (line: QuoteGearLine) =>
    setGear(lines.map((l) => (l.itemId === line.itemId ? { ...l, gratis: !l.gratis || undefined } : l)))

  const [kitName, setKitName] = useState<string | null>(null)
  const saveKit = async () => {
    if (!kitName?.trim()) return
    await addKit(kitName, lines, kitCrewFromLines(crewLines))
    setKitName(null)
  }

  return (
    <div className="space-y-2">
      {lines.length > 0 && (
        <ul className="space-y-1">
          {lines.map((line) => {
            const item = byId.get(line.itemId)
            const owned = item ? unitsOwned(item) : line.qty
            const value = line.rate * line.qty
            const charged = line.gratis ? 0 : value * factor
            return (
              <li
                key={line.itemId}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-1.5"
              >
                <div className="min-w-[140px] flex-1">
                  <div className="truncate text-sm text-zinc-100">
                    {line.name}
                    {!item && <span className="ml-1.5 text-[10px] text-amber-300/70">usunięty z katalogu</span>}
                  </div>
                  <div className="text-[11px] text-zinc-500">
                    {line.rate > 0 ? `${formatCurrency(line.rate)}/dzień${line.qty > 1 ? ' za szt.' : ''}` : 'bez stawki'}
                  </div>
                </div>
                {owned > 1 || line.qty > 1 ? (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setQty(line, line.qty - 1)}
                      aria-label={`Mniej: ${line.name}`}
                      className="flex size-6 items-center justify-center rounded border border-white/10 text-zinc-400 hover:text-white"
                    >
                      <Minus className="size-3" />
                    </button>
                    <span className="w-6 text-center text-sm tabular-nums text-zinc-200">{line.qty}</span>
                    <button
                      type="button"
                      onClick={() => setQty(line, line.qty + 1)}
                      disabled={line.qty >= owned}
                      aria-label={`Więcej: ${line.name}`}
                      className="flex size-6 items-center justify-center rounded border border-white/10 text-zinc-400 hover:text-white disabled:opacity-30"
                    >
                      <Plus className="size-3" />
                    </button>
                  </div>
                ) : null}
                <button
                  type="button"
                  aria-pressed={!!line.gratis}
                  onClick={() => toggleGratis(line)}
                  title="Gratis: jedzie na plan, klient za to nie płaci"
                  className={`inline-flex h-6 items-center gap-1 rounded-md border px-1.5 text-[11px] transition-colors ${
                    line.gratis
                      ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                      : 'border-white/10 text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  <Gift className="size-3" />
                  gratis
                </button>
                <div className="w-24 text-right text-sm tabular-nums">
                  {charged < value && <div className="text-[11px] text-zinc-600 line-through">{formatCurrency(Math.round(value))}</div>}
                  <div className={line.gratis ? 'text-amber-200/80' : 'text-zinc-200'}>
                    {formatCurrency(Math.round(charged))}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setQty(line, 0)}
                  aria-label={`Usuń ${line.name}`}
                  className="text-zinc-600 hover:text-red-400"
                >
                  <X className="size-4" />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {rentals.length > 0 && (
        <ul className="space-y-1">
          {rentals.map((rental) => (
            <li key={rental.id} className="flex items-center gap-2">
              <Input
                value={rental.label}
                placeholder="Sprzęt z wypożyczalni, np. obiektywy Cooke"
                onChange={(e) =>
                  setRentals(rentals.map((r) => (r.id === rental.id ? { ...r, label: e.target.value } : r)))
                }
                aria-label="Co z wypożyczalni"
                className="h-8 flex-1 border-white/10 bg-black/40 text-sm"
              />
              <Input
                inputMode="decimal"
                value={rental.amount ? String(rental.amount) : ''}
                placeholder="zł"
                onChange={(e) =>
                  setRentals(rentals.map((r) => (r.id === rental.id ? { ...r, amount: amountOf(e.target.value) } : r)))
                }
                aria-label="Kwota za wypożyczalnię (dla klienta = mój koszt)"
                className="h-8 w-24 border-white/10 bg-black/40 text-right text-sm tabular-nums"
              />
              <button
                type="button"
                onClick={() => setRentals(rentals.filter((r) => r.id !== rental.id))}
                aria-label="Usuń wypożyczalnię"
                className="text-zinc-600 hover:text-red-400"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <GearPicker
          items={items}
          kits={kits}
          lines={lines}
          onToggle={(item) =>
            setGear(setQuoteGearLine(lines, item, lines.some((l) => l.itemId === item.id) ? 0 : unitsOwned(item)))
          }
          onKit={(kit) => {
            if (kit.lines.length > 0) setGear(addKitToQuoteGear(lines, kit.lines, items))
            if (kit.crew?.length) onUpdate('crew', addKitCrewToQuote(crewLines, kit.crew, roles, people))
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setRentals([...rentals, { id: createExternalRentalId(), label: '', amount: 0 }])}
          className="h-8 gap-1.5 text-xs text-zinc-400"
        >
          <Plus className="size-3.5" />
          Z wypożyczalni
        </Button>
        {(lines.length > 0 || crewLines.length > 0) &&
          (kitName === null ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setKitName('')}
              className="h-8 gap-1.5 text-xs text-zinc-500"
            >
              <Layers className="size-3.5" />
              Zapisz jako zestaw
            </Button>
          ) : (
            <span className="flex items-center gap-1">
              <Input
                autoFocus
                value={kitName}
                placeholder="Nazwa zestawu"
                onChange={(e) => setKitName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveKit()
                  if (e.key === 'Escape') setKitName(null)
                }}
                aria-label="Nazwa zestawu"
                className="h-8 w-40 border-white/10 bg-black/40 text-sm"
              />
              <Button type="button" size="sm" onClick={() => void saveKit()} disabled={!kitName.trim()} className="h-8">
                Zapisz
              </Button>
            </span>
          ))}
        {(figures.value > 0 || figures.external > 0) && (
          <span className="ml-auto text-xs tabular-nums text-zinc-500">
            sprzęt w dniu {formatCurrency(Math.round(figures.charged + figures.external))}
          </span>
        )}
      </div>
    </div>
  )
}

function GearPicker({
  items,
  kits,
  lines,
  onToggle,
  onKit,
}: {
  items: EquipmentItem[]
  kits: GearKit[]
  lines: QuoteGearLine[]
  onToggle: (item: EquipmentItem) => void
  onKit: (kit: GearKit) => void
}) {
  const [query, setQuery] = useState('')
  const inDay = new Set(lines.map((l) => l.itemId))
  const needle = normalize(query.trim())

  const groups = useMemo(() => {
    const map = new Map<string, EquipmentItem[]>()
    items
      .filter((item) => !item.retiredAt && (!needle || normalize(item.name).includes(needle)))
      .forEach((item) => {
        const bucket = map.get(item.category) ?? []
        bucket.push(item)
        map.set(item.category, bucket)
      })
    return [...map.entries()]
      .sort(([a], [b]) => equipmentCategoryRank(a) - equipmentCategoryRank(b) || a.localeCompare(b, 'pl'))
      .map(([category, list]) => ({ category, items: list.sort((a, b) => a.name.localeCompare(b.name, 'pl')) }))
  }, [items, needle])

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 border-white/10 text-xs">
          <Plus className="size-3.5" />
          Dodaj z mojego sprzętu
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 border-white/10 bg-zinc-950 p-0 text-white">
        <div className="border-b border-white/5 p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-600" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Szukaj sprzętu"
              aria-label="Szukaj sprzętu"
              className="h-8 border-white/10 bg-black/40 pl-8 text-sm"
            />
          </div>
        </div>
        <div className="max-h-80 overflow-y-auto p-1">
          {items.length === 0 && (
            <p className="px-2 py-4 text-center text-xs text-zinc-500">
              Katalog jest pusty. Dodaj sprzęt w sekcji „Sprzęt" w pasku bocznym.
            </p>
          )}
          {kits.length > 0 && !needle && (
            <div className="mb-1">
              <div className="px-2 pb-1 pt-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Zestawy</div>
              {kits.map((kit) => (
                <button
                  key={kit.id}
                  type="button"
                  onClick={() => onKit(kit)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-zinc-200 hover:bg-white/5"
                >
                  <Layers className="size-3.5 shrink-0 text-zinc-500" />
                  <span className="flex-1 truncate">{kit.name}</span>
                  <span className="text-[11px] text-zinc-500">
                    {kit.lines.length} poz.{kit.crew?.length ? ` · ekipa ${kit.crew.length}` : ''}
                  </span>
                </button>
              ))}
            </div>
          )}
          {groups.map((group) => (
            <div key={group.category}>
              <div className="px-2 pb-1 pt-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                {equipmentCategoryLabel(group.category)}
              </div>
              {group.items.map((item) => {
                const on = inDay.has(item.id)
                const units = unitsOwned(item)
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => onToggle(item)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-white/5"
                  >
                    <span
                      className={`flex size-4 shrink-0 items-center justify-center rounded border ${
                        on ? 'border-emerald-500/60 bg-emerald-500/20 text-emerald-300' : 'border-white/15'
                      }`}
                    >
                      {on && <Check className="size-3" />}
                    </span>
                    <span className="flex-1 truncate text-sm text-zinc-200">
                      {item.name}
                      {units > 1 && <span className="ml-1 text-xs text-zinc-500">×{units}</span>}
                    </span>
                    <span className={`text-[11px] tabular-nums ${item.rentalDayRate > 0 ? 'text-zinc-500' : 'text-amber-300/70'}`}>
                      {item.rentalDayRate > 0 ? `${Math.round(item.rentalDayRate)} zł` : 'bez stawki'}
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
