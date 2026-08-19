'use client'

/**
 * Sprzęt w obrębie projektu: co realnie zabieramy i na ile dni.
 *
 * Ta sekcja NIE zmienia kwot wyceny — to świadomy wymóg. Daje dwie rzeczy:
 * listę pakowania oraz podstawę do liczenia, ile własny sprzęt „zarobił na
 * siebie", zastępując rental.
 */

import { useMemo, useRef } from 'react'
import { useReactToPrint } from 'react-to-print'
import { Package, PackageOpen, Printer } from 'lucide-react'
import { useEquipment } from '@/lib/equipment-context'
import { useProjectHub } from '@/lib/project-hub-context'
import { buildPackingList, computeEquipmentRoi } from '@/lib/equipment-roi'
import {
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_CATEGORY_LABELS,
  type EquipmentCategory,
  type Project,
} from '@/lib/project-types'
import { dayLabel, itemLabel } from '@/lib/pl-plural'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'

/** `YYYY-MM-DD` → `DD.MM.YYYY` na potrzeby wydruku. */
function formatDate(dateKey: string): string {
  const [y, m, d] = dateKey.split('-')
  return y && m && d ? `${d}.${m}.${y}` : dateKey
}

function pln(amount: number): string {
  return `${Math.round(amount).toLocaleString('pl-PL', { useGrouping: 'always' })} zł`
}

/** Domyślna liczba dni przy zaznaczeniu — dni zdjęciowe z wyceny, minimum 1. */
function defaultDaysFor(project: Project): number {
  const raw = (project.quote as { data?: { dniZdjeciowe?: unknown } })?.data?.dniZdjeciowe
  const days = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : 0
  return days > 0 ? days : 1
}

