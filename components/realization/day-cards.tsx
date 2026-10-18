'use client'

/**
 * Karty dni realizacji (R2, B3): data i miejsce z kalendarza, ekipa i sprzęt
 * dnia — wprost z dnia wyceny (dzień N → N-ty dzień zdjęciowy), z
 * zaznaczeniem „było" i „Zewnętrzny | Moja praca". Mój sprzęt z katalogu to
 * „mój sprzęt" bez kwoty (zaznacza się go w siatce niżej); sprzęt z
 * wypożyczalni to koszt zewnętrzny.
 */

import { useState } from 'react'
import { ClipboardList, Plus, Trash2, Users } from 'lucide-react'
import { costAmount, isCrew, isOwnWork, type CrewSuggestion, type NewCost } from '@/lib/project-costs'
import type { DayInfo } from '@/lib/realization-days'
import type { GearDay, ProjectCost } from '@/lib/project-types'
import { itemLabel } from '@/lib/pl-plural'
import { KindChip, mono, pln } from '@/components/calendar/calendar-bits'
import type { DayRemoval } from '@/components/equipment/project-equipment'
import { CostRow, CrewRow, type LineMechanics } from './cost-rows'
import { DayCalendar, type DayCalendarActions } from './day-calendar'

const smallButton =
  'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-semibold text-zinc-400 outline-none hover:bg-white/5 hover:text-zinc-100 focus-visible:ring-2 focus-visible:ring-white/60'

/** Koszty zewnętrzne i moja praca z wierszy (zaznaczonych). */
export function lineTotals(lines: ProjectCost[]): { external: number; own: number } {
  return lines.reduce(
    (acc, c) => {
      if (c.skipped) return acc
      if (isOwnWork(c)) acc.own += costAmount(c)
      else acc.external += costAmount(c)
      return acc
    },
    { external: 0, own: 0 }
  )
}

export function TotalsText({ lines, label }: { lines: ProjectCost[]; label: string }) {
  const { external, own } = lineTotals(lines)
  return (
    <div className="text-right">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="text-sm font-semibold tabular-nums text-amber-300/90" style={mono}>
        {external > 0 ? pln(external) : '—'}
      </div>
      {own > 0 && (
        <div className="text-[11px] tabular-nums text-sky-300/80" style={mono}>
          moja praca {pln(own)}
        </div>
      )}
    </div>
  )
}

export interface LineHandlers {
  outsiders: CrewSuggestion[]
  roleListId: string
  mechanics: (cost: ProjectCost) => LineMechanics
  onChangeCost: (cost: ProjectCost, patch: Partial<ProjectCost>) => void
  onRemoveCost: (cost: ProjectCost) => void
}

/** Wiersze ekipy i kosztów jednej grupy (dzień albo dzień wyceny bez odpowiednika). */
export function DayLines({ lines, handlers }: { lines: ProjectCost[]; handlers: LineHandlers }) {
  const crew = lines.filter(isCrew)
  const rentals = lines.filter((c) => !isCrew(c) && c.category === 'wynajem')
  const other = lines.filter((c) => !isCrew(c) && c.category !== 'wynajem')
  return (
    <>
      {crew.length > 0 && (
        <div className="space-y-1.5">
          {crew.map((cost) => (
            <CrewRow
              key={cost.id}
              cost={cost}
              outsiders={handlers.outsiders}
              roleListId={handlers.roleListId}
              mechanics={handlers.mechanics(cost)}
              onChange={(patch) => handlers.onChangeCost(cost, patch)}
              onRemove={() => handlers.onRemoveCost(cost)}
            />
          ))}
        </div>
      )}
      {[...rentals, ...other].length > 0 && (
        <div className="mt-1.5 space-y-1.5">
          {[...rentals, ...other].map((cost) => (
            <CostRow
              key={cost.id}
              cost={cost}
              withCrewCategory={false}
              mechanics={handlers.mechanics(cost)}
              onChange={(patch) => handlers.onChangeCost(cost, patch)}
              onRemove={() => handlers.onRemoveCost(cost)}
            />
          ))}
        </div>
      )}
    </>
  )
}

