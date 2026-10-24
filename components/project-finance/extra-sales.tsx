'use client'

/**
 * Dosprzedaż w zakładce Finanse projektu (U1, U-DOSPRZEDAŻ): lista wydarzeń
 * `extra_sale` z kategorią, fazą, kwotą i notatką; dodawanie, edycja i
 * usuwanie (miękkie, z „Cofnij" w komunikacie zakładki). Kategoria z listy albo
 * nowa, wpisana na miejscu (`extra-sales.ts`). Liczby i reguły — w lib.
 */

import { useId, useMemo, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { parseAmount } from '@/lib/event-draft'
import {
  EXTRA_SALE_PHASES,
  EXTRA_SALE_PHASE_LABELS,
  categoryKey,
  categoryLabel,
  cleanCategory,
  phaseLabel,
} from '@/lib/extra-sales'
import type { ExtraSale, ExtraSalePhase } from '@/lib/money-loop'
import { mono, pln } from '@/components/calendar/calendar-bits'

export interface ExtraSaleInput {
  day: string
  amountNetto: number
  category: string | null
  phase: ExtraSalePhase | null
  what: string
}

function dateText(day: string): string {
  const [y, m, d] = day.split('-')
  return d ? `${d}.${m}.${y}` : day
}

const inputClass =
  'h-8 rounded-md border border-white/10 bg-black/40 px-2 text-sm text-zinc-100 outline-none [color-scheme:dark] focus:border-white/30'

/** Kategoria: lista (startowe + użyte) z filtrem; tekst spoza listy = nowa kategoria. */
function CategoryPicker({ value, options, onChange }: { value: string; options: string[]; onChange: (next: string) => void }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const query = categoryKey(value)
  const matches = options.filter((name) => !query || categoryKey(name).includes(query))
  const exact = options.some((name) => categoryKey(name) === query)
  return (
    <div className="relative min-w-0 flex-1 sm:max-w-64">
      <input
        aria-label="Kategoria dosprzedaży"
        aria-controls={`${id}-list`}
        aria-expanded={open}
        role="combobox"
        value={value}
        placeholder="Kategoria — wybierz albo wpisz nową"
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false)
        }}
        className={`${inputClass} w-full`}
      />
      {open && (matches.length > 0 || (query && !exact)) && (
        <ul id={`${id}-list`} role="listbox" className="absolute left-0 right-0 top-9 z-20 max-h-56 overflow-y-auto rounded-md border border-white/10 bg-zinc-900 py-1 shadow-xl">
          {matches.map((name) => (
            <li key={name} role="option" aria-selected={categoryKey(name) === query}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(name)
                  setOpen(false)
                }}
                className="block w-full px-2.5 py-1.5 text-left text-sm text-zinc-200 hover:bg-white/5"
              >
                {name}
              </button>
            </li>
          ))}
          {query && !exact && (
            <li role="option" aria-selected={false}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setOpen(false)}
                className="block w-full px-2.5 py-1.5 text-left text-sm text-primary hover:bg-white/5"
              >
                + Nowa kategoria „{cleanCategory(value)}"
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

function PhasePills({ value, onChange }: { value: ExtraSalePhase | null; onChange: (next: ExtraSalePhase | null) => void }) {
  return (
    <div className="inline-flex flex-wrap items-center gap-1" role="group" aria-label="Faza dosprzedaży">
      {EXTRA_SALE_PHASES.map((phase) => {
        const active = value === phase
        return (
          <button
            key={phase}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(active ? null : phase)}
            className={`rounded-md border px-2 py-1 text-xs transition-colors ${
              active ? 'border-primary/50 bg-primary/15 text-white' : 'border-white/10 text-zinc-400 hover:text-zinc-100'
            }`}
          >
            {EXTRA_SALE_PHASE_LABELS[phase]}
          </button>
        )
      })}
    </div>
  )
}

