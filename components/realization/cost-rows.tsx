'use client'

/**
 * Wiersze kosztów rzeczywistych w zakładce Realizacja: osoba z ekipy i zwykły
 * koszt (kategoria, opis, kwota). Kwoty wpisuje się po polsku („1 234,50").
 */

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Scissors, X } from 'lucide-react'
import { parseAmount } from '@/lib/event-draft'
import { useCrew } from '@/lib/crew-context'
import { costRowRolePatch } from '@/lib/crew-rates'
import { crewMemberById, rolesForPerson } from '@/lib/crew-types'
import { costAmount, type CrewSuggestion } from '@/lib/project-costs'
import { COST_CATEGORIES, costCategoryLabel, type ProjectCost } from '@/lib/project-types'
import { isPlainAmount, plainAmountPatch } from '@/lib/realization-costs'
import { canSplit, quantityValue } from '@/lib/realization-control'
import { pln } from '@/components/calendar/calendar-bits'
import { PersonPicker } from './person-picker'
import { RentalItemPicker, type RentalDictionary } from './rental-item-picker'

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
  title,
}: {
  value: number
  onChange: (value: number) => void
  label: string
  className?: string
  /** Podpowiedź po najechaniu (np. skąd kwota dojazdu). */
  title?: string
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
      title={title}
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


function quantityText(value: number): string {
  return String(value).replace('.', ',')
}

/** W2: ilość wiersza (dni, osoby, sztuki) — liczba ≥ 0, także ułamkowa („0,5"). */
export function QuantityInput({
  value,
  onChange,
  className = '',
}: {
  value: number
  onChange: (value: number) => void
  className?: string
}) {
  const [text, setText] = useState(() => quantityText(value))
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setText(quantityText(value))
  }, [value])
  return (
    <input
      inputMode="decimal"
      value={text}
      aria-label="Ilość"
      title="Ilość (dni, osoby, sztuki)"
      onFocus={() => {
        focused.current = true
      }}
      onBlur={() => {
        focused.current = false
        setText(quantityText(value))
      }}
      onChange={(e) => {
        setText(e.target.value)
        onChange(quantityValue(parseAmount(e.target.value) ?? 0))
      }}
      className={`${fieldClass} w-12 shrink-0 text-right tabular-nums ${className}`}
    />
  )
}

/** Ilość × stawka: pole ilości i „×". */
function QuantityPart({ cost, onChange, dim }: { cost: ProjectCost; onChange: (patch: Partial<ProjectCost>) => void; dim: string }) {
  return (
    <>
      <QuantityInput value={cost.quantity ?? 1} onChange={(quantity) => onChange({ quantity })} className={dim} />
      <span className="shrink-0 text-xs text-zinc-500" aria-hidden>
        ×
      </span>
    </>
  )
}

/** Wartość wiersza po polu stawki — widoczna, gdy ilość ≠ 1. */
function RowValue({ cost }: { cost: ProjectCost }) {
  if ((cost.quantity ?? 1) === 1) return null
  return (
    <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-zinc-400" title="Wartość wiersza (ilość × stawka)">
      = {pln(costAmount(cost))}
    </span>
  )
}

/** Dzień do wyboru przy przenoszeniu pojedynczego wiersza. */
export interface MoveTarget {
  id: string
  label: string
}

