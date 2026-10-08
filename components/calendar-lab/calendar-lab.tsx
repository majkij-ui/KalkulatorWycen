'use client'

/**
 * Makieta kalendarza — design pass przed T2.
 *
 * Cztery warianty (A–D) tego samego miesiąca na tych samych danych. Wspólne są
 * nagłówek, warstwy, panel dnia/wątku i tabela par kolorów; wariant decyduje
 * tylko o tym, jak pokazać „który projekt" i „jaki typ wydarzenia".
 * Dane są przykładowe i nic nie jest zapisywane.
 */

import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react'
import {
  EVENT_GROUPS,
  EVENT_GROUP_LABELS,
  NEUTRAL_TILE,
  PROJECT_COLOR_ORDER,
  groupChip,
  projectTile,
  type EventGroup,
} from '@/lib/calendar-palette'
import { EVENT_KINDS, eventKind } from '@/lib/event-kinds'
import { addDays, dayKey, monthGrid } from '@/lib/calendar-layout'
import { toDateKey } from '@/lib/project-types'
import { plural } from '@/lib/pl-plural'
import { describeThreadStats, threadStats } from '@/lib/thread-stats'
import { DEMO_EVENTS, type DemoEvent, type DemoProject } from './demo-data'
import {
  MONTHS,
  archivo,
  coversDay,
  eventEnd,
  formatDay,
  mono,
  projectsById,
  timeOf,
  type CalendarVariant,
} from './shared'
import { variantA } from './variant-a'
import { variantB } from './variant-b'
import { variantC } from './variant-c'
import { variantD } from './variant-d'

const VARIANTS: CalendarVariant[] = [variantA, variantB, variantC, variantD]

// ── Strona ───────────────────────────────────────────────────────────────────

