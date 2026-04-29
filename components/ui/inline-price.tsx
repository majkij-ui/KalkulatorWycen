'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

interface InlinePriceProps {
  value: number
  onChange: (value: number) => void
  /** Show amber tint + dot when price differs from default */
  isModified?: boolean
  /** 'zł' (default) | 'zł/km' | '%' */
  suffix?: string
  step?: number
  min?: number
  /** Decimal places for display and rounding */
  decimals?: number
  className?: string
}

export function InlinePrice({
  value,
  onChange,
  isModified = false,
  suffix = 'zł',
  step = 50,
  min = 0,
  decimals = 0,
  className,
}: InlinePriceProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const displayText =
    suffix === '%'
      ? `${value}%`
      : suffix === 'zł/km'
      ? `${value.toFixed(decimals).replace('.', ',')} zł/km`
      : `${value.toLocaleString('pl-PL', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} zł`

  const commit = (raw: string) => {
    const parsed = Number(raw.replace(',', '.'))
    if (!Number.isNaN(parsed) && parsed >= min) {
      const factor = 10 ** decimals
      onChange(decimals === 0 ? Math.round(parsed) : Math.round(parsed * factor) / factor)
    }
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        type="number"
        value={draft}
        step={step}
        min={min}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(draft) }
          if (e.key === 'Escape') { e.preventDefault(); setEditing(false) }
        }}
        className={cn(
          'w-20 rounded border border-primary/50 bg-black/60 px-2 py-0.5 text-right text-sm tabular-nums text-white focus:outline-none focus:ring-1 focus:ring-primary/60',
          className
        )}
      />
    )
  }

  return (
    <button
      type="button"
      onClick={() => { setDraft(String(value)); setEditing(true) }}
      title="Kliknij aby zmienić stawkę"
      className={cn(
        'group relative inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-sm tabular-nums transition-colors hover:bg-white/5 cursor-text select-none',
        isModified ? 'text-amber-400' : 'text-zinc-300',
        className
      )}
    >
      {isModified && (
        <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-amber-400 ring-1 ring-black" />
      )}
      <span>{displayText}</span>
      <svg
        className="size-2.5 text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity ml-0.5 shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2.5}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.862 4.487z" />
      </svg>
    </button>
  )
}
