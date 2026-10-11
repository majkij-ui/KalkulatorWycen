'use client'

/**
 * Formularz wpisu harmonogramu (port `event-modal.tsx` z CallSheetWiz):
 * tytuł, tag, początek / koniec / czas trwania zsynchronizowane ze sobą,
 * notatki dla ekipy. Plus „Zaraz po poprzednim" (`followPreviousEvent` z
 * silnika edycji — w CallSheetWiz był w kodzie, ale bez przycisku).
 *
 * Edycja rozkłada istniejący wpis, więc nieznane pola i punkty zostają.
 */

import { useEffect, useId, useState } from 'react'
import { ArrowDownToLine, Trash2 } from 'lucide-react'
import { createCallSheetItemId } from '@/lib/call-sheet-types'
import { followPreviousEvent } from '@/lib/editing-engine'
import type { Category, PlannerEvent } from '@/lib/schedule-types'
import { clampMinutesToDay, getDurationMinutes, hhmmToMinutes, minutesToHHMM } from '@/lib/time'
import { FieldLabel, TagDot, inputClass } from './planner-bits'
import { TimeSpinnerInput } from './time-spinner-input'

interface PlannerEventFormProps {
  /** `null` = nowy wpis. */
  event: PlannerEvent | null
  categories: Category[]
  /** Początek nowego wpisu (koniec ostatniego albo 06:00). */
  defaultStartMinutes: number
  /** Wpis tuż przed tym (do „Zaraz po poprzednim"); `null` = brak. */
  previous: PlannerEvent | null
  onSave: (event: PlannerEvent) => void
  onDelete?: (event: PlannerEvent) => void
  onClose: () => void
}