export function CalendarLab() {
  const today = toDateKey(new Date())
  const [variantId, setVariantId] = useState<CalendarVariant['id']>('a')
  const [cursor, setCursor] = useState({ year: 2026, month: 10 })
  const [hiddenGroups, setHiddenGroups] = useState<Set<EventGroup>>(new Set())
  const [focusId, setFocusId] = useState<string | null>(null)
  const [selectedDay, setSelectedDay] = useState<string>(today)
  const [adding, setAdding] = useState(false)
  const [pickedKind, setPickedKind] = useState<string | null>(null)

  const variant = VARIANTS.find((v) => v.id === variantId) ?? variantA
  const r = variant.square ? 'rounded-none' : 'rounded-md'
  const pill = variant.square ? 'rounded-none' : 'rounded-full'

  // Wariant w adresie (#b) — da się podesłać link do konkretnej wersji.
  useEffect(() => {
    const readHash = () => {
      const fromHash = window.location.hash.slice(1)
      if (VARIANTS.some((v) => v.id === fromHash)) setVariantId(fromHash as CalendarVariant['id'])
    }
    readHash()
    window.addEventListener('hashchange', readHash)
    return () => window.removeEventListener('hashchange', readHash)
  }, [])

  const chooseVariant = (id: CalendarVariant['id']) => {
    setVariantId(id)
    window.history.replaceState(null, '', `#${id}`)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFocusId(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const weeks = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor])
  const monthPrefix = `${cursor.year}-${String(cursor.month).padStart(2, '0')}`

  const visibleEvents = useMemo(
    () => DEMO_EVENTS.filter((e) => !hiddenGroups.has(eventKind(e.kind).group)),
    [hiddenGroups]
  )

  const monthStats = useMemo(() => {
    const inMonth = DEMO_EVENTS.filter((e) => dayKey(e.start).startsWith(monthPrefix))
    const count = (kind: string) => inMonth.filter((e) => e.kind === kind).length
    const daysOf = (kind: string) =>
      DEMO_EVENTS.filter((e) => e.kind === kind).reduce((sum, e) => {
        let n = 0
        for (let d = dayKey(e.start); d <= eventEnd(e); d = addDays(d, 1)) if (d.startsWith(monthPrefix)) n++
        return sum + n
      }, 0)
    return [
      { value: count('lead_in'), label: plural(count('lead_in'), 'lead', 'leady', 'leadów') },
      { value: daysOf('shoot_day'), label: plural(daysOf('shoot_day'), 'dzień zdjęciowy', 'dni zdjęciowe', 'dni zdjęciowych') },
      { value: daysOf('post_day'), label: plural(daysOf('post_day'), 'dzień postprodukcji', 'dni postprodukcji', 'dni postprodukcji') },
      { value: count('invoice_sent'), label: plural(count('invoice_sent'), 'faktura wysłana', 'faktury wysłane', 'faktur wysłanych') },
      { value: count('invoice_paid'), label: plural(count('invoice_paid'), 'wpłata', 'wpłaty', 'wpłat') },
      { value: count('gear_purchase'), label: plural(count('gear_purchase'), 'zakup sprzętu', 'zakupy sprzętu', 'zakupów sprzętu') },
    ]
  }, [monthPrefix])

  const focusProject = focusId ? projectsById.get(focusId) : undefined
  const focusEvents = useMemo(
    () => (focusId ? DEMO_EVENTS.filter((e) => e.projectId === focusId).sort((a, b) => a.start.localeCompare(b.start)) : []),
    [focusId]
  )
  const dayEvents = visibleEvents.filter((e) => coversDay(e, selectedDay))

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

  const selectDay = (day: string) => {
    setSelectedDay(day)
    setFocusId(null)
    setAdding(false)
  }

  const focusEvent = (event: DemoEvent) => {
    setSelectedDay(dayKey(event.start))
    setAdding(false)
    setFocusId(event.projectId ?? null)
  }

  const { MonthGrid } = variant

  return (
    <main className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-8 sm:py-10">
      <div className="mx-auto max-w-[1320px]">
        {/* Przełącznik wariantów */}
        <div className="mb-8 border-b border-white/[0.07] pb-5">
          <p className="text-xs text-zinc-500">Makieta z przykładowymi danymi. Nic tutaj nie jest zapisywane.</p>
          <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Wariant kalendarza">
            {VARIANTS.map((v) => {
              const active = v.id === variant.id
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => chooseVariant(v.id)}
                  aria-pressed={active}
                  className={`flex items-baseline gap-2 border px-3 py-1.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-white/60 ${
                    v.square ? 'rounded-none' : 'rounded-lg'
                  } ${active ? 'border-primary/60 bg-primary/10 text-zinc-50' : 'border-white/10 text-zinc-400 hover:text-zinc-100'}`}
                >
                  <span className={active ? 'text-primary' : 'text-zinc-600'} style={mono}>
                    {v.id.toUpperCase()}
                  </span>
                  {v.name}
                </button>
              )
            })}
          </div>
          <p className="mt-3 max-w-[78ch] text-sm leading-relaxed text-zinc-400">{variant.summary}</p>
        </div>

        {/* Nagłówek miesiąca */}
        <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl" style={archivo}>
            {MONTHS[cursor.month - 1]}{' '}
            <span className="text-zinc-500" style={mono}>
              {cursor.year}
            </span>
          </h1>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              aria-label="Poprzedni miesiąc"
              className={`${r} border border-white/10 p-1.5 text-zinc-300 outline-none hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-white/60`}
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                const now = new Date()
                setCursor({ year: now.getFullYear(), month: now.getMonth() + 1 })
                selectDay(today)
              }}
              className={`${r} border border-white/10 px-3 py-1 text-xs font-semibold text-zinc-300 outline-none hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-white/60`}
            >
              Dziś
            </button>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              aria-label="Następny miesiąc"
              className={`${r} border border-white/10 p-1.5 text-zinc-300 outline-none hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-white/60`}
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </header>

        {/* Podsumowanie miesiąca */}
        <dl className="mt-5 flex flex-wrap gap-x-7 gap-y-2 text-sm">
          {monthStats.map((stat) => (
            <div key={stat.label} className="flex items-baseline gap-1.5">
              <dt className="sr-only">{stat.label}</dt>
              <dd className="text-base font-semibold text-zinc-100" style={mono}>
                {stat.value}
              </dd>
              <span className="text-zinc-500">{stat.label}</span>
            </div>
          ))}
        </dl>

        {/* Warstwy = legenda */}
        <div className="mt-5 flex flex-wrap items-center gap-1.5" role="group" aria-label="Warstwy kalendarza">
          {EVENT_GROUPS.map((group) => {
            const on = !hiddenGroups.has(group)
            return (
              <button
                key={group}
                type="button"
                onClick={() => toggleGroup(group)}
                aria-pressed={on}
                className={`flex items-center gap-2 border px-2.5 py-1 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-white/60 ${pill} ${
                  on ? 'border-white/15 text-zinc-200' : 'border-white/5 text-zinc-600 line-through'
                }`}
              >
                <variant.GroupSwatch group={group} on={on} />
                {EVENT_GROUP_LABELS[group]}
              </button>
            )
          })}
          {focusProject && (
            <button
              type="button"
              onClick={() => setFocusId(null)}
              className={`ml-auto flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-zinc-300 outline-none hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-white/60 ${pill}`}
            >
              <X className="size-3.5" />
              Pokaż wszystkie projekty
            </button>
          )}
        </div>

        <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <MonthGrid
            weeks={weeks}
            events={visibleEvents}
            monthPrefix={monthPrefix}
            today={today}
            selectedDay={selectedDay}
            focusId={focusId}
            onSelectDay={selectDay}
            onFocusEvent={focusEvent}
          />

          <aside className="min-w-0">
            {focusProject ? (
              <ThreadPanel
                project={focusProject}
                events={focusEvents}
                today={today}
                variant={variant}
                onClose={() => setFocusId(null)}
              />
            ) : (
              <DayPanel
                day={selectedDay}
                events={dayEvents}
                variant={variant}
                adding={adding}
                pickedKind={pickedKind}
                onAdd={() => {
                  setAdding((v) => !v)
                  setPickedKind(null)
                }}
                onPick={setPickedKind}
                onFocus={focusEvent}
              />
            )}
          </aside>
        </div>

        <PaletteMatrix variant={variant} />
      </div>
    </main>
  )
}

