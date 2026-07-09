'use client'

import { useState, useEffect, useRef } from 'react'
import Image from 'next/image'
import { Settings, RotateCcw, FolderOpen, Save, Eraser } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuote } from '@/lib/quote-context'
import { AnimatedCurrency } from '@/components/animated-currency'
import { BipolarSlider } from '@/components/ui/bipolar-slider'
import { SettingsSheet } from '@/components/settings-sheet'
import { QuoteLibrarySheet } from '@/components/quote-library-sheet'

export function StickyHeader() {
  const {
    totals,
    formatCurrency,
    resetToZero,
    marginMultiplier,
    setMarginMultiplier,
    saveAsDefaults,
    hardReset,
    activeQuoteName,
  } = useQuote()

  const [sheetOpen, setSheetOpen] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [delta, setDelta] = useState<number | null>(null)
  const prevTotalRef = useRef<number | null>(null)
  const deltaTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Hard-reset: two-click confirmation within 3 s
  const [hardResetPending, setHardResetPending] = useState(false)
  const hardResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Save defaults: brief success flash
  const [defaultsSaved, setDefaultsSaved] = useState(false)
  const defaultsSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Delta animation
  useEffect(() => {
    const current = totals.sumaNetto
    const prev = prevTotalRef.current
    if (prev === null) { prevTotalRef.current = current; return }
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

  // ── Hard Reset ───────────────────────────────────────────────────────────────
  const handleHardReset = () => {
    if (!hardResetPending) {
      setHardResetPending(true)
      hardResetTimerRef.current = setTimeout(() => setHardResetPending(false), 3000)
    } else {
      if (hardResetTimerRef.current) clearTimeout(hardResetTimerRef.current)
      setHardResetPending(false)
      hardReset()
    }
  }

  // ── Save Defaults ────────────────────────────────────────────────────────────
  const handleSaveDefaults = () => {
    saveAsDefaults()
    if (defaultsSavedTimerRef.current) clearTimeout(defaultsSavedTimerRef.current)
    setDefaultsSaved(true)
    defaultsSavedTimerRef.current = setTimeout(() => setDefaultsSaved(false), 2000)
  }

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-white/10 bg-black/60 backdrop-blur-xl">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-6 sm:py-8">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="relative size-10 shrink-0 overflow-hidden rounded-lg sm:size-11">
              <Image src="/logo.png" alt="" width={44} height={44} className="object-cover" />
            </div>
            <div className="flex flex-col">
              <span className="text-xl font-bold tracking-tight text-white">NonoiseMedia</span>
              <span className="text-sm text-zinc-400">Kalkulator wycen</span>
            </div>
          </div>

          {/* Right side */}
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-3">
              {/* Total display */}
              <div className="text-right">
                <p className="text-xs text-zinc-400">Szacunkowy koszt (netto)</p>
                <div className="relative" style={{ minWidth: '7.5rem', minHeight: '1.75rem' }}>
                  <AnimatePresence mode="wait" initial={false}>
                    {delta !== null ? (
                      <motion.span
                        key="delta"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.18, ease: 'easeOut' }}
                        className={`block text-right text-lg font-semibold tabular-nums sm:text-xl ${
                          delta > 0 ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {delta > 0 ? '+' : ''}{formatCurrency(delta)}
                      </motion.span>
                    ) : (
                      <motion.div
                        key="total"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.18, ease: 'easeOut' }}
                        className="text-right"
                      >
                        <AnimatedCurrency
                          value={totals.sumaNetto}
                          format={formatCurrency}
                          className="text-lg font-semibold tabular-nums text-amber-400 sm:text-xl"
                          duration={0.5}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-1.5">
                {/* Biblioteka wycen: zapis / wczytywanie nazwanych wycen */}
                <button
                  type="button"
                  onClick={() => setLibraryOpen(true)}
                  title="Moje wyceny — zapisz i wczytuj wyceny"
                  aria-label="Moje wyceny"
                  className="flex h-9 max-w-44 shrink items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <FolderOpen className="size-4 shrink-0" />
                  <span className="truncate text-xs font-medium">
                    {activeQuoteName ?? 'Wyceny'}
                  </span>
                </button>

                {/* Divider */}
                <div className="w-px h-4 bg-white/10" />

                <ActionButton
                  onClick={handleSaveDefaults}
                  title="Zapisz stawki jako moje domyślne (przywracane przy twardym resecie)"
                  aria-label="Zapisz stawki jako domyślne"
                  active={defaultsSaved}
                  activeClass="text-amber-400 border-amber-400/40 bg-amber-400/10"
                >
                  <Save className="size-4" />
                </ActionButton>

                {/* Divider */}
                <div className="w-px h-4 bg-white/10" />

                {/* Reset group */}
                <ActionButton
                  onClick={resetToZero}
                  title="Resetuj wycenę do zera (stawki bez zmian)"
                  aria-label="Resetuj wycenę"
                >
                  <RotateCcw className="size-4" />
                </ActionButton>
                <ActionButton
                  onClick={handleHardReset}
                  title={hardResetPending ? 'Kliknij ponownie aby potwierdzić twardy reset' : 'Twardy reset — zeruje wycenę i przywraca stawki do domyślnych'}
                  aria-label="Twardy reset"
                  active={hardResetPending}
                  activeClass="text-red-400 border-red-400/40 bg-red-400/10"
                >
                  <Eraser className="size-4" />
                </ActionButton>

                {/* Divider */}
                <div className="w-px h-4 bg-white/10" />

                {/* Settings */}
                <ActionButton
                  onClick={() => setSheetOpen(true)}
                  title="Ustawienia wyceny"
                  aria-label="Ustawienia wyceny"
                >
                  <Settings className="size-4" />
                </ActionButton>
              </div>
            </div>

            {/* Margin slider */}
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
      <QuoteLibrarySheet open={libraryOpen} onOpenChange={setLibraryOpen} />
    </>
  )
}

// ── Shared button component ──────────────────────────────────────────────────
function ActionButton({
  onClick,
  title,
  'aria-label': ariaLabel,
  active = false,
  activeClass = '',
  children,
}: {
  onClick: () => void
  title: string
  'aria-label': string
  active?: boolean
  activeClass?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      className={`flex size-9 shrink-0 items-center justify-center rounded-lg border transition-colors ${
        active
          ? activeClass
          : 'border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white'
      }`}
    >
      {children}
    </button>
  )
}
