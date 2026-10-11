'use client'

/**
 * Oś czasu dnia (port `visual-timeline.tsx` z CallSheetWiz): wpisy jako
 * kafle w kolorze tagu, przeciąganie w poziomie (siatka 5 minut), zmiana
 * długości prawą krawędzią, nachodzące wpisy w osobnych rzędach, zoom.
 *
 * Bez @dnd-kit (hub go nie ma): zwykłe zdarzenia wskaźnika z przechwyceniem,
 * a cała matematyka w `planner-timeline.ts`. Klik bez przesunięcia otwiera
 * edycję; z klawiatury: Enter edytuje, ←/→ przesuwa o 5 minut (Shift: 15),
 * Alt+←/→ zmienia długość.
 *
 * Wygląd jak kalendarz huba: kafel = ciemne tło i krawędź w kolorze tagu.
 * Znacznik „teraz" tylko w dniu zdjęć.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toDateKey } from '@/lib/project-types'
import {
  assignRows,
  draggedStart,
  hourMarks,
  minutesToPx,
  nowMarker,
  resizedEnd,
  timelineRange,
  MIN_DURATION_MIN,
} from '@/lib/planner-timeline'
import { tagStyle, type Category, type PlannerEvent } from '@/lib/schedule-types'
import { clampStartToDragBounds, getDurationMinutes, minutesToHHMM } from '@/lib/time'
import { mono } from '@/components/calendar/calendar-bits'
import { TagDot } from './planner-bits'

const ROW_HEIGHT = 40
const ROW_GAP = 6
const HEADER_HEIGHT = 28
const FALLBACK_WIDTH = 960
const MIN_BASE_WIDTH = 640
const DRAG_THRESHOLD_PX = 4

interface VisualTimelineProps {
  events: PlannerEvent[]
  /** Wszystkie tagi call sheetu (także usunięte — wpis z usuniętym tagiem jest szary). */
  categories: Category[]
  /** Data dnia (`YYYY-MM-DD`) — znacznik „teraz" tylko tego dnia. */
  dayDate: string
  onEventChange: (eventId: string, updates: { startMinutes?: number; endMinutes?: number }) => void
  onEventClick: (event: PlannerEvent) => void
}

interface DragState {
  id: string
  mode: 'move' | 'resize'
  pointerId: number
  startX: number
  event: PlannerEvent
  moved: boolean
}

function CurrentTimeMarker({ dayDate, range, width }: { dayDate: string; range: { start: number; end: number }; width: number }) {
  // Dopiero po zamontowaniu — zegar serwera i klienta się różnią.
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const interval = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(interval)
  }, [])
  if (!now) return null
  const minutes = nowMarker(now, dayDate, range, toDateKey(now))
  if (minutes === null) return null
  return (
    <div className="pointer-events-none absolute bottom-0 top-0 z-20" style={{ left: minutesToPx(minutes, range, width) }}>
      <div className="absolute -top-1 size-2.5 -translate-x-1/2 rounded-full bg-red-500" />
      <div className="h-full w-px bg-red-500/60" />
    </div>
  )
}