// ── Panel dnia ───────────────────────────────────────────────────────────────

function ProjectSwatch({ project, square }: { project?: DemoProject; square: boolean }) {
  const tile = project ? projectTile(project.color) : NEUTRAL_TILE
  return (
    <span
      className={`size-2.5 shrink-0 ${square ? 'rounded-none' : 'rounded-[3px]'}`}
      style={{ background: tile.edge }}
      aria-hidden
    />
  )
}

function DayPanel({
  day,
  events,
  variant,
  adding,
  pickedKind,
  onAdd,
  onPick,
  onFocus,
}: {
  day: string
  events: DemoEvent[]
  variant: CalendarVariant
  adding: boolean
  pickedKind: string | null
  onAdd: () => void
  onPick: (kind: string) => void
  onFocus: (event: DemoEvent) => void
}) {
  const r = variant.square ? 'rounded-none' : 'rounded-md'
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xl font-semibold" style={archivo}>
          {formatDay(day)}
        </h2>
        <button
          type="button"
          onClick={onAdd}
          aria-expanded={adding}
          className={`flex items-center gap-1 bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-white/70 ${r}`}
        >
          <Plus className="size-3.5" />
          Dodaj
        </button>
      </div>

      {adding && (
        <div className={`mt-4 space-y-3 border border-white/10 bg-white/[0.02] p-3 ${variant.square ? 'rounded-none' : 'rounded-lg'}`}>
          <p className="text-xs text-zinc-400">Co się wydarzyło?</p>
          {EVENT_GROUPS.map((group) => {
            const kinds = EVENT_KINDS.filter((k) => k.group === group)
            if (!kinds.length) return null
            return (
              <div key={group}>
                <p className="mb-1.5 text-[11px] text-zinc-500">{EVENT_GROUP_LABELS[group]}</p>
                <div className="flex flex-wrap gap-1">
                  {kinds.map((k) => {
                    const chip = groupChip(k.group)
                    const active = pickedKind === k.key
                    return (
                      <button
                        key={k.key}
                        type="button"
                        onClick={() => onPick(k.key)}
                        aria-pressed={active}
                        className={`flex items-center gap-1.5 border px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${r}`}
                        style={{
                          borderColor: active ? chip.bg : 'rgba(255,255,255,0.08)',
                          color: active ? chip.bg : undefined,
                        }}
                      >
                        <variant.GroupSwatch group={k.group} />
                        {k.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
          {pickedKind && (
            <p className="border-t border-white/10 pt-2.5 text-xs text-zinc-400">
              Tu otworzy się formularz „{eventKind(pickedKind).label}": projekt (albo nowy lead), daty i pola
              tego typu. Powstanie w T2.
            </p>
          )}
        </div>
      )}

      {events.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">Nic tego dnia. Dodaj wydarzenie albo wybierz inny dzień.</p>
      ) : (
        <ul className="mt-4 space-y-1">
          {events.map((event) => {
            const project = event.projectId ? projectsById.get(event.projectId) : undefined
            const time = timeOf(event.start)
            const multi = event.end && dayKey(event.end) !== dayKey(event.start)
            return (
              <li key={event.id}>
                <button
                  type="button"
                  onClick={() => onFocus(event)}
                  disabled={!project}
                  className={`w-full px-2 py-2 text-left outline-none enabled:hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-white/50 ${r}`}
                >
                  <span className="flex items-center gap-2">
                    <variant.KindMark kind={event.kind} />
                    <span className="truncate text-sm text-zinc-100">{event.title}</span>
                  </span>
                  <span className="mt-1 flex items-center gap-2 pl-0.5 text-xs text-zinc-500">
                    <ProjectSwatch project={project} square={variant.square} />
                    <span className="truncate">{project?.name ?? 'Firma, bez projektu'}</span>
                    {time && <span style={mono}>{time}</span>}
                    {multi && (
                      <span style={mono}>
                        {Number(event.start.slice(8, 10))}–{Number(event.end!.slice(8, 10))}.{event.end!.slice(5, 7)}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ── Panel wątku ──────────────────────────────────────────────────────────────

function ThreadPanel({
  project,
  events,
  today,
  variant,
  onClose,
}: {
  project: DemoProject
  events: DemoEvent[]
  today: string
  variant: CalendarVariant
  onClose: () => void
}) {
  const tile = projectTile(project.color)
  const stats = describeThreadStats(threadStats(events, today))
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs text-zinc-500">
            <ProjectSwatch project={project} square={variant.square} />
            {project.client}
          </p>
          <h2 className="mt-1 text-xl font-semibold leading-tight" style={archivo}>
            {project.name}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Zamknij wątek"
          className={`p-1 text-zinc-500 outline-none hover:bg-white/5 hover:text-zinc-200 focus-visible:ring-2 focus-visible:ring-white/60 ${
            variant.square ? 'rounded-none' : 'rounded-md'
          }`}
        >
          <X className="size-4" />
        </button>
      </div>

      {stats.length > 0 && (
        <ul
          className={`mt-4 space-y-1 px-3 py-2.5 text-sm ${variant.square ? 'rounded-none' : 'rounded-lg'}`}
          style={{ background: tile.bg, color: tile.text }}
        >
          {stats.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      )}

      <ol className="relative mt-5 space-y-3 pl-5">
        <span className="absolute bottom-1 left-[5px] top-1 w-px" style={{ background: tile.edge, opacity: 0.4 }} aria-hidden />
        {events.map((event) => {
          const chip = groupChip(eventKind(event.kind).group)
          const time = timeOf(event.start)
          const future = dayKey(event.start) > today
          return (
            <li key={event.id} className={`relative ${future ? 'opacity-60' : ''}`}>
              <span
                className={`absolute -left-5 top-1 size-[11px] border-2 ${variant.square ? 'rounded-none' : 'rounded-full'}`}
                style={{ background: future ? 'var(--background)' : chip.bg, borderColor: chip.bg }}
                aria-hidden
              />
              <p className="text-xs text-zinc-500" style={mono}>
                {formatDay(dayKey(event.start))}
                {event.end && dayKey(event.end) !== dayKey(event.start) && ` – ${formatDay(dayKey(event.end))}`}
                {time && `, ${time}`}
              </p>
              <p className="mt-0.5 flex items-center gap-2 text-sm text-zinc-100">
                <variant.KindMark kind={event.kind} />
                <span className="min-w-0 truncate">{event.title}</span>
              </p>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

// ── Wszystkie pary kolorów ───────────────────────────────────────────────────

function PaletteMatrix({ variant }: { variant: CalendarVariant }) {
  const groups = EVENT_GROUPS.filter((g) => g !== 'inne')
  const shortFor = (group: EventGroup) => EVENT_KINDS.find((k) => k.group === group)!.short
  return (
    <section className="mt-16 border-t border-white/[0.07] pt-8">
      <h2 className="text-xl font-semibold" style={archivo}>
        Wszystkie pary kolorów
      </h2>
      <p className="mt-1 max-w-[70ch] text-sm text-zinc-500">
        12 kolorów projektów (w kolejności, w jakiej dostają je nowe projekty) i 5 grup wydarzeń w wariancie{' '}
        {variant.id.toUpperCase()}. Każda para musi być czytelna. Ostatni wiersz to wydarzenia bez projektu.
      </p>
      <div className="mt-5 overflow-x-auto">
        <table className="border-separate border-spacing-x-1 border-spacing-y-1.5 text-[11px]">
          <thead>
            <tr>
              <th className="pr-3 text-left font-normal text-zinc-600">projekt</th>
              {groups.map((g) => (
                <th key={g} className="px-1 text-left font-normal text-zinc-500">
                  {EVENT_GROUP_LABELS[g]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...PROJECT_COLOR_ORDER, null].map((key) => (
              <tr key={key ?? 'neutral'}>
                <td className="pr-3 text-zinc-500" style={mono}>
                  {key ?? 'firma'}
                </td>
                {groups.map((g) => (
                  <td key={g}>
                    <variant.PairSample color={key} group={g} label={shortFor(g)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
