'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { FileDown, Receipt, Loader2, RefreshCcw } from 'lucide-react'
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
import { getProductionEkipaCastSprzetNetto, type LineItemRow } from '@/lib/quote-calc'
import type { LocalPdfState, PdfRowKey, QuoteData } from '@/lib/quote-types'
import { isTauriRuntime } from '@/lib/storage'
import { PDF_LABELS, type PdfLang } from '@/lib/pdf-i18n'
import { formatPdfAmount, type PdfCurrency } from '@/lib/pdf-currency'
import { fetchEurPlnRate } from '@/lib/nbp-fx'

const DEFAULT_EXCHANGE_RATE = 4.3

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

const PDF_ROW_KEYS: PdfRowKey[] = ['preprodukcja', 'ekipa', 'obsada', 'sprzet', 'logistyka', 'postprodukcja', 'inne']

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

  const coercedLang: 'pl' | 'en' = r.pdfLanguage === 'en' ? 'en' : 'pl'
  const coercedCurrency: 'PLN' | 'EUR' = r.currency === 'EUR' ? 'EUR' : 'PLN'
  const coercedRate = safeNum(r.exchangeRate, fallback.exchangeRate, DEFAULT_EXCHANGE_RATE)

  return {
    ...fallback,
    clientName: coerceStr(r.clientName, fallback.clientName),
    projectName: coerceStr(r.projectName, fallback.projectName),
    issueDateIso: coerceStr(r.issueDateIso, fallback.issueDateIso),
    validUntilIso: coerceStr(r.validUntilIso, fallback.validUntilIso),
    terminZdjec: coerceStr(r.terminZdjec, fallback.terminZdjec),
    showVat: coerceBool(r.showVat, fallback.showVat),
    pdfLanguage: coercedLang,
    currency: coercedCurrency,
    exchangeRate: coercedRate > 0 ? coercedRate : DEFAULT_EXCHANGE_RATE,
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

function roundToUnit(n: number): number {
  const safe = safeNum(n, 0)
  return Math.round(safe)
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

function getOpisInitial({
  key,
  data,
  lang = 'pl',
}: {
  key: PdfRowKey
  data: QuoteData
  lang?: PdfLang
}): string {
  const L = PDF_LABELS[lang]
  const yn = (v: boolean) => (v ? L.yes : L.no)

  // Equipment class enum is a Polish-only string in QuoteData; map it for EN.
  const equipmentClass =
    data.klasaSprzetu === 'minimalistyczny'
      ? L.equipmentMinimal
      : data.klasaSprzetu === 'kinowy'
        ? L.equipmentCinematic
        : L.equipmentStandard

  if (key === 'preprodukcja') {
    const scen =
      data.scenariusz === 'brak'
        ? L.scenarioNone
        : data.scenariusz === 'podstawowy'
          ? L.scenarioBasic
          : L.scenarioExtended

    if (!data.isDetailedPrepro) {
      return `${L.opisDocumentation}: ${safeNum(data.dniDokumentacji, 0, 0)} ${L.opisDays}.\n${L.opisScenario}: ${scen}.`
    }

    return `${L.opisScenario}: ${scen}.\n${L.opisLocationVisit}: ${yn(data.wizjaLokalna)}.\n${L.opisProductionMgr}: ${yn(data.kierownikProdukcji)}.`
  }

  if (key === 'ekipa') {
    if (!data.isDetailedProdukcja) {
      return `${L.opisQuickQuoteMode}: ${safeNum(data.dniZdjeciowe, 0, 0)} ${L.opisDays} × ${safeNum(data.wielkoscEkipy, 1, 1)} ${L.opisCrewSize}\n${L.opisRezOpSurcharge}: ${yn(data.crudeRezOpSurcharge)}.`
    }

    return `${L.opisDetailedCrew} ${safeArray(data.detailedShootingDays).length} ${L.opisShootingDays}.`
  }

  if (key === 'obsada') {
    const liczbaAktorow = safeNum(data.liczbaAktorow, 0, 0)
    const perActor = safeNum(data.actorRightsTransferAmount, 0, 0)
    const hasActorRights =
      data.copyrightType === 'przekazanie' && liczbaAktorow > 0 && perActor > 0
    const actorRightsLine = hasActorRights
      ? `${L.opisActorRightsTransfer}: ${liczbaAktorow} ${L.opisActorUnit}(s) × ${perActor.toLocaleString('pl-PL')} ${lang === 'en' ? 'PLN' : 'zł'}.`
      : null

    if (!data.isDetailedProdukcja) {
      // Quick mode has no actor/model/extra split. If user still set a
      // per-actor rights transfer, surface it; otherwise show the placeholder.
      if (actorRightsLine) return actorRightsLine
      return L.opisCastQuickModeNote
    }

    const days = safeArray(data.detailedShootingDays) as QuoteData['detailedShootingDays']
    const sum = (pick: (d: QuoteData['detailedShootingDays'][number]) => number): number =>
      days.reduce((acc, d) => acc + safeNum(pick(d), 0, 0), 0)
    const aktorPD = sum((d) => d.aktor)
    const modelPD = sum((d) => d.model)
    const statystaPD = sum((d) => d.statysta)

    const lines: string[] = [`${L.opisDetailedCast} ${days.length} ${L.opisShootingDays}.`]
    if (aktorPD > 0) lines.push(`${L.opisActor}: ${aktorPD} ${L.opisPersonDays}.`)
    if (modelPD > 0) lines.push(`${L.opisModel}: ${modelPD} ${L.opisPersonDays}.`)
    if (statystaPD > 0) lines.push(`${L.opisExtra}: ${statystaPD} ${L.opisPersonDays}.`)
    if (actorRightsLine) lines.push(actorRightsLine)
    return lines.join('\n')
  }

  if (key === 'sprzet') {
    if (!data.isDetailedProdukcja) {
      return `${L.opisEquipmentClass}: ${equipmentClass}.\n${L.opisDroneSurcharge}: ${yn(data.crudeDroneSurcharge)}.`
    }

    return `${L.opisDetailedEquipment} ${safeArray(data.detailedShootingDays).length} ${L.opisShootingDays}.`
  }

  if (key === 'logistyka') {
    return `${L.opisTravel}: ${safeNum(data.kosztDojazduKm, 0, 0)} km.\n${L.opisCatering}: ${yn(data.includeCatering)}.\n${L.opisLodging}: ${yn(data.includeLodging)}.`
  }

  if (key === 'postprodukcja') {
    if (!data.isDetailedPostpro) {
      const unit = data.crudeEditUnit === 'dni' ? L.unitDays : L.unitHours
      return `${L.opisEditingQuickMode}: ${safeNum(data.crudeEditCount, 0, 0)} ${unit}.`
    }

    return `${L.opisDetailedPostpro}: ${safeArray(data.detailedDeliverables).length} ${L.opisItems}.`
  }

  if (key === 'inne') {
    const prawa = data.copyrightType === 'przekazanie' ? L.copyrightTransfer : L.copyrightLicense
    return `${L.opisVoiceover}: ${yn(data.lektor)}.\n${L.opisMusicLicense}: ${data.licencjaMuzyczna}.\n${L.opisCopyright}: ${prawa}.`
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
    pricingConfig,
    marginMultiplier,
    registerPdfDraftBridge,
  } = useQuote()

  const issueDate = useMemo(() => new Date(), [])
  const validUntilDate = useMemo(() => addDays(issueDate, 30), [issueDate])
  const formatPdfDate = (d: Date, lang: PdfLang) => format(d, lang === 'en' ? 'dd/MM/yyyy' : 'dd.MM.yyyy')

  const [draftHydrationStatus, setDraftHydrationStatus] = useState<'loading' | 'ready'>('loading')
  const [isUsingDraft, setIsUsingDraft] = useState(false)
  const [showDraftPrompt, setShowDraftPrompt] = useState(false)
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

  const buildInitialState = ({ lang, currency, exchangeRate, terms: termsArg }: BuildOpts): LocalPdfState => {
    const preNetto = safeNum(breakdown?.find((p) => p.category === 'Preprodukcja')?.phaseNetto, 0, 0)
    const postNetto = safeNum(breakdown?.find((p) => p.category === 'Postprodukcja')?.phaseNetto, 0, 0)

    const { ekipaNetto, castNetto, sprzetNetto } = getProductionEkipaCastSprzetNetto(
      data,
      marginMultiplier,
      pricingConfig
    )

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

    const computedSum = preNetto + ekipaNetto + castNetto + sprzetNetto + logistykaNetto + postNetto + inneNetto
    const delta = safeNum(totals?.sumaNetto, 0, 0) - computedSum

    // Calculator math is in PLN; convert to active currency once at build time so
    // editing in EUR is true EUR-native (not a live recalculation against PLN).
    const safeRate = Number.isFinite(exchangeRate) && exchangeRate > 0 ? exchangeRate : DEFAULT_EXCHANGE_RATE
    const toCurrency = (pln: number): number => {
      const v = currency === 'EUR' ? pln / safeRate : pln
      return roundToUnit(v)
    }

    const L = PDF_LABELS[lang]

    return {
      clientName: data.clientName ?? '',
      projectName: data.projectName ?? '',
      issueDateIso: formatPdfDate(issueDate, lang),
      validUntilIso: formatPdfDate(validUntilDate, lang),
      terminZdjec: L.tbd,
      showVat: false,
      pdfLanguage: lang,
      currency,
      exchangeRate,
      rows: {
        preprodukcja: {
          key: 'preprodukcja',
          title: L.rowPreprodukcja,
          cenaNetto: toCurrency(preNetto),
          opis: getOpisInitial({ key: 'preprodukcja', data, lang }),
        },
        ekipa: {
          key: 'ekipa',
          title: L.rowEkipa,
          cenaNetto: toCurrency(ekipaNetto),
          opis: getOpisInitial({ key: 'ekipa', data, lang }),
        },
        obsada: {
          key: 'obsada',
          title: L.rowObsada,
          cenaNetto: toCurrency(castNetto),
          opis: getOpisInitial({ key: 'obsada', data, lang }),
        },
        sprzet: {
          key: 'sprzet',
          title: L.rowSprzet,
          cenaNetto: toCurrency(sprzetNetto),
          opis: getOpisInitial({ key: 'sprzet', data, lang }),
        },
        logistyka: {
          key: 'logistyka',
          title: L.rowLogistyka,
          cenaNetto: toCurrency(logistykaNetto),
          opis: getOpisInitial({ key: 'logistyka', data, lang }),
        },
        postprodukcja: {
          key: 'postprodukcja',
          title: L.rowPostprodukcja,
          cenaNetto: toCurrency(postNetto),
          opis: getOpisInitial({ key: 'postprodukcja', data, lang }),
        },
        inne: {
          key: 'inne',
          title: L.rowInne,
          cenaNetto: toCurrency(inneNetto + delta),
          opis: getOpisInitial({ key: 'inne', data, lang }),
        },
      },

      materialyKoncowe: '',
      opcjeDodatkowe: data.opcjeDodatkowe ?? '',
      portfolioLinksText: '',
      termsAndConditions: termsArg,
    }
  }

  const [localPdfState, setLocalPdfState] = useState<LocalPdfState>(() =>
    buildInitialState({ lang: 'pl', currency: 'PLN', exchangeRate: DEFAULT_EXCHANGE_RATE, terms: [] })
  )

  // terms must be derived AFTER localPdfState exists so they can track the active PDF language
  const terms = useMemo(
    () => getTermsAndConditions(localPdfState.pdfLanguage),
    [getTermsAndConditions, localPdfState.pdfLanguage]
  )

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

  // Bridge for sticky-header save/load JSON: snapshots/restores the PDF draft
  // so a saved .json wycena round-trips toggles, opisy, terminy, etc.
  // Uses refs internally so the registered closures always see the latest state.
  const localPdfStateRef = useRef(localPdfState)
  useEffect(() => {
    localPdfStateRef.current = localPdfState
  }, [localPdfState])

  useEffect(() => {
    registerPdfDraftBridge({
      snapshot: () => localPdfStateRef.current,
      apply: (raw) => {
        const coerced = coerceLocalPdfDraft(raw, localPdfStateRef.current)
        setLocalPdfState(coerced)
        setIsUsingDraft(true)
        setShowDraftPrompt(false)
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
    return () => registerPdfDraftBridge(null)
  }, [registerPdfDraftBridge, updateField])

  useEffect(() => {
    if (draftHydrationStatus !== 'ready') return
    if (isUsingDraft) return

    setLocalPdfState((prev) => {
      const init = buildInitialState({
        lang: prev.pdfLanguage,
        currency: prev.currency,
        exchangeRate: prev.exchangeRate,
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
        currency: prev.currency,
        exchangeRate: prev.exchangeRate,
        materialyKoncowe: prev.materialyKoncowe,
        portfolioLinksText: prev.portfolioLinksText,
        terminZdjec: prev.terminZdjec,
        opcjeDodatkowe: touchedOpcjeRef.current ? prev.opcjeDodatkowe : init.opcjeDodatkowe,
        rows: nextRows,
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [breakdown, totals?.sumaNetto, data, pricingConfig, marginMultiplier, terms, draftHydrationStatus, isUsingDraft])

  const totalNetto = useMemo(() => {
    return ROWS.reduce((sum, r) => sum + safeNum(localPdfState.rows[r.key]?.cenaNetto, 0, 0), 0)
  }, [localPdfState.rows])

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
    // Every text field — opis per row, materialyKoncowe, opcjeDodatkowe, portfolioLinksText,
    // terminZdjec, uwagiManualText — stays exactly as the user left it.
    // We stay in draft mode so future calculator changes don't silently overwrite the kept text.
    const fresh = buildInitialState({
      lang: localPdfState.pdfLanguage,
      currency: localPdfState.currency,
      exchangeRate: localPdfState.exchangeRate,
      terms,
    })

    setLocalPdfState((prev) => {
      const nextRows = { ...prev.rows }
      PDF_ROW_KEYS.forEach((key) => {
        nextRows[key] = { ...prev.rows[key], cenaNetto: fresh.rows[key].cenaNetto }
      })
      return { ...prev, rows: nextRows }
    })

    setShowDraftPrompt(false)
    setIsUsingDraft(true) // stay in draft so the sync effect doesn't rewrite preserved text
    setPreviewResetKey((k) => k + 1) // force the controlled price <input>s to repaint
  }

  const handleContinueEditing = () => {
    setShowDraftPrompt(false)
    setIsUsingDraft(true)
  }

  const handleClearEditor = () => {
    const init = buildInitialState({
      lang: localPdfState.pdfLanguage,
      currency: localPdfState.currency,
      exchangeRate: localPdfState.exchangeRate,
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
    setShowDraftPrompt(false)
    setLocalPdfState(init)
  }

  const printRef = useRef<HTMLDivElement | null>(null)
  const originalDocumentTitleRef = useRef<string | null>(null)
  const [isExportingPdf, setIsExportingPdf] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [nbpFetchState, setNbpFetchState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [nbpEffectiveDate, setNbpEffectiveDate] = useState<string>('')

  const handleFetchNbpRate = async () => {
    setNbpFetchState('loading')
    try {
      const { rate, effectiveDate } = await fetchEurPlnRate()
      setLocalPdfState((prev) => ({ ...prev, exchangeRate: rate }))
      setNbpEffectiveDate(effectiveDate)
      setNbpFetchState('idle')
    } catch {
      setNbpFetchState('error')
    }
  }

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

      let yStart = 0
      let firstPage = true
      while (yStart < canvas.height) {
        const limit = yStart + pageHpx
        const candidates = breakPxs.filter((b) => b > yStart && b <= Math.min(limit, canvas.height))
        // Prefer the latest break that fits on this page; fall back to a hard cut
        // if there's no candidate (single section taller than A4 — rare).
        const yEnd = candidates.length
          ? candidates[candidates.length - 1]
          : Math.min(limit, canvas.height)
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

            {/* Currency toggle: switching converts all stored row amounts ONCE
                using the current exchange rate. After that, edits happen directly
                in the active currency (no live PLN↔EUR conversion). */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-300">Waluta PDF:</span>
              <SegmentedToggle
                value={localPdfState.currency}
                options={[
                  { value: 'PLN', label: 'PLN' },
                  { value: 'EUR', label: 'EUR' },
                ]}
                onChange={(v) => {
                  const nextCurrency = v as PdfCurrency
                  setLocalPdfState((prev) => {
                    if (prev.currency === nextCurrency) return prev
                    const rate = Number.isFinite(prev.exchangeRate) && prev.exchangeRate > 0
                      ? prev.exchangeRate
                      : DEFAULT_EXCHANGE_RATE
                    // PLN → EUR: divide; EUR → PLN: multiply
                    const factor = nextCurrency === 'EUR' ? 1 / rate : rate
                    const nextRows = { ...prev.rows }
                    ;(Object.keys(nextRows) as PdfRowKey[]).forEach((key) => {
                      const r = nextRows[key]
                      if (!r) return
                      nextRows[key] = { ...r, cenaNetto: roundToUnit(safeNum(r.cenaNetto, 0, 0) * factor) }
                    })
                    return { ...prev, currency: nextCurrency, rows: nextRows }
                  })
                }}
              />
            </div>

            {/* Exchange rate input + NBP button (only when EUR).
                Used as the one-shot conversion rate when switching currency
                (PLN→EUR or EUR→PLN). Editing the rate after switching does
                NOT re-convert existing values — just toggle PLN→EUR again to
                apply a new rate. */}
            {localPdfState.currency === 'EUR' && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-zinc-300">Kurs EUR/PLN:</span>
                <Input
                  type="number"
                  inputMode="decimal"
                  step={0.01}
                  min={0.01}
                  value={localPdfState.exchangeRate}
                  onChange={(e) => {
                    const next = Number.parseFloat(e.target.value)
                    setLocalPdfState((prev) => ({
                      ...prev,
                      exchangeRate: Number.isFinite(next) && next > 0 ? next : prev.exchangeRate,
                    }))
                  }}
                  className="h-8 w-20 border-white/10 bg-white/5 text-foreground text-right tabular-nums"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleFetchNbpRate}
                  disabled={nbpFetchState === 'loading'}
                  className="h-8 gap-1.5 border-white/10 bg-zinc-900/40 text-white hover:bg-white/10"
                  title={nbpEffectiveDate ? `Ostatnio pobrano: ${nbpEffectiveDate}` : 'Pobierz aktualny kurs średni z NBP'}
                >
                  {nbpFetchState === 'loading' ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <RefreshCcw className="size-3.5" />
                  )}
                  Pobierz z NBP
                </Button>
                {nbpFetchState === 'error' && (
                  <span className="text-xs text-red-400">Nie udało się pobrać — wpisz ręcznie.</span>
                )}
                {nbpEffectiveDate && nbpFetchState === 'idle' && (
                  <span className="text-[11px] text-zinc-500">NBP {nbpEffectiveDate}</span>
                )}
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
                            {localPdfState.pdfLanguage === 'en'
                              ? localPdfState.showVat ? 'Total (gross)' : 'Total (net)'
                              : `Całkowity koszt ${localPdfState.showVat ? 'brutto' : 'netto'}`}
                          </div>
                          <div className="text-[18px] font-black text-primary tabular-nums">
                            {formatPdfAmount(
                              localPdfState.showVat ? totalNetto * (1 + VAT_RATE) : totalNetto,
                              localPdfState.currency
                            )}
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
                          <div className="flex justify-end">
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

                {(() => {
                  const L = PDF_LABELS[localPdfState.pdfLanguage]
                  const fmt = (n: number) => formatPdfAmount(n, localPdfState.currency)
                  return (
                    <>
                      <div className="mt-4 rounded-lg bg-zinc-950 p-4 text-white">
                        {localPdfState.showVat ? (
                          <div className="flex flex-col gap-1">
                            <div className="flex items-baseline justify-between text-[8pt] font-bold uppercase tracking-tight">
                              <span className="text-zinc-300">{L.sumNetto}</span>
                              <span className="tabular-nums text-white">{fmt(totalNetto)}</span>
                            </div>
                            <div className="flex items-baseline justify-between text-[8pt] font-bold uppercase tracking-tight">
                              <span className="text-zinc-300">{L.vatRow}</span>
                              <span className="tabular-nums text-white">{fmt(totalNetto * VAT_RATE)}</span>
                            </div>
                            <div className="flex items-baseline justify-between text-[18px] font-black tracking-tight">
                              <span>{L.sumBrutto}</span>
                              <span className="text-primary tabular-nums">{fmt(totalNetto * (1 + VAT_RATE))}</span>
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
                          <div className="text-[10.5px] font-extrabold uppercase tracking-widest text-primary mb-1">
                            {L.portfolio}
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
