'use client'

/**
 * Wspólne drobiazgi planera dnia (T5b): klasy pól i przycisków w języku
 * Realizacji i kalendarza, chip tagu w kolorach kafla kalendarza.
 */

import type { ReactNode } from 'react'
import { tagStyle, type Category } from '@/lib/schedule-types'

export const inputClass =
  'h-8 w-full min-w-0 rounded-md border border-white/10 bg-black/40 px-2 text-sm text-zinc-100 outline-none [color-scheme:dark] placeholder:text-zinc-600 focus:border-white/30'

export const smallButton =
  'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-semibold text-zinc-400 outline-none hover:bg-white/5 hover:text-zinc-100 focus-visible:ring-2 focus-visible:ring-white/60 disabled:cursor-not-allowed disabled:opacity-40'

export const outlineButton =
  'inline-flex h-8 items-center gap-1.5 rounded-md border border-white/10 px-2.5 text-xs font-medium text-zinc-300 outline-none hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-white/60 disabled:cursor-not-allowed disabled:opacity-40'

export const iconButton =
  'inline-flex size-7 items-center justify-center rounded-md text-zinc-500 outline-none hover:bg-white/5 hover:text-zinc-100 focus-visible:ring-2 focus-visible:ring-white/60'

export function FieldLabel({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-[11px] text-zinc-500">
      {children}
    </label>
  )
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <h4 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{children}</h4>
      {aside}
    </div>
  )
}

/** Tag jako mały kafel: ciemne tło i krawędź w kolorze tagu, jak projekty w kalendarzu. */
export function TagChip({ category, className = '' }: { category: Category | null | undefined; className?: string }) {
  const style = tagStyle(category)
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-[3px] border-l-[3px] px-1.5 py-[2px] text-[10px] font-semibold leading-none ${className}`}
      style={{ background: style.tile.bg, borderColor: style.tile.edge, color: style.tile.text }}
    >
      {style.label}
    </span>
  )
}

/** Próbka koloru tagu (legenda, lista wyboru). */
export function TagDot({ category }: { category: Category | null | undefined }) {
  return (
    <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: tagStyle(category).tile.edge }} aria-hidden />
  )
}
