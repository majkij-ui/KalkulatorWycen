'use client'

/**
 * Harmonogram jako lista do odhaczania na planie (port `call-sheet.tsx` z
 * CallSheetWiz): wpisy po godzinie, czas trwania, notatki, tag, punkty pod
 * wpisem (ujęcia) z odhaczaniem, edycją, kolejnością i usuwaniem.
 *
 * Odhaczenie całego wpisu żyje tylko w tej sesji (jak w CallSheetWiz —
 * postęp na planie, nie dane); odhaczenia punktów zapisują się w call sheecie.
 * Kolejność punktów: strzałki zamiast przeciągania (hub nie ma @dnd-kit, a
 * przyciski działają też z klawiatury).
 */

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronUp, Pencil, Plus, StickyNote, Trash2, X } from 'lucide-react'
import { addSubItem, moveSubItem, removeSubItem, updateSubItem } from '@/lib/call-sheet'
import type { Category, PlannerEvent } from '@/lib/schedule-types'
import { formatDuration, minutesToHHMM } from '@/lib/time'
import { mono } from '@/components/calendar/calendar-bits'
import { Checkbox } from '@/components/ui/checkbox'
import { TagChip, iconButton, inputClass } from './planner-bits'

interface ScheduleTableProps {
  events: PlannerEvent[]
  categories: Category[]
  onEdit: (event: PlannerEvent) => void
  onDelete: (event: PlannerEvent) => void
  onUpdateEvent: (event: PlannerEvent) => void
}

