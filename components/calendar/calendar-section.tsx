'use client'

/**
 * Kalendarz — ekran startowy kokpitu (plan §4, wariant A z §5c).
 *
 * Wątek projektu w jednym miejscu: klik w kafel podświetla wszystkie
 * wydarzenia projektu i pokazuje jego oś czasu z wyliczonymi liczbami. Klik w
 * dzień pokazuje ten dzień i „Dodaj". Sprawy firmy (zakupy sprzętu, marketing)
 * mają neutralny kafel. Statusy projektu zmieniają się tylko po potwierdzeniu.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { EVENT_GROUPS, EVENT_GROUP_LABELS, groupChip, type EventGroup } from '@/lib/calendar-palette'
import { buildCalendarEntries, monthSummary, type CalendarEntry } from '@/lib/calendar-entries'
import { dayKey, monthGrid } from '@/lib/calendar-layout'
import { eventKind } from '@/lib/event-kinds'
import { useEvents } from '@/lib/events-context'
import { useEquipment } from '@/lib/equipment-context'
import { useProjectHub } from '@/lib/project-hub-context'
import { toDateKey } from '@/lib/project-types'
import { plural } from '@/lib/pl-plural'
import { MONTHS, archivo, mono, pln } from './calendar-bits'
import { MonthGrid } from './month-grid'
import { DayPanel } from './day-panel'
import { ThreadPanel } from './thread-panel'
import { EventForm, type FormTarget, type SavedInfo } from './event-form'
import { EventNotice, noticeAfterSave, type EventNoticeState } from './event-notice'

/** Od tej szerokości okna panel stoi obok siatki (okno Tauri ma 1400 px). */
const SIDE_PANEL_QUERY = '(min-width: 1260px)'

function coversDay(entry: CalendarEntry, day: string): boolean {
  const start = dayKey(entry.start)
  const end = entry.end ? dayKey(entry.end) : start
  return start <= day && (end >= start ? end : start) >= day
}

