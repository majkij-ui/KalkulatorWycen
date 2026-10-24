'use client'

/**
 * „Wynajem sprzętu" na górze Kosztów projektu (U2, plan §17.1): JEDNA liczba
 * wynajmu projektu. Stały wiersz z kwotą za cały projekt (0 zł, dopóki nic
 * nie wpisano), pod nim pozycje z wynajmu (ze słownika albo dodane na
 * miejscu) — najpierw wypełniają wpisaną kwotę („bez szczegółów"), potem ją
 * podnoszą (`rentals.ts`). Wynajem w dniach edytuje się w kartach dni; tu jest
 * tylko jego suma, bo liczy się do tej samej liczby.
 */

import { useState } from 'react'
import { Plus } from 'lucide-react'
import type { ProjectCost } from '@/lib/project-types'
import { RENTAL_LINE_LABEL, rentalNameKey, type RentalBlock } from '@/lib/rentals'
import { archivo, mono, pln } from '@/components/calendar/calendar-bits'
import { AmountInput, RemoveButton, RentalRow, TickBox, WorkPill, type LineMechanics } from './cost-rows'
import { RentalItemPicker, type RentalDictionary } from './rental-item-picker'

export interface RentalBlockHandlers {
  mechanics: (cost: ProjectCost) => LineMechanics
  /** Kwota w polu „Wynajem sprzętu" (za cały projekt). */
  onTyped: (value: number) => void
  /** Zaznaczenie / „Moja praca" wiersza bez szczegółów. */
  onRestChange: (cost: ProjectCost, patch: Partial<ProjectCost>) => void
  onRestRemove: (cost: ProjectCost) => void
  /** Nowa pozycja z wynajmu (po wyborze ze słownika). */
  onAddItem: (init: Partial<ProjectCost>) => void
  onItemChange: (cost: ProjectCost, patch: Partial<ProjectCost>) => void
  onItemRemove: (cost: ProjectCost) => void
}

export function RentalBlockSection({
  block,
  dictionary,
  handlers,
  dayNames,
}: {
  block: RentalBlock
  dictionary: RentalDictionary
  handlers: RentalBlockHandlers
  /** Nazwy dni z wynajmem („Dzień 1"), do podpisu sumy w dniach. */
  dayNames: string[]
}) {
  const [adding, setAdding] = useState(false)
  const { rest } = block
  const restMechanics = rest ? handlers.mechanics(rest) : null
  const ownLabel = rest?.label?.trim() && rentalNameKey(rest.label) !== rentalNameKey(RENTAL_LINE_LABEL) ? rest.label.trim() : null

  return (
    <div className="space-y-1.5 rounded-lg border border-white/5 bg-white/[0.02] p-2.5" aria-label="Wynajem sprzętu">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold text-white" style={archivo}>
          Wynajem sprzętu
        </h4>
        <div className="text-right text-xs text-zinc-500">
          razem{' '}
          <span className="text-sm font-semibold text-amber-300/90" style={mono}>
            {pln(block.total)}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap">
        {restMechanics ? (
          <TickBox mechanics={restMechanics} label={RENTAL_LINE_LABEL} />
        ) : (
          <span className="size-4 shrink-0" aria-hidden />
        )}
        <span className={`min-w-0 flex-1 text-sm text-zinc-200 ${restMechanics && !restMechanics.counted ? 'opacity-50' : ''}`}>
          Za cały projekt
          {ownLabel && <span className="ml-1.5 text-xs text-zinc-500">({ownLabel})</span>}
        </span>
        <AmountInput
          value={block.typed}
          onChange={handlers.onTyped}
          label="Wynajem sprzętu za cały projekt (zł netto)"
          className="w-24 shrink-0"
        />
        <span className="w-8 shrink-0 text-xs text-zinc-500">zł</span>
        {restMechanics ? <WorkPill mechanics={restMechanics} /> : <span className="hidden w-[168px] shrink-0 sm:block" aria-hidden />}
        {rest ? (
          <RemoveButton label="Usuń kwotę za cały projekt" onClick={() => handlers.onRestRemove(rest)} />
        ) : (
          <span className="size-7 shrink-0" aria-hidden />
        )}
      </div>
      {block.items.length > 0 && block.restCounts && (
        <p className="pl-6 text-[11px] text-zinc-500">
          {block.overTyped > 0.5
            ? `Pozycje są o ${pln(block.overTyped)} wyższe niż wpisana kwota — liczy się ${pln(block.projectTotal)}.`
            : `w tym bez szczegółów ${pln(block.restAmount)} — pozycje najpierw wypełniają wpisaną kwotę`}
        </p>
      )}

      {block.items.length > 0 && (
        <div className="space-y-1.5 pt-1">
          {block.items.map((cost) => (
            <RentalRow
              key={cost.id}
              cost={cost}
              dictionary={dictionary}
              withCrewCategory
              mechanics={handlers.mechanics(cost)}
              onChange={(patch) => handlers.onItemChange(cost, patch)}
              onRemove={() => handlers.onItemRemove(cost)}
            />
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        {adding ? (
          <div className="flex w-full flex-wrap items-center gap-1.5 sm:flex-nowrap">
            <RentalItemPicker
              cost={{}}
              dictionary={dictionary}
              autoFocus
              className="w-full flex-1 sm:max-w-sm"
              onChange={(patch) => {
                if (!patch.rentalItemId) return
                handlers.onAddItem(patch)
                setAdding(false)
              }}
            />
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="rounded-md px-1.5 py-1 text-xs text-zinc-500 hover:text-zinc-200"
            >
              Anuluj
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="-ml-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-semibold text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
          >
            <Plus className="size-3.5" />
            Pozycja z wynajmu
          </button>
        )}
        {block.days.length > 0 && (
          <span className="text-[11px] text-zinc-500">
            w dniach {pln(block.daysTotal)}
            {dayNames.length > 0 && ` (${dayNames.join(', ')})`} — edycja w kartach dni
          </span>
        )}
      </div>
    </div>
  )
}
