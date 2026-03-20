'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { FileDown, Receipt } from 'lucide-react'
import { useReactToPrint } from 'react-to-print'
import { addDays, format } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { GlassCard } from '@/components/glass-card'
import { useQuote } from '@/lib/quote-context'
import { PrintableQuote } from '@/components/pdf/printable-quote'
import { safeArray, safeNum } from '@/lib/safe-numbers'
import { getProductionEkipaSprzetNetto, type LineItemRow } from '@/lib/quote-calc'
import type { LocalPdfState, PdfRowKey, QuoteData } from '@/lib/quote-types'

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

const VAT_RATE = 0.23

const ROWS: { key: PdfRowKey; title: string }[] = [
  { key: 'preprodukcja', title: 'Preprodukcja' },
  { key: 'ekipa', title: 'Ekipa filmowa' },
  { key: 'sprzet', title: 'Sprzęt filmowy' },
  { key: 'logistyka', title: 'Logistyka' },
  { key: 'postprodukcja', title: 'Postprodukcja' },
  { key: 'inne', title: 'Inne koszty' },
]

function round2(n: number): number {
  const safe = safeNum(n, 0)
  return Math.round(safe * 100) / 100
}

function netToInputValue(net: number, showVat: boolean): number {
  return safeNum(showVat ? net * (1 + VAT_RATE) : net, 0)
}

function inputToNet(input: number, showVat: boolean): number {
  return safeNum(showVat ? input / (1 + VAT_RATE) : input, 0)
}

