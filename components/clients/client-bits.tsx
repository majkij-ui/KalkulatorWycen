'use client'

/**
 * Drobne elementy ekranu „Klienci": kwoty, daty, kafelek liczby (jak w
 * Sprzęcie) i przycisk kopiowania.
 */

import { useEffect, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { mono } from '@/components/calendar/calendar-bits'

export { pln } from '@/components/calendar/calendar-bits'

export function formatDate(dateKey: string | null | undefined): string {
  if (!dateKey) return '—'
  const [y, m, d] = dateKey.split('-')
  return y && m && d ? `${d}.${m}.${y}` : dateKey
}

export function pct(value: number | null, digits = 0): string {
  return value === null ? '—' : `${value.toLocaleString('pl-PL', { maximumFractionDigits: digits })}%`
}

export function Tile({
  label,
  value,
  lines = [],
  warn,
  good,
}: {
  label: string
  value: string
  lines?: string[]
  warn?: string
  good?: boolean
}) {
  return (
    <div className="rounded-xl border border-white/5 bg-zinc-900/40 p-4">
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-1 text-lg font-bold sm:text-xl ${good ? 'text-emerald-400' : 'text-zinc-100'}`} style={mono}>
        {value}
      </div>
      {lines.filter(Boolean).map((line) => (
        <div key={line} className="text-xs text-zinc-500">
          {line}
        </div>
      ))}
      {warn && <div className="mt-0.5 text-xs text-amber-300/80">{warn}</div>}
    </div>
  )
}

/** Schowek: API przeglądarki, a gdy go brak (stary WebView) — ukryte pole. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      const ok = document.execCommand('copy')
      area.remove()
      return ok
    } catch {
      return false
    }
  }
}

export function CopyButton({ text, label, caption = 'kopiuj' }: { text: string; label: string; caption?: string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle')
  useEffect(() => {
    if (state === 'idle') return
    const t = setTimeout(() => setState('idle'), 1600)
    return () => clearTimeout(t)
  }, [state])
  return (
    <button
      type="button"
      onClick={async () => setState((await copyText(text)) ? 'ok' : 'fail')}
      aria-label={label}
      title={label}
      className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-zinc-500 outline-none transition-colors hover:bg-white/5 hover:text-zinc-200 focus-visible:ring-2 focus-visible:ring-white/60"
    >
      {state === 'ok' ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
      <span aria-live="polite">{state === 'ok' ? 'skopiowano' : state === 'fail' ? 'nie udało się' : caption}</span>
    </button>
  )
}
