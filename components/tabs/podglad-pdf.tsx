'use client'

import { useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Download, Receipt } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useQuote } from '@/lib/quote-context'
import { QuotePdfDocument } from '@/components/quote-pdf-document'
import { AnimatedCurrency } from '@/components/animated-currency'
import { format } from 'date-fns'

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
}

const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0 },
}

export function PodgladPdfTab() {
  const { breakdown, totals, formatCurrency, isCalculating } = useQuote()
  const [projectName, setProjectName] = useState('')
  const [validUntil, setValidUntil] = useState('')

  const defaultValidUntil = validUntil || format(new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd')

  const handleDownload = useCallback(async () => {
    const { pdf } = await import('@react-pdf/renderer')
    const doc = (
      <QuotePdfDocument
        projectName={projectName}
        validUntil={validUntil || defaultValidUntil}
        breakdown={breakdown}
        sumaNetto={totals.sumaNetto}
        vat={totals.vat}
        sumaBrutto={totals.sumaBrutto}
      />
    )
    const blob = await pdf(doc).toBlob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `wycena-${projectName ? projectName.replace(/\s+/g, '-') : 'projekt'}-${format(new Date(), 'yyyy-MM-dd')}.pdf`
    a.click()
    URL.revokeObjectURL(url)
  }, [breakdown, totals, projectName, validUntil, defaultValidUntil])

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="space-y-5"
    >
      <motion.div variants={item} className="space-y-4">
        <div className="grid gap-4 rounded-xl border-t border-l border-white/10 bg-zinc-900/30 p-4 backdrop-blur-xl sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="project-name" className="text-zinc-400">Nazwa projektu</Label>
            <Input
              id="project-name"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="np. Kampania wiosenna 2025"
              className="border-white/10 bg-white/5 text-foreground"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="valid-until" className="text-zinc-400">Data ważności oferty</Label>
            <Input
              id="valid-until"
              type="date"
              value={validUntil || defaultValidUntil}
              onChange={(e) => setValidUntil(e.target.value)}
              className="border-white/10 bg-white/5 text-foreground"
            />
          </div>
        </div>
      </motion.div>

      <motion.div variants={item}>
        <div className="overflow-hidden rounded-xl border-t border-l border-white/10 bg-zinc-900/30 backdrop-blur-xl">
          <div className="border-b border-white/10 px-6 py-5">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Receipt className="size-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Podsumowanie wyceny</h3>
                <p className="text-xs text-zinc-400">Szczegółowy rozkład kosztów projektu</p>
              </div>
            </div>
          </div>

          {isCalculating ? (
            <div className="flex flex-col gap-3 px-6 py-8">
              <div className="h-4 w-3/4 animate-pulse rounded bg-white/10" />
              <div className="h-4 w-full animate-pulse rounded bg-white/10" />
              <div className="h-4 w-5/6 animate-pulse rounded bg-white/10" />
              <div className="mt-4 h-8 w-1/2 animate-pulse rounded bg-white/10" />
            </div>
          ) : (
            <>
              <div className="divide-y divide-white/5">
                {(breakdown ?? []).map((section, sectionIdx) => (
                  <motion.div
                    key={section.category}
                    variants={item}
                    layout
                    className="px-6 py-4"
                  >
                    <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-primary/80">
                      {section.category}
                    </h4>
                    <div className="space-y-2">
                      {(section.items ?? []).map((lineItem, i) => (
                        <div
                          key={`${sectionIdx}-${i}`}
                          className="flex items-center justify-between text-sm"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-zinc-400">{lineItem.label}</span>
                            <span className="rounded bg-white/5 px-1.5 py-0.5 text-xs text-zinc-500">
                              {lineItem.value}
                            </span>
                          </div>
                          <span className={`font-medium tabular-nums ${lineItem.lineNetto > 0 ? 'text-white' : 'text-zinc-500'}`}>
                            {formatCurrency(lineItem.lineNetto)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                ))}
              </div>

              <div className="border-t border-white/10 bg-primary/5 px-6 py-5">
                <div className="flex items-center justify-between">
                  <span className="text-lg font-bold text-white">Suma netto</span>
                  <AnimatedCurrency
                    value={totals.sumaNetto}
                    format={formatCurrency}
                    className="text-2xl font-bold tabular-nums text-primary"
                    duration={0.5}
                  />
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-sm text-zinc-400">VAT (23%)</span>
                  <AnimatedCurrency
                    value={totals.vat}
                    format={formatCurrency}
                    className="text-sm tabular-nums text-zinc-400"
                    duration={0.5}
                  />
                </div>
                <Separator className="my-3 bg-white/10" />
                <div className="flex items-center justify-between">
                  <span className="text-lg font-bold text-white">Suma brutto</span>
                  <AnimatedCurrency
                    value={totals.sumaBrutto}
                    format={formatCurrency}
                    className="text-2xl font-bold tabular-nums text-white"
                    duration={0.5}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      </motion.div>

      <motion.div variants={item}>
        <Button
          onClick={handleDownload}
          size="lg"
          className="w-full gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Download className="size-5" />
          Pobierz wycenę (PDF)
        </Button>
      </motion.div>
    </motion.div>
  )
}
