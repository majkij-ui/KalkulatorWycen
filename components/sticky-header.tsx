'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Settings } from 'lucide-react'
import { useQuote } from '@/lib/quote-context'
import { AnimatedCurrency } from '@/components/animated-currency'
import { SettingsSheet } from '@/components/settings-sheet'

export function StickyHeader() {
  const { totals, formatCurrency } = useQuote()
  const [sheetOpen, setSheetOpen] = useState(false)

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

          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-xs text-zinc-400">
                Szacunkowy koszt (netto)
              </p>
              <AnimatedCurrency
                value={totals.sumaNetto}
                format={formatCurrency}
                className="text-lg font-semibold tabular-nums text-amber-400 sm:text-xl"
                duration={0.5}
              />
            </div>
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
      </header>

      <SettingsSheet open={sheetOpen} onOpenChange={setSheetOpen} />
    </>
  )
}
