'use client'

/**
 * Drobne, wspólne elementy kalendarza: nazwy miesięcy, chip typu, próbka
 * koloru projektu. Język wizualny = wariant A z design passu (plan §5c):
 * projekt = ciemny kafel z krawędzią, typ = jasny chip z podpisem.
 */

import type { CSSProperties } from 'react'
import { NEUTRAL_TILE, groupChip, projectColorFor, projectTile, type TileColors } from '@/lib/calendar-palette'
import { eventKind } from '@/lib/event-kinds'
import type { Project } from '@/lib/project-types'

export const MONTHS = [
  'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
  'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień',
]

/** Dopełniacz do dat: „8 października". */
const MONTHS_GENITIVE = [
  'stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca',
  'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia',
]

export const WEEKDAYS = ['pon', 'wt', 'śr', 'czw', 'pt', 'sob', 'nd']

/** Kroje z księgi marki (ładowane w layout.tsx): Archivo — nagłówki, JetBrains Mono — daty i liczby. */
export const archivo: CSSProperties = { fontFamily: 'var(--font-archivo)' }
export const mono: CSSProperties = { fontFamily: 'var(--font-jetbrains-mono)', fontVariantNumeric: 'tabular-nums' }

export function formatDay(key: string): string {
  const [, m, d] = key.slice(0, 10).split('-').map(Number)
  return `${d} ${MONTHS_GENITIVE[m - 1] ?? ''}`
}

export function timeOf(value: string): string | null {
  return value.length > 10 ? value.slice(11, 16) : null
}

export function pln(amount: number): string {
  return `${Math.round(amount).toLocaleString('pl-PL', { useGrouping: 'always' })} zł`
}

/** Kolory kafla dla projektu (albo neutralne dla spraw firmy / usuniętego projektu). */
export function tileFor(project: Project | undefined): TileColors {
  return project ? projectTile(projectColorFor(project)) : NEUTRAL_TILE
}

export function KindChip({ kind }: { kind: string }) {
  const k = eventKind(kind)
  const chip = groupChip(k.group)
  return (
    <span
      className="shrink-0 rounded-[3px] px-1 py-[2px] text-[10px] font-semibold leading-none"
      style={{ background: chip.bg, color: chip.text }}
    >
      {k.short}
    </span>
  )
}

export function ProjectSwatch({ project }: { project?: Project }) {
  return <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: tileFor(project).edge }} aria-hidden />
}
