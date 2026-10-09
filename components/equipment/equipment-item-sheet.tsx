'use client'

/**
 * Panel jednej pozycji sprzętu: edycja (nazwa, kategoria, sztuki, cena i data
 * zakupu, stawka rentalowa, notatki), statystyki, historia projektów oraz
 * wycofanie / usunięcie. `item === null` = dodawanie nowej pozycji.
 */

import { useMemo, useState } from 'react'
import { ArrowUpRight, RotateCcw, Trash2 } from 'lucide-react'
import { useEquipment } from '@/lib/equipment-context'
import { useProjectHub } from '@/lib/project-hub-context'
import { itemUsageHistory, type EquipmentRoi } from '@/lib/equipment-roi'
import {
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_CATEGORY_LABELS,
  equipmentCategoryLabel,
  toDateKey,
  type EquipmentItem,
} from '@/lib/project-types'
import { dayLabel } from '@/lib/pl-plural'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

const CUSTOM = '__custom__'
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

function pln(amount: number): string {
  return `${Math.round(amount).toLocaleString('pl-PL', { useGrouping: 'always' })} zł`
}

function formatDate(dateKey: string | null | undefined): string {
  if (!dateKey) return '—'
  const [y, m, d] = dateKey.split('-')
  return y && m && d ? `${d}.${m}.${y}` : dateKey
}

/**
 * Prognoza spłaty `YYYY-MM` → „~maj 2027". Ponad 10 lat naprzód to w praktyce
 * „nie przy tym tempie" — konkretny miesiąc w 2042 udawałby precyzję.
 */
export function formatPayoff(monthKey: string, now: Date = new Date()): string {
  const [y, m] = monthKey.split('-').map(Number)
  if (!y || !m) return monthKey
  const monthsAhead = (y - now.getFullYear()) * 12 + (m - 1 - now.getMonth())
  if (monthsAhead > 120) return 'ponad 10 lat'
  return `~${new Date(y, m - 1, 1).toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' })}`
}

interface Draft {
  name: string
  category: string
  customCategory: string
  quantity: string
  purchasePrice: string
  purchaseDate: string
  rentalDayRate: string
  notes: string
}

function toDraft(item: EquipmentItem | null, knownCategories: string[]): Draft {
  const category = item?.category ?? 'kamery'
  const known = knownCategories.includes(category)
  return {
    name: item?.name ?? '',
    category: known ? category : CUSTOM,
    customCategory: known ? '' : category,
    quantity: String(item?.quantity ?? 1),
    purchasePrice: item?.purchasePrice ? String(item.purchasePrice) : '',
    purchaseDate: item?.purchaseDate ?? '',
    rentalDayRate: item?.rentalDayRate ? String(item.rentalDayRate) : '',
    notes: item?.notes ?? '',
  }
}

function amount(text: string): number {
  const value = Number(text.replace(',', '.'))
  return Number.isFinite(value) && value > 0 ? value : 0
}

