'use client'

/**
 * Małe słupki: kwoty zleceń klienta w kolejności dat. Jedna seria, jeden kolor
 * (marki); szczegóły po najechaniu albo fokusie, klik otwiera projekt. Pełna
 * lista z kwotami jest pod spodem w „Projektach", więc to tylko obraz trendu.
 */

import { useState } from 'react'
import type { ClientSize } from '@/lib/client-stats'
import { mono } from '@/components/calendar/calendar-bits'
import { formatDate, pln } from './client-bits'

export function SizeBars({ size, onOpenProject }: { size: ClientSize; onOpenProject?: (id: string) => void }) {
  const [active, setActive] = useState<number | null>(null)
  const { points } = size
  if (!points.length) return null
  const max = Math.max(...points.map((p) => p.value))
  const hovered = active !== null ? points[active] : null

  return (
    <figure className="m-0">
      <div className="relative">
        {/* Podpis najechanego słupka — stałe miejsce nad wykresem, nic nie zasłania. */}
        <div className="mb-2 flex h-9 items-end justify-between gap-3 text-xs" aria-live="polite">
          {hovered ? (
            <>
              <span className="min-w-0 truncate text-zinc-300">
                {hovered.name || 'Bez nazwy'} <span className="text-zinc-500">· {formatDate(hovered.date)}</span>
              </span>
              <span className="shrink-0 font-semibold text-zinc-100" style={mono}>
                {pln(hovered.value)}
              </span>
            </>
          ) : (
            <span className="text-zinc-600">Najedź na słupek, kliknij, żeby otworzyć projekt.</span>
          )}
        </div>
        <ul
          className="m-0 flex h-24 list-none items-end gap-[2px] border-b border-white/10 p-0"
          aria-label="Kwoty zleceń w kolejności dat"
          onMouseLeave={() => setActive(null)}
        >
          {points.map((point, i) => (
            <li key={point.projectId} className="flex h-full min-w-[3px] max-w-12 flex-1">
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                onClick={() => onOpenProject?.(point.projectId)}
                aria-label={`${point.name || 'Bez nazwy'}, ${formatDate(point.date)}, ${pln(point.value)}`}
                className="group flex h-full w-full items-end outline-none"
              >
                <span
                  className={`block w-full rounded-t-[4px] transition-colors ${
                    active === i ? 'bg-primary' : 'bg-primary/55 group-focus-visible:bg-primary'
                  }`}
                  style={{ height: `${Math.max(3, (point.value / max) * 100)}%` }}
                />
              </button>
            </li>
          ))}
        </ul>
        {/* Zakres dat pod słupkami (do lewej, bo przy kilku zleceniach słupki nie sięgają prawej krawędzi). */}
        <div className="mt-1 text-[11px] text-zinc-600" style={mono}>
          {formatDate(points[0].date)}
          {points.length > 1 && ` – ${formatDate(points[points.length - 1].date)}`}
        </div>
      </div>
    </figure>
  )
}