export function PlannerEventForm({
  event,
  categories,
  defaultStartMinutes,
  previous,
  onSave,
  onDelete,
  onClose,
}: PlannerEventFormProps) {
  const id = useId()
  const [title, setTitle] = useState(event?.title ?? '')
  const [startTime, setStartTime] = useState(minutesToHHMM(event?.startMinutes ?? defaultStartMinutes))
  const [endTime, setEndTime] = useState(event ? minutesToHHMM(event.endMinutes) : '')
  const [durationInput, setDurationInput] = useState(
    event ? String(getDurationMinutes(event.startMinutes, event.endMinutes)) : ''
  )
  const [notes, setNotes] = useState(event?.notes ?? '')
  const [categoryId, setCategoryId] = useState(event ? event.categoryId : (categories[0]?.id ?? ''))
  const [errors, setErrors] = useState<Record<string, string>>({})

  const startMinutes = hhmmToMinutes(startTime)
  const endMinutes = hhmmToMinutes(endTime)

  // Czas trwania idzie za początkiem i końcem, gdy oba są poprawne (nowy wpis
  // zostaje bez końca, dopóki go nie wpiszesz — jak w CallSheetWiz).
  useEffect(() => {
    if (startMinutes !== null && endMinutes !== null && endMinutes > startMinutes) {
      setDurationInput(String(getDurationMinutes(startMinutes, endMinutes)))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startTime, endTime])

  const handleStartChange = (value: string) => {
    setStartTime(value)
    const start = hhmmToMinutes(value)
    const end = hhmmToMinutes(endTime)
    if (start !== null && end !== null && start > end) setEndTime(value)
  }

  const handleEndChange = (value: string) => {
    setEndTime(value)
    const end = hhmmToMinutes(value)
    const start = hhmmToMinutes(startTime)
    if (start !== null && end !== null && end < start) setStartTime(value)
  }

  const handleDurationChange = (value: string) => {
    const num = parseInt(value, 10)
    if (value === '' || Number.isNaN(num)) {
      setDurationInput(value)
      return
    }
    const duration = Math.max(0, num)
    setDurationInput(String(duration))
    const start = hhmmToMinutes(startTime)
    if (start !== null) setEndTime(minutesToHHMM(clampMinutesToDay(start + duration)))
  }

  const followPrevious = () => {
    if (!previous || startMinutes === null) return
    const duration = endMinutes !== null && endMinutes > startMinutes ? endMinutes - startMinutes : 0
    const next = followPreviousEvent({ startMinutes, endMinutes: startMinutes + duration }, previous)
    setStartTime(minutesToHHMM(next.startMinutes))
    if (duration > 0) setEndTime(minutesToHHMM(next.endMinutes))
  }

  const validate = (): boolean => {
    const next: Record<string, string> = {}
    if (!title.trim()) next.title = 'Podaj, co się dzieje.'
    if (startMinutes === null) next.startTime = 'Godzina w formacie GG:MM.'
    if (endMinutes === null) next.endTime = 'Godzina w formacie GG:MM (albo wpisz czas trwania).'
    if (startMinutes !== null && endMinutes !== null && endMinutes <= startMinutes) {
      next.endTime = 'Koniec musi być po początku.'
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate() || startMinutes === null || endMinutes === null) return
    onSave({
      ...(event ?? {}),
      id: event?.id ?? createCallSheetItemId('ev'),
      title: title.trim(),
      startMinutes,
      endMinutes,
      categoryId,
      notes: notes.trim() || undefined,
      subItems: event?.subItems ?? [],
    })
  }

  const canFollow = !!previous && startMinutes !== null && startMinutes !== previous.endMinutes

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div>
        <h3 className="text-base font-bold text-white" style={{ fontFamily: 'var(--font-archivo)' }}>
          {event ? 'Edytuj wpis' : 'Nowy wpis harmonogramu'}
        </h3>
        <p className="mt-0.5 text-xs text-zinc-500">
          {event ? 'Zmień godziny, tag albo notatkę dla ekipy.' : 'Co, kiedy i dla kogo — trafi na oś czasu i na call sheet.'}
        </p>
      </div>

      <div>
        <FieldLabel htmlFor={`${id}-title`}>Co się dzieje</FieldLabel>
        <input
          id={`${id}-title`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="np. Światło — scena 1"
          className={inputClass}
          aria-invalid={!!errors.title}
          autoFocus
        />
        {errors.title && <p className="mt-1 text-xs text-red-300">{errors.title}</p>}
      </div>

      <div>
        <FieldLabel htmlFor={`${id}-tag`}>Tag</FieldLabel>
        <div className="flex items-center gap-2">
          <TagDot category={categories.find((c) => c.id === categoryId)} />
          <select
            id={`${id}-tag`}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className={inputClass}
          >
            <option value="">Bez tagu</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label || 'Bez nazwy'}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div>
          <FieldLabel htmlFor={`${id}-start`}>Początek</FieldLabel>
          <TimeSpinnerInput
            id={`${id}-start`}
            label="Początek"
            value={startTime}
            onChange={handleStartChange}
            fallbackMinutes={defaultStartMinutes}
            invalid={!!errors.startTime}
          />
        </div>
        <div>
          <FieldLabel htmlFor={`${id}-end`}>Koniec</FieldLabel>
          <TimeSpinnerInput
            id={`${id}-end`}
            label="Koniec"
            value={endTime}
            onChange={handleEndChange}
            fallbackMinutes={startMinutes ?? defaultStartMinutes}
            invalid={!!errors.endTime}
          />
        </div>
        <div>
          <FieldLabel htmlFor={`${id}-duration`}>Czas (min)</FieldLabel>
          <input
            id={`${id}-duration`}
            type="number"
            min={0}
            max={1440}
            value={durationInput}
            onChange={(e) => handleDurationChange(e.target.value)}
            className={`${inputClass} tabular-nums`}
          />
        </div>
      </div>
      {(errors.startTime || errors.endTime) && (
        <p className="-mt-1 text-xs text-red-300">{errors.startTime ?? errors.endTime}</p>
      )}
      {previous && (
        <button
          type="button"
          onClick={followPrevious}
          disabled={!canFollow}
          className="-mt-1 inline-flex items-center gap-1 self-start rounded-md px-1.5 py-1 text-xs font-semibold text-zinc-400 hover:bg-white/5 hover:text-zinc-100 disabled:cursor-default disabled:opacity-40"
          title={`Początek = koniec „${previous.title}" (${minutesToHHMM(previous.endMinutes)})`}
        >
          <ArrowDownToLine className="size-3.5" />
          Zaraz po poprzednim ({minutesToHHMM(previous.endMinutes)})
        </button>
      )}

      <div>
        <FieldLabel htmlFor={`${id}-notes`}>Notatki dla ekipy</FieldLabel>
        <textarea
          id={`${id}-notes`}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="np. Wszyscy na bazie, odprawa BHP"
          className={`${inputClass} h-auto resize-y py-1.5`}
        />
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-white/70"
        >
          Zapisz
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-3 py-1.5 text-xs font-semibold text-zinc-400 outline-none hover:text-zinc-100 focus-visible:ring-2 focus-visible:ring-white/60"
        >
          Anuluj
        </button>
        {event && onDelete && (
          <button
            type="button"
            onClick={() => onDelete(event)}
            className="ml-auto flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-semibold text-zinc-500 outline-none hover:bg-red-500/10 hover:text-red-300 focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <Trash2 className="size-3.5" />
            Usuń
          </button>
        )}
      </div>
    </form>
  )
}