export function CalendarSection({ onOpenProject }: { onOpenProject: (id: string) => void }) {
  const today = toDateKey(new Date())
  const { events } = useEvents()
  const { items } = useEquipment()
  const { projects } = useProjectHub()

  const [cursor, setCursor] = useState(() => ({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) }))
  const [selectedDay, setSelectedDay] = useState(today)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [form, setForm] = useState<{ target: FormTarget; key: number } | null>(null)
  const [hiddenGroups, setHiddenGroups] = useState<Set<EventGroup>>(new Set())
  const [notice, setNotice] = useState<EventNoticeState | null>(null)
  const panelRef = useRef<HTMLElement>(null)

  const projectsById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])
  const entries = useMemo(() => buildCalendarEntries(events, items), [events, items])
  const visibleEntries = useMemo(
    () => entries.filter((e) => !hiddenGroups.has(eventKind(e.kind).group)),
    [entries, hiddenGroups]
  )
  const weeks = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor])
  const monthPrefix = `${cursor.year}-${String(cursor.month).padStart(2, '0')}`
  const summary = useMemo(() => monthSummary(entries, cursor.year, cursor.month), [entries, cursor])

  const focusProject = focusId ? projectsById.get(focusId) : undefined
  const threadEntries = useMemo(
    () => (focusId ? entries.filter((e) => e.projectId === focusId) : []),
    [entries, focusId]
  )
  const dayEntries = visibleEntries.filter((e) => coversDay(e, selectedDay))

  /** Na wąskim oknie panel jest pod siatką — przewiń do niego po kliknięciu. */
  const revealPanel = () => {
    if (window.matchMedia(SIDE_PANEL_QUERY).matches) return
    requestAnimationFrame(() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  const openForm = (target: FormTarget) => {
    setForm((prev) => ({ target, key: (prev?.key ?? 0) + 1 }))
    revealPanel()
  }

  const selectDay = (day: string) => {
    setSelectedDay(day)
    setFocusId(null)
    setForm(null)
    revealPanel()
  }

  const showMonthOf = (day: string) => setCursor({ year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)) })

  const onEntryClick = (entry: CalendarEntry) => {
    setSelectedDay(dayKey(entry.start))
    if (entry.projectId && projectsById.has(entry.projectId)) {
      setForm(null)
      setFocusId(entry.projectId)
      revealPanel()
    } else {
      openForm({ mode: 'edit', entry })
    }
  }

  const onSaved = (info: SavedInfo) => {
    setForm(null)
    setSelectedDay(info.date)
    if (!info.date.startsWith(monthPrefix)) showMonthOf(info.date)
    setNotice(noticeAfterSave(info))
    setFocusId(info.project?.id ?? null)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (form) setForm(null)
      else setFocusId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [form])

  const shiftMonth = (delta: number) =>
    setCursor(({ year, month }) => {
      const index = year * 12 + (month - 1) + delta
      return { year: Math.floor(index / 12), month: (index % 12) + 1 }
    })

  const toggleGroup = (group: EventGroup) =>
    setHiddenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })

  const stats = [
    { value: summary.leads, label: plural(summary.leads, 'lead', 'leady', 'leadów') },
    { value: summary.shootDays, label: plural(summary.shootDays, 'dzień zdjęciowy', 'dni zdjęciowe', 'dni zdjęciowych') },
    {
      value: summary.postDays,
      label: plural(summary.postDays, 'dzień postprodukcji', 'dni postprodukcji', 'dni postprodukcji'),
    },
    {
      value: summary.invoicesSent,
      label: plural(summary.invoicesSent, 'faktura wysłana', 'faktury wysłane', 'faktur wysłanych'),
    },
    { value: summary.invoicesPaid, label: plural(summary.invoicesPaid, 'wpłata', 'wpłaty', 'wpłat') },
    {
      value: summary.gearCount,
      label: `${plural(summary.gearCount, 'zakup sprzętu', 'zakupy sprzętu', 'zakupów sprzętu')}${
        summary.gearSpend > 0 ? ` za ${pln(summary.gearSpend)}` : ''
      }`,
    },
  ]

  const navButton =
    'rounded-md border border-white/10 text-zinc-300 outline-none hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-white/60'

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl" style={archivo}>
          {MONTHS[cursor.month - 1]}{' '}
          <span className="text-zinc-500" style={mono}>
            {cursor.year}
          </span>
        </h1>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => shiftMonth(-1)} aria-label="Poprzedni miesiąc" className={`${navButton} p-1.5`}>
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              showMonthOf(today)
              selectDay(today)
            }}
            className={`${navButton} px-3 py-1 text-xs font-semibold`}
          >
            Dziś
          </button>
          <button type="button" onClick={() => shiftMonth(1)} aria-label="Następny miesiąc" className={`${navButton} p-1.5`}>
            <ChevronRight className="size-4" />
          </button>
        </div>
      </header>

      <dl className="mt-5 flex flex-wrap gap-x-7 gap-y-2 text-sm">
        {stats.map((stat) => (
          <div key={stat.label} className="flex items-baseline gap-1.5">
            <dt className="sr-only">{stat.label}</dt>
            <dd className="text-base font-semibold text-zinc-100" style={mono}>
              {stat.value}
            </dd>
            <span className="text-zinc-500">{stat.label}</span>
          </div>
        ))}
      </dl>

      <div className="mt-5 flex flex-wrap items-center gap-1.5" role="group" aria-label="Warstwy kalendarza">
        {EVENT_GROUPS.map((group) => {
          const chip = groupChip(group)
          const on = !hiddenGroups.has(group)
          return (
            <button
              key={group}
              type="button"
              onClick={() => toggleGroup(group)}
              aria-pressed={on}
              className={`flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-white/60 ${
                on ? 'border-white/15 text-zinc-200' : 'border-white/5 text-zinc-600 line-through'
              }`}
            >
              <span
                className="size-2.5 rounded-[3px]"
                style={{ background: on ? chip.bg : 'transparent', boxShadow: on ? undefined : `inset 0 0 0 1px ${chip.bg}` }}
                aria-hidden
              />
              {EVENT_GROUP_LABELS[group]}
            </button>
          )
        })}
        {focusProject && (
          <button
            type="button"
            onClick={() => setFocusId(null)}
            className="ml-auto flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-zinc-300 outline-none hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <X className="size-3.5" />
            Pokaż wszystkie projekty
          </button>
        )}
      </div>

      {entries.length === 0 && (
        <p className="mt-4 text-sm text-zinc-500">
          Kalendarz jest pusty. Kliknij dzień i dodaj pierwsze wydarzenie — lead, dzień zdjęciowy albo fakturę.
        </p>
      )}

      <div className="mt-4 grid gap-6 min-[1260px]:grid-cols-[minmax(0,1fr)_300px]">
        <MonthGrid
          weeks={weeks}
          entries={visibleEntries}
          projectsById={projectsById}
          monthPrefix={monthPrefix}
          today={today}
          selectedDay={selectedDay}
          focusId={focusId}
          onSelectDay={selectDay}
          onEntryClick={onEntryClick}
        />

        <aside ref={panelRef} className="min-w-0 scroll-mt-20" aria-label="Szczegóły">
          {notice && <EventNotice notice={notice} onDone={() => setNotice(null)} className="mb-4" />}

          {form ? (
            <EventForm
              key={form.key}
              target={form.target}
              onClose={() => setForm(null)}
              onSaved={onSaved}
              onDeleted={(event) => {
                setForm(null)
                setNotice({ type: 'deleted', event })
              }}
            />
          ) : focusProject ? (
            <ThreadPanel
              project={focusProject}
              entries={threadEntries}
              today={today}
              onClose={() => setFocusId(null)}
              onAdd={() => openForm({ mode: 'new', date: selectedDay, projectId: focusProject.id })}
              onEdit={(entry) => openForm({ mode: 'edit', entry })}
              onOpenProject={() => onOpenProject(focusProject.id)}
            />
          ) : (
            <DayPanel
              day={selectedDay}
              entries={dayEntries}
              projectsById={projectsById}
              onAdd={() => openForm({ mode: 'new', date: selectedDay, projectId: null })}
              onEdit={(entry) => openForm({ mode: 'edit', entry })}
              onFocusProject={(projectId) => {
                setFocusId(projectId)
                revealPanel()
              }}
            />
          )}
        </aside>
      </div>
    </div>
  )
}
