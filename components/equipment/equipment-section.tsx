'use client'

/**
 * Sekcja „Sprzęt" — katalog własnego sprzętu z ceną zakupu i średnią stawką
 * rentalową, plus zwrot z inwestycji liczony z realnych projektów.
 *
 * Katalog jest ŹRÓDŁEM DANYCH, nie częścią wyceny — zaznaczenie sprzętu na
 * projekcie nigdy nie zmienia kwot w ofercie.
 */

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Check, Loader2, Package, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useEquipment } from '@/lib/equipment-context'
import { useProjectHub } from '@/lib/project-hub-context'
import { computeCatalogRoi, computeCatalogTotals } from '@/lib/equipment-roi'
import {
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_CATEGORY_LABELS,
  type EquipmentCategory,
  type EquipmentItem,
} from '@/lib/project-types'
import { dayLabel } from '@/lib/pl-plural'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

function pln(amount: number): string {
  return `${Math.round(amount).toLocaleString('pl-PL', { useGrouping: 'always' })} zł`
}

/** Pasek postępu spłaty — od razu widać, co się zwróciło. */
function PayoffBar({ pct }: { pct: number | null }) {
  if (pct === null) {
    return <div className="text-[11px] text-zinc-600">brak ceny zakupu</div>
  }
  const clamped = Math.min(100, pct)
  const paid = pct >= 100
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-zinc-800">
        <div
          className={`h-full rounded-full ${paid ? 'bg-emerald-500' : 'bg-amber-500'}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className={`text-[11px] tabular-nums ${paid ? 'text-emerald-400' : 'text-zinc-500'}`}>
        {Math.round(pct)}%
      </span>
    </div>
  )
}

function ItemRow({ item }: { item: EquipmentItem }) {
  const { updateItem, removeItem } = useEquipment()
  const { projects } = useProjectHub()
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [draft, setDraft] = useState(item)

  const roi = useMemo(
    () => computeCatalogRoi([item], projects)[0],
    [item, projects]
  )

  const save = async () => {
    await updateItem({
      ...draft,
      name: draft.name.trim() || item.name,
      purchasePrice: Number.isFinite(draft.purchasePrice) ? Math.max(0, draft.purchasePrice) : 0,
      rentalDayRate: Number.isFinite(draft.rentalDayRate) ? Math.max(0, draft.rentalDayRate) : 0,
    })
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/15 bg-zinc-900/70 px-4 py-3">
        <Input
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          aria-label="Nazwa sprzętu"
          className="h-8 min-w-[160px] flex-1 border-white/10 bg-black/40 text-sm"
        />
        <select
          value={draft.category}
          onChange={(e) => setDraft({ ...draft, category: e.target.value as EquipmentCategory })}
          aria-label="Kategoria"
          className="h-8 rounded-md border border-white/10 bg-black/40 px-2 text-xs text-zinc-200"
        >
          {EQUIPMENT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {EQUIPMENT_CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
        <Input
          type="number"
          min={0}
          value={draft.purchasePrice || ''}
          onChange={(e) => setDraft({ ...draft, purchasePrice: Number(e.target.value) })}
          placeholder="Cena zakupu"
          aria-label="Cena zakupu"
          className="h-8 w-[120px] border-white/10 bg-black/40 text-sm tabular-nums"
        />
        <Input
          type="number"
          min={0}
          value={draft.rentalDayRate || ''}
          onChange={(e) => setDraft({ ...draft, rentalDayRate: Number(e.target.value) })}
          placeholder="Rental/dzień"
          aria-label="Średnia stawka rentalowa za dzień"
          className="h-8 w-[120px] border-white/10 bg-black/40 text-sm tabular-nums"
        />
        <Button size="sm" onClick={save} className="h-8 gap-1.5">
          <Check className="size-3.5" />
          Zapisz
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setDraft(item)
            setEditing(false)
          }}
          className="h-8"
        >
          <X className="size-3.5" />
        </Button>
      </div>
    )
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="group flex flex-wrap items-center gap-4 rounded-xl border border-white/5 bg-zinc-900/40 px-4 py-3 transition-colors hover:border-white/15"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold text-zinc-100">{item.name}</div>
        <div className="mt-0.5 text-xs text-zinc-500">
          {item.purchasePrice > 0 ? `zakup ${pln(item.purchasePrice)}` : 'zakup —'}
          {' · '}
          {item.rentalDayRate > 0 ? `rental ${pln(item.rentalDayRate)}/dzień` : 'rental —'}
        </div>
      </div>

      <div className="shrink-0 text-right">
        <div className="text-xs text-zinc-500">
          {roi.timesUsed === 0
            ? 'nieużywany'
            : `${roi.timesUsed}× · ${roi.totalDays} ${dayLabel(roi.totalDays)}`}
        </div>
        <div className="tabular-nums text-sm font-semibold text-zinc-200">{pln(roi.earned)}</div>
      </div>

      <div className="w-32 shrink-0">
        <PayoffBar pct={roi.roiPct} />
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {confirmDelete ? (
          <>
            <Button
              size="sm"
              variant="destructive"
              className="h-7 px-2 text-xs"
              onClick={() => removeItem(item.id)}
            >
              Usuń
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => setConfirmDelete(false)}
            >
              Anuluj
            </Button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => {
                setDraft(item)
                setEditing(true)
              }}
              aria-label={`Edytuj ${item.name}`}
              className="rounded-md p-1.5 text-zinc-500 transition-colors hover:text-white"
            >
              <Pencil className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              aria-label={`Usuń ${item.name}`}
              className="rounded-md p-1.5 text-zinc-600 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
            >
              <Trash2 className="size-4" />
            </button>
          </>
        )}
      </div>
    </motion.div>
  )
}

function AddItemForm() {
  const { addItem } = useEquipment()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [category, setCategory] = useState<EquipmentCategory>('kamery')
  const [purchasePrice, setPurchasePrice] = useState('')
  const [rentalDayRate, setRentalDayRate] = useState('')

  const submit = async () => {
    if (!name.trim()) return
    await addItem({
      name,
      category,
      purchasePrice: Number(purchasePrice) || 0,
      rentalDayRate: Number(rentalDayRate) || 0,
    })
    setName('')
    setPurchasePrice('')
    setRentalDayRate('')
    setOpen(false)
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} className="h-9 gap-2">
        <Plus className="size-4" />
        Dodaj sprzęt
      </Button>
    )
  }

  return (
    <div className="flex w-full flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-zinc-900/50 p-3">
      <Input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder="Nazwa, np. Sony FX3"
        aria-label="Nazwa sprzętu"
        className="h-9 min-w-[180px] flex-1 border-white/10 bg-black/40 text-sm"
      />
      <select
        value={category}
        onChange={(e) => setCategory(e.target.value as EquipmentCategory)}
        aria-label="Kategoria"
        className="h-9 rounded-md border border-white/10 bg-black/40 px-2 text-sm text-zinc-200"
      >
        {EQUIPMENT_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {EQUIPMENT_CATEGORY_LABELS[c]}
          </option>
        ))}
      </select>
      <Input
        type="number"
        min={0}
        value={purchasePrice}
        onChange={(e) => setPurchasePrice(e.target.value)}
        placeholder="Cena zakupu"
        aria-label="Cena zakupu"
        className="h-9 w-[130px] border-white/10 bg-black/40 text-sm tabular-nums"
      />
      <Input
        type="number"
        min={0}
        value={rentalDayRate}
        onChange={(e) => setRentalDayRate(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder="Rental/dzień"
        aria-label="Średnia stawka rentalowa za dzień"
        className="h-9 w-[130px] border-white/10 bg-black/40 text-sm tabular-nums"
      />
      <Button onClick={submit} disabled={!name.trim()} className="h-9">
        Dodaj
      </Button>
      <Button variant="ghost" onClick={() => setOpen(false)} className="h-9">
        Anuluj
      </Button>
    </div>
  )
}

export function EquipmentSection() {
  const { items, isLoading } = useEquipment()
  const { projects } = useProjectHub()

  const totals = useMemo(
    () => computeCatalogTotals(computeCatalogRoi(items, projects)),
    [items, projects]
  )

  const grouped = useMemo(() => {
    const map = new Map<EquipmentCategory, EquipmentItem[]>()
    items.forEach((item) => {
      const bucket = map.get(item.category) ?? []
      bucket.push(item)
      map.set(item.category, bucket)
    })
    return map
  }, [items])

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-white">Sprzęt</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Katalog własnego sprzętu. Zaznaczenia w projekcie nie wpływają na kwoty wyceny —
          służą liście pakowania i rentowności.
        </p>
      </header>

      {items.length > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Zainwestowane', value: pln(totals.totalInvested) },
            { label: 'Odpracowane', value: pln(totals.totalEarned) },
            {
              label: 'Zwrot katalogu',
              value: totals.roiPct === null ? '—' : `${Math.round(totals.roiPct)}%`,
            },
            { label: 'Spłacone', value: `${totals.paidOffCount}/${items.length}` },
          ].map((stat) => (
            <div key={stat.label} className="rounded-xl border border-white/5 bg-zinc-900/40 p-3">
              <div className="text-[11px] uppercase tracking-wide text-zinc-500">{stat.label}</div>
              <div className="mt-1 tabular-nums text-lg font-bold text-zinc-100">{stat.value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="mb-6">
        <AddItemForm />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16 text-zinc-600">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/10 py-16 text-center">
          <Package className="size-8 text-zinc-700" />
          <p className="mt-3 max-w-sm text-sm text-zinc-500">
            Dodaj sprzęt z ceną zakupu i średnią stawką rentalową, żeby liczyć, ile zarobił
            na siebie w projektach.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {EQUIPMENT_CATEGORIES.filter((c) => grouped.has(c)).map((category) => (
            <section key={category}>
              <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-zinc-500">
                {EQUIPMENT_CATEGORY_LABELS[category]}
              </h2>
              <div className="flex flex-col gap-2">
                {(grouped.get(category) ?? []).map((item) => (
                  <ItemRow key={item.id} item={item} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