function ExtraSaleForm({
  initial,
  categories,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: ExtraSaleInput
  categories: string[]
  submitLabel: string
  onSubmit: (input: ExtraSaleInput) => void | Promise<void>
  onCancel: () => void
}) {
  const [category, setCategory] = useState(initial.category ?? '')
  const [phase, setPhase] = useState<ExtraSalePhase | null>(initial.phase)
  const [amount, setAmount] = useState(initial.amountNetto ? String(initial.amountNetto).replace('.', ',') : '')
  const [what, setWhat] = useState(initial.what)
  const [day, setDay] = useState(initial.day)
  const parsed = parseAmount(amount)
  const valid = parsed !== undefined && parsed > 0 && /^\d{4}-\d{2}-\d{2}$/.test(day)
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!valid) return
        void onSubmit({ day, amountNetto: parsed!, category: cleanCategory(category) ?? null, phase, what: what.trim() })
      }}
      className="space-y-2 rounded-lg border border-white/10 bg-black/20 p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <CategoryPicker value={category} options={categories} onChange={setCategory} />
        <input
          inputMode="decimal"
          aria-label="Kwota dosprzedaży (zł netto)"
          placeholder="Kwota netto"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className={`${inputClass} w-32 text-right tabular-nums`}
          style={mono}
        />
        <span className="text-xs text-zinc-500">zł netto</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <PhasePills value={phase} onChange={setPhase} />
        <input type="date" aria-label="Data dosprzedaży" value={day} onChange={(e) => setDay(e.target.value)} className={`${inputClass} w-36`} />
      </div>
      <input
        aria-label="Notatka do dosprzedaży"
        placeholder="Notatka (opcjonalnie), np. dysk z surówką"
        value={what}
        onChange={(e) => setWhat(e.target.value)}
        className={`${inputClass} w-full`}
      />
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={!valid}
          className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-40"
        >
          {submitLabel}
        </button>
        <button type="button" onClick={onCancel} className="h-8 px-2 text-xs text-zinc-400 hover:text-white">
          Anuluj
        </button>
      </div>
    </form>
  )
}

export function ExtraSalesSection({
  extras,
  categories,
  today,
  onAdd,
  onEdit,
  onRemove,
}: {
  extras: ExtraSale[]
  categories: string[]
  today: string
  onAdd: (input: ExtraSaleInput) => Promise<void>
  onEdit: (id: string, input: ExtraSaleInput) => Promise<void>
  onRemove: (extra: ExtraSale) => Promise<void>
}) {
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const total = useMemo(() => extras.reduce((sum, x) => sum + (x.amount ?? 0), 0), [extras])
  return (
    <section aria-label="Dosprzedaż" className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-200">
          Dosprzedaż {extras.length > 0 && <span className="font-normal text-zinc-500">· {pln(total)}</span>}
        </h3>
        {!adding && (
          <button
            type="button"
            onClick={() => {
              setAdding(true)
              setEditing(null)
            }}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-zinc-300 hover:bg-white/5 hover:text-white"
          >
            <Plus className="size-3.5" />
            Dosprzedaż
          </button>
        )}
      </div>
      {extras.length === 0 && !adding && (
        <p className="text-xs text-zinc-500">Nic ponad cenę. Dodaj, co klient dokupił — z kategorią i fazą.</p>
      )}
      <ul className="space-y-1">
        {extras.map((x) =>
          editing === x.id ? (
            <li key={x.id}>
              <ExtraSaleForm
                initial={{ day: x.day, amountNetto: x.amount ?? 0, category: x.category ?? null, phase: x.phase ?? null, what: x.what }}
                categories={categories}
                submitLabel="Zapisz"
                onSubmit={async (input) => {
                  await onEdit(x.id, input)
                  setEditing(null)
                }}
                onCancel={() => setEditing(null)}
              />
            </li>
          ) : (
            <li key={x.id} className="group flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg border border-white/5 bg-zinc-900/30 px-3 py-2 text-sm">
              <span className={`min-w-0 flex-1 ${x.category ? 'text-zinc-200' : 'text-zinc-500'}`}>
                {categoryLabel(x.category)}
                <span className="ml-2 text-xs text-zinc-500">
                  {phaseLabel(x.phase)} · {dateText(x.day)}
                  {x.what ? ` · ${x.what}` : ''}
                  {x.number ? ` · FV ${x.number}` : ''}
                </span>
              </span>
              <span className="shrink-0 tabular-nums text-zinc-100" style={mono}>
                {x.amount === null ? 'bez kwoty' : pln(x.amount)}
              </span>
              <span className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setEditing(x.id)
                    setAdding(false)
                  }}
                  aria-label={`Edytuj dosprzedaż ${categoryLabel(x.category)}`}
                  className="rounded p-1 text-zinc-500 hover:text-white"
                >
                  <Pencil className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => void onRemove(x)}
                  aria-label={`Usuń dosprzedaż ${categoryLabel(x.category)}`}
                  className="rounded p-1 text-zinc-500 hover:text-red-300"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </span>
            </li>
          )
        )}
      </ul>
      {adding && (
        <ExtraSaleForm
          initial={{ day: today, amountNetto: 0, category: null, phase: null, what: '' }}
          categories={categories}
          submitLabel="Dodaj dosprzedaż"
          onSubmit={async (input) => {
            await onAdd(input)
            setAdding(false)
          }}
          onCancel={() => setAdding(false)}
        />
      )}
    </section>
  )
}
