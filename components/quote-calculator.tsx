'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ClipboardList, Clapperboard, Scissors, PlusCircle, FileDown } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { StickyHeader } from '@/components/sticky-header'
import { PreprodukcjaTab } from '@/components/tabs/preprodukcja'
import { ProdukcjaTab } from '@/components/tabs/produkcja'
import { PostprodukcjaTab } from '@/components/tabs/postprodukcja'
import { DodatkoweTab } from '@/components/tabs/dodatkowe'
import { PodgladPdfTab } from '@/components/tabs/podglad-pdf'
import { QuoteDocScope, useQuote } from '@/lib/quote-context'
import { currencyUnit } from '@/lib/quote-currency'
import { QuoteVariantsBar } from '@/components/projects/quote-variants-bar'
import type { Project } from '@/lib/project-types'

export type CalculatorTab = 'preprodukcja' | 'produkcja' | 'postprodukcja' | 'dodatkowe' | 'podglad'

const tabs: { value: CalculatorTab; label: string; icon: typeof ClipboardList }[] = [
  { value: 'preprodukcja', label: 'Preprodukcja', icon: ClipboardList },
  { value: 'produkcja', label: 'Produkcja', icon: Clapperboard },
  { value: 'postprodukcja', label: 'Postprodukcja', icon: Scissors },
  { value: 'dodatkowe', label: 'Dodatkowe', icon: PlusCircle },
  { value: 'podglad', label: 'Podglad i PDF', icon: FileDown },
]

const CATEGORY_TO_TAB: Record<string, CalculatorTab> = {
  Preprodukcja: 'preprodukcja',
  Produkcja: 'produkcja',
  Postprodukcja: 'postprodukcja',
  Dodatkowe: 'dodatkowe',
}

/**
 * Widok kalkulatora bez własnego opakowania strony — tło i poświatę dostarcza
 * `AppShell`, dzięki czemu ten sam komponent renderuje się wewnątrz projektu.
 * Pokazuje wycenę otwartego projektu (jego dokument); zmiany zapisują się same.
 * `initialTab` / `onTabChange` — projekt pamięta kartę, na której byłeś.
 *
 * Zakładka Profit przeszła do zakładki projektu „Realizacja" jako plan (T5a);
 * jej dane dalej żyją w wycenie.
 *
 * Warianty (Q2): `docId` to dokument oglądanego wariantu; kalkulator, PDF i
 * nagłówek z sumą liczą z niego (`QuoteDocScope`), a pasek wariantów
 * przełącza między nimi. Bez `project` — sam kalkulator wybranego wariantu.
 */
export function QuoteCalculatorView({
  initialTab,
  onTabChange,
  project,
  docId,
  variantId,
  onSelectVariant,
}: {
  initialTab?: CalculatorTab
  onTabChange?: (tab: CalculatorTab) => void
  project?: Project
  docId?: string
  variantId?: string
  onSelectVariant?: (variantId: string) => void
} = {}) {
  const calculator = (
    <CalculatorBody
      initialTab={initialTab}
      onTabChange={onTabChange}
      variantsBar={
        project && variantId && onSelectVariant ? (
          <QuoteVariantsBar project={project} selectedId={variantId} onSelect={onSelectVariant} />
        ) : null
      }
    />
  )
  return docId ? <QuoteDocScope docId={docId}>{calculator}</QuoteDocScope> : calculator
}

function CalculatorBody({
  initialTab,
  onTabChange,
  variantsBar,
}: {
  initialTab?: CalculatorTab
  onTabChange?: (tab: CalculatorTab) => void
  variantsBar: React.ReactNode
}) {
  const [activeTab, setActiveTabState] = useState<CalculatorTab>(initialTab ?? 'preprodukcja')
  const setActiveTab = (next: string) => {
    setActiveTabState(next as CalculatorTab)
    onTabChange?.(next as CalculatorTab)
  }
  const { breakdown, money, docEpoch, docId } = useQuote()

  const phaseNetMap: Partial<Record<CalculatorTab, number>> = {}
  for (const phase of breakdown) {
    const key = CATEGORY_TO_TAB[phase.category]
    if (key) phaseNetMap[key] = phase.phaseNetto
  }

  return (
    <>
      <StickyHeader />

      <main className="relative mx-auto max-w-4xl px-4 py-6">
        {variantsBar}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="flex justify-center mb-8">
            <TabsList className="inline-flex items-center justify-center rounded-full border border-white/5 bg-black/60 p-1 backdrop-blur-xl">
              {tabs.map((tab) => {
                const Icon = tab.icon
                const phaseNetto = phaseNetMap[tab.value] ?? 0
                return (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm text-zinc-400 data-[state=active]:bg-zinc-800 data-[state=active]:text-white transition-all"
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="hidden sm:flex flex-col items-start leading-[1.15]">
                      <span>{tab.label}</span>
                      {phaseNetto > 0 && (
                        <span className="text-[10px] tabular-nums font-normal text-amber-400/70">
                          {Math.round(phaseNetto).toLocaleString('pl-PL')} {currencyUnit(money.currency)}
                        </span>
                      )}
                    </span>
                    <span className="text-[10px] leading-tight sm:hidden">{tab.label.split(' ')[0]}</span>
                  </TabsTrigger>
                )
              })}
            </TabsList>
          </div>

          <div className="relative min-h-[400px]">
            <AnimatePresence mode="wait">
              <motion.div
                layout
                key={activeTab}
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.25, ease: 'easeInOut' }}
              >
                <TabsContent value="preprodukcja" className="mt-0">
                  <PreprodukcjaTab />
                </TabsContent>
                <TabsContent value="produkcja" className="mt-0">
                  <ProdukcjaTab />
                </TabsContent>
                <TabsContent value="postprodukcja" className="mt-0">
                  <PostprodukcjaTab />
                </TabsContent>
                <TabsContent value="dodatkowe" className="mt-0">
                  <DodatkoweTab />
                </TabsContent>
                <TabsContent value="podglad" className="mt-0">
                  {/* Inny wariant albo wycena podmieniona w całości (import z pliku, zmiana z zewnątrz) — PDF od nowa. */}
                  <PodgladPdfTab key={`${docId ?? ''}:${docEpoch}`} />
                </TabsContent>
              </motion.div>
            </AnimatePresence>
          </div>
        </Tabs>

        {/* Footer */}
        <footer className="mt-12 border-t border-white/5 pb-8 pt-6 text-center">
          <p className="text-xs text-zinc-400">
            Przedstawione kwoty mają charakter szacunkowy i mogą ulec zmianie.
          </p>
          {process.env.NEXT_PUBLIC_GIT_VERSION && (
            <p className="mt-2 text-[10px] text-zinc-500 tabular-nums">
              {process.env.NEXT_PUBLIC_GIT_VERSION}
            </p>
          )}
        </footer>
      </main>
    </>
  )
}
