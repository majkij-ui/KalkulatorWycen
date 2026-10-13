'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { FileDown, Receipt, RefreshCcw } from 'lucide-react'
import { useReactToPrint } from 'react-to-print'
import { addDays } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Switch } from '@/components/ui/switch'
import { GlassCard } from '@/components/glass-card'
import { PDF_DRAFT_STORAGE_KEY, useQuote } from '@/lib/quote-context'
import { PrintableQuote } from '@/components/pdf/printable-quote'
import { PortfolioRowsEditor } from '@/components/pdf/portfolio-rows-editor'
import { safeNum } from '@/lib/safe-numbers'
import type { LocalPdfState, PdfRowKey } from '@/lib/quote-types'
import {
  PDF_ROW_KEYS,
  buildInitialPdfState,
  coerceLocalPdfDraft,
  flipPdfCurrency,
  isLegacyEurDraft,
  reconcilePdfCurrency,
  roundToUnit,
} from '@/lib/pdf-draft'
import { isTauriRuntime } from '@/lib/storage'
import { PDF_LABELS, type PdfLang } from '@/lib/pdf-i18n'
import { formatPdfAmount, pdfCurrencyUnit, type PdfCurrency } from '@/lib/pdf-currency'
import { buildQuoteBreakdown, computeQuoteTotals, quoteViews } from '@/lib/quote-financials'
import { formatMoney, formatRate, switchQuoteCurrency } from '@/lib/quote-currency'
import type { TermsMoney } from '@/lib/pdf-texts-config'
import { QuoteCurrencyControl } from '@/components/quote-currency-control'

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
  { key: 'obsada', title: 'Obsada' },
  { key: 'sprzet', title: 'Sprzęt filmowy' },
  { key: 'logistyka', title: 'Logistyka' },
  { key: 'postprodukcja', title: 'Postprodukcja' },
  { key: 'inne', title: 'Inne koszty' },
]

function rowTitleForLang(key: PdfRowKey, lang: PdfLang): string {
  const L = PDF_LABELS[lang]
  switch (key) {
    case 'preprodukcja': return L.rowPreprodukcja
    case 'ekipa':        return L.rowEkipa
    case 'obsada':       return L.rowObsada
    case 'sprzet':       return L.rowSprzet
    case 'logistyka':    return L.rowLogistyka
    case 'postprodukcja':return L.rowPostprodukcja
    case 'inne':         return L.rowInne
  }
}

