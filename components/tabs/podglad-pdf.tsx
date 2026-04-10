'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { FileDown, Receipt } from 'lucide-react'
import { useReactToPrint } from 'react-to-print'
import { addDays, format } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Switch } from '@/components/ui/switch'
import { GlassCard } from '@/components/glass-card'
import { useQuote } from '@/lib/quote-context'
import { PrintableQuote } from '@/components/pdf/printable-quote'
import { safeArray, safeNum } from '@/lib/safe-numbers'
import { getProductionEkipaSprzetNetto, type LineItemRow } from '@/lib/quote-calc'
import type { LocalPdfState, PdfRowKey, QuoteData } from '@/lib/quote-types'
import { isTauriRuntime } from '@/lib/storage'

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

const PDF_DRAFT_STORAGE_KEY = 'nonoise-pdf-draft'

const PDF_ROW_KEYS: PdfRowKey[] = ['preprodukcja', 'ekipa', 'sprzet', 'logistyka', 'postprodukcja', 'inne']

function coerceLocalPdfDraft(raw: unknown, fallback: LocalPdfState): LocalPdfState {
  if (!raw || typeof raw !== 'object') return fallback
  const r = raw as Partial<LocalPdfState> & { [k: string]: unknown }

  const draftRows = (r.rows && typeof r.rows === 'object' ? (r.rows as Record<string, unknown>) : {}) as Record<
    PdfRowKey,
    unknown
  >

  const coerceStr = (v: unknown, fb: string): string => (typeof v === 'string' ? v : fb)
  const coerceBool = (v: unknown, fb: boolean): boolean => (typeof v === 'boolean' ? v : fb)

  const nextRows: LocalPdfState['rows'] = { ...fallback.rows }
  PDF_ROW_KEYS.forEach((key) => {
    const base = fallback.rows[key]
    const candidate = (draftRows as Record<PdfRowKey, any>)[key]
    const candidateObj = candidate && typeof candidate === 'object' ? candidate : {}

    nextRows[key] = {
      key,
      title: coerceStr(candidateObj?.title, base.title),
      opis: coerceStr(candidateObj?.opis, base.opis),
      cenaNetto: safeNum(candidateObj?.cenaNetto, base.cenaNetto, 0),
    }
  })

  return {
    ...fallback,
    clientName: coerceStr(r.clientName, fallback.clientName),
    projectName: coerceStr(r.projectName, fallback.projectName),
    issueDateIso: coerceStr(r.issueDateIso, fallback.issueDateIso),
    validUntilIso: coerceStr(r.validUntilIso, fallback.validUntilIso),
    terminZdjec: coerceStr(r.terminZdjec, fallback.terminZdjec),
    showVat: coerceBool(r.showVat, fallback.showVat),
    rows: nextRows,
    materialyKoncowe: coerceStr(r.materialyKoncowe, fallback.materialyKoncowe),
    opcjeDodatkowe: coerceStr(r.opcjeDodatkowe, fallback.opcjeDodatkowe),
    portfolioLinksText: coerceStr(r.portfolioLinksText, fallback.portfolioLinksText),
    termsAndConditions: safeArray<string>(r.termsAndConditions).slice(0, 200),
  }
}

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
  className,
}: {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
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
      className={`min-h-10 w-full resize-none overflow-hidden rounded-md border border-zinc-200 bg-white/70 px-3 py-2 text-[12px] leading-snug text-zinc-900 outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-60 ${className ?? ''}`}
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
  const {
    breakdown,
    totals,
    formatCurrency,
    isCalculating,
    getTermsAndConditions,
    data,
    updateField,
    pricingTier,
    pricingConfig,
    marginMultiplier,
  } = useQuote()

  const issueDatePl = useMemo(() => format(new Date(), 'dd.MM.yyyy'), [])
  const validUntilPl = useMemo(() => format(addDays(new Date(), 30), 'dd.MM.yyyy'), [])

  const [draftHydrationStatus, setDraftHydrationStatus] = useState<'loading' | 'ready'>('loading')
  const [isUsingDraft, setIsUsingDraft] = useState(false)
  const [showDraftPrompt, setShowDraftPrompt] = useState(false)

  const terms = useMemo(() => getTermsAndConditions(), [getTermsAndConditions])
  const [uwagiManualText, setUwagiManualText] = useState('')
  // mergedTerms is computed later (after localPdfState + draft mode are known)

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
      clientName: data.clientName ?? '',
      projectName: data.projectName ?? '',
      issueDateIso: issueDatePl,
      validUntilIso: validUntilPl,
      terminZdjec: 'Do ustalenia',
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
    if (typeof window === 'undefined') {
      setDraftHydrationStatus('ready')
      return
    }

    try {
      const raw = localStorage.getItem(PDF_DRAFT_STORAGE_KEY)
      if (!raw) {
        setDraftHydrationStatus('ready')
        return
      }

      const parsed: unknown = JSON.parse(raw)
      const coerced = coerceLocalPdfDraft(parsed, localPdfState)
      setLocalPdfState(coerced)
      setIsUsingDraft(true)
      setShowDraftPrompt(true)

      // Ensure editor inputs (bound to global QuoteState) reflect the draft.
      updateField('clientName', coerced.clientName)
      updateField('projectName', coerced.projectName)
    } catch {
      // ignore corrupted draft
    } finally {
      setDraftHydrationStatus('ready')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (draftHydrationStatus !== 'ready') return
    if (typeof window === 'undefined') return
    try {
      localStorage.setItem(PDF_DRAFT_STORAGE_KEY, JSON.stringify(localPdfState))
    } catch {
      // ignore write failures
    }
  }, [draftHydrationStatus, localPdfState])

  useEffect(() => {
    if (draftHydrationStatus !== 'ready') return
    if (isUsingDraft) return

    const init = buildInitialState()
    setLocalPdfState((prev) => {
      const nextRows = { ...init.rows }
      ;(Object.keys(nextRows) as PdfRowKey[]).forEach((key) => {
        if (touchedRowsRef.current[key]) nextRows[key] = prev.rows[key]
      })

      return {
        ...init,
        // Keep user-edited fields:
        showVat: prev.showVat,
        materialyKoncowe: prev.materialyKoncowe,
        portfolioLinksText: prev.portfolioLinksText,
        terminZdjec: prev.terminZdjec,
        opcjeDodatkowe: touchedOpcjeRef.current ? prev.opcjeDodatkowe : init.opcjeDodatkowe,
        rows: nextRows,
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [breakdown, totals?.sumaNetto, data, pricingTier, pricingConfig, marginMultiplier, terms, draftHydrationStatus, isUsingDraft])

  const totalNetto = useMemo(() => {
    return ROWS.reduce((sum, r) => sum + safeNum(localPdfState.rows[r.key]?.cenaNetto, 0, 0), 0)
  }, [localPdfState.rows])

  const effectiveTerms = useMemo(() => {
    return isUsingDraft ? localPdfState.termsAndConditions : terms
  }, [isUsingDraft, localPdfState.termsAndConditions, terms])

  const mergedTerms = useMemo(() => {
    const manual = (uwagiManualText ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    return [...effectiveTerms, ...manual]
  }, [effectiveTerms, uwagiManualText])

  const NETTO_DISCLAIMER = 'Podane kwoty są kwotami netto.'
  const displayTerms = useMemo(() => {
    if (localPdfState.showVat) {
      return mergedTerms.filter((t) => !t.includes(NETTO_DISCLAIMER))
    }
    return mergedTerms.map((t) =>
      t.includes(NETTO_DISCLAIMER)
        ? 'Sprzedaż na fakturze bez VAT, kwoty netto są równe kwotom brutto.'
        : t
    )
  }, [localPdfState.showVat, mergedTerms])

  const resetEditorSyncFlags = () => {
    PDF_ROW_KEYS.forEach((key) => {
      touchedRowsRef.current[key] = false
    })
    touchedOpcjeRef.current = false
  }

  const handleRestoreFromCalculator = () => {
    const init = buildInitialState()
    resetEditorSyncFlags()
    setUwagiManualText('')

    try {
      localStorage.removeItem(PDF_DRAFT_STORAGE_KEY)
    } catch {
      // ignore
    }

    setIsUsingDraft(false)
    setShowDraftPrompt(false)
    setLocalPdfState(init)
  }

  const handleContinueEditing = () => {
    setShowDraftPrompt(false)
    setIsUsingDraft(true)
  }

  const handleClearEditor = () => {
    const init = buildInitialState()
    resetEditorSyncFlags()
    setUwagiManualText('')

    try {
      localStorage.removeItem(PDF_DRAFT_STORAGE_KEY)
    } catch {
      // ignore
    }

    setIsUsingDraft(false)
    setShowDraftPrompt(false)
    setLocalPdfState(init)
  }

  const printRef = useRef<HTMLDivElement | null>(null)
  const originalDocumentTitleRef = useRef<string | null>(null)
  const [isExportingPdf, setIsExportingPdf] = useState(false)

  const getDynamicDocumentTitle = (): string => {
    const client = localPdfState.clientName?.trim() ? localPdfState.clientName.trim() : 'Klienta'
    const project = localPdfState.projectName?.trim() ? localPdfState.projectName.trim() : 'Projektu'
    return `Wycena Wideo | NonoiseMedia dla ${client} | ${project}`
  }

  const handleTauriExport = async () => {
    const el = printRef.current
    if (!el) return
    setIsExportingPdf(true)

    const prevElStyle = el.getAttribute('style') ?? ''
    el.setAttribute('style', 'position:absolute;left:-9999px;top:0;display:block;')

    // Wait one frame so the browser lays out the element before html2canvas reads it
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

    try {
      // html2canvas-pro is a maintained fork of html2canvas that adds native support
      // for CSS Color 4 functions (lab/lch/oklab/oklch/color). Required on WKWebView
      // (macOS Tauri), because getComputedStyle() there returns colors in their original
      // color space, and Tailwind v4 emits oklch() throughout.
      const html2canvas = (await import('html2canvas-pro')).default
      const { jsPDF } = await import('jspdf')
      const { writeFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')

      const canvas = await html2canvas(el, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
      })

      // Build PDF, handling content taller than one A4 page
      const pdfDoc = new jsPDF({ format: 'a4', unit: 'mm', orientation: 'portrait' })
      const pdfW = pdfDoc.internal.pageSize.getWidth()   // 210 mm
      const pdfH = pdfDoc.internal.pageSize.getHeight()  // 297 mm
      const totalContentH = (canvas.height * pdfW) / canvas.width
      const imgData = canvas.toDataURL('image/jpeg', 0.95)

      let yOffset = 0
      while (yOffset < totalContentH) {
        pdfDoc.addImage(imgData, 'JPEG', 0, -yOffset, pdfW, totalContentH)
        yOffset += pdfH
        if (yOffset < totalContentH) pdfDoc.addPage()
      }

      // WKWebView blocks jsPDF's default <a download> approach (NSURLErrorCancelled
      // -999), so we write the PDF bytes directly to the user's Downloads folder
      // via the Tauri fs plugin. The capability for $DOWNLOAD/** is declared in
      // src-tauri/capabilities/default.json.
      const bytes = new Uint8Array(pdfDoc.output('arraybuffer'))
      // Sanitize filename for filesystems (strip path separators and illegal chars)
      const safeName = `${getDynamicDocumentTitle()}.pdf`.replace(/[\\/:*?"<>|]/g, '-')
      await writeFile(safeName, bytes, { baseDir: BaseDirectory.Download })
    } catch (err) {
      console.error('Tauri PDF export failed:', err)
    } finally {
      el.setAttribute('style', prevElStyle)
      setIsExportingPdf(false)
    }
  }

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    onBeforePrint: async () => {
      if (typeof document === 'undefined') return
      if (originalDocumentTitleRef.current === null) {
        originalDocumentTitleRef.current = document.title
      }
      document.title = getDynamicDocumentTitle()
    },
    onAfterPrint: () => {
      if (typeof document === 'undefined') return
      if (originalDocumentTitleRef.current !== null) {
        document.title = originalDocumentTitleRef.current
        originalDocumentTitleRef.current = null
      }
    },
    pageStyle: `
      @page { size: A4; margin: 14mm 12mm; }
      @media print {
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        body * { visibility: hidden !important; }
        #printable-quote { visibility: visible !important; display: block !important; }
        #printable-quote * { visibility: visible !important; }
        #printable-quote, #printable-quote * { user-select: text !important; -webkit-user-select: text !important; }
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
        <div className="grid gap-4 rounded-xl border-t border-l border-white/10 bg-zinc-900/30 p-4 backdrop-blur-xl sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="client-name" className="text-zinc-400">Nazwa klienta</Label>
            <Input
              id="client-name"
              value={data.clientName}
              onChange={(e) => updateField('clientName', e.target.value)}
              placeholder="np. NonoiseMedia Sp. z o.o."
              className="border-white/10 bg-white/5 text-foreground"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="project-name" className="text-zinc-400">Nazwa projektu</Label>
            <Input
              id="project-name"
              value={data.projectName}
              onChange={(e) => updateField('projectName', e.target.value)}
              placeholder="np. Kampania wiosenna 2025"
              className="border-white/10 bg-white/5 text-foreground"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="termin-zdjec" className="text-zinc-400">Termin zdjęć</Label>
            <Input
              id="termin-zdjec"
              value={localPdfState.terminZdjec}
              onChange={(e) => setLocalPdfState((prev) => ({ ...prev, terminZdjec: e.target.value }))}
              placeholder="np. Do ustalenia lub 20.04.2026"
              className="border-white/10 bg-white/5 text-foreground"
            />
          </div>
        </div>
      </motion.div>

      {showDraftPrompt && (
        <Alert
          variant="default"
          className="border-white/10 bg-zinc-900/30 text-zinc-200 px-4 py-3 backdrop-blur-xl"
        >
          <AlertTitle className="text-zinc-100">Wykryto zapisaną wersję edytorską.</AlertTitle>
          <AlertDescription className="text-zinc-300">
            Możesz zachować ręczne zmiany albo przywrócić aktualne przeliczenia z kalkulatora.
          </AlertDescription>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button variant="outline" onClick={handleRestoreFromCalculator} className="w-full sm:w-auto">
              Pobierz nowe dane z kalkulatora
            </Button>
            <Button onClick={handleContinueEditing} className="w-full sm:w-auto">
              Kontynuuj bieżący PDF
            </Button>
          </div>
        </Alert>
      )}

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
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
              <Button
                onClick={isTauriRuntime() ? handleTauriExport : handlePrint}
                size="lg"
                disabled={isCalculating || isExportingPdf}
                className="w-full sm:w-auto gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <FileDown className="size-5" />
                {isExportingPdf ? 'Generowanie…' : 'Pobierz PDF'}
              </Button>
              <Button variant="outline" onClick={handleClearEditor} size="lg" className="w-full sm:w-auto">
                Wyczyść edytor
              </Button>
            </div>
          </div>

          <div className="mt-5 rounded-xl border border-zinc-800 bg-zinc-950/20 p-4">
            <div className="w-full overflow-x-auto">
              <div className="mx-auto w-[210mm] max-w-full rounded-lg bg-white shadow-2xl p-6 text-zinc-900 aspect-[1/1.414] overflow-y-auto print:shadow-none print:m-0">
                <div className="mb-3 flex items-end justify-between gap-4 border-b border-zinc-200 pb-3">
                  <div>
                    <div className="text-[10.5px] font-extrabold uppercase tracking-widest text-primary">Oferta współpracy</div>
                    <div className="mt-1 text-[9.5px] text-zinc-600">
                      Data sporządzenia: {localPdfState.issueDateIso}
                    </div>
                    <div className="text-[9.5px] text-zinc-600">
                      Termin zdjęć: {localPdfState.terminZdjec?.trim() ? localPdfState.terminZdjec.trim() : 'Do ustalenia'}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[9.5px] text-zinc-700 font-semibold">
                      Klient: {localPdfState.clientName?.trim() ? localPdfState.clientName.trim() : '—'}{" "}
                      <span className="text-zinc-400">|</span> Projekt: {localPdfState.projectName?.trim() ? localPdfState.projectName.trim() : '—'}
                    </div>
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
                    const nettoValue = row.cenaNetto

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
                            value={Number.isFinite(nettoValue) ? round2(nettoValue) : 0}
                              onChange={(e) => {
                                const raw = e.target.value
                                const parsed = safeNum(raw === '' ? 0 : Number.parseFloat(raw), 0, 0)
                              const nextNet = round2(parsed)
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

                          {/* Przy VAT ON pokazujemy w listingu wyłącznie netto (reszta logiki VAT pozostaje w Total bar). */}
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

                <div className="mt-4 rounded-lg bg-zinc-950 p-4 text-white">
                  {localPdfState.showVat ? (
                    <div className="flex flex-col gap-1">
                      <div className="flex items-baseline justify-between text-[8pt] font-bold uppercase tracking-tight">
                        <span className="text-zinc-300">Suma Netto</span>
                        <span className="tabular-nums text-white">{formatCurrency(totalNetto)}</span>
                      </div>
                      <div className="flex items-baseline justify-between text-[8pt] font-bold uppercase tracking-tight">
                        <span className="text-zinc-300">VAT (23%)</span>
                        <span className="tabular-nums text-white">{formatCurrency(totalNetto * VAT_RATE)}</span>
                      </div>
                      <div className="flex items-baseline justify-between text-[18px] font-black tracking-tight">
                        <span>SUMA BRUTTO</span>
                        <span className="text-primary tabular-nums">
                          {formatCurrency(totalNetto * (1 + VAT_RATE))}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-baseline justify-between text-[10pt] font-bold uppercase tracking-tight">
                      <span>CAŁKOWITY KOSZT PROJEKTU</span>
                      <span className="text-primary tabular-nums text-[22px] font-black">
                        {formatCurrency(totalNetto)}
                      </span>
                    </div>
                  )}
                </div>

                <div className="mt-5 grid gap-4">
                  <div className="rounded-md border border-zinc-200 p-3">
                    <div className="text-[8pt] font-bold uppercase tracking-widest text-zinc-700 mb-1">
                      Materiały końcowe
                    </div>
                    <AutoGrowTextarea
                      disabled={isCalculating}
                      value={localPdfState.materialyKoncowe}
                      onChange={(next) => setLocalPdfState((prev) => ({ ...prev, materialyKoncowe: next }))}
                      placeholder="Np. materiały przekazane klientowi (logo, brandbook, pliki)…"
                      className="text-[10px] leading-relaxed"
                    />
                  </div>

                  <div className="rounded-md border border-zinc-200 p-3">
                    <div className="text-[8pt] font-bold uppercase tracking-widest text-zinc-700 mb-1">
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
                      className="text-[10px] leading-relaxed"
                    />
                  </div>

                  <div className="rounded-lg border border-zinc-200 p-3">
                    <div className="text-[10.5px] font-extrabold uppercase tracking-widest text-primary mb-1">
                      Przykładowe realizacje
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
                      UWAGI
                    </div>
                    {displayTerms.length > 0 ? (
                      <ol className="list-decimal list-inside space-y-1 text-[10px] text-zinc-700">
                        {displayTerms.map((t, idx) => (
                          <li key={`${idx}-${t.slice(0, 18)}`}>{t}</li>
                        ))}
                      </ol>
                    ) : (
                      <div className="text-[10px] text-zinc-600">—</div>
                    )}
                    <div className="mt-2">
                      <AutoGrowTextarea
                        disabled={isCalculating}
                        value={uwagiManualText}
                        onChange={(next) => setUwagiManualText(next)}
                        placeholder="Dodaj własne uwagi (1 punkt na linię)…"
                        className="text-[10px] leading-relaxed"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Hidden printable page for react-to-print */}
          <div ref={printRef} id="printable-quote" style={{ display: 'none' }}>
            <PrintableQuote localPdfState={{ ...localPdfState, termsAndConditions: mergedTerms }} />
          </div>
        </GlassCard>
      </motion.div>
    </motion.div>
  )
}