/** W2: „Rozdziel" (ilość > 1) i „Przenieś do dnia…" przy pojedynczym wierszu. */
export function RowTools({
  cost,
  targets,
  onSplit,
  onMove,
}: {
  cost: ProjectCost
  targets?: MoveTarget[]
  onSplit?: () => void
  onMove?: (dayId: string) => void
}) {
  const options = (targets ?? []).filter((t) => t.id !== cost.dayId)
  const split = !!onSplit && canSplit(cost)
  if (!split && !(onMove && options.length > 0)) return null
  return (
    <span className="flex shrink-0 items-center gap-1">
      {split && (
        <button
          type="button"
          onClick={onSplit}
          aria-label="Rozdziel na pojedyncze wiersze"
          title="Rozbija wiersz na pojedyncze (ilość 1) — suma się nie zmienia"
          className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[11px] font-semibold text-zinc-400 outline-none hover:bg-white/5 hover:text-zinc-100 focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <Scissors className="size-3" />
          Rozdziel
        </button>
      )}
      {onMove && options.length > 0 && (
        <select
          value=""
          aria-label="Przenieś ten wiersz do dnia"
          onChange={(e) => e.target.value && onMove(e.target.value)}
          className="h-7 w-[92px] rounded-md border border-white/10 bg-black/40 px-1 text-[11px] text-zinc-400"
        >
          <option value="">Do dnia…</option>
          {options.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      )}
    </span>
  )
}

/**
 * R2 (B3, D1): zaznaczenie „było" (odznaczone = tego nie było, nie liczy się
 * nigdzie) i „Zewnętrzny | Moja praca" na każdym liczonym wierszu.
 */
export interface LineMechanics {
  counted: boolean
  own: boolean
  onTick: (counted: boolean) => void
  onWork: (own: boolean) => void
}

export function TickBox({ mechanics, label }: { mechanics: LineMechanics; label: string }) {
  return (
    <input
      type="checkbox"
      checked={mechanics.counted}
      onChange={(e) => mechanics.onTick(e.target.checked)}
      aria-label={`Było: ${label}`}
      title={mechanics.counted ? 'Odznacz, jeśli tego nie było' : 'Zaznacz, jeśli to było'}
      className="size-4 shrink-0 accent-primary"
    />
  )
}

/** „Zewnętrzny | Moja praca" — przy odznaczonym wierszu nie ma czego rozróżniać. */
export function WorkPill({ mechanics }: { mechanics: LineMechanics }) {
  if (!mechanics.counted) return <span className="hidden w-[168px] shrink-0 sm:block" aria-hidden />
  const option = (own: boolean, text: string) => (
    <button
      type="button"
      aria-pressed={mechanics.own === own}
      onClick={() => mechanics.own !== own && mechanics.onWork(own)}
      className={`flex-1 whitespace-nowrap px-1.5 py-1 text-center text-[11px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${
        mechanics.own === own ? (own ? 'bg-sky-500/20 text-sky-200' : 'bg-white/10 text-zinc-100') : 'text-zinc-500 hover:text-zinc-200'
      }`}
    >
      {text}
    </button>
  )
  return (
    <span className="inline-flex w-[168px] shrink-0 overflow-hidden rounded-md border border-white/10" role="group" aria-label="Kto płaci">
      {option(false, 'Zewnętrzny')}
      {option(true, 'Moja praca')}
    </span>
  )
}

export function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
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

/**
 * Osoba z ekipy: osoba z bazy Ekipa albo wpisana tekstem (`PersonPicker`),
 * rola (podpowiedzi z listy ról — przy osobie z bazy najpierw jej role), stawka
 * za dzień. Zmiana roli przy osobie z bazy bierze jej stawkę w nowej roli (S2).
 */
export function CrewRow({
  cost,
  outsiders,
  roleListId,
  onChange,
  onRemove,
  mechanics,
  tools,
}: {
  cost: ProjectCost
  /** W2: „Rozdziel" i „Przenieś do dnia…". */
  tools?: ReactNode
  /** R2: zaznaczenie i „Moja praca"; brak = wiersz jak dotąd. */
  mechanics?: LineMechanics
  /** Imiona z innych projektów spoza bazy — trzecia sekcja listy wyboru. */
  outsiders: CrewSuggestion[]
  /** `datalist` z nazwami ról. */
  roleListId: string
  onChange: (patch: Partial<ProjectCost>) => void
  onRemove: () => void
}) {
  const ownListId = useId()
  const { allPeople, roles } = useCrew()
  const member = crewMemberById(allPeople, cost.personId)
  const { own, others } = rolesForPerson(member, roles)
  const personal = own.length > 0
  const dim = mechanics && !mechanics.counted ? 'opacity-50' : ''
  return (
    <div className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap">
      {mechanics && <TickBox mechanics={mechanics} label={cost.person?.trim() || cost.role?.trim() || 'osoba'} />}
      <PersonPicker cost={cost} outsiders={outsiders} onChange={onChange} className={`min-w-0 flex-1 sm:w-auto sm:flex-[3] ${dim}`} />
      <input
        value={cost.role ?? ''}
        list={personal ? ownListId : roleListId}
        placeholder="Rola"
        aria-label="Rola"
        onChange={(e) => onChange(costRowRolePatch(cost, e.target.value, member, roles))}
        className={`${fieldClass} flex-[2] ${dim}`}
      />
      {personal && <CrewRoleDatalist id={ownListId} names={[...own, ...others].map((r) => r.name)} />}
      <QuantityPart cost={cost} onChange={onChange} dim={dim} />
      <AmountInput
        value={cost.unitCost}
        onChange={(unitCost) => onChange({ unitCost })}
        label="Stawka za dzień (zł netto)"
        className={`w-24 shrink-0 ${dim}`}
      />
      <span className="w-8 shrink-0 text-xs text-zinc-500">zł</span>
      <RowValue cost={cost} />
      {tools}
      {mechanics && <WorkPill mechanics={mechanics} />}
      <RemoveButton label="Usuń osobę" onClick={onRemove} />
    </div>
  )
}

/** Kategorie do wyboru: znane (bez ekipy, gdy ekipa ma własną listę) + nieznana z rekordu. */
function categoryOptions(current: string, withCrew: boolean): string[] {
  const known = (COST_CATEGORIES as readonly string[]).filter((c) => withCrew || c !== 'ekipa')
  return known.includes(current) ? known : [...known, current]
}

/** Kwota do pola: zaokrąglona do groszy (km × zł/km daje ułamki). */
function roundedAmount(cost: ProjectCost): number {
  return Math.round(costAmount(cost) * 100) / 100
}

/** „2 500 km × 0,52 zł" — skąd się wzięła kwota dojazdu z wyceny. */
function quantityHint(cost: ProjectCost): string {
  const qty = (cost.quantity ?? 1).toLocaleString('pl-PL')
  const rate = cost.unitCost.toLocaleString('pl-PL', { maximumFractionDigits: 2 })
  return `z wyceny: ${qty} km × ${rate} zł — wpisz kwotę, jeśli było inaczej`
}

/**
 * Zwykły koszt: kategoria, opis, kwota. Dojazd (U-DOJAZD) to jedna kwota —
 * stary wiersz km × zł/km pokazuje swoją kwotę, poprawka zapisuje 1 × kwota.
 */
export function CostRow({
  cost,
  withCrewCategory,
  onChange,
  onRemove,
  mechanics,
  tools,
}: {
  cost: ProjectCost
  /** W2: „Rozdziel" i „Przenieś do dnia…". */
  tools?: ReactNode
  /** R2: zaznaczenie i „Moja praca"; brak = wiersz jak dotąd. */
  mechanics?: LineMechanics
  /** Koszty całego projektu mogą być też „ekipą" (np. montażysta na cały projekt). */
  withCrewCategory: boolean
  onChange: (patch: Partial<ProjectCost>) => void
  onRemove: () => void
}) {
  const id = useId()
  const plain = isPlainAmount(cost)
  const dim = mechanics && !mechanics.counted ? 'opacity-50' : ''
  return (
    <div className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap">
      {mechanics && <TickBox mechanics={mechanics} label={cost.label?.trim() || costCategoryLabel(cost.category)} />}
      <select
        id={`${id}-category`}
        value={cost.category}
        aria-label="Kategoria kosztu"
        onChange={(e) => onChange({ category: e.target.value })}
        className={`${fieldClass} min-w-0 flex-1 sm:w-44 sm:flex-none ${dim}`}
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
        className={`${fieldClass} w-full flex-1 sm:w-auto ${dim}`}
      />
      {!plain && <QuantityPart cost={cost} onChange={onChange} dim={dim} />}
      {plain ? (
        <AmountInput
          value={roundedAmount(cost)}
          onChange={(amount) => onChange(plainAmountPatch(amount))}
          label="Kwota (zł netto)"
          title={(cost.quantity ?? 1) !== 1 ? quantityHint(cost) : undefined}
          className={`w-24 shrink-0 ${dim}`}
        />
      ) : (
        <AmountInput
          value={cost.unitCost}
          onChange={(unitCost) => onChange({ unitCost })}
          label="Stawka (zł netto)"
          className={`w-24 shrink-0 ${dim}`}
        />
      )}
      <span className="w-8 shrink-0 text-xs text-zinc-500">zł</span>
      {!plain && <RowValue cost={cost} />}
      {tools}
      {mechanics && <WorkPill mechanics={mechanics} />}
      <RemoveButton label="Usuń koszt" onClick={onRemove} />
    </div>
  )
}

function daysText(value: number | undefined): string {
  return value ? String(value).replace('.', ',') : ''
}

/** Dni wynajmu: puste = nie wiadomo (wiersz dnia liczy się jako 1 dzień). */
function DaysInput({
  value,
  onChange,
  className = '',
}: {
  value: number | undefined
  onChange: (days: number | undefined) => void
  className?: string
}) {
  const [text, setText] = useState(() => daysText(value))
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setText(daysText(value))
  }, [value])
  return (
    <input
      inputMode="decimal"
      value={text}
      placeholder="—"
      aria-label="Dni wynajmu"
      onFocus={() => {
        focused.current = true
      }}
      onBlur={() => {
        focused.current = false
        setText(daysText(value))
      }}
      onChange={(e) => {
        setText(e.target.value)
        const days = Number(e.target.value.replace(',', '.'))
        onChange(e.target.value.trim() && Number.isFinite(days) && days > 0 ? days : undefined)
      }}
      className={`${fieldClass} w-14 text-right tabular-nums ${className}`}
    />
  )
}

