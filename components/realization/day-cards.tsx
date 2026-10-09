'use client'

/**
 * Karty dni realizacji: data i miejsce z kalendarza, sprzęt dnia (skrót —
 * zaznacza się go w siatce niżej), ekipa i koszty tego dnia.
 */

import { useState } from 'react'
import { Plus, Trash2, Users } from 'lucide-react'
import { costAmount, costsOfDay, isCrew, type CrewSuggestion, type NewCost } from '@/lib/project-costs'
import type { DayInfo } from '@/lib/realization-days'
import type { GearDay, ProjectCost } from '@/lib/project-types'
import { itemLabel } from '@/lib/pl-plural'
import { KindChip, mono, pln } from '@/components/calendar/calendar-bits'
import type { DayRemoval } from '@/components/equipment/project-equipment'
import { CostRow, CrewRow } from './cost-rows'
import { DayCalendar, type DayCalendarActions } from './day-calendar'

const smallButton =
  'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-semibold text-zinc-400 outline-none hover:bg-white/5 hover:text-zinc-100 focus-visible:ring-2 focus-visible:ring-white/60'

export interface DayCardsProps {
  days: GearDay[]
  info: Map<string, DayInfo>
  costs: ProjectCost[]
  /** Odpracował sprzęt w dniu (z podsumowania siatki). */
  rentByDay: Map<string, number>
  suggestions: CrewSuggestion[]
  crewListId: string
  dayLabel: (day: GearDay, index: number) => string
  calendar: DayCalendarActions
  dayRemoval: (day: GearDay) => DayRemoval
  onRemoveDay: (day: GearDay) => void
  onAddCost: (dayId: string, init: NewCost) => void
  onChangeCost: (id: string, patch: Partial<ProjectCost>) => void
  onRemoveCost: (cost: ProjectCost) => void
  onCopyCrew: (dayId: string) => void
}

export function DayCards(props: DayCardsProps) {
  const { days } = props
  if (days.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-zinc-500">
        Projekt nie ma dni realizacji. Dodaj dzień przyciskiem „Dzień" albo dzień zdjęciowy w kalendarzu.
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {days.map((day, index) => (
        <DayCard key={day.id} day={day} index={index} {...props} />
      ))}
    </div>
  )
}

function DayCard({
  day,
  index,
  days,
  info,
  costs,
  rentByDay,
  suggestions,
  crewListId,
  dayLabel,
  calendar,
  dayRemoval,
  onRemoveDay,
  onAddCost,
  onChangeCost,
  onRemoveCost,
  onCopyCrew,
}: DayCardsProps & { day: GearDay; index: number }) {
  const [confirm, setConfirm] = useState(false)
  const dayInfo = info.get(day.id)
  const dayCosts = costsOfDay(costs, day.id)
  const crew = dayCosts.filter(isCrew)
  const other = dayCosts.filter((c) => !isCrew(c))
  const total = dayCosts.reduce((sum, c) => sum + costAmount(c), 0)
  const rent = rentByDay.get(day.id) ?? 0
  const removal: DayRemoval = days.length > 1 ? dayRemoval(day) : { ok: false, reason: '' }
  const inCalendar = dayInfo?.link === 'calendar'

  return (
    <article
      className={`rounded-xl border bg-zinc-900/40 p-4 ${inCalendar ? 'border-white/5' : 'border-amber-400/15'}`}
      aria-label={dayLabel(day, index)}
    >
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <KindChip kind={dayInfo?.kind ?? 'shoot_day'} />
            <h4 className="truncate text-sm font-semibold text-white">{dayLabel(day, index)}</h4>
          </div>
          <DayCalendar day={day} info={dayInfo} actions={calendar} />
        </div>
        <div className="flex items-start gap-3">
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">Koszty dnia</div>
            <div className="text-sm font-semibold tabular-nums text-amber-300/90" style={mono}>
              {total > 0 ? pln(total) : '—'}
            </div>
          </div>
          {removal.ok &&
            (confirm ? (
              <button
                type="button"
                onClick={() => {
                  setConfirm(false)
                  onRemoveDay(day)
                }}
                className="rounded-md bg-red-500/15 px-2 py-1 text-xs font-semibold text-red-200 hover:bg-red-500/25"
              >
                Usuń dzień
              </button>
            ) : (
              <button
                type="button"
                aria-label={`Usuń ${dayLabel(day, index)}`}
                title="Usuń dzień"
                onClick={() => (removal.confirm ? setConfirm(true) : onRemoveDay(day))}
                className="rounded-md p-1.5 text-zinc-600 hover:bg-red-500/10 hover:text-red-300"
              >
                <Trash2 className="size-3.5" />
              </button>
            ))}
        </div>
      </header>
      {confirm && removal.ok && removal.confirm && (
        <p className="mt-1 text-right text-[11px] text-zinc-500">{removal.confirm}</p>
      )}

      <p className="mt-2 text-[11px] text-zinc-500">
        Sprzęt:{' '}
        {day.lines.length > 0
          ? `${day.lines.length} ${itemLabel(day.lines.length)}${rent > 0 ? ` · odpracował ${pln(rent)}` : ''}`
          : 'nic nie zaznaczono (siatka niżej)'}
      </p>

      <section className="mt-3" aria-label="Ekipa">
        <h5 className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Ekipa</h5>
        <div className="space-y-1.5">
          {crew.map((cost) => (
            <CrewRow
              key={cost.id}
              cost={cost}
              suggestions={suggestions}
              listId={crewListId}
              onChange={(patch) => onChangeCost(cost.id, patch)}
              onRemove={() => onRemoveCost(cost)}
            />
          ))}
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => onAddCost(day.id, { category: 'ekipa', person: '', role: '', quantity: 1, unitCost: 0 })}
            className={`${smallButton} -ml-1.5`}
          >
            <Plus className="size-3.5" />
            Osoba
          </button>
          {crew.length > 0 && days.length > 1 && (
            <button
              type="button"
              onClick={() => onCopyCrew(day.id)}
              className={smallButton}
              title="Dopisuje te osoby do pozostałych dni, w których ich jeszcze nie ma"
            >
              <Users className="size-3.5" />
              Ta sama ekipa we wszystkich dniach
            </button>
          )}
        </div>
      </section>

      <section className="mt-3" aria-label="Koszty dnia">
        <h5 className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Inne koszty dnia</h5>
        <div className="space-y-1.5">
          {other.map((cost) => (
            <CostRow
              key={cost.id}
              cost={cost}
              withCrewCategory={false}
              onChange={(patch) => onChangeCost(cost.id, patch)}
              onRemove={() => onRemoveCost(cost)}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => onAddCost(day.id, { category: 'catering', label: '', quantity: 1, unitCost: 0 })}
          className={`${smallButton} -ml-1.5 mt-1`}
        >
          <Plus className="size-3.5" />
          Koszt (catering, wynajem, dojazd…)
        </button>
      </section>
    </article>
  )
}
