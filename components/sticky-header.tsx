'use client'

import { useState, useEffect, useRef } from 'react'
import Image from 'next/image'
import { Settings, RotateCcw, Eraser, FileText } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuote } from '@/lib/quote-context'
import { useProjectHub } from '@/lib/project-hub-context'
import { AnimatedCurrency } from '@/components/animated-currency'
import { BipolarSlider } from '@/components/ui/bipolar-slider'
import { SettingsSheet } from '@/components/settings-sheet'
import { QuoteCurrencyControl } from '@/components/quote-currency-control'
import { formatMoney } from '@/lib/quote-currency'
import { DISCOUNT_LINE_LABEL, MARGIN_LINE_LABEL, hasMarginLine, marginLineAmount } from '@/lib/quote-calc'

export function StickyHeader() {
  const {
    totals,
    formatCurrency,
    resetToZero,
    marginMultiplier,
    setMarginMultiplier,
    hardReset,
    money,
    sumaNettoPln,
    data,
    breakdown,
  } = useQuote()
  // Wycena to dokument otwartego projektu — zapisuje się sama (bez „Zapisz").
  const { activeProject } = useProjectHub()

  const [sheetOpen, setSheetOpen] = useState(false)
  const [delta, setDelta] = useState<number | null>(null)
  const prevTotalRef = useRef<number | null>(null)
  const prevCurrencyRef = useRef(money.currency)
  const deltaTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Resety zapisują się od razu, więc oba potwierdza się drugim kliknięciem w ciągu 3 s.
  // „Cofnij zmiany z tej sesji" w nagłówku projektu przywraca wycenę sprzed nich.
  const [pendingReset, setPendingReset] = useState<'zero' | 'hard' | null>(null)
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Delta animation
  useEffect(() => {
    const current = totals.sumaNetto
    const prev = prevTotalRef.current
    if (prev === null) { prevTotalRef.current = current; return }
    // Zmiana waluty wyceny to nie zmiana ceny — bez błysku różnicy.
    if (prevCurrencyRef.current !== money.currency) {
      prevCurrencyRef.current = money.currency
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
  }, [totals.sumaNetto, money.currency])

  const displayPercent = Math.round((marginMultiplier - 1) * 100)
  const sign = displayPercent > 0 ? '+' : ''
  // R1 (A5): w nowej wycenie marża to osobna pozycja; w starej rozciąga ceny pozycji jak dotąd.
  const marginLine = marginLineAmount(breakdown)
  const marginNote =
    displayPercent === 0
      ? null
      : hasMarginLine(data)
        ? `${marginLine < 0 ? DISCOUNT_LINE_LABEL : MARGIN_LINE_LABEL}: ${formatCurrency(Math.round(marginLine))} (osobna pozycja)`
        : 'rozciąga ceny pozycji (starsza wycena)'

  // ── Resety (dwa kliknięcia) ──────────────────────────────────────────────────
  const handleReset = (kind: 'zero' | 'hard') => {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
    if (pendingReset !== kind) {
      setPendingReset(kind)
      resetTimerRef.current = setTimeout(() => setPendingReset(null), 3000)
      return
    }
    setPendingReset(null)
    if (kind === 'hard') hardReset()
    else resetToZero()
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
            <div className="flex flex-col items-start">
              <span className="text-xl font-bold tracking-tight text-white">NonoiseMedia</span>
              <span className="text-sm text-zinc-400">Kalkulator wycen</span>

              {/* Wycena TEGO projektu — widać, czyj dokument edytujesz, także po przewinięciu */}
              {activeProject && (
                <span
                  title={activeProject.name}
                  className="mt-1.5 inline-flex max-w-[180px] items-center gap-1.5 rounded-full border border-amber-400/20 bg-amber-400/10 px-2.5 py-0.5 sm:max-w-[260px]"
                >
                  <FileText className="size-3 shrink-0 text-amber-400/80" />
                  <span className="truncate text-xs font-medium text-amber-100/90">{activeProject.name}</span>
                </span>
              )}
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
                {money.currency !== 'PLN' && (
                  <p className="text-[11px] tabular-nums text-zinc-500" title="Finanse liczą się w złotych po kursie wyceny">
                    ≈ {formatMoney(Math.round(sumaNettoPln), 'PLN', { decimals: 0 })}
                  </p>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-1.5">
                {/* Reset group */}
                <ActionButton
                  onClick={() => handleReset('zero')}
                  title={
                    pendingReset === 'zero'
                      ? 'Kliknij ponownie, aby wyzerować wycenę tego projektu'
                      : 'Wyzeruj wycenę tego projektu (stawki bez zmian)'
                  }
                  aria-label="Wyzeruj wycenę"
                  active={pendingReset === 'zero'}
                  activeClass="text-red-400 border-red-400/40 bg-red-400/10"
                >
                  <RotateCcw className="size-4" />
                </ActionButton>
                <ActionButton
                  onClick={() => handleReset('hard')}
                  title={
                    pendingReset === 'hard'
                      ? 'Kliknij ponownie, aby wyczyścić wycenę tego projektu'
                      : 'Wyczyść wycenę tego projektu i przywróć moje domyślne stawki'
                  }
                  aria-label="Wyczyść wycenę"
                  active={pendingReset === 'hard'}
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

            <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
            {/* Waluta wyceny (S3) */}
            <QuoteCurrencyControl />

            {/* Margin slider */}
            <div className="flex flex-col items-stretch gap-0.5 w-64">
            <div className="flex items-center gap-3 opacity-80 hover:opacity-100 transition-opacity">
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
            {marginNote && (
              <div className="truncate text-right text-[10px] tabular-nums text-zinc-500" title={marginNote}>
                {marginNote}
              </div>
            )}
            </div>
            </div>
          </div>
        </div>
      </header>

      <SettingsSheet open={sheetOpen} onOpenChange={setSheetOpen} />
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