function SegmentedToggle({
  value,
  options,
  onChange,
}: {
  value: string
  options: { value: string; label: string }[]
  onChange: (next: string) => void
}) {
  return (
    <div className="inline-flex items-center rounded-md border border-white/10 bg-zinc-900/40 p-0.5">
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            type="button"
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`rounded px-2.5 py-1 text-xs font-semibold transition-colors ${
              active ? 'bg-primary text-primary-foreground' : 'text-zinc-400 hover:text-white'
            }`}
            aria-pressed={active}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
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

export function PodgladPdfTab() {
  const {
    breakdown,
    totals,
    isCalculating,
    getTermsAndConditions,
    data,
    clientData,
    clientPricing,
    money,
    setQuoteCurrency,
    updateField,
    pricingConfig,
    marginMultiplier,
    registerPdfDraftBridge,
    syncPdfDraftSnapshot,
  } = useQuote()

  const issueDate = useMemo(() => new Date(), [])
  const validUntilDate = useMemo(() => addDays(issueDate, 30), [issueDate])

  const [draftHydrationStatus, setDraftHydrationStatus] = useState<'loading' | 'ready'>('loading')
  const [isUsingDraft, setIsUsingDraft] = useState(false)
  // „Zostaw ceny z PDF" chowa ostrzeżenie do następnej zmiany cen w kalkulatorze.
  const [dismissedPriceSignature, setDismissedPriceSignature] = useState<string | null>(null)
  const [previewResetKey, setPreviewResetKey] = useState(0)

  const [uwagiManualText, setUwagiManualText] = useState('')
  // mergedTerms is computed later (after localPdfState + draft mode are known)

  const touchedRowsRef = useRef<Record<PdfRowKey, boolean>>({
    preprodukcja: false,
    ekipa: false,
    obsada: false,
    sprzet: false,
    logistyka: false,
    postprodukcja: false,
    inne: false,
  })
  const touchedOpcjeRef = useRef(false)

  interface BuildOpts {
    lang: PdfLang
    currency: PdfCurrency
    exchangeRate: number
    terms: string[]
  }

  // Wiersze z kalkulatora w walucie wyceny (S3); szkic sprzed S3 (PLN → EUR) przelicza po swoim kursie.
  const buildInitialState = ({ lang, currency, exchangeRate, terms: termsArg }: BuildOpts): LocalPdfState =>
    buildInitialPdfState({
      data: clientData,
      breakdown,
      sumaNetto: totals?.sumaNetto,
      marginMultiplier,
      pricing: clientPricing,
      lang,
      currency,
      exchangeRate,
      terms: termsArg,
      issueDate,
      validUntilDate,
    })

  /**
   * Waluta PDF: waluta wyceny. Wyjątek — szkic sprzed S3 (wycena w PLN, PDF w
   * EUR): drukuje się jak dawniej, w euro po kursie szkicu.
   */
  const pdfMoneyFor = (state: Pick<LocalPdfState, 'currency' | 'exchangeRate' | 'followsQuote'>) =>
    isLegacyEurDraft(state, money.currency)
      ? { currency: 'EUR' as PdfCurrency, exchangeRate: state.exchangeRate, legacy: true }
      : { currency: money.currency as PdfCurrency, exchangeRate: money.rate, legacy: false }

  const [localPdfState, setLocalPdfState] = useState<LocalPdfState>(() =>
    buildInitialState({ lang: 'pl', currency: money.currency, exchangeRate: money.rate, terms: [] })
  )
  const pdfMoney = pdfMoneyFor(localPdfState)

  // terms must be derived AFTER localPdfState exists so they can track the active PDF language
  const terms = useMemo(() => {
    const termsMoney: TermsMoney | undefined = pdfMoney.legacy
      ? { currency: 'EUR', convert: (pln) => Math.round(pln / pdfMoney.exchangeRate) }
      : undefined
    return getTermsAndConditions(localPdfState.pdfLanguage, termsMoney)
  }, [getTermsAndConditions, localPdfState.pdfLanguage, pdfMoney.legacy, pdfMoney.exchangeRate])

  // When the user toggles the PDF language, drop "touched" flags so the auto-generated
  // opis text + the editable opcjeDodatkowe regenerate in the new language. (Otherwise
  // a row the user nudged once in PL would stay stuck in PL after toggling to EN.)
  const prevLangRef = useRef<PdfLang>(localPdfState.pdfLanguage)
  useEffect(() => {
    if (prevLangRef.current !== localPdfState.pdfLanguage) {
      PDF_ROW_KEYS.forEach((key) => {
        touchedRowsRef.current[key] = false
      })
      touchedOpcjeRef.current = false
      prevLangRef.current = localPdfState.pdfLanguage
    }
  }, [localPdfState.pdfLanguage])

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
      // Szkic wraca po cichu. Pytamy tylko wtedy, gdy jego ceny naprawdę
      // rozjechały się z kalkulatorem (ostrzeżenie niżej).
      setIsUsingDraft(true)

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

  // Bridge for sticky-header save/load JSON: snapshots/restores the PDF draft
  // so a saved .json wycena round-trips toggles, opisy, terminy, etc.
  // Uses refs internally so the registered closures always see the latest state.
  const localPdfStateRef = useRef(localPdfState)
  // „Wyczyść edytor" dla mostka (nowy projekt, wycena bez własnego szkicu).
  // Ref, bo funkcja jest zdefiniowana niżej i zależy od bieżącego renderu.
  const clearEditorRef = useRef<() => void>(() => {})
  useEffect(() => {
    localPdfStateRef.current = localPdfState
    syncPdfDraftSnapshot(localPdfState)
  }, [localPdfState, syncPdfDraftSnapshot])

  useEffect(() => {
    registerPdfDraftBridge({
      snapshot: () => localPdfStateRef.current,
      reset: () => clearEditorRef.current(),
      apply: (raw) => {
        const coerced = coerceLocalPdfDraft(raw, localPdfStateRef.current)
        setLocalPdfState(coerced)
        syncPdfDraftSnapshot(coerced)
        setIsUsingDraft(true)
        // Mark every row + opcjeDodatkowe as user-touched so the auto-rebuild
        // effect doesn't immediately overwrite the loaded values.
        PDF_ROW_KEYS.forEach((key) => {
          touchedRowsRef.current[key] = true
        })
        touchedOpcjeRef.current = true
        // Mirror client/project into the global QuoteData so editor inputs match.
        updateField('clientName', coerced.clientName)
        updateField('projectName', coerced.projectName)
      },
    })
    return () => {
      syncPdfDraftSnapshot(localPdfStateRef.current)
      registerPdfDraftBridge(null)
    }
  }, [registerPdfDraftBridge, syncPdfDraftSnapshot, updateField])

  // Waluta wyceny się zmieniła (S3), także gdy zakładka PDF była zamknięta: ceny
  // z kalkulatora w nowej walucie, ceny i opisy poprawione ręcznie przeliczone /
  // zostawione. Szkic sprzed S3 (PLN → EUR) zostaje, jak był.
  const [currencyNotice, setCurrencyNotice] = useState<string | null>(null)
  useEffect(() => {
    if (draftHydrationStatus !== 'ready') return
    const prev = localPdfState
    if (isLegacyEurDraft(prev, money.currency)) return
    if (prev.currency === money.currency) {
      if (!prev.followsQuote || prev.exchangeRate !== money.rate) {
        setLocalPdfState((s) => ({ ...s, followsQuote: true, exchangeRate: money.rate }))
      }
      return
    }
    const oldCurrency = prev.currency
    const oldRate = oldCurrency === 'EUR' ? prev.exchangeRate : money.rate
    // Kalkulator w starej walucie: ta sama wycena przełączona z powrotem.
    const oldData = switchQuoteCurrency(data, oldCurrency, { rate: oldRate, source: 'manual' })
    const old = quoteViews(oldData, pricingConfig).client
    const lang = prev.pdfLanguage
    const before = buildInitialPdfState({
      data: old.data,
      breakdown: buildQuoteBreakdown(old.data, marginMultiplier, old.pricing),
      sumaNetto: computeQuoteTotals(old.data, marginMultiplier, old.pricing).sumaNetto,
      marginMultiplier,
      pricing: old.pricing,
      lang,
      currency: oldCurrency,
      exchangeRate: oldRate,
      terms,
      issueDate,
      validUntilDate,
    })
    const after = buildInitialState({ lang, currency: money.currency, exchangeRate: money.rate, terms })
    setLocalPdfState((s) => reconcilePdfCurrency(s, before, after, oldRate))
    setPreviewResetKey((k) => k + 1)
    setCurrencyNotice(
      `Waluta wyceny: ${money.currency}. Ceny w PDF są teraz z kalkulatora w ${money.currency === 'EUR' ? 'euro' : 'złotych'}; ` +
        'ceny poprawione ręcznie przeliczono po kursie, opisy zmienione ręcznie zostały bez zmian.'
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftHydrationStatus, money.currency, money.rate, localPdfState.currency, localPdfState.followsQuote])

  useEffect(() => {
    if (draftHydrationStatus !== 'ready') return
    if (isUsingDraft) return

    setLocalPdfState((prev) => {
      const target = pdfMoneyFor(prev)
      const init = buildInitialState({
        lang: prev.pdfLanguage,
        currency: target.currency,
        exchangeRate: target.exchangeRate,
        terms,
      })
      const nextRows = { ...init.rows }
      ;(Object.keys(nextRows) as PdfRowKey[]).forEach((key) => {
        if (touchedRowsRef.current[key]) nextRows[key] = prev.rows[key]
      })

      return {
        ...init,
        // Keep user-edited fields:
        showVat: prev.showVat,
        pdfLanguage: prev.pdfLanguage,
        currency: target.currency,
        exchangeRate: target.exchangeRate,
        followsQuote: init.followsQuote,
        materialyKoncowe: prev.materialyKoncowe,
        portfolioRows: prev.portfolioRows,
        terminZdjec: prev.terminZdjec,
        opcjeDodatkowe: touchedOpcjeRef.current ? prev.opcjeDodatkowe : init.opcjeDodatkowe,
        rows: nextRows,
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [breakdown, totals?.sumaNetto, clientData, clientPricing, marginMultiplier, terms, draftHydrationStatus, isUsingDraft])

  const totalNetto = useMemo(() => {
    return ROWS.reduce((sum, r) => sum + safeNum(localPdfState.rows[r.key]?.cenaNetto, 0, 0), 0)
  }, [localPdfState.rows])

  // Ceny, które PDF miałby TERAZ z kalkulatora. Szkic (isUsingDraft) przestaje
  // śledzić kalkulator, żeby nie nadpisać ręcznych tekstów — więc porównujemy
  // wiersz po wierszu i ostrzegamy tylko, gdy ceny naprawdę się rozjechały.
  const calculatorRows = useMemo(
    () =>
      buildInitialState({
        lang: localPdfState.pdfLanguage,
        currency: pdfMoney.currency,
        exchangeRate: pdfMoney.exchangeRate,
        terms,
      }).rows,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [breakdown, totals?.sumaNetto, clientData, clientPricing, marginMultiplier, terms, localPdfState.pdfLanguage, pdfMoney.currency, pdfMoney.exchangeRate]
  )
  const calculatorTotal = ROWS.reduce((sum, r) => sum + safeNum(calculatorRows[r.key]?.cenaNetto, 0, 0), 0)
  const priceSignature = ROWS.map((r) => Math.round(safeNum(calculatorRows[r.key]?.cenaNetto, 0, 0))).join('|')
  const pricesDiffer =
    isUsingDraft &&
    draftHydrationStatus === 'ready' &&
    ROWS.some(
      (r) =>
        Math.round(safeNum(localPdfState.rows[r.key]?.cenaNetto, 0, 0)) !==
        Math.round(safeNum(calculatorRows[r.key]?.cenaNetto, 0, 0))
    )
  const showStalePrices = pricesDiffer && dismissedPriceSignature !== priceSignature

  // Terms are always re-derived from the active language + current pdfTexts
  // templates — never read back from the stored draft snapshot. Otherwise a
  // PL-saved draft would render in PL even after toggling the PDF to English.
  const effectiveTerms = terms

  const mergedTerms = useMemo(() => {
    const manual = (uwagiManualText ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    return [...effectiveTerms, ...manual]
  }, [effectiveTerms, uwagiManualText])

  const displayTerms = useMemo(() => {
    const L = PDF_LABELS[localPdfState.pdfLanguage]
    const nettoLead = L.nettoDisclaimer
    if (localPdfState.showVat) {
      return mergedTerms.filter((t) => !t.includes(nettoLead))
    }
    return mergedTerms.map((t) => (t.includes(nettoLead) ? L.nettoDisclaimerSwap : t))
  }, [localPdfState.showVat, localPdfState.pdfLanguage, mergedTerms])

  const resetEditorSyncFlags = () => {
    PDF_ROW_KEYS.forEach((key) => {
      touchedRowsRef.current[key] = false
    })
    touchedOpcjeRef.current = false
  }

  const handleRestoreFromCalculator = () => {
    // Refresh ONLY numeric values (cenaNetto per row) from the current calculator state.
    // Every text field — opis per row, materialyKoncowe, opcjeDodatkowe, portfolioRows,
    // terminZdjec, uwagiManualText — stays exactly as the user left it.
    // We stay in draft mode so future calculator changes don't silently overwrite the kept text.
    const fresh = buildInitialState({
      lang: localPdfState.pdfLanguage,
      currency: pdfMoney.currency,
      exchangeRate: pdfMoney.exchangeRate,
      terms,
    })

    setLocalPdfState((prev) => {
      const nextRows = { ...prev.rows }
      PDF_ROW_KEYS.forEach((key) => {
        nextRows[key] = { ...prev.rows[key], cenaNetto: fresh.rows[key].cenaNetto }
      })
      return { ...prev, rows: nextRows }
    })

    setIsUsingDraft(true) // stay in draft so the sync effect doesn't rewrite preserved text
    setPreviewResetKey((k) => k + 1) // force the controlled price <input>s to repaint
  }


  const handleClearEditor = () => {
    const init = buildInitialState({
      lang: localPdfState.pdfLanguage,
      currency: pdfMoney.currency,
      exchangeRate: pdfMoney.exchangeRate,
      terms,
    })
    resetEditorSyncFlags()
    setUwagiManualText('')

    try {
      localStorage.removeItem(PDF_DRAFT_STORAGE_KEY)
    } catch {
      // ignore
    }

    setIsUsingDraft(false)
    setLocalPdfState(init)
  }
  clearEditorRef.current = handleClearEditor

  const printRef = useRef<HTMLDivElement | null>(null)
  const originalDocumentTitleRef = useRef<string | null>(null)
  const [isExportingPdf, setIsExportingPdf] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  const getDynamicDocumentTitle = (): string => {
    const client = localPdfState.clientName?.trim() ? localPdfState.clientName.trim() : 'Klienta'
    const project = localPdfState.projectName?.trim() ? localPdfState.projectName.trim() : 'Projektu'
    return `Wycena Wideo | NonoiseMedia dla ${client} | ${project}`
  }

  const handleTauriExport = async () => {
    const el = printRef.current
    if (!el) return
    setIsExportingPdf(true)
    setExportError(null)

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
      const { writeFile } = await import('@tauri-apps/plugin-fs')
      const { save: showSaveDialog } = await import('@tauri-apps/plugin-dialog')

      const canvas = await html2canvas(el, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
      })

      // Smart-break: capture safe break Y-positions BEFORE we strip the off-screen layout.
      // Each card / table row marked with data-pdf-break="after" is a candidate cut point.
      const containerRect = el.getBoundingClientRect()
      const cssScale = canvas.width / containerRect.width // canvas-px per CSS-px
      const breakPxs: number[] = []
      el.querySelectorAll<HTMLElement>('[data-pdf-break="after"]').forEach((node) => {
        const r = node.getBoundingClientRect()
        breakPxs.push((r.bottom - containerRect.top) * cssScale)
      })
      breakPxs.sort((a, b) => a - b)

      // Build PDF, slicing the canvas at the nearest section boundary before each page break
      const pdfDoc = new jsPDF({ format: 'a4', unit: 'mm', orientation: 'portrait' })
      const pdfW = pdfDoc.internal.pageSize.getWidth() // 210 mm
      const pdfH = pdfDoc.internal.pageSize.getHeight() // 297 mm
      const pxPerMm = canvas.width / pdfW
      const pageHpx = pdfH * pxPerMm

      // The true content ends at the bottom of the last section break; everything
      // below it (the printable container's pb-8) is decorative whitespace. Stop the
      // pager there so that trailing padding doesn't spill onto an extra blank page.
      const contentHeight = breakPxs.length ? breakPxs[breakPxs.length - 1] : canvas.height

      let yStart = 0
      let firstPage = true
      while (yStart < contentHeight) {
        const limit = yStart + pageHpx
        const candidates = breakPxs.filter((b) => b > yStart && b <= Math.min(limit, contentHeight))
        // Prefer the latest break that fits on this page; fall back to a hard cut
        // if there's no candidate (single section taller than A4 — rare).
        const yEnd = candidates.length
          ? candidates[candidates.length - 1]
          : Math.min(limit, contentHeight)
        const sliceH = yEnd - yStart
        if (sliceH <= 0) break

        const tmp = document.createElement('canvas')
        tmp.width = canvas.width
        tmp.height = Math.ceil(sliceH)
        const ctx = tmp.getContext('2d')
        if (!ctx) throw new Error('2D canvas context unavailable')
        ctx.drawImage(canvas, 0, -yStart)

        if (!firstPage) pdfDoc.addPage()
        firstPage = false
        const sliceMm = sliceH / pxPerMm
        pdfDoc.addImage(tmp.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, pdfW, sliceMm)

        yStart = yEnd
      }

      // WKWebView blocks jsPDF's default <a download> approach (NSURLErrorCancelled
      // -999), so we write the PDF bytes via the Tauri fs plugin. The native save
      // dialog lets the user choose location and filename; the OS handles overwrite confirmation.
      const bytes = new Uint8Array(pdfDoc.output('arraybuffer'))
      const safeName = `${getDynamicDocumentTitle()}.pdf`.replace(/[\\/:*?"<>|]/g, '-')
      const chosen = await showSaveDialog({
        defaultPath: safeName,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      })
      if (!chosen) {
        // User cancelled the dialog — exit cleanly without error
        return
      }
      await writeFile(chosen, bytes)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('Tauri PDF export failed:', err)
      setExportError(msg || 'Nieznany błąd')
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
              onChange={(e) => {
                const v = e.target.value
                updateField('clientName', v)
                // Also push directly into the PDF draft so the preview/print
                // updates immediately. Without this, draft mode keeps a stale
                // localPdfState because the auto-rebuild effect only runs when
                // isUsingDraft === false.
                setLocalPdfState((prev) => ({ ...prev, clientName: v }))
              }}
              placeholder="np. NonoiseMedia Sp. z o.o."
              className="border-white/10 bg-white/5 text-foreground"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="project-name" className="text-zinc-400">Nazwa projektu</Label>
            <Input
              id="project-name"
              value={data.projectName}
              onChange={(e) => {
                const v = e.target.value
                updateField('projectName', v)
                setLocalPdfState((prev) => ({ ...prev, projectName: v }))
              }}
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

      {pdfMoney.legacy && (
        <Alert
          variant="default"
          className="border-sky-500/20 bg-sky-500/5 text-zinc-200 px-4 py-3 backdrop-blur-xl"
        >
          <AlertTitle className="text-sky-100">Euro tylko na PDF (stara wycena)</AlertTitle>
          <AlertDescription className="text-zinc-300">
            Ta wycena liczy w złotych, a PDF przelicza kwoty na euro po kursie {formatRate(localPdfState.exchangeRate)} —
            tak działało przed walutą na wycenie. Drukuje się bez zmian. Możesz przełączyć całą wycenę na EUR po tym
            kursie (ceny w kalkulatorze w euro, finanse w złotych) albo wrócić z PDF do złotych.
          </AlertDescription>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button
              onClick={() => {
                setQuoteCurrency('EUR', { rate: localPdfState.exchangeRate, source: 'manual' })
                setLocalPdfState((prev) => ({ ...prev, followsQuote: true }))
              }}
              className="w-full sm:w-auto"
            >
              Przełącz wycenę na EUR po kursie {formatRate(localPdfState.exchangeRate)}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setLocalPdfState((prev) => ({ ...flipPdfCurrency(prev, 'PLN'), followsQuote: true }))
                setPreviewResetKey((k) => k + 1)
              }}
              className="w-full sm:w-auto"
            >
              Wróć do PLN na PDF
            </Button>
          </div>
        </Alert>
      )}

      {currencyNotice && (
        <Alert
          variant="default"
          className="border-white/10 bg-white/5 text-zinc-200 px-4 py-3 backdrop-blur-xl"
        >
          <AlertDescription className="flex items-start justify-between gap-3 text-zinc-300">
            <span>{currencyNotice}</span>
            <button
              type="button"
              onClick={() => setCurrencyNotice(null)}
              className="shrink-0 text-xs text-zinc-500 hover:text-white"
            >
              Zamknij
            </button>
          </AlertDescription>
        </Alert>
      )}

      {showStalePrices && (
        <Alert
          variant="default"
          className="border-amber-500/20 bg-amber-500/5 text-zinc-200 px-4 py-3 backdrop-blur-xl"
        >
          <AlertTitle className="text-amber-100">Ceny w PDF różnią się od kalkulatora</AlertTitle>
          <AlertDescription className="text-zinc-300">
            PDF: {formatMoney(totalNetto, localPdfState.currency)} netto, kalkulator:{' '}
            {formatMoney(calculatorTotal, pdfMoney.currency)} netto. Aktualizacja
            zmienia tylko ceny — opisy i teksty zostają.
          </AlertDescription>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button onClick={handleRestoreFromCalculator} className="w-full sm:w-auto">
              Zaktualizuj ceny z kalkulatora
            </Button>
            <Button
              variant="outline"
              onClick={() => setDismissedPriceSignature(priceSignature)}
              className="w-full sm:w-auto"
            >
              Zostaw ceny z PDF
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

          {/* Top row: format toggles (VAT / language / currency) */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="flex items-center gap-2">
              <Switch
                checked={localPdfState.showVat}
                onCheckedChange={(v) => setLocalPdfState((prev) => ({ ...prev, showVat: Boolean(v) }))}
              />
              <div className="text-sm text-zinc-300">Pokaż VAT (23%)</div>
            </div>

            {/* Language toggle */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-300">Język PDF:</span>
              <SegmentedToggle
                value={localPdfState.pdfLanguage}
                options={[
                  { value: 'pl', label: 'PL' },
                  { value: 'en', label: 'EN' },
                ]}
                onChange={(v) => setLocalPdfState((prev) => ({ ...prev, pdfLanguage: v as PdfLang }))}
              />
            </div>

            {/* Waluta należy do wyceny (S3): ten sam przełącznik co w nagłówku kalkulatora. */}
            {!pdfMoney.legacy && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-zinc-300">Waluta wyceny:</span>
                <QuoteCurrencyControl align="start" />
              </div>
            )}
          </div>

          <div className="mt-5 rounded-xl border border-zinc-800 bg-zinc-950/20 p-4">
            <div className="w-full overflow-x-auto">
              <div className="mx-auto w-[210mm] max-w-full rounded-lg bg-white shadow-2xl p-6 text-zinc-900 aspect-[1/1.414] overflow-y-auto print:shadow-none print:m-0">
                {(() => {
                  const L = PDF_LABELS[localPdfState.pdfLanguage]
                  return (
                    <>
                      <div className="mb-3 flex items-end justify-between gap-4 border-b border-zinc-200 pb-3">
                        <div>
                          <div className="text-[10.5px] font-extrabold uppercase tracking-widest text-primary">{localPdfState.pdfLanguage === 'en' ? 'Cooperation offer' : 'Oferta współpracy'}</div>
                          <div className="mt-1 text-[9.5px] text-zinc-600">
                            {L.issueDate}: {localPdfState.issueDateIso}
                          </div>
                          <div className="text-[9.5px] text-zinc-600">
                            {L.shootingDate}: {localPdfState.terminZdjec?.trim() ? localPdfState.terminZdjec.trim() : L.tbd}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[9.5px] text-zinc-700 font-semibold">
                            {L.client}: {localPdfState.clientName?.trim() ? localPdfState.clientName.trim() : L.emptyDash}{' '}
                            <span className="text-zinc-400">|</span> {L.project}: {localPdfState.projectName?.trim() ? localPdfState.projectName.trim() : L.emptyDash}
                          </div>
                          <div className="mt-1 text-[11px] font-bold text-zinc-900">
                            {localPdfState.pdfLanguage === 'en' ? 'Total (net)' : 'Całkowity koszt netto'}
                          </div>
                          <div className="text-[18px] font-black text-primary tabular-nums">
                            {formatPdfAmount(totalNetto, localPdfState.currency, localPdfState.pdfLanguage)}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-12 gap-x-4 pt-2 pb-3 text-[10.5px] font-extrabold uppercase tracking-widest text-primary">
                        <div className="col-span-4">{L.tableCategory}</div>
                        <div className="col-span-2 text-right">{L.tableEstimateNetto}</div>
                        <div className="col-span-6">{L.tableDescription}</div>
                      </div>
                    </>
                  )
                })()}

                <div key={previewResetKey} className="rounded-md border border-zinc-200">
                  {ROWS.map((r) => {
                    const row = localPdfState.rows[r.key]
                    const nettoValue = row.cenaNetto

                    return (
                      <div
                        key={r.key}
                        className="grid grid-cols-12 gap-x-4 items-start border-b border-zinc-200 last:border-b-0 px-3 py-3"
                      >
                        <div className="col-span-4 text-[12px] font-semibold text-zinc-800 pt-2">{rowTitleForLang(r.key, localPdfState.pdfLanguage)}</div>

                        <div className="col-span-2">
                          <div className="flex items-center justify-end gap-1">
                            <input
                              type="number"
                              inputMode="decimal"
                              min={0}
                              step={0.01}
                              disabled={isCalculating}
                            value={Number.isFinite(nettoValue) ? roundToUnit(nettoValue) : 0}
                              onChange={(e) => {
                                const raw = e.target.value
                                const parsed = safeNum(raw === '' ? 0 : Number.parseFloat(raw), 0, 0)
                              const nextNet = roundToUnit(parsed)
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
                              className="w-24 rounded-md border border-zinc-200 bg-white/80 px-2 py-2 text-right text-[12px] font-bold tabular-nums text-zinc-900 outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-60"
                            />
                            <span className="text-[11px] font-semibold text-zinc-500">
                              {pdfCurrencyUnit(localPdfState.currency, localPdfState.pdfLanguage)}
                            </span>
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

                {(() => {
                  const L = PDF_LABELS[localPdfState.pdfLanguage]
                  const fmt = (n: number) => formatPdfAmount(n, localPdfState.currency, localPdfState.pdfLanguage)
                  return (
                    <>
                      <div className="mt-4 rounded-lg bg-zinc-950 p-4 text-white">
                        {localPdfState.showVat ? (
                          <div className="flex flex-col gap-1">
                            <div className="flex items-baseline justify-between text-[18px] font-black uppercase tracking-tight">
                              <span>{L.sumNetto}</span>
                              <span className="text-primary tabular-nums">{fmt(totalNetto)}</span>
                            </div>
                            {/* Netto prowadzi; VAT i brutto to cicha informacja pod spodem. */}
                            <div className="flex items-baseline justify-between text-[7.5pt] font-normal uppercase tracking-wide text-zinc-400">
                              <span>{L.vatRow}</span>
                              <span className="tabular-nums">{fmt(totalNetto * VAT_RATE)}</span>
                            </div>
                            <div className="flex items-baseline justify-between text-[7.5pt] font-normal uppercase tracking-wide text-zinc-400">
                              <span>{L.sumBrutto}</span>
                              <span className="tabular-nums">{fmt(totalNetto * (1 + VAT_RATE))}</span>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-baseline justify-between text-[10pt] font-bold uppercase tracking-tight">
                            <span>{L.totalProject}</span>
                            <span className="text-primary tabular-nums text-[22px] font-black">{fmt(totalNetto)}</span>
                          </div>
                        )}
                      </div>

                      <div className="mt-5 grid gap-4">
                        <div className="rounded-md border border-zinc-200 p-3">
                          <div className="text-[8pt] font-bold uppercase tracking-widest text-zinc-700 mb-1">
                            {L.finalMaterials}
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
                            {L.additionalOptions}
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
                          <div className="text-[10.5px] font-extrabold uppercase tracking-widest text-primary mb-2">
                            {L.portfolio}
                          </div>
                          <PortfolioRowsEditor
                            disabled={isCalculating}
                            rows={localPdfState.portfolioRows}
                            onChange={(rows) => setLocalPdfState((prev) => ({ ...prev, portfolioRows: rows }))}
                          />
                        </div>

                        <div className="rounded-lg border border-zinc-200 p-3">
                          <div className="text-[10.5px] font-extrabold uppercase tracking-widest text-zinc-700 mb-2">
                            {L.notes}
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
                    </>
                  )
                })()}
              </div>
            </div>
          </div>

          {/* Export buttons row (below Preview) */}
          <div className="mt-4 flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            <Button
              onClick={isTauriRuntime() ? handleTauriExport : handlePrint}
              size="lg"
              disabled={isCalculating || isExportingPdf}
              className="w-full sm:w-auto gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <FileDown className="size-5" />
              {isExportingPdf ? 'Generowanie…' : 'Pobierz PDF'}
            </Button>
            {pricesDiffer && (
              <Button variant="outline" onClick={handleRestoreFromCalculator} size="lg" className="w-full sm:w-auto gap-2">
                <RefreshCcw className="size-4" />
                Zaktualizuj ceny z kalkulatora
              </Button>
            )}
            <Button variant="outline" onClick={handleClearEditor} size="lg" className="w-full sm:w-auto">
              Wyczyść edytor
            </Button>
          </div>

          {/* Visible PDF export error + print-dialog fallback */}
          {exportError && (
            <Alert
              variant="destructive"
              className="mt-3 border-red-500/30 bg-red-950/30 text-red-200"
            >
              <AlertTitle className="text-red-100">Eksport PDF się nie udał</AlertTitle>
              <AlertDescription className="text-red-300/90 break-words">
                {exportError}
              </AlertDescription>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setExportError(null)
                    handlePrint()
                  }}
                  className="border-white/10 text-white hover:bg-white/10"
                >
                  Otwórz okno drukowania
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setExportError(null)}
                  className="text-zinc-400 hover:text-white"
                >
                  Zamknij
                </Button>
              </div>
            </Alert>
          )}

          {/* Hidden printable page for react-to-print */}
          <div ref={printRef} id="printable-quote" style={{ display: 'none' }}>
            <PrintableQuote localPdfState={{ ...localPdfState, termsAndConditions: mergedTerms }} />
          </div>
        </GlassCard>
      </motion.div>
    </motion.div>
  )
}
