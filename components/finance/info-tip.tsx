'use client'

/**
 * Mała ikona (i) przy tytule kafla — krótkie wyjaśnienie zwykłym językiem.
 * Popover, nie sam tooltip: otwiera się po najechaniu myszą, kliknięciu / dotknięciu
 * (telefon) i z klawiatury (Tab, potem Enter / spacja), zamyka Escape albo
 * kliknięcie obok.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Info } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

const HOVER_CLOSE_MS = 150

export function InfoTip({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  /** Otwarte samym najechaniem myszą — pierwsze kliknięcie je przypina zamiast zamykać. */
  const byHover = useRef(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Po zamknięciu fokus wraca na ikonę; to nie ma jej otwierać od nowa. */
  const quietUntil = useRef(0)

  const clearTimer = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = null
  }
  useEffect(() => clearTimer, [])

  const hoverOpen = () => {
    clearTimer()
    if (!open) {
      byHover.current = true
      setOpen(true)
    }
  }
  const hoverClose = () => {
    if (!byHover.current) return
    clearTimer()
    closeTimer.current = setTimeout(() => {
      byHover.current = false
      quietUntil.current = Date.now() + 400
      setOpen(false)
    }, HOVER_CLOSE_MS)
  }
  const change = (next: boolean) => {
    clearTimer()
    byHover.current = false
    if (!next) quietUntil.current = Date.now() + 400
    setOpen(next)
  }

  return (
    <Popover open={open} onOpenChange={change}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Co to znaczy: ${title}`}
          className="ml-0.5 inline-flex size-4 shrink-0 items-center align-text-bottom justify-center rounded-full text-zinc-600 transition-colors hover:text-zinc-300 focus-visible:text-zinc-300 focus-visible:outline focus-visible:outline-1 focus-visible:outline-zinc-500"
          onPointerEnter={(e) => e.pointerType === 'mouse' && hoverOpen()}
          onPointerLeave={(e) => e.pointerType === 'mouse' && hoverClose()}
          onFocus={(e) => {
            if (Date.now() > quietUntil.current && e.currentTarget.matches(':focus-visible')) {
              clearTimer()
              byHover.current = false
              setOpen(true)
            }
          }}
          onClick={(e) => {
            // Kafel pod spodem bywa przyciskiem — ikona nie może go uruchamiać.
            e.stopPropagation()
            if (byHover.current) {
              // Najechane myszą i kliknięte: zostaje otwarte, zamiast mrugnąć zamknięciem.
              e.preventDefault()
              byHover.current = false
              clearTimer()
            }
          }}
        >
          <Info className="size-3.5" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        collisionPadding={12}
        className="w-64 border-white/10 bg-zinc-900 p-3 text-xs font-normal normal-case leading-relaxed tracking-normal text-zinc-300"
        // Otwarte samym najechaniem nie zabiera fokusu (klawiatura i czytnik dostają go przy Enter / spacji).
        onOpenAutoFocus={(e) => byHover.current && e.preventDefault()}
        onPointerEnter={(e) => e.pointerType === 'mouse' && clearTimer()}
        onPointerLeave={(e) => e.pointerType === 'mouse' && hoverClose()}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </PopoverContent>
    </Popover>
  )
}
