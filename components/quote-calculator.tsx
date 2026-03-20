'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ClipboardList, Clapperboard, Scissors, PlusCircle, FileDown } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { StickyHeader } from '@/components/sticky-header'
import { CalculatingOverlay } from '@/components/calculating-overlay'
import { AmbientGlow } from '@/components/ambient-glow'
import { PreprodukcjaTab } from '@/components/tabs/preprodukcja'
import { ProdukcjaTab } from '@/components/tabs/produkcja'
import { PostprodukcjaTab } from '@/components/tabs/postprodukcja'
import { DodatkoweTab } from '@/components/tabs/dodatkowe'
import { PodgladPdfTab } from '@/components/tabs/podglad-pdf'
import { QuoteProvider, useQuote } from '@/lib/quote-context'

const tabs = [
  { value: 'preprodukcja', label: 'Preprodukcja', icon: ClipboardList },
  { value: 'produkcja', label: 'Produkcja', icon: Clapperboard },
  { value: 'postprodukcja', label: 'Postprodukcja', icon: Scissors },
  { value: 'dodatkowe', label: 'Dodatkowe', icon: PlusCircle },
  { value: 'podglad', label: 'Podglad i PDF', icon: FileDown },
]

function QuoteCalculatorInner() {
  const [activeTab, setActiveTab] = useState('preprodukcja')
  const { isCalculating } = useQuote()

  return (
    <div className="relative min-h-screen bg-[#050505]">
      <AmbientGlow />

      <StickyHeader />

      <main className="relative mx-auto max-w-4xl px-4 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="flex justify-center mb-8">
            <TabsList className="inline-flex items-center justify-center rounded-full border border-white/5 bg-black/60 p-1 backdrop-blur-xl">
              {tabs.map((tab) => {
                const Icon = tab.icon
                return (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    className="inline-flex items-center gap-2 rounded-full px-6 py-2 text-sm text-zinc-400 data-[state=active]:bg-zinc-800 data-[state=active]:text-white transition-all"
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="hidden sm:inline">{tab.label}</span>
                    <span className="text-[10px] leading-tight sm:hidden">{tab.label.split(' ')[0]}</span>
                  </TabsTrigger>
                )
              })}
            </TabsList>
          </div>

          <div className="relative min-h-[400px]">
            <CalculatingOverlay isVisible={isCalculating} />

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
                  <PodgladPdfTab />
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
    </div>
  )
}

export function QuoteCalculator() {
  const [mounted, setMounted] = useState(false)

  // Ensures we only render after hydration to prevent ID mismatches.
  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return <div className="min-h-screen bg-zinc-950" />
  }

  return (
    <QuoteProvider>
      <QuoteCalculatorInner />
    </QuoteProvider>
  )
}