/**
 * Wiersz wynajmu (U2, plan §17.1): co wynajęte (słownik albo opis) i kwota, a
 * w drugiej linii — opcjonalnie dni i wypożyczalnia. Kategorię da się zmienić
 * jak w zwykłym koszcie.
 */
export function RentalRow({
  cost,
  dictionary,
  onChange,
  onRemove,
  mechanics,
  withCrewCategory = false,
  tools,
}: {
  /** W2: „Rozdziel" i „Przenieś do dnia…". */
  tools?: ReactNode
  cost: ProjectCost
  dictionary: RentalDictionary
  onChange: (patch: Partial<ProjectCost>) => void
  onRemove: () => void
  mechanics?: LineMechanics
  withCrewCategory?: boolean
}) {
  const id = useId()
  const dim = mechanics && !mechanics.counted ? 'opacity-50' : ''
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap">
        {mechanics && <TickBox mechanics={mechanics} label={cost.label?.trim() || 'wynajem'} />}
        <select
          id={`${id}-category`}
          value={cost.category}
          aria-label="Kategoria kosztu"
          onChange={(e) => onChange({ category: e.target.value })}
          className={`${fieldClass} min-w-0 flex-1 sm:w-44 sm:flex-none ${dim}`}
        >
          {categoryOptions(cost.category, withCrewCategory).map((c) => (
            <option key={c} value={c}>
              {costCategoryLabel(c)}
            </option>
          ))}
        </select>
        <RentalItemPicker cost={cost} dictionary={dictionary} onChange={onChange} className={`w-full flex-1 sm:w-auto ${dim}`} />
        <QuantityPart cost={cost} onChange={onChange} dim={dim} />
        <AmountInput
          value={cost.unitCost}
          onChange={(unitCost) => onChange({ unitCost })}
          label={(cost.quantity ?? 1) !== 1 ? 'Stawka (zł netto)' : 'Kwota wynajmu (zł netto)'}
          className={`w-24 shrink-0 ${dim}`}
        />
        <span className="w-8 shrink-0 text-xs text-zinc-500">zł</span>
        <RowValue cost={cost} />
        {tools}
        {mechanics && <WorkPill mechanics={mechanics} />}
        <RemoveButton label="Usuń wynajem" onClick={onRemove} />
      </div>
      <div className={`flex flex-wrap items-center gap-1.5 pl-6 text-[11px] text-zinc-500 ${dim}`}>
        <label className="flex items-center gap-1">
          dni
          <DaysInput value={cost.rentalDays} onChange={(rentalDays) => onChange({ rentalDays })} className="h-7" />
        </label>
        <input
          value={cost.vendor ?? ''}
          placeholder="Wypożyczalnia"
          aria-label="Wypożyczalnia"
          onChange={(e) => onChange({ vendor: e.target.value || undefined })}
          className={`${fieldClass} h-7 w-40 text-xs`}
        />
      </div>
    </div>
  )
}

/** Podpowiedzi ról dla pól „Rola" (jedna lista na zakładkę): aktywne role z bazy Ekipa. */
export function CrewRoleDatalist({ id, names }: { id: string; names: string[] }) {
  return (
    <datalist id={id}>
      {names.map((name) => (
        <option key={name} value={name} />
      ))}
    </datalist>
  )
}