export function ProjectEquipment() {
  const { items, isLoading } = useEquipment()
  const { activeProject, updateActiveProject } = useProjectHub()
  const printRef = useRef<HTMLDivElement>(null)

  const usageMap = useMemo(() => {
    const map = new Map<string, number>()
    activeProject?.equipment.forEach((u) => map.set(u.itemId, u.days))
    return map
  }, [activeProject])

  const grouped = useMemo(() => {
    const map = new Map<EquipmentCategory, typeof items>()
    items.forEach((item) => {
      const bucket = map.get(item.category) ?? []
      bucket.push(item)
      map.set(item.category, bucket)
    })
    return map
  }, [items])

  if (!activeProject) return null

  const setUsage = (itemId: string, days: number) => {
    const others = activeProject.equipment.filter((u) => u.itemId !== itemId)
    const next = days > 0 ? [...others, { itemId, days }] : others
    updateActiveProject({ equipment: next })
  }

  const toggle = (itemId: string, checked: boolean) => {
    setUsage(itemId, checked ? defaultDaysFor(activeProject) : 0)
  }

  const packing = buildPackingList(activeProject, items)
  const selectedCount = activeProject.equipment.filter((u) => u.days > 0).length

  // Wartość „odpracowana" przez zaznaczony sprzęt w TYM projekcie.
  const projectEarned = activeProject.equipment.reduce((sum, usage) => {
    const item = items.find((i) => i.id === usage.itemId)
    return item ? sum + usage.days * item.rentalDayRate : sum
  }, 0)

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

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      {/* Widok do druku — normalnie ukryty */}
      <div id="packing-list" ref={printRef} className="hidden">
        <h1 className="text-xl font-bold">Lista pakowania — {activeProject.name}</h1>
        <p className="mt-1 text-sm text-zinc-600">{formatDate(activeProject.date)}</p>
        <hr className="mt-3 border-zinc-300" />
        {packing.map((group) => (
          <section key={group.category} className="mt-4 break-inside-avoid">
            <h2 className="text-xs font-bold uppercase tracking-widest">
              {EQUIPMENT_CATEGORY_LABELS[group.category as EquipmentCategory] ?? group.category}
            </h2>
            <ul className="mt-1">
              {group.items.map(({ item, days }) => (
                <li key={item.id} className="flex items-center gap-2 py-0.5 text-sm">
                  <span className="inline-block size-3 border border-zinc-500" aria-hidden />
                  <span>{item.name}</span>
                  <span className="text-zinc-500">({days} {dayLabel(days)})</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div>
        <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-white">Sprzęt na planie</h2>
            <p className="mt-1 max-w-lg text-xs text-zinc-500">
              Zaznacz, co realnie zabierasz. Nie wpływa to na kwoty w wycenie — służy liście
              pakowania i rentowności sprzętu.
            </p>
          </div>
          {selectedCount > 0 && (
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="text-[11px] uppercase tracking-wide text-zinc-500">
                  Zastąpiony rental
                </div>
                <div className="tabular-nums font-bold text-emerald-400">{pln(projectEarned)}</div>
              </div>
              <Button variant="outline" onClick={() => handlePrint()} className="h-9 gap-2">
                <Printer className="size-4" />
                Drukuj listę
              </Button>
            </div>
          )}
        </header>

        {isLoading ? null : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/10 py-12 text-center">
            <Package className="size-7 text-zinc-700" />
            <p className="mt-3 max-w-sm text-sm text-zinc-500">
              Katalog sprzętu jest pusty. Dodaj pozycje w sekcji „Sprzęt", żeby móc je tutaj
              zaznaczać.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {EQUIPMENT_CATEGORIES.filter((c) => grouped.has(c)).map((category) => (
              <section key={category}>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-zinc-500">
                  {EQUIPMENT_CATEGORY_LABELS[category]}
                </h3>
                <div className="flex flex-col gap-1.5">
                  {(grouped.get(category) ?? []).map((item) => {
                    const days = usageMap.get(item.id) ?? 0
                    const checked = days > 0
                    const roi = computeEquipmentRoi(item, [activeProject])
                    return (
                      <div
                        key={item.id}
                        className={`flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 transition-colors ${
                          checked
                            ? 'border-emerald-500/20 bg-emerald-500/5'
                            : 'border-white/5 bg-zinc-900/30'
                        }`}
                      >
                        <Checkbox
                          id={`eq-${item.id}`}
                          checked={checked}
                          onCheckedChange={(v) => toggle(item.id, Boolean(v))}
                          aria-label={`Zabierz ${item.name}`}
                        />
                        <label
                          htmlFor={`eq-${item.id}`}
                          className="min-w-0 flex-1 cursor-pointer truncate text-sm text-zinc-200"
                        >
                          {item.name}
                          {item.rentalDayRate > 0 && (
                            <span className="ml-2 text-xs text-zinc-600">
                              {pln(item.rentalDayRate)}/dzień
                            </span>
                          )}
                        </label>

                        {checked && (
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              min={1}
                              value={days}
                              onChange={(e) => {
                                const next = Math.max(0, Math.floor(Number(e.target.value) || 0))
                                setUsage(item.id, next)
                              }}
                              aria-label={`Liczba dni dla ${item.name}`}
                              className="h-7 w-16 border-white/10 bg-black/40 text-center text-sm tabular-nums"
                            />
                            <span className="text-xs text-zinc-500">{dayLabel(days)}</span>
                            {roi.earned > 0 && (
                              <span className="w-20 text-right tabular-nums text-xs text-emerald-400/80">
                                {pln(roi.earned)}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        )}

        {/* Podgląd listy pakowania */}
        {packing.length > 0 && (
          <section className="mt-8 rounded-xl border border-white/10 bg-zinc-900/40 p-4">
            <div className="mb-3 flex items-center gap-2">
              <PackageOpen className="size-4 text-zinc-500" />
              <h3 className="text-sm font-bold text-zinc-200">Lista pakowania</h3>
              <span className="text-xs text-zinc-600">
                {selectedCount} {itemLabel(selectedCount)}
              </span>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {packing.map((group) => (
                <div key={group.category}>
                  <div className="text-[11px] font-bold uppercase tracking-wide text-zinc-500">
                    {EQUIPMENT_CATEGORY_LABELS[group.category as EquipmentCategory] ?? group.category}
                  </div>
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {group.items.map(({ item, days }) => (
                      <li key={item.id} className="flex justify-between text-sm text-zinc-300">
                        <span className="truncate">{item.name}</span>
                        <span className="shrink-0 tabular-nums text-zinc-500">
                          {days} {dayLabel(days)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
