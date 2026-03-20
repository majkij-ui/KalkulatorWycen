'use client'

import { useState, useCallback, useMemo } from 'react'
import { motion } from 'framer-motion'
import { FileDown, Receipt } from 'lucide-react'
import { addDays, format } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { GlassCard } from '@/components/glass-card'
import { useQuote } from '@/lib/quote-context'
import { QuotePdfDocument } from '@/components/pdf/quote-pdf-document'
import { AnimatedCurrency } from '@/components/animated-currency'
import { safeArray, safeNum } from '@/lib/safe-numbers'

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
  const { breakdown, totals, formatCurrency, isCalculating, getTermsAndConditions, data } = useQuote()
  const [projectName, setProjectName] = useState('')

  const { issueDateIso, validUntilIso } = useMemo(() => {
    const issue = new Date()
    return {
      issueDateIso: format(issue, 'yyyy-MM-dd'),
      validUntilIso: format(addDays(issue, 30), 'yyyy-MM-dd'),
    }
  }, [])

  const phaseTotals = useMemo(() => {
    const pre = breakdown?.find((p) => p.category === 'Preprodukcja')?.phaseNetto ?? 0
    const pro = breakdown?.find((p) => p.category === 'Produkcja')?.phaseNetto ?? 0
    const post = breakdown?.find((p) => p.category === 'Postprodukcja')?.phaseNetto ?? 0

    const dodPhase = breakdown?.find((p) => p.category === 'Dodatkowe')
    const dodItems = safeArray(dodPhase?.items)

    const dojazd = safeNum(
      dodItems.find((i) => i.label === 'Koszty dojazdu')?.lineNetto,
      0,
      0
    )
    const catering = safeNum(
      dodItems.find((i) => i.label === 'Catering')?.lineNetto,
      0,
      0
    )
    const noclegi = safeNum(
      dodItems.find((i) => i.label === 'Noclegi')?.lineNetto,
      0,
      0
    )
    const prawaAutorskie = safeNum(
      dodItems.find((i) => i.label === 'Pełne przekazanie praw')?.lineNetto,
      0,
      0
    )

    return [
      { category: 'Preprodukcja', phaseNetto: safeNum(pre, 0, 0) },
      { category: 'Produkcja', phaseNetto: safeNum(pro, 0, 0) },
      { category: 'Postprodukcja', phaseNetto: safeNum(post, 0, 0) },
      { category: 'Logistyka (Catering + Nocleg + Dojazd)', phaseNetto: dojazd + catering + noclegi },
      { category: 'Prawa Autorskie (Licencja / Przekazanie praw)', phaseNetto: prawaAutorskie },
      { category: 'Opcje Dodatkowe', phaseNetto: 0 },
    ]
  }, [breakdown])

  const terms = useMemo(() => getTermsAndConditions(), [getTermsAndConditions])

  const handleDownload = useCallback(async () => {
    const { pdf } = await import('@react-pdf/renderer')
    const doc = (
      <QuotePdfDocument
        clientProjectName={projectName}
        issueDateIso={issueDateIso}
        validUntilIso={validUntilIso}
        phaseTotals={phaseTotals}
        totals={totals}
        termsAndConditions={terms}
        opcjeDodatkowe={data.opcjeDodatkowe}
      />
    )
    const blob = await pdf(doc).toBlob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `wycena-${projectName ? projectName.replace(/\s+/g, '-') : 'projekt'}-${issueDateIso}.pdf`
    a.click()
    URL.revokeObjectURL(url)
  }, [data.opcjeDodatkowe, issueDateIso, phaseTotals, projectName, terms, totals, validUntilIso])

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
            <Label htmlFor="project-name" className="text-zinc-400">Klient / Projekt</Label>
            <Input
              id="project-name"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="np. Kampania wiosenna 2025"
              className="border-white/10 bg-white/5 text-foreground"
            />
          </div>
        </div>
      </motion.div>

      <motion.div variants={item}>
        <GlassCard className="relative">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Receipt className="size-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Podgląd na żywo</h3>
              <p className="text-xs text-zinc-400">Premium podsumowanie wyceny (netto)</p>
            </div>
          </div>

          {isCalculating ? (
            <div className="flex flex-col gap-3 py-2">
              <div className="h-4 w-3/4 animate-pulse rounded bg-white/10" />
              <div className="h-4 w-full animate-pulse rounded bg-white/10" />
              <div className="h-4 w-5/6 animate-pulse rounded bg-white/10" />
            </div>
          ) : (
            <>
              <div className="space-y-3">
                {phaseTotals.map((p, idx) => (
                  <div key={`${p.category}-${idx}`} className="flex items-center justify-between text-sm">
                    <span className="text-zinc-400">{p.category}</span>
                    <span className="font-medium tabular-nums text-white">{formatCurrency(p.phaseNetto)}</span>
                  </div>
                ))}
              </div>

              {data.opcjeDodatkowe?.trim() ? (
                <div className="mt-5 rounded-xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-primary/80">Opcje Dodatkowe</span>
                    <span className="text-xs text-zinc-500">opis</span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-zinc-400">
                    {data.opcjeDodatkowe}
                  </p>
                </div>
              ) : null}

              <Separator className="my-5 bg-white/10" />

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
              <div className="mt-3 flex items-center justify-between">
                <span className="text-lg font-bold text-white">Suma brutto</span>
                <AnimatedCurrency
                  value={totals.sumaBrutto}
                  format={formatCurrency}
                  className="text-2xl font-bold tabular-nums text-white"
                  duration={0.5}
                />
              </div>
            </>
          )}
        </GlassCard>
      </motion.div>

      <motion.div variants={item}>
        <Button
          onClick={handleDownload}
          size="lg"
          disabled={isCalculating}
          className="w-full gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <FileDown className="size-5" />
          Pobierz wycenę (PDF)
        </Button>
      </motion.div>
    </motion.div>
  )
}
