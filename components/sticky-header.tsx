'use client'

import { useState, useEffect, useRef } from 'react'
import Image from 'next/image'
import { Settings, RotateCcw } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuote } from '@/lib/quote-context'
import { AnimatedCurrency } from '@/components/animated-currency'
import { BipolarSlider } from '@/components/ui/bipolar-slider'
import { SettingsSheet } from '@/components/settings-sheet'

export function StickyHeader() {
  const { totals, formatCurrency, resetToZero, marginMultiplier, setMarginMultiplier } = useQuote()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [delta, setDelta] = useState<number | null>(null)
  const prevTotalRef = useRef<number | null>(null)
  const deltaTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const current = totals.sumaNetto
    const prev = prevTotalRef.current
    // Skip first render (no previous value yet)
    if (prev === null) {
      prevTotalRef.current = current
      return
    }
    if (current !== prev) {
      const diff = current - prev
      prevTotalRef.current = current
      if (deltaTimerRef.current) clearTimeout(deltaTimerRef.current)
      setDelta(diff)
      deltaTimerRef.current = setTimeout(() => setDelta(null), 2000)
    }
  }, [totals.sumaNetto])

  const displayPercent = Math.round((marginMultiplier - 1) * 100)
  const sign = displayPercent > 0 ? '+' : ''

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-white/10 bg-black/60 backdrop-blur-xl">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-6 sm:py-8">
          <div className="flex items-center gap-3">
            <div className="relative size-10 shrink-0 overflow-hidden rounded-lg sm:size-11">
              <Image
                src="/logo.png"
                alt=""
                width={44}
                height={44}
                className="object-cover"
              />
            </div>
            <div className="flex flex-col">
              <span className="text-xl font-bold tracking-tight text-white">
                NonoiseMedia
              </span>
              <span className="text-sm text-zinc-400">
                Kalkulator wycen
              </span>
            </div>
          </div>

          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-xs text-zinc-400">
                  Szacunkowy koszt (netto)
                </p>
                <div className="relative inline-block">
                  <AnimatedCurrency
                    value={totals.sumaNetto}
                    format={formatCurrency}
                    className="text-lg font-semibold tabular-nums text-amber-400 sm:text-xl"
                    duration={0.5}
                  />
                  <AnimatePresence>
                    {delta !== null && (
                      <motion.span
                        key={delta}
                        initial={{ opacity: 0, y: 6, scale: 0.85 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -4, scale: 0.9 }}
                        transition={{ duration: 0.25, ease: 'easeOut' }}
                        className={`absolute -right-1 -top-5 text-[11px] font-semibold tabular-nums whitespace-nowrap ${
                          delta > 0 ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {delta > 0 ? '+' : ''}{formatCurrency(delta)}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={resetToZero}
                  className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white sm:size-11"
                  aria-label="Resetuj wycenę"
                  title="Resetuj wycenę"
                >
                  <RotateCcw className="size-5" />
                </button>
                <button
                  type="button"
                  onClick={() => setSheetOpen(true)}
                  className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white sm:size-11"
                  aria-label="Ustawienia wyceny"
                >
                  <Settings className="size-5" />
                </button>
              </div>
            </div>
            <div className="flex items-center gap-3 w-64 opacity-80 hover:opacity-100 transition-opacity">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 shrink-0">
                Marża / Rabat
              </span>
              <BipolarSlider
                min={0.5}
                max={1.5}
                step={0.05}
                value={[marginMultiplier]}
                onValueChange={([v]) => setMarginMultiplier(v)}
                className="flex-1 py-1"
              />
              <span className="text-xs font-mono text-white w-10 text-right tabular-nums">
                {sign}{displayPercent}%
              </span>
            </div>
          </div>
        </div>
      </header>

      <SettingsSheet open={sheetOpen} onOpenChange={setSheetOpen} />
    </>
  )
}