export function VisualTimeline({ events, categories, dayDate, onEventChange, onEventClick }: VisualTimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [preview, setPreview] = useState<{ id: string; start: number; end: number } | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      // Zerowa szerokość (element ukryty) i drgania subpikselowe nie przeliczają osi.
      if (width <= 0) return
      setContainerWidth((prev) => (Math.abs(prev - width) < 1 ? prev : width))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const range = useMemo(() => timelineRange(events), [events])
  const width = Math.max(containerWidth || FALLBACK_WIDTH, MIN_BASE_WIDTH) * zoom
  const rows = useMemo(() => assignRows(events), [events])
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
  const usedTags = useMemo(() => {
    const ids = new Set(events.map((e) => e.categoryId))
    return categories.filter((c) => !c.deletedAt && ids.has(c.id))
  }, [events, categories])
  const hours = hourMarks(range)
  const contentHeight = Math.max(1, rows.length) * (ROW_HEIGHT + ROW_GAP) + ROW_GAP

  // Stan przeciągania w refach: zdarzenia wskaźnika przychodzą szybciej niż
  // render, a uchwyt długości i kafel dostają te same zdarzenia (bąbelkowanie).
  const dragRef = useRef<DragState | null>(null)
  const previewRef = useRef<{ id: string; start: number; end: number } | null>(null)

  const startDrag = (e: React.PointerEvent<HTMLElement>, event: PlannerEvent, mode: DragState['mode']) => {
    if (!e.isPrimary || e.button !== 0 || dragRef.current) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { id: event.id, mode, pointerId: e.pointerId, startX: e.clientX, event, moved: false }
    setDrag(dragRef.current)
  }

  const moveDrag = (e: React.PointerEvent<HTMLElement>) => {
    const current = dragRef.current
    if (!current || current.pointerId !== e.pointerId) return
    const deltaPx = e.clientX - current.startX
    if (!current.moved && Math.abs(deltaPx) < DRAG_THRESHOLD_PX) return
    if (!current.moved) {
      current.moved = true
      setDrag({ ...current })
    }
    const { event } = current
    const next =
      current.mode === 'move'
        ? (() => {
            const start = draggedStart(event, deltaPx, range, width)
            return { id: event.id, start, end: start + (event.endMinutes - event.startMinutes) }
          })()
        : { id: event.id, start: event.startMinutes, end: resizedEnd(event, deltaPx, range, width) }
    previewRef.current = next
    setPreview(next)
  }

  const endDrag = (e: React.PointerEvent<HTMLElement>, cancelled = false) => {
    const current = dragRef.current
    if (!current || current.pointerId !== e.pointerId) return
    const last = previewRef.current
    dragRef.current = null
    previewRef.current = null
    setDrag(null)
    setPreview(null)
    if (cancelled) return
    if (!current.moved) {
      if (current.mode === 'move') onEventClick(current.event)
      return
    }
    if (!last || last.id !== current.id) return
    if (current.mode === 'move' && last.start !== current.event.startMinutes) {
      onEventChange(current.id, { startMinutes: last.start })
    }
    if (current.mode === 'resize' && last.end !== current.event.endMinutes) {
      onEventChange(current.id, { endMinutes: last.end })
    }
  }

  const onKey = useCallback(
    (e: React.KeyboardEvent<HTMLElement>, event: PlannerEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onEventClick(event)
        return
      }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      e.preventDefault()
      const step = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 15 : 5)
      const duration = getDurationMinutes(event.startMinutes, event.endMinutes)
      if (e.altKey) {
        const end = Math.max(event.startMinutes + MIN_DURATION_MIN, Math.min(1439, event.endMinutes + step))
        onEventChange(event.id, { endMinutes: end })
      } else {
        const start = clampStartToDragBounds(event.startMinutes + step, duration, { start: 0, end: 1439 })
        onEventChange(event.id, { startMinutes: start })
      }
    },
    [onEventChange, onEventClick]
  )

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
          {usedTags.map((tag) => (
            <span key={tag.id} className="inline-flex items-center gap-1.5">
              <TagDot category={tag} />
              {tag.label}
            </span>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-zinc-500">
          Powiększenie
          <input
            type="range"
            min={1}
            max={4}
            step={0.25}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="w-24 accent-[var(--primary)]"
          />
          <span className="w-9 text-right tabular-nums" style={mono}>
            {zoom.toFixed(1)}×
          </span>
        </label>
      </div>

      <div ref={containerRef} className="w-full overflow-hidden rounded-xl border border-white/5 bg-zinc-900/40">
        <div className="overflow-x-auto">
          <div className="relative" style={{ width, height: HEADER_HEIGHT + contentHeight }}>
            {/* Godziny */}
            <div className="absolute inset-x-0 top-0 border-b border-white/5" style={{ height: HEADER_HEIGHT }}>
              {hours.map((m) => (
                <span
                  key={m}
                  className="absolute top-1.5 pl-1.5 text-[11px] text-zinc-500"
                  style={{ ...mono, left: minutesToPx(m, range, width) }}
                >
                  {minutesToHHMM(Math.min(m, 1439)).replace('23:59', '24:00')}
                </span>
              ))}
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0" style={{ top: HEADER_HEIGHT }}>
              {hours.map((m) => (
                <div
                  key={m}
                  className="absolute bottom-0 top-0 border-l border-white/[0.04]"
                  style={{ left: minutesToPx(m, range, width) }}
                />
              ))}
            </div>
            <div className="absolute inset-x-0 bottom-0" style={{ top: HEADER_HEIGHT }}>
              <CurrentTimeMarker dayDate={dayDate} range={range} width={width} />
            </div>

            {events.length === 0 && (
              <p className="absolute inset-x-0 text-center text-xs text-zinc-500" style={{ top: HEADER_HEIGHT + 14 }}>
                Harmonogram jest pusty — dodaj wpis albo wstaw szablon dnia.
              </p>
            )}

            <div className="absolute inset-x-0" style={{ top: HEADER_HEIGHT + ROW_GAP }}>
              {rows.map((row, rowIndex) =>
                row.map((event) => {
                  const live = preview?.id === event.id ? preview : null
                  const start = live?.start ?? event.startMinutes
                  const end = live?.end ?? event.endMinutes
                  const left = minutesToPx(start, range, width)
                  const blockWidth = Math.max(minutesToPx(end, range, width) - left - 2, 8)
                  const style = tagStyle(categoryById.get(event.categoryId))
                  const active = drag?.id === event.id && drag.moved
                  return (
                    <div
                      key={event.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`${event.title}, ${minutesToHHMM(event.startMinutes)}–${minutesToHHMM(event.endMinutes)}. Enter: edycja, strzałki: przesuń`}
                      title={`${event.title}\n${minutesToHHMM(event.startMinutes)}–${minutesToHHMM(event.endMinutes)}${event.notes ? `\n${event.notes}` : ''}`}
                      onPointerDown={(e) => startDrag(e, event, 'move')}
                      onPointerMove={moveDrag}
                      onPointerUp={(e) => endDrag(e)}
                      onPointerCancel={(e) => endDrag(e, true)}
                      onKeyDown={(e) => onKey(e, event)}
                      className={`absolute flex cursor-grab touch-none select-none items-center overflow-hidden rounded-md border-l-[3px] px-2 outline-none focus-visible:ring-2 focus-visible:ring-white/70 active:cursor-grabbing ${
                        active ? 'z-30 opacity-80 shadow-lg shadow-black/50' : 'z-10'
                      }`}
                      style={{
                        left,
                        width: blockWidth,
                        top: rowIndex * (ROW_HEIGHT + ROW_GAP),
                        height: ROW_HEIGHT,
                        background: style.tile.bg,
                        borderColor: style.tile.edge,
                      }}
                    >
                      {active && (
                        <span
                          className="pointer-events-none absolute -top-7 left-1/2 z-40 -translate-x-1/2 whitespace-nowrap rounded border border-white/10 bg-zinc-950 px-1.5 py-0.5 text-[11px] text-white"
                          style={mono}
                        >
                          {minutesToHHMM(start)}–{minutesToHHMM(end)}
                        </span>
                      )}
                      <div className="pointer-events-none flex min-w-0 flex-1 flex-col leading-tight">
                        {blockWidth >= 44 && (
                          <span className="truncate text-xs font-medium" style={{ color: style.tile.text }}>
                            {event.title}
                          </span>
                        )}
                        {blockWidth >= 104 && (
                          <span className="truncate text-[10px] text-zinc-400" style={mono}>
                            {minutesToHHMM(start)}–{minutesToHHMM(end)}
                          </span>
                        )}
                      </div>
                      <div
                        role="separator"
                        aria-label={`Zmień długość: ${event.title}`}
                        onPointerDown={(e) => startDrag(e, event, 'resize')}
                        className="group absolute bottom-0 right-0 top-0 flex w-3 cursor-ew-resize touch-none items-center justify-center"
                      >
                        <span className="h-5 w-0.5 rounded-full bg-white/40 opacity-0 transition-opacity group-hover:opacity-100" />
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      </div>
      <p className="text-[11px] text-zinc-600">
        Przeciągnij kafel, żeby przesunąć (co 5 min), prawą krawędź — żeby zmienić długość. Klik otwiera edycję.
      </p>
    </div>
  )
}