export interface DayCardsProps {
  days: GearDay[]
  info: Map<string, DayInfo>
  /** Wiersze każdego dnia (`layoutRealization`). */
  lines: Map<string, ProjectCost[]>
  /** Odpracował sprzęt w dniu (z podsumowania siatki). */
  rentByDay: Map<string, number>
  handlers: LineHandlers
  dayLabel: (day: GearDay, index: number) => string
  calendar: DayCalendarActions
  dayRemoval: (day: GearDay) => DayRemoval
  onRemoveDay: (day: GearDay) => void
  onAddCost: (dayId: string, init: NewCost) => void
  onCopyCrew: (dayId: string) => void
  /** Call sheet dnia (T5b): liczba wpisów harmonogramu, `null` = jeszcze go nie ma. */
  callSheetOf: (day: GearDay) => { entries: number } | null
  /** `false`, dopóki call sheety się wczytują (bez tego powstałby drugi call sheet dnia). */
  callSheetsReady: boolean
  onOpenCallSheet: (day: GearDay) => void
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
  lines,
  rentByDay,
  handlers,
  dayLabel,
  calendar,
  dayRemoval,
  onRemoveDay,
  onAddCost,
  onCopyCrew,
  callSheetOf,
  callSheetsReady,
  onOpenCallSheet,
}: DayCardsProps & { day: GearDay; index: number }) {
  const [confirm, setConfirm] = useState(false)
  const dayInfo = info.get(day.id)
  const dayLines = lines.get(day.id) ?? []
  const crew = dayLines.filter(isCrew)
  const rent = rentByDay.get(day.id) ?? 0
  const removal: DayRemoval = days.length > 1 ? dayRemoval(day) : { ok: false, reason: '' }
  const inCalendar = dayInfo?.link === 'calendar'
  const callSheet = callSheetOf(day)

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
          <button
            type="button"
            onClick={() => onOpenCallSheet(day)}
            disabled={!callSheetsReady}
            aria-label={`Call sheet: ${dayLabel(day, index)}`}
            title={
              callSheet
                ? 'Harmonogram dnia, ekipa z telefonami, lista pakowania i PDF'
                : 'Zaplanuj dzień: harmonogram, ekipa z telefonami, lista pakowania i PDF'
            }
            className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:opacity-40 ${
              callSheet ? 'border-primary/40 bg-primary/10 text-orange-100 hover:bg-primary/15' : 'border-white/10 text-zinc-300 hover:bg-white/5'
            }`}
          >
            <ClipboardList className="size-3.5" />
            Call sheet
            {callSheet && callSheet.entries > 0 && (
              <span className="rounded bg-black/30 px-1 text-[10px] tabular-nums text-orange-200/90">{callSheet.entries}</span>
            )}
          </button>
          <TotalsText lines={dayLines} label="Koszty dnia" />
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

      <section className="mt-3" aria-label="Ekipa i sprzęt">
        <h5 className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Ekipa i sprzęt</h5>
        <DayLines lines={dayLines} handlers={handlers} />
        <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2 text-xs text-zinc-400">
          <span className="font-semibold text-zinc-300">Mój sprzęt</span>
          <span className="text-zinc-500">
            {day.lines.length > 0
              ? `${day.lines.length} ${itemLabel(day.lines.length)} z katalogu${rent > 0 ? ` · odpracował ${pln(rent)}` : ''} — bez kwoty (siatka niżej)`
              : 'nic nie zaznaczono (siatka niżej)'}
          </span>
        </p>
        <div className="mt-1 flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => onAddCost(day.id, { category: 'ekipa', person: '', role: '', quantity: 1, unitCost: 0 })}
            className={`${smallButton} -ml-1.5`}
          >
            <Plus className="size-3.5" />
            Osoba
          </button>
          <button
            type="button"
            onClick={() => onAddCost(day.id, { category: 'wynajem', label: '', quantity: 1, unitCost: 0 })}
            className={smallButton}
          >
            <Plus className="size-3.5" />
            Koszt dnia (wynajem…)
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
    </article>
  )
}
