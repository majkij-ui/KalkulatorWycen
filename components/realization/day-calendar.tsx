'use client'

/**
 * Data dnia realizacji i jego miejsce w kalendarzu (wariant A: datę trzyma
 * kalendarz). Ten sam kawałek jest w karcie dnia i w popoverze kolumny siatki.
 *
 *   dzień z kalendarza → data + „Edytuj w kalendarzu" (formularz wydarzenia)
 *   bez wydarzenia     → pole daty + „Dodaj do kalendarza"
 *   usunięte wydarzenie → „Przywróć w kalendarzu" albo dodanie na nowo
 */

import { useState } from 'react'
import { CalendarPlus, CalendarDays, RotateCcw } from 'lucide-react'
import { eventData } from '@/lib/event-kinds'
import type { TimelineEvent } from '@/lib/event-types'
import type { DayInfo } from '@/lib/realization-days'
import type { GearDay } from '@/lib/project-types'
import { fieldClass } from './cost-rows'

/** `YYYY-MM-DD` → „wt 28.10.2026". */
export function formatDayLong(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  if (!y || !m || !d) return dateKey
  const weekday = new Date(y, m - 1, d).toLocaleDateString('pl-PL', { weekday: 'short' })
  return `${weekday} ${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`
}

export interface DayCalendarActions {
  onEditEvent: (event: TimelineEvent) => void
  onAddToCalendar: (day: GearDay, date: string) => void
  onRestoreEvent: (event: TimelineEvent) => void
}

const linkButton =
  'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-semibold text-primary outline-none hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-white/60 disabled:cursor-not-allowed disabled:opacity-40'

function AddToCalendar({ day, onAdd }: { day: GearDay; onAdd: (date: string) => void }) {
  // Lokalnie: pole daty odpala onChange przy każdej cyfrze roku, a każde
  // wydarzenie w kalendarzu to zapis — dodajemy dopiero po kliknięciu.
  const [date, setDate] = useState(day.date)
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= '2000-01-01'
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        aria-label="Data dnia"
        className={`${fieldClass} [color-scheme:dark]`}
      />
      <button type="button" disabled={!valid} onClick={() => onAdd(date)} className={linkButton}>
        <CalendarPlus className="size-3.5" />
        Dodaj do kalendarza
      </button>
    </div>
  )
}

export function DayCalendar({
  day,
  info,
  actions,
  onDone,
}: {
  day: GearDay
  info: DayInfo | undefined
  actions: DayCalendarActions
  /** Popover zamyka się po akcji. */
  onDone?: () => void
}) {
  const done = onDone ?? (() => {})
  const event = info?.event ?? null

  if (info?.link === 'calendar' && event) {
    const location = String(eventData(event).location ?? '')
    return (
      <div className="text-xs">
        <div className="text-zinc-300">
          <CalendarDays className="mr-1 inline size-3.5 align-[-2px] text-zinc-500" />
          {formatDayLong(day.date)}
          {info.eventSpan > 1 && (
            <span className="text-zinc-500">
              {' '}
              · dzień {(day.eventDay ?? 0) + 1} z {info.eventSpan}
            </span>
          )}
          {location && <span className="text-zinc-500"> · {location}</span>}
        </div>
        <button
          type="button"
          onClick={() => {
            done()
            actions.onEditEvent(event)
          }}
          className={`${linkButton} -ml-1.5 mt-0.5`}
        >
          Edytuj w kalendarzu
        </button>
      </div>
    )
  }

  const message =
    info?.link === 'event-gone'
      ? 'Wydarzenie tego dnia usunięto z kalendarza. Sprzęt, ekipa i koszty zostały.'
      : info?.link === 'event-changed'
        ? 'Wydarzenie w kalendarzu się zmieniło (zakres, typ albo projekt), a ten dzień został poza nim.'
        : info?.link === 'not-in-calendar'
          ? 'Tego dnia nie ma w kalendarzu.'
          : 'Bez daty — nie ma go w kalendarzu.'

  return (
    <div className="space-y-1 text-xs">
      <p className="text-amber-200/80">{message}</p>
      <div className="flex flex-wrap items-center gap-1">
        {info?.link === 'event-gone' && event?.deletedAt && (
          <button
            type="button"
            onClick={() => {
              done()
              actions.onRestoreEvent(event)
            }}
            className={`${linkButton} -ml-1.5`}
          >
            <RotateCcw className="size-3.5" />
            Przywróć w kalendarzu
          </button>
        )}
        {info?.link === 'event-changed' && event && (
          <button
            type="button"
            onClick={() => {
              done()
              actions.onEditEvent(event)
            }}
            className={`${linkButton} -ml-1.5`}
          >
            Pokaż wydarzenie
          </button>
        )}
      </div>
      <AddToCalendar
        // Nowa ostatnia znana data (np. wydarzenie przesunięto) zaczyna pole od nowa.
        key={day.date}
        day={day}
        onAdd={(date) => {
          done()
          actions.onAddToCalendar(day, date)
        }}
      />
    </div>
  )
}