export function ScheduleTable({ events, categories, onEdit, onDelete, onUpdateEvent }: ScheduleTableProps) {
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<{ eventId: string; subId: string; draft: string } | null>(null)
  const [focusEventId, setFocusEventId] = useState<string | null>(null)
  const inputRefs = useRef(new Map<string, HTMLInputElement>())
  const categoryById = new Map(categories.map((c) => [c.id, c]))

  useEffect(() => {
    if (!focusEventId) return
    const input = inputRefs.current.get(focusEventId)
    if (!input) return
    input.focus()
    setFocusEventId(null)
  }, [focusEventId, expanded])

  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }

  const revealInput = (eventId: string) => {
    setExpanded((prev) => new Set(prev).add(eventId))
    setFocusEventId(eventId)
  }

  const add = (event: PlannerEvent) => {
    const draft = drafts[event.id] ?? ''
    if (!draft.trim()) return
    onUpdateEvent(addSubItem(event, draft))
    setDrafts((prev) => ({ ...prev, [event.id]: '' }))
  }

  const saveEdit = (event: PlannerEvent) => {
    if (!editing || editing.eventId !== event.id) return
    const text = editing.draft.trim()
    if (!text) return
    onUpdateEvent(updateSubItem(event, editing.subId, { text }))
    setEditing(null)
  }

  const liveIds = new Set(events.map((e) => e.id))
  const done = [...checked].filter((id) => liveIds.has(id)).length
  const total = events.length
  const progress = total > 0 ? (done / total) * 100 : 0

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-zinc-500">Na planie odhaczaj, co już za wami (tylko w tej sesji).</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500" style={mono}>
            {done}/{total}
          </span>
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/5">
            <div className="h-full rounded-full bg-emerald-500 transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>

      <div className="divide-y divide-white/5 overflow-hidden rounded-xl border border-white/5 bg-zinc-900/40">
        {events.length === 0 && <p className="px-4 py-6 text-center text-sm text-zinc-500">Brak wpisów.</p>}
        {events.map((event) => {
          const isChecked = checked.has(event.id)
          const isExpanded = expanded.has(event.id)
          const subItems = event.subItems ?? []
          const doneSubs = subItems.filter((s) => s.isCompleted).length
          return (
            <div key={event.id} className="group/event">
              <div
                className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 transition-colors hover:bg-white/[0.03] ${isChecked ? 'opacity-50' : ''}`}
              >
                <Checkbox
                  id={`plan-${event.id}`}
                  checked={isChecked}
                  onCheckedChange={() => setChecked((prev) => toggle(prev, event.id))}
                  aria-label={`Odhacz „${event.title}"`}
                  className="border-white/20"
                />
                <span className="w-[6.5rem] shrink-0 text-sm text-zinc-100" style={mono}>
                  {minutesToHHMM(event.startMinutes)}–{minutesToHHMM(event.endMinutes)}
                </span>
                <span className="hidden w-[5.5rem] shrink-0 whitespace-nowrap text-xs text-zinc-500 lg:inline" style={mono}>
                  {formatDuration(event.startMinutes, event.endMinutes)}
                </span>
                {/* Wąski ekran: tytuł w drugiej linii na całą szerokość, żeby godzina i tag go nie zgniotły. */}
                <div className="order-last flex w-full min-w-0 flex-col gap-0.5 pl-7 sm:order-none sm:w-auto sm:flex-1 sm:pl-0">
                  <label
                    htmlFor={`plan-${event.id}`}
                    className={`cursor-pointer truncate text-sm font-medium ${isChecked ? 'text-zinc-500 line-through' : 'text-zinc-100'}`}
                  >
                    {event.title}
                  </label>
                  {event.notes && (
                    <span className="flex items-center gap-1 truncate text-xs text-zinc-500">
                      <StickyNote className="size-3 shrink-0" />
                      {event.notes}
                    </span>
                  )}
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-2">
                  {subItems.length > 0 && (
                    <span className="hidden shrink-0 rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-zinc-400 lg:inline" style={mono}>
                      {doneSubs}/{subItems.length} ujęć
                    </span>
                  )}
                  <TagChip category={categoryById.get(event.categoryId)} />
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button type="button" onClick={() => revealInput(event.id)} className={iconButton} title="Dodaj punkt (ujęcie)" aria-label={`Dodaj punkt do „${event.title}"`}>
                      <Plus className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setExpanded((prev) => toggle(prev, event.id))}
                      className={iconButton}
                      aria-expanded={isExpanded}
                      aria-label={`${isExpanded ? 'Zwiń' : 'Rozwiń'} punkty „${event.title}"`}
                    >
                      <ChevronDown className={`size-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                    </button>
                    <span className="hidden items-center gap-0.5 opacity-0 transition-opacity group-hover/event:opacity-100 group-focus-within/event:opacity-100 sm:flex">
                      <button type="button" onClick={() => onEdit(event)} className={iconButton} aria-label={`Edytuj „${event.title}"`}>
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(event)}
                        className={`${iconButton} hover:text-red-300`}
                        aria-label={`Usuń „${event.title}"`}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </span>
                  </div>
                </div>
              </div>

              {isExpanded && (
                <div className="mb-2.5 ml-9 mr-3 rounded-lg border border-white/5 bg-black/20 p-2.5 sm:ml-12">
                  <input
                    ref={(node) => {
                      if (node) inputRefs.current.set(event.id, node)
                      else inputRefs.current.delete(event.id)
                    }}
                    value={drafts[event.id] ?? ''}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [event.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return
                      e.preventDefault()
                      add(event)
                    }}
                    placeholder="Dodaj punkt i naciśnij Enter…"
                    aria-label={`Nowy punkt w „${event.title}"`}
                    className={`${inputClass} h-7 text-xs`}
                  />
                  {subItems.length > 0 ? (
                    <ul className="mt-2 flex flex-col gap-1">
                      {subItems.map((sub, index) => {
                        const isEditing = editing?.eventId === event.id && editing.subId === sub.id
                        return (
                          <li key={sub.id} className="group/sub flex items-center gap-2">
                            <Checkbox
                              checked={sub.isCompleted}
                              onCheckedChange={(value) => onUpdateEvent(updateSubItem(event, sub.id, { isCompleted: Boolean(value) }))}
                              aria-label={`Odhacz „${sub.text}"`}
                              className="border-white/20"
                            />
                            {isEditing ? (
                              <>
                                <input
                                  value={editing.draft}
                                  onChange={(e) => setEditing({ ...editing, draft: e.target.value })}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault()
                                      saveEdit(event)
                                    }
                                    if (e.key === 'Escape') {
                                      e.preventDefault()
                                      setEditing(null)
                                    }
                                  }}
                                  autoFocus
                                  aria-label={`Zmień „${sub.text}"`}
                                  className={`${inputClass} h-7 flex-1 text-xs`}
                                />
                                <button type="button" onClick={() => saveEdit(event)} className={`${iconButton} size-6 hover:text-emerald-300`} aria-label="Zapisz punkt">
                                  <Check className="size-3" />
                                </button>
                                <button type="button" onClick={() => setEditing(null)} className={`${iconButton} size-6`} aria-label="Anuluj">
                                  <X className="size-3" />
                                </button>
                              </>
                            ) : (
                              <>
                                <span className={`min-w-0 flex-1 text-xs ${sub.isCompleted ? 'text-zinc-500 line-through' : 'text-zinc-200'}`}>
                                  {sub.text}
                                </span>
                                <span className="flex items-center opacity-0 transition-opacity group-hover/sub:opacity-100 group-focus-within/sub:opacity-100">
                                  <button
                                    type="button"
                                    disabled={index === 0}
                                    onClick={() => onUpdateEvent(moveSubItem(event, sub.id, -1))}
                                    className={`${iconButton} size-6 disabled:opacity-30`}
                                    aria-label={`Wyżej: „${sub.text}"`}
                                  >
                                    <ChevronUp className="size-3" />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={index === subItems.length - 1}
                                    onClick={() => onUpdateEvent(moveSubItem(event, sub.id, 1))}
                                    className={`${iconButton} size-6 disabled:opacity-30`}
                                    aria-label={`Niżej: „${sub.text}"`}
                                  >
                                    <ChevronDown className="size-3" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditing({ eventId: event.id, subId: sub.id, draft: sub.text })}
                                    className={`${iconButton} size-6`}
                                    aria-label={`Zmień „${sub.text}"`}
                                  >
                                    <Pencil className="size-3" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => onUpdateEvent(removeSubItem(event, sub.id))}
                                    className={`${iconButton} size-6 hover:text-red-300`}
                                    aria-label={`Usuń „${sub.text}"`}
                                  >
                                    <X className="size-3" />
                                  </button>
                                </span>
                              </>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  ) : (
                    <p className="mt-2 text-xs text-zinc-600">Bez punktów.</p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
