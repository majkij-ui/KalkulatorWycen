'use client'

/**
 * Wiersze kosztów rzeczywistych w zakładce Realizacja: osoba z ekipy i zwykły
 * koszt (kategoria, opis, kwota). Kwoty wpisuje się po polsku („1 234,50").
 */

import { useEffect, useId, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { parseAmount } from '@/lib/event-draft'
import { costAmount, personKey, type CrewSuggestion } from '@/lib/project-costs'
import { COST_CATEGORIES, costCategoryLabel, type ProjectCost } from '@/lib/project-types'
import { pln } from '@/components/calendar/calendar-bits'

export const fieldClass =
  'h-8 min-w-0 rounded-md border border-white/10 bg-black/40 px-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-white/30'

function formatAmount(value: number): string {
  return value ? String(value).replace('.', ',') : ''
}

/** Pole kwoty: tekst podczas pisania, liczba w danych; po wyjściu z pola — ładny zapis. */
export function AmountInput({
  value,
  onChange,
  label,
  className = '',
}: {
  value: number
  onChange: (value: number) => void
  label: string
  className?: string
}) {
  const [text, setText] = useState(() => formatAmount(value))
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setText(formatAmount(value))
  }, [value])
  return (
    <input
      inputMode="decimal"
      value={text}
      placeholder="0"
      aria-label={label}
      onFocus={() => {
        focused.current = true
      }}
      onBlur={() => {
        focused.current = false
        setText(formatAmount(value))
      }}
      onChange={(e) => {
        setText(e.target.value)
        onChange(parseAmount(e.target.value) ?? 0)
      }}
      className={`${fieldClass} text-right tabular-nums ${className}`}
    />
  )
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex size-7 shrink-0 items-center justify-center rounded-md text-zinc-600 outline-none hover:bg-red-500/10 hover:text-red-300 focus-visible:ring-2 focus-visible:ring-white/60"
    >
      <X className="size-3.5" />
    </button>
  )
}

/** Osoba z ekipy: imię (podpowiedzi z innych projektów), rola, stawka za dzień. */
export function CrewRow({
  cost,
  suggestions,
  listId,
  onChange,
  onRemove,
}: {
  cost: ProjectCost
  suggestions: CrewSuggestion[]
  listId: string
  onChange: (patch: Partial<ProjectCost>) => void
  onRemove: () => void
}) {
  const quantity = cost.quantity ?? 1
  return (
    <div className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap">
      <input
        value={cost.person ?? ''}
        list={listId}
        placeholder="Osoba"
        aria-label="Osoba"
        onChange={(e) => {
          const person = e.target.value
          // Wybór znanej osoby uzupełnia rolę i stawkę — tylko puste pola.
          const known = suggestions.find((s) => personKey(s.person) === personKey(person))
          onChange({
            person,
            ...(known && !cost.role ? { role: known.role } : {}),
            ...(known && !cost.unitCost ? { unitCost: known.unitCost } : {}),
          })
        }}
        className={`${fieldClass} w-full sm:w-auto sm:flex-[3]`}
      />
      <input
        value={cost.role ?? ''}
        placeholder="Rola"
        aria-label="Rola"
        onChange={(e) => onChange({ role: e.target.value })}
        className={`${fieldClass} flex-[2]`}
      />
      {quantity !== 1 && (
        <span className="shrink-0 text-xs tabular-nums text-zinc-500" title="Liczba dni z importu">
          {String(quantity).replace('.', ',')} ×
        </span>
      )}
      <AmountInput
        value={cost.unitCost}
        onChange={(unitCost) => onChange({ unitCost })}
        label="Stawka za dzień (zł netto)"
        className="w-24 shrink-0"
      />
      <span className="w-8 shrink-0 text-xs text-zinc-500">zł</span>
      <RemoveButton label="Usuń osobę" onClick={onRemove} />
    </div>
  )
}

/** Kategorie do wyboru: znane (bez ekipy, gdy ekipa ma własną listę) + nieznana z rekordu. */
function categoryOptions(current: string, withCrew: boolean): string[] {
  const known = (COST_CATEGORIES as readonly string[]).filter((c) => withCrew || c !== 'ekipa')
  return known.includes(current) ? known : [...known, current]
}

/** Zwykły koszt: kategoria, opis, kwota. */
export function CostRow({
  cost,
  withCrewCategory,
  onChange,
  onRemove,
}: {
  cost: ProjectCost
  /** Koszty całego projektu mogą być też „ekipą" (np. montażysta na cały projekt). */
  withCrewCategory: boolean
  onChange: (patch: Partial<ProjectCost>) => void
  onRemove: () => void
}) {
  const id = useId()
  const quantity = cost.quantity ?? 1
  return (
    <div className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap">
      <select
        id={`${id}-category`}
        value={cost.category}
        aria-label="Kategoria kosztu"
        onChange={(e) => onChange({ category: e.target.value })}
        className={`${fieldClass} w-full sm:w-44 sm:flex-none`}
      >
        {categoryOptions(cost.category, withCrewCategory).map((c) => (
          <option key={c} value={c}>
            {costCategoryLabel(c)}
          </option>
        ))}
      </select>
      <input
        value={cost.category === 'ekipa' ? (cost.person ?? cost.label ?? '') : (cost.label ?? '')}
        placeholder={cost.category === 'ekipa' ? 'Osoba' : 'Opis (np. wynajem studia)'}
        aria-label="Opis kosztu"
        onChange={(e) => onChange(cost.category === 'ekipa' ? { person: e.target.value } : { label: e.target.value })}
        className={`${fieldClass} flex-1`}
      />
      {quantity !== 1 && (
        <span className="shrink-0 text-xs tabular-nums text-zinc-500" title={`Razem ${pln(costAmount(cost))}`}>
          {String(quantity).replace('.', ',')} ×
        </span>
      )}
      <AmountInput
        value={cost.unitCost}
        onChange={(unitCost) => onChange({ unitCost })}
        label={quantity !== 1 ? 'Stawka (zł netto)' : 'Kwota (zł netto)'}
        className="w-24 shrink-0"
      />
      <span className="w-8 shrink-0 text-xs text-zinc-500">zł</span>
      <RemoveButton label="Usuń koszt" onClick={onRemove} />
    </div>
  )
}

/** Podpowiedzi osób dla pól „Osoba" (jedna lista na zakładkę). */
export function CrewDatalist({ id, suggestions }: { id: string; suggestions: CrewSuggestion[] }) {
  return (
    <datalist id={id}>
      {suggestions.map((s) => (
        <option key={personKey(s.person)} value={s.person}>
          {[s.role, s.unitCost ? pln(s.unitCost) : ''].filter(Boolean).join(' · ')}
        </option>
      ))}
    </datalist>
  )
}
