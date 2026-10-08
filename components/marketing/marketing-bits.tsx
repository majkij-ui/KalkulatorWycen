'use client'

/**
 * Drobne, wspólne elementy zakładki Marketing: formatery, wybór jakości leada,
 * etykiety pól formularzy.
 */

import { Ban, Star, Sparkles } from 'lucide-react'
import {
  LEAD_QUALITIES,
  LEAD_QUALITY_HINTS,
  LEAD_QUALITY_LABELS,
  type LeadQuality,
} from '@/lib/marketing-types'

const MONTHS_SHORT = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru']
const MONTHS_FULL = [
  'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
  'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień',
]

export function pln(amount: number | null | undefined, digits = 0): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return '—'
  return `${amount.toLocaleString('pl-PL', {
    useGrouping: 'always',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} zł`
}

export function count(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return Math.round(value).toLocaleString('pl-PL', { useGrouping: 'always' })
}

export function pct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${(value * 100).toLocaleString('pl-PL', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`
}

/** `2026-04-09` → `9 kwi 2026` */
export function shortDate(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  return y && m && d ? `${d} ${MONTHS_SHORT[m - 1]} ${y}` : dateKey
}

/** `2026-04-09` → `09.04` */
export function dayMonth(dateKey: string): string {
  const [, m, d] = dateKey.split('-')
  return m && d ? `${d}.${m}` : dateKey
}

/** `2026-04` → `Kwiecień 2026` */
export function monthName(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return y && m ? `${MONTHS_FULL[m - 1]} ${y}` : month
}

export function monthShort(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return y && m ? `${MONTHS_SHORT[m - 1]} ${String(y).slice(2)}` : month
}

export const inputClass =
  'h-8 w-full rounded-md border border-white/10 bg-black/40 px-2 text-sm text-zinc-100 outline-none [color-scheme:dark] placeholder:text-zinc-600 focus:border-white/30'

export function FieldLabel({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-[11px] text-zinc-500">
      {children}
    </label>
  )
}

// ── Jakość leada ─────────────────────────────────────────────────────────────

/**
 * Kolor + ikona + podpis — znaczenie nigdy nie wisi na samym kolorze.
 * Fałszywy wygaszony, bardzo dobry w kolorze marki.
 */
const QUALITY_STYLES: Record<LeadQuality, { active: string; icon: typeof Star }> = {
  fake: { active: 'border-zinc-500/50 bg-zinc-700/30 text-zinc-300', icon: Ban },
  good: { active: 'border-violet-400/40 bg-violet-500/15 text-violet-200', icon: Star },
  very_good: { active: 'border-primary/50 bg-primary/15 text-primary', icon: Sparkles },
}

export function QualityBadge({ quality }: { quality: LeadQuality | null }) {
  if (!quality) {
    return (
      <span className="inline-flex shrink-0 items-center rounded-full border border-dashed border-amber-400/40 px-2 py-0.5 text-[11px] font-semibold text-amber-300/90">
        do oceny
      </span>
    )
  }
  const { active, icon: Icon } = QUALITY_STYLES[quality]
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${active}`}>
      <Icon className="size-3" aria-hidden />
      {LEAD_QUALITY_LABELS[quality]}
    </span>
  )
}

export function QualityPicker({
  value,
  onChange,
  size = 'md',
  label = 'Jakość leada',
}: {
  value: LeadQuality | null
  onChange: (next: LeadQuality) => void
  size?: 'sm' | 'md'
  label?: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-white/10 bg-black/30 p-0.5">
      {LEAD_QUALITIES.map((quality) => {
        const { active, icon: Icon } = QUALITY_STYLES[quality]
        const selected = value === quality
        return (
          <button
            key={quality}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={LEAD_QUALITY_LABELS[quality]}
            title={LEAD_QUALITY_HINTS[quality]}
            onClick={() => onChange(quality)}
            className={`flex items-center gap-1 rounded-md border font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-white/60 ${
              size === 'sm' ? 'px-1.5 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'
            } ${selected ? active : 'border-transparent text-zinc-500 hover:text-zinc-200'}`}
          >
            <Icon className={size === 'sm' ? 'size-3' : 'size-3.5'} aria-hidden />
            {LEAD_QUALITY_LABELS[quality]}
          </button>
        )
      })}
    </div>
  )
}
