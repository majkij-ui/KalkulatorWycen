'use client'

/**
 * Koszty stałe wybranego okresu — ZUS, marketing i worek „inne".
 *
 * Pokazujemy KAŻDY miesiąc okresu, także pusty: brak ZUS-u w marcu ma być
 * widoczny od razu, a nie ginąć w liście. ZUS i inne cykliczne pozycje
 * dodaje się raz z opcją „powtarzaj do", zamiast wpisywać 12 razy.
 */

import { useMemo, useState } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import { fixedCostsByMonth, periodMonths, type Period } from '@/lib/finance-calc'
import {
  FIXED_COST_TYPES,
  FIXED_COST_TYPE_LABELS,
  type FixedCost,
  type FixedCostType,
} from '@/lib/project-types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { AddFixedCostParams } from './use-fixed-costs'

const MONTH_NAMES = [
  'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
  'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień',
]

function pln(amount: number): string {
  return `${Math.round(amount).toLocaleString('pl-PL', { useGrouping: 'always' })} zł`
}

function monthName(monthKey: string): string {
  const [y, m] = monthKey.split('-')
  return `${MONTH_NAMES[Number(m) - 1] ?? m} ${y}`
}

function AddCostForm({
  months,
  onAdd,
  onClose,
}: {
  months: string[]
  onAdd: (params: AddFixedCostParams) => Promise<void>
  onClose: () => void
}) {
  const [month, setMonth] = useState(months[0] ?? '')
  const [type, setType] = useState<FixedCostType>('zus')
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('')
  const [repeat, setRepeat] = useState(false)
  const [repeatUntil, setRepeatUntil] = useState(months[months.length - 1] ?? '')

  const value = Number(amount.replace(',', '.'))
  const valid = /^\d{4}-\d{2}$/.test(month) && Number.isFinite(value) && value > 0

  const submit = async () => {
    if (!valid) return
    await onAdd({
      month,
      type,
      amount: value,
      label: label.trim(),
      repeatUntil: repeat && repeatUntil >= month ? repeatUntil : undefined,
    })
    setLabel('')
    setAmount('')
    onClose()
  }

  return (
    <div className="mb-4 flex flex-col gap-2 rounded-xl border border-white/10 bg-black/30 p-3">
      <div className="flex flex-wrap gap-2">
        <Input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          aria-label="Miesiąc"
          className="h-9 w-[150px] border-white/10 bg-black/40 text-sm"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as FixedCostType)}
          aria-label="Rodzaj kosztu"
          className="h-9 rounded-md border border-white/10 bg-black/40 px-2 text-sm text-zinc-200"
        >
          {FIXED_COST_TYPES.map((t) => (
            <option key={t} value={t}>
              {FIXED_COST_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <Input
          type="number"
          min={0}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="Kwota zł"
          aria-label="Kwota"
          className="h-9 w-[120px] border-white/10 bg-black/40 text-sm tabular-nums"
        />
      </div>
      <Input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder={type === 'other' ? 'Opis, np. księgowa, Adobe CC' : 'Opis (opcjonalnie)'}
        aria-label="Opis"
        className="h-9 border-white/10 bg-black/40 text-sm"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          <input
            type="checkbox"
            checked={repeat}
            onChange={(e) => setRepeat(e.target.checked)}
            className="accent-sky-500"
          />
          Powtarzaj co miesiąc do
          <Input
            type="month"
            value={repeatUntil}
            disabled={!repeat}
            onChange={(e) => setRepeatUntil(e.target.value)}
            aria-label="Powtarzaj do miesiąca"
            className="h-8 w-[140px] border-white/10 bg-black/40 text-xs disabled:opacity-40"
          />
        </label>
        <div className="flex gap-1">
          <Button variant="ghost" onClick={onClose} className="h-8">
            Anuluj
          </Button>
          <Button onClick={submit} disabled={!valid} className="h-8">
            Dodaj
          </Button>
        </div>
      </div>
    </div>
  )
}

function CostRow({
  cost,
  onUpdate,
  onRemove,
}: {
  cost: FixedCost
  onUpdate: (cost: FixedCost) => Promise<void>
  onRemove: (id: string) => Promise<void>
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const commit = async () => {
    if (draft === null) return
    const value = Number(draft.replace(',', '.'))
    setDraft(null)
    if (Number.isFinite(value) && value >= 0 && value !== cost.amount) {
      await onUpdate({ ...cost, amount: value })
    }
  }

  return (
    <div className="group flex items-center gap-2 py-1 pl-3 text-sm">
      <span className="w-20 shrink-0 text-xs text-zinc-500">{FIXED_COST_TYPE_LABELS[cost.type]}</span>
      <span className="min-w-0 flex-1 truncate text-zinc-300">{cost.label || '—'}</span>
      {draft === null ? (
        <button
          type="button"
          onClick={() => setDraft(String(cost.amount))}
          aria-label={`Zmień kwotę: ${FIXED_COST_TYPE_LABELS[cost.type]} ${cost.label}`}
          className="rounded px-1.5 tabular-nums text-zinc-100 hover:bg-white/5"
        >
          {pln(cost.amount)}
        </button>
      ) : (
        <Input
          autoFocus
          type="number"
          min={0}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') setDraft(null)
          }}
          aria-label="Kwota"
          className="h-7 w-[100px] border-white/10 bg-black/40 text-right text-sm tabular-nums"
        />
      )}
      {confirmDelete ? (
        <span className="flex shrink-0 gap-1">
          <Button size="sm" variant="destructive" className="h-6 px-2 text-xs" onClick={() => onRemove(cost.id)}>
            Usuń
          </Button>
          <button
            type="button"
            onClick={() => setConfirmDelete(false)}
            aria-label="Anuluj usuwanie"
            className="rounded p-1 text-zinc-500 hover:text-white"
          >
            <X className="size-3.5" />
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          aria-label={`Usuń ${FIXED_COST_TYPE_LABELS[cost.type]} ${cost.label}`}
          className="shrink-0 rounded p-1 text-zinc-600 opacity-0 transition-opacity hover:text-red-400 focus:opacity-100 group-hover:opacity-100"
        >
          <Trash2 className="size-3.5" />
        </button>
      )}
    </div>
  )
}

export function FixedCostsPanel({
  period,
  costs,
  addCost,
  updateCost,
  removeCost,
}: {
  period: Period
  costs: FixedCost[]
  addCost: (params: AddFixedCostParams) => Promise<void>
  updateCost: (cost: FixedCost) => Promise<void>
  removeCost: (id: string) => Promise<void>
}) {
  const [adding, setAdding] = useState(false)
  const months = useMemo(() => periodMonths(period), [period])
  const totals = useMemo(() => fixedCostsByMonth(costs), [costs])
  const byMonth = useMemo(() => {
    const map = new Map<string, FixedCost[]>()
    costs.forEach((c) => {
      const bucket = map.get(c.month) ?? []
      bucket.push(c)
      map.set(c.month, bucket)
    })
    return map
  }, [costs])

  return (
    <section className="rounded-xl border border-white/5 bg-zinc-900/40 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Koszty stałe</h2>
        {!adding && (
          <Button size="sm" variant="ghost" onClick={() => setAdding(true)} className="h-7 gap-1.5 text-xs">
            <Plus className="size-3.5" />
            Dodaj koszt
          </Button>
        )}
      </div>

      {adding && <AddCostForm months={months} onAdd={addCost} onClose={() => setAdding(false)} />}

      <div className="flex flex-col divide-y divide-white/5">
        {months.map((month) => {
          const items = byMonth.get(month) ?? []
          const total = totals.get(month)?.total ?? 0
          const missingZus = !items.some((c) => c.type === 'zus')
          return (
            <div key={month} className="py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-zinc-300">{monthName(month)}</span>
                <span className="flex items-center gap-2">
                  {missingZus && (
                    <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500">
                      bez ZUS
                    </span>
                  )}
                  <span className="tabular-nums text-sm font-semibold text-zinc-100">{pln(total)}</span>
                </span>
              </div>
              {items.map((cost) => (
                <CostRow key={cost.id} cost={cost} onUpdate={updateCost} onRemove={removeCost} />
              ))}
            </div>
          )
        })}
      </div>
    </section>
  )
}