function AutoGrowTextarea({
  value,
  onChange,
  placeholder,
  disabled,
}: {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  disabled?: boolean
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  return (
    <textarea
      ref={ref}
      disabled={disabled}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="min-h-10 w-full resize-none overflow-hidden rounded-md border border-zinc-200 bg-white/70 px-3 py-2 text-[12px] leading-snug text-zinc-900 outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-60"
      style={{ height: 0 }}
    />
  )
}

function getOpisInitial({
  key,
  data,
}: {
  key: PdfRowKey
  data: QuoteData
}): string {
  if (key === 'preprodukcja') {
    const scen =
      data.scenariusz === 'brak'
        ? 'Brak'
        : data.scenariusz === 'podstawowy'
          ? 'Podstawowy'
          : 'Rozbudowany'

    if (!data.isDetailedPrepro) {
      return `Dokumentacja: ${safeNum(data.dniDokumentacji, 0, 0)} dni.\nScenariusz: ${scen}.`
    }

    return `Scenariusz: ${scen}.\nWizja lokalna: ${data.wizjaLokalna ? 'Tak' : 'Nie'}.\nKierownik produkcji: ${data.kierownikProdukcji ? 'Tak' : 'Nie'}.`
  }

  if (key === 'ekipa') {
    if (!data.isDetailedProdukcja) {
      return `Tryb szybkiej wyceny: ${safeNum(data.dniZdjeciowe, 0, 0)} dni × ${safeNum(data.wielkoscEkipy, 1, 1)} os.\nDopłata Reż-Op: ${data.crudeRezOpSurcharge ? 'Tak' : 'Nie'}.`
    }

    return `Szczegółowa wycena ról i obsady dla ${safeArray(data.detailedShootingDays).length} dni zdjęciowych.`
  }

  if (key === 'sprzet') {
    if (!data.isDetailedProdukcja) {
      return `Klasa sprzętu: ${data.klasaSprzetu}.\nDopłata Dron: ${data.crudeDroneSurcharge ? 'Tak' : 'Nie'}.`
    }

    return `Szczegółowa wycena sprzętu (kamery, obiektywy, stabilizacja, podgląd, światło, dron) dla ${safeArray(
      data.detailedShootingDays
    ).length} dni zdjęciowych.`
  }

  if (key === 'logistyka') {
    return `Dojazd: ${safeNum(data.kosztDojazduKm, 0, 0)} km.\nCatering: ${data.includeCatering ? 'Tak' : 'Nie'}.\nNoclegi: ${data.includeLodging ? 'Tak' : 'Nie'}.`
  }

  if (key === 'postprodukcja') {
    if (!data.isDetailedPostpro) {
      return `Montaż w trybie szybkiej wyceny: ${safeNum(data.crudeEditCount, 0, 0)} ${data.crudeEditUnit === 'dni' ? 'dni' : 'godz.'}.`
    }

    return `Szczegółowa wycena postprodukcji: ${safeArray(data.detailedDeliverables).length} pozycji (formaty i dostawy).`
  }

  if (key === 'inne') {
    const prawa =
      data.copyrightType === 'przekazanie' ? 'pełne przekazanie praw' : 'niewyłączna licencja'
    return `Lektor: ${data.lektor ? 'Tak' : 'Nie'}.\nLicencja muzyczna: ${data.licencjaMuzyczna}.\nPrawa autorskie: ${prawa}.`
  }

  return ''
}

export function PodgladPdfTab() {
  const { breakdown, totals, formatCurrency, isCalculating, getTermsAndConditions, data, pricingTier, pricingConfig, marginMultiplier } =
    useQuote()

  const issueDatePl = useMemo(() => format(new Date(), 'dd.MM.yyyy'), [])
  const validUntilPl = useMemo(() => format(addDays(new Date(), 30), 'dd.MM.yyyy'), [])

  const terms = useMemo(() => getTermsAndConditions(), [getTermsAndConditions])

  const touchedRowsRef = useRef<Record<PdfRowKey, boolean>>({
    preprodukcja: false,
    ekipa: false,
    sprzet: false,
    logistyka: false,
    postprodukcja: false,
    inne: false,
  })
  const touchedOpcjeRef = useRef(false)

  const buildInitialState = (): LocalPdfState => {
    const preNetto = safeNum(breakdown?.find((p) => p.category === 'Preprodukcja')?.phaseNetto, 0, 0)
    const postNetto = safeNum(breakdown?.find((p) => p.category === 'Postprodukcja')?.phaseNetto, 0, 0)

    const { ekipaNetto, sprzetNetto } = getProductionEkipaSprzetNetto(data, pricingTier, marginMultiplier, pricingConfig)

    const dodPhase = breakdown?.find((p) => p.category === 'Dodatkowe')
    const dodItems = safeArray<LineItemRow>(dodPhase?.items)

    const dojazd = dodItems.filter((i) => i.label === 'Koszty dojazdu').reduce((s, i) => s + safeNum(i.lineNetto, 0, 0), 0)
    const catering = dodItems.filter((i) => i.label === 'Catering').reduce((s, i) => s + safeNum(i.lineNetto, 0, 0), 0)
    const noclegi = dodItems.filter((i) => i.label === 'Noclegi').reduce((s, i) => s + safeNum(i.lineNetto, 0, 0), 0)

    const excluded = new Set(['Koszty dojazdu', 'Catering', 'Noclegi'])
    const inneNetto = dodItems
      .filter((i) => !excluded.has(i.label))
      .reduce((s, i) => s + safeNum(i.lineNetto, 0, 0), 0)

    const logistykaNetto = dojazd + catering + noclegi

    const computedSum = preNetto + ekipaNetto + sprzetNetto + logistykaNetto + postNetto + inneNetto
    const delta = safeNum(totals?.sumaNetto, 0, 0) - computedSum

    return {
      projectName: '',
      issueDateIso: issueDatePl,
      validUntilIso: validUntilPl,
      showVat: false,
      rows: {
        preprodukcja: {
          key: 'preprodukcja',
          title: 'Preprodukcja',
          cenaNetto: preNetto,
          opis: getOpisInitial({ key: 'preprodukcja', data }),
        },
        ekipa: {
          key: 'ekipa',
          title: 'Ekipa filmowa',
          cenaNetto: ekipaNetto,
          opis: getOpisInitial({ key: 'ekipa', data }),
        },
        sprzet: {
          key: 'sprzet',
          title: 'Sprzęt filmowy',
          cenaNetto: sprzetNetto,
          opis: getOpisInitial({ key: 'sprzet', data }),
        },
        logistyka: {
          key: 'logistyka',
          title: 'Logistyka',
          cenaNetto: logistykaNetto,
          opis: getOpisInitial({ key: 'logistyka', data }),
        },
        postprodukcja: {
          key: 'postprodukcja',
          title: 'Postprodukcja',
          cenaNetto: postNetto,
          opis: getOpisInitial({ key: 'postprodukcja', data }),
        },
        inne: {
          key: 'inne',
          title: 'Inne koszty',
          cenaNetto: inneNetto + delta,
          opis: getOpisInitial({ key: 'inne', data }),
        },
      },

      materialyKoncowe: '',
      opcjeDodatkowe: data.opcjeDodatkowe ?? '',
      portfolioLinksText: '',
      termsAndConditions: terms,
    }
  }

  const [localPdfState, setLocalPdfState] = useState<LocalPdfState>(() => buildInitialState())

  useEffect(() => {
    const init = buildInitialState()
    setLocalPdfState((prev) => {
      const nextRows = { ...init.rows }
      ;(Object.keys(nextRows) as PdfRowKey[]).forEach((key) => {
        if (touchedRowsRef.current[key]) nextRows[key] = prev.rows[key]
      })

      return {
        ...init,
        // Keep user-edited fields:
        projectName: prev.projectName,
        showVat: prev.showVat,
        materialyKoncowe: prev.materialyKoncowe,
        portfolioLinksText: prev.portfolioLinksText,
        opcjeDodatkowe: touchedOpcjeRef.current ? prev.opcjeDodatkowe : init.opcjeDodatkowe,
        rows: nextRows,
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [breakdown, totals?.sumaNetto, data, pricingTier, pricingConfig, marginMultiplier, terms])

  const totalNetto = useMemo(() => {
    return ROWS.reduce((sum, r) => sum + safeNum(localPdfState.rows[r.key]?.cenaNetto, 0, 0), 0)
  }, [localPdfState.rows])

  const printRef = useRef<HTMLDivElement | null>(null)

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    pageStyle: `
      @page { size: A4; margin: 14mm 12mm; }
      @media print {
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        body * { visibility: hidden !important; }
        #printable-quote { visibility: visible !important; display: block !important; }
        #printable-quote * { visibility: visible !important; }
      }
    `,
  })

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
              value={localPdfState.projectName}
              onChange={(e) => setLocalPdfState((prev) => ({ ...prev, projectName: e.target.value }))}
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
              <h3 className="text-lg font-bold text-white">Podgląd i PDF</h3>
              <p className="text-xs text-zinc-400">Edycja podsumowania oraz eksport do PDF</p>
            </div>
          </div>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Switch
                checked={localPdfState.showVat}
                onCheckedChange={(v) => setLocalPdfState((prev) => ({ ...prev, showVat: Boolean(v) }))}
              />
              <div className="text-sm text-zinc-300">Pokaż VAT (23%)</div>
            </div>
            <Button
              onClick={handlePrint}
              size="lg"
              disabled={isCalculating}
              className="w-full sm:w-auto gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <FileDown className="size-5" />
              Pobierz PDF
            </Button>
          </div>

          <div className="mt-5 rounded-xl border border-zinc-800 bg-zinc-950/20 p-4">
            <div className="w-full overflow-x-auto">
              <div className="min-w-[740px] rounded-lg bg-white/95 p-5 text-zinc-900">
                <div className="mb-3 flex items-end justify-between gap-4 border-b border-zinc-200 pb-3">
                  <div>
                    <div className="text-[10.5px] font-extrabold uppercase tracking-widest text-primary">Oferta współpracy</div>
                    <div className="mt-1 text-[9.5px] text-zinc-600">
                      Data sporządzenia: {localPdfState.issueDateIso}
                    </div>
                    <div className="text-[9.5px] text-zinc-600">
                      Termin ważności: 30 dni (do {localPdfState.validUntilIso})
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[9.5px] text-zinc-700 font-semibold">Klient / Projekt: {localPdfState.projectName?.trim() ? localPdfState.projectName.trim() : '—'}</div>
                    <div className="mt-1 text-[11px] font-bold text-zinc-900">
                      Całkowity koszt {localPdfState.showVat ? 'brutto' : 'netto'}
                    </div>
                    <div className="text-[18px] font-black text-primary tabular-nums">
                      {formatCurrency(localPdfState.showVat ? totalNetto * (1 + VAT_RATE) : totalNetto)}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-12 gap-x-4 pt-2 pb-3 text-[10.5px] font-extrabold uppercase tracking-widest text-primary">
                  <div className="col-span-4">Kategoria</div>
                  <div className="col-span-2 text-right">Szacunkowo</div>
                  <div className="col-span-6">Opis</div>
                </div>

                <div className="rounded-md border border-zinc-200">
                  {ROWS.map((r) => {
                    const row = localPdfState.rows[r.key]
                    const inputValue = netToInputValue(row.cenaNetto, localPdfState.showVat)

                    return (
                      <div
                        key={r.key}
                        className="grid grid-cols-12 gap-x-4 items-start border-b border-zinc-200 last:border-b-0 px-3 py-3"
                      >
                        <div className="col-span-4 text-[12px] font-semibold text-zinc-800 pt-2">{r.title}</div>

                        <div className="col-span-2">
                          <div className="flex justify-end">
                            <input
                              type="number"
                              inputMode="decimal"
                              min={0}
                              step={0.01}
                              disabled={isCalculating}
                              value={Number.isFinite(inputValue) ? round2(inputValue) : 0}
                              onChange={(e) => {
                                const raw = e.target.value
                                const parsed = safeNum(raw === '' ? 0 : Number.parseFloat(raw), 0, 0)
                                const nextNet = round2(inputToNet(parsed, localPdfState.showVat))
                                touchedRowsRef.current[r.key] = true
                                setLocalPdfState((prev) => ({
                                  ...prev,
                                  rows: {
                                    ...prev.rows,
                                    [r.key]: {
                                      ...prev.rows[r.key],
                                      cenaNetto: nextNet,
                                    },
                                  },
                                }))
                              }}
                              className="w-28 rounded-md border border-zinc-200 bg-white/80 px-2 py-2 text-right text-[12px] font-bold tabular-nums text-zinc-900 outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-60"
                            />
                          </div>
                        </div>

                        <div className="col-span-6">
                          <AutoGrowTextarea
                            disabled={isCalculating}
                            value={row.opis}
                            onChange={(next) => {
                              touchedRowsRef.current[r.key] = true
                              setLocalPdfState((prev) => ({
                                ...prev,
                                rows: {
                                  ...prev.rows,
                                  [r.key]: {
                                    ...prev.rows[r.key],
                                    opis: next,
                                  },
                                },
                              }))
                            }}
                            placeholder="Opis zawartości…"
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div className="mt-4 flex items-baseline justify-between border-t border-zinc-200 pt-3">
                  <div className="text-[11px] font-bold text-zinc-900">
                    Total: {localPdfState.showVat ? 'brutto' : 'netto'}
                  </div>
                  <div className="text-[22px] font-black text-primary tabular-nums">
                    {formatCurrency(localPdfState.showVat ? totalNetto * (1 + VAT_RATE) : totalNetto)}
                  </div>
                </div>

                <div className="mt-5 grid gap-4">
                  <div className="rounded-lg border border-zinc-200 p-3">
                    <div className="text-[10.5px] font-extrabold uppercase tracking-widest text-primary mb-1">
                      Materiały końcowe
                    </div>
                    <AutoGrowTextarea
                      disabled={isCalculating}
                      value={localPdfState.materialyKoncowe}
                      onChange={(next) => setLocalPdfState((prev) => ({ ...prev, materialyKoncowe: next }))}
                      placeholder="Np. materiały przekazane klientowi (logo, brandbook, pliki)…"
                    />
                  </div>

                  <div className="rounded-lg border border-zinc-200 p-3">
                    <div className="text-[10.5px] font-extrabold uppercase tracking-widest text-primary mb-1">
                      Opcje dodatkowe
                    </div>
                    <AutoGrowTextarea
                      disabled={isCalculating}
                      value={localPdfState.opcjeDodatkowe}
                      onChange={(next) => {
                        touchedOpcjeRef.current = true
                        setLocalPdfState((prev) => ({ ...prev, opcjeDodatkowe: next }))
                      }}
                      placeholder="Wpisz dodatkowe opcje i uwagi marketingowe…"
                    />
                  </div>

                  <div className="rounded-lg border border-zinc-200 p-3">
                    <div className="text-[10.5px] font-extrabold uppercase tracking-widest text-primary mb-1">
                      Linki do portfolio
                    </div>
                    <AutoGrowTextarea
                      disabled={isCalculating}
                      value={localPdfState.portfolioLinksText}
                      onChange={(next) => setLocalPdfState((prev) => ({ ...prev, portfolioLinksText: next }))}
                      placeholder="Każdy link w osobnej linii…"
                    />
                  </div>

                  <div className="rounded-lg border border-zinc-200 p-3">
                    <div className="text-[10.5px] font-extrabold uppercase tracking-widest text-zinc-700 mb-2">
                      Uwagi
                    </div>
                    {terms.length > 0 ? (
                      <ol className="list-decimal list-inside space-y-1 text-[10px] text-zinc-700">
                        {terms.map((t, idx) => (
                          <li key={`${idx}-${t.slice(0, 18)}`}>{t}</li>
                        ))}
                      </ol>
                    ) : (
                      <div className="text-[10px] text-zinc-600">—</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Hidden printable page for react-to-print */}
          <div ref={printRef} id="printable-quote" style={{ display: 'none' }}>
            <PrintableQuote localPdfState={localPdfState} />
          </div>
        </GlassCard>
      </motion.div>
    </motion.div>
  )
}