export function EquipmentItemSheet({
  item,
  roi,
  onClose,
  onOpenProject,
}: {
  item: EquipmentItem | null
  roi: EquipmentRoi | undefined
  onClose: () => void
  onOpenProject?: (id: string) => void
}) {
  const { items, addItem, updateItem, removeItem } = useEquipment()
  const { projects } = useProjectHub()

  // Kategorie do wyboru: znane + własne, już użyte w katalogu.
  const categories = useMemo(() => {
    const custom = [...new Set(items.map((i) => i.category))].filter(
      (c) => !(EQUIPMENT_CATEGORIES as readonly string[]).includes(c)
    )
    return [...EQUIPMENT_CATEGORIES, ...custom.sort((a, b) => a.localeCompare(b, 'pl'))]
  }, [items])

  const [draft, setDraft] = useState<Draft>(() => toDraft(item, categories))
  const [retireDate, setRetireDate] = useState(() => toDateKey(new Date()))
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [saved, setSaved] = useState(false)

  const history = useMemo(
    () => (item ? itemUsageHistory(item.id, projects, items) : []),
    [item, projects, items]
  )

  const set = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }))
    setSaved(false)
  }

  const category = (draft.category === CUSTOM ? draft.customCategory.trim() : draft.category) || 'inne'
  const quantity = Math.max(1, Math.floor(amount(draft.quantity)) || 1)
  const canSave = draft.name.trim().length > 0

  const save = async () => {
    if (!canSave) return
    const fields = {
      name: draft.name.trim(),
      category,
      purchasePrice: amount(draft.purchasePrice),
      rentalDayRate: amount(draft.rentalDayRate),
      purchaseDate: DATE_KEY.test(draft.purchaseDate) ? draft.purchaseDate : '',
      notes: draft.notes,
    }
    if (!item) {
      await addItem({ ...fields, quantity })
      onClose()
      return
    }
    const next: EquipmentItem = { ...item, ...fields }
    if (quantity > 1) next.quantity = quantity
    else delete next.quantity
    await updateItem(next)
    setSaved(true)
  }

  const retire = async () => {
    if (!item || !DATE_KEY.test(retireDate)) return
    await updateItem({ ...item, retiredAt: retireDate })
  }

  const restore = async () => {
    if (!item) return
    const next: EquipmentItem = { ...item }
    delete next.retiredAt
    await updateItem(next)
  }

  const label = 'text-[11px] text-zinc-500'
  const field = 'mt-1 h-9 border-white/10 bg-black/40 text-sm'

  return (
    <div className="flex flex-col gap-6">
      <header>
        <div className="text-[11px] uppercase tracking-widest text-zinc-500">
          {item ? equipmentCategoryLabel(item.category) : 'Nowy sprzęt'}
        </div>
        <h2 className="mt-1 text-xl font-bold tracking-tight text-white">{item ? item.name : 'Dodaj sprzęt'}</h2>
        {item?.retiredAt && (
          <div className="mt-1 text-xs text-amber-300/80">Wycofany {formatDate(item.retiredAt)}</div>
        )}
      </header>

      {item && roi && (
        <section className="grid grid-cols-2 gap-2">
          <Stat
            label="Odpracował"
            value={pln(roi.rentValue)}
            sub={roi.rentValuePct === null ? 'brak ceny zakupu' : `${Math.round(roi.rentValuePct)}% ceny zakupu`}
            good={roi.rentValue > 0}
          />
          <Stat
            label="Zarobił"
            value={`~${pln(roi.clientPaid)}`}
            sub={roi.clientPaidPct === null ? 'szacunek z wycen' : `${Math.round(roi.clientPaidPct)}% ceny zakupu`}
            good={roi.clientPaid > 0}
          />
          <Stat
            label="Na planie"
            value={`${roi.daysUsed} ${dayLabel(roi.daysUsed)}`}
            sub={
              roi.projectsUsed === 0
                ? 'jeszcze nieużywany'
                : `${roi.projectsUsed} proj.${roi.daysPerMonth !== null ? ` · ${roi.daysPerMonth.toLocaleString('pl-PL', { maximumFractionDigits: 1 })} dni/mies.` : ''}`
            }
          />
          <Stat
            label="Spłata"
            value={
              roi.paidOffByRent
                ? 'spłacony'
                : roi.rentPayoffMonth
                  ? formatPayoff(roi.rentPayoffMonth)
                  : '—'
            }
            sub={
              roi.paidOffByClients
                ? 'klienci też już zapłacili'
                : roi.clientPayoffMonth
                  ? `z zapłat klientów ${formatPayoff(roi.clientPayoffMonth)}`
                  : roi.invested > 0
                    ? 'przy obecnym tempie'
                    : 'podaj cenę zakupu'
            }
          />
          <div className="col-span-2 text-[11px] text-zinc-600">
            Pierwsze użycie {formatDate(roi.firstUsed)} · ostatnie {formatDate(roi.lastUsed)}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <label className={label}>
          Nazwa
          <Input value={draft.name} onChange={(e) => set({ name: e.target.value })} className={field} autoFocus={!item} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className={label}>
            Kategoria
            <select
              value={draft.category}
              onChange={(e) => set({ category: e.target.value })}
              className="mt-1 h-9 w-full rounded-md border border-white/10 bg-black/40 px-2 text-sm text-zinc-200"
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {EQUIPMENT_CATEGORY_LABELS[c as keyof typeof EQUIPMENT_CATEGORY_LABELS] ?? c}
                </option>
              ))}
              <option value={CUSTOM}>Własna…</option>
            </select>
          </label>
          <label className={label}>
            Sztuk
            <Input
              type="number"
              min={1}
              value={draft.quantity}
              onChange={(e) => set({ quantity: e.target.value })}
              className={`${field} tabular-nums`}
            />
          </label>
        </div>
        {draft.category === CUSTOM && (
          <label className={label}>
            Nazwa kategorii
            <Input
              value={draft.customCategory}
              placeholder="np. grip"
              onChange={(e) => set({ customCategory: e.target.value })}
              className={field}
            />
          </label>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className={label}>
            Cena zakupu{quantity > 1 ? ' (za sztukę)' : ''}
            <Input
              inputMode="decimal"
              value={draft.purchasePrice}
              placeholder="zł netto"
              onChange={(e) => set({ purchasePrice: e.target.value })}
              className={`${field} tabular-nums`}
            />
          </label>
          <label className={label}>
            Data zakupu
            <Input
              type="date"
              value={draft.purchaseDate}
              onChange={(e) => set({ purchaseDate: e.target.value })}
              className={`${field} [color-scheme:dark]`}
            />
          </label>
        </div>
        <label className={label}>
          Rental za dzień{quantity > 1 ? ' (za sztukę)' : ''}
          <Input
            inputMode="decimal"
            value={draft.rentalDayRate}
            placeholder="ile kosztowałby dzień wynajmu, zł netto"
            onChange={(e) => set({ rentalDayRate: e.target.value })}
            className={`${field} tabular-nums`}
          />
        </label>
        <label className={label}>
          Notatki
          <Textarea
            value={draft.notes}
            onChange={(e) => set({ notes: e.target.value })}
            rows={2}
            className="mt-1 border-white/10 bg-black/40 text-sm"
          />
        </label>
        {quantity > 1 && amount(draft.purchasePrice) > 0 && (
          <p className="text-[11px] text-zinc-500">
            Zainwestowane: {quantity} × {pln(amount(draft.purchasePrice))} = {pln(quantity * amount(draft.purchasePrice))}
          </p>
        )}
        <div className="flex items-center gap-2">
          <Button onClick={save} disabled={!canSave} className="h-9">
            {item ? 'Zapisz' : 'Dodaj'}
          </Button>
          <Button variant="ghost" onClick={onClose} className="h-9 text-zinc-400">
            {item ? 'Zamknij' : 'Anuluj'}
          </Button>
          {saved && <span className="text-xs text-emerald-400">Zapisano</span>}
        </div>
      </section>

      {item && (
        <section>
          <h3 className="mb-2 text-[11px] font-bold uppercase tracking-widest text-zinc-500">
            Projekty ({history.length})
          </h3>
          {history.length === 0 ? (
            <p className="text-xs text-zinc-600">
              Jeszcze w żadnym zrealizowanym projekcie. Zaznacza się go w zakładce Sprzęt projektu.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {history.map(({ project, use }) => (
                <li key={project.id}>
                  <button
                    type="button"
                    disabled={!onOpenProject}
                    onClick={() => {
                      onOpenProject?.(project.id)
                      onClose()
                    }}
                    className="group flex w-full items-center gap-3 rounded-lg border border-white/5 bg-zinc-900/40 px-3 py-2 text-left transition-colors enabled:hover:border-white/15"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-zinc-200">{project.name || 'Bez nazwy'}</div>
                      <div className="text-[11px] text-zinc-500">
                        {formatDate(use.dates[use.dates.length - 1] ?? project.date)} · {use.daysUsed}{' '}
                        {dayLabel(use.daysUsed)}
                        {use.unitDays !== use.daysUsed ? ` · ${use.unitDays} szt.-dni` : ''}
                      </div>
                    </div>
                    <div className="text-right text-xs tabular-nums">
                      <div className="text-emerald-400/80">{pln(use.rentValue)}</div>
                      <div className="text-zinc-500">~{pln(use.clientPaid)}</div>
                    </div>
                    {onOpenProject && (
                      <ArrowUpRight className="size-4 shrink-0 text-zinc-600 group-hover:text-zinc-300" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {item && (
        <section className="flex flex-col gap-3 border-t border-white/5 pt-4">
          {item.retiredAt ? (
            <Button variant="outline" onClick={restore} className="h-9 w-fit gap-2 border-white/10">
              <RotateCcw className="size-4" />
              Przywróć do użytku
            </Button>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <label className={label}>
                Wycofany od (sprzedany, zepsuty)
                <Input
                  type="date"
                  value={retireDate}
                  onChange={(e) => setRetireDate(e.target.value)}
                  className={`${field} w-44 [color-scheme:dark]`}
                />
              </label>
              <Button variant="outline" onClick={retire} className="h-9 border-white/10">
                Wycofaj
              </Button>
            </div>
          )}
          <p className="text-[11px] text-zinc-600">
            Wycofany sprzęt zostaje w statystykach i historii, ale znika z list wyboru w projektach.
          </p>

          {confirmDelete ? (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3">
              <p className="text-xs text-red-200">
                {history.length > 0
                  ? `Jest w ${history.length} zrealizowanych projektach. Usunięcie wymaże go ze statystyk. Jeśli został sprzedany, lepiej go wycofać.`
                  : 'Usunąć tę pozycję z katalogu?'}
              </p>
              <div className="mt-2 flex gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={async () => {
                    await removeItem(item.id)
                    onClose()
                  }}
                  className="h-8"
                >
                  Usuń na zawsze
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)} className="h-8">
                  Anuluj
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="ghost"
              onClick={() => setConfirmDelete(true)}
              className="h-8 w-fit gap-2 px-2 text-xs text-zinc-500 hover:text-red-400"
            >
              <Trash2 className="size-3.5" />
              Usuń z katalogu
            </Button>
          )}
        </section>
      )}
    </div>
  )
}

function Stat({ label, value, sub, good }: { label: string; value: string; sub: string; good?: boolean }) {
  return (
    <div className="rounded-xl border border-white/5 bg-zinc-900/50 p-3">
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-0.5 tabular-nums text-base font-bold ${good ? 'text-emerald-400' : 'text-zinc-200'}`}>
        {value}
      </div>
      <div className="text-[11px] text-zinc-500">{sub}</div>
    </div>
  )
}
