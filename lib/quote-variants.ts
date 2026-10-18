/**
 * Warianty wyceny A/B/C (Q2, PLAN-AFTER-TEST-DRIVE §4a / §9).
 *
 * M.J. często wysyła klientowi 2–3 wersje oferty (tania, droga „kotwica",
 * środek). Każdy wariant to pełna wycena z własnym cennikiem, marżą, walutą i
 * szkicem PDF.
 *
 *   `Project.quote`          — wariant WYBRANY do rozliczeń (jak dotąd: finanse,
 *                              plan Realizacji, Finanse, klienci, statystyki
 *                              sprzętu i ekipy, `npm run data` czytają tylko to);
 *   `Project.quoteLabel`     — jego nazwa (brak = „A");
 *   `Project.quoteVariantId` — jego trwałe id (brak = `main`);
 *   `Project.quoteVariants`  — pozostałe warianty; nigdy nie liczą pieniędzy.
 *
 * „Wybrany do rozliczeń" zamienia migawki miejscami i przelicza finanse z
 * nowego wyboru. Dokument wariantu w magazynie (`quote-documents.ts`) ma klucz
 * `${projectId}#${variantId}`; wybrany ma klucz = id projektu (jak w Q1).
 *
 * Moduł czysty — bez Reacta i Tauri; testy w `quote-variants.test.ts`.
 */

import { pdfRowsTotal } from './pdf-draft'
import { blankQuoteSnapshot, clientAfterSave } from './project-save'
import { computeQuoteTotals, computeSnapshotFinancials, computeTotalCrewDays, resolveSnapshot, quoteViews } from './quote-financials'
import { quoteGearFigures } from './quote-gear'
import { toPln, type QuoteCurrency } from './quote-currency'
import type { Project, ProjectFinancials, QuoteVariant } from './project-types'
import type { TimelineEvent } from './event-types'
import type { QuoteSnapshot } from './quote-library'
import type { LocalPdfState, QuoteData } from './quote-types'
import { safeArray, safeNum } from './safe-numbers'

/** Id wybranego wariantu w projekcie sprzed Q2 (bez `quoteVariantId`). */
export const MAIN_VARIANT_ID = 'main'
/** Nazwa wybranego wariantu, dopóki nikt jej nie nadał. */
export const DEFAULT_CHOSEN_LABEL = 'A'

const DOC_SEPARATOR = '#'

type VariantProject = Pick<Project, 'id' | 'quote' | 'quoteVariants' | 'quoteLabel' | 'quoteVariantId'>

export function chosenVariantId(project: Pick<Project, 'quoteVariantId'>): string {
  return project.quoteVariantId?.trim() || MAIN_VARIANT_ID
}

export function chosenLabel(project: Pick<Project, 'quoteLabel'>): string {
  return project.quoteLabel?.trim() || DEFAULT_CHOSEN_LABEL
}

/** Klucz dokumentu wariantu w magazynie: wybrany = id projektu, pozostałe `projekt#wariant`. */
export function variantDocId(project: Pick<Project, 'id' | 'quoteVariantId'>, variantId: string): string {
  return variantId === chosenVariantId(project) ? project.id : `${project.id}${DOC_SEPARATOR}${variantId}`
}

/** `projekt#wariant` → części; samo id projektu = wybrany wariant (`variantId: null`). */
export function parseDocId(docId: string): { projectId: string; variantId: string | null } {
  const at = docId.indexOf(DOC_SEPARATOR)
  if (at === -1) return { projectId: docId, variantId: null }
  return { projectId: docId.slice(0, at), variantId: docId.slice(at + 1) }
}

/** Wariant (niewybrany) po id — także usunięty; `null` = nie ma. */
export function findVariant(project: Pick<Project, 'quoteVariants'>, variantId: string): QuoteVariant | null {
  return (project.quoteVariants ?? []).find((v) => v.id === variantId) ?? null
}

export interface VariantView {
  id: string
  label: string
  /** Wybrany do rozliczeń (`Project.quote`). */
  chosen: boolean
  /** Migawka wyceny (`null` = pusta). */
  snapshot: QuoteSnapshot | null
  docId: string
}

const collator = new Intl.Collator('pl', { numeric: true, sensitivity: 'base' })

/** Żywe warianty projektu (wybrany + nieusunięte) w kolejności nazw: A, B, C… */
export function listVariants(project: VariantProject): VariantView[] {
  const chosenId = chosenVariantId(project)
  const chosen: VariantView = {
    id: chosenId,
    label: chosenLabel(project),
    chosen: true,
    snapshot: project.quote ?? null,
    docId: project.id,
  }
  const others = (project.quoteVariants ?? [])
    .filter((v) => !v.deletedAt && v.id !== chosenId)
    .map<VariantView>((v) => ({
      id: v.id,
      label: v.label.trim() || '?',
      chosen: false,
      snapshot: v.snapshot ?? null,
      docId: variantDocId(project, v.id),
    }))
  return [chosen, ...others].sort((a, b) => collator.compare(a.label, b.label) || (a.chosen ? -1 : b.chosen ? 1 : 0))
}

/** Czy projekt ma więcej niż jeden żywy wariant (wtedy widać nazwy, pytania i dopisek w PDF). */
export function hasAlternatives(project: Pick<Project, 'quoteVariants' | 'quoteVariantId'>): boolean {
  const chosenId = chosenVariantId(project)
  return (project.quoteVariants ?? []).some((v) => !v.deletedAt && v.id !== chosenId)
}

/** Następna wolna litera (A, B, C…, potem liczby). Porównanie bez wielkości liter. */
export function nextVariantLabel(labels: string[]): string {
  const taken = new Set(labels.map((l) => l.trim().toLocaleUpperCase('pl')))
  for (let code = 65; code <= 90; code += 1) {
    const letter = String.fromCharCode(code)
    if (!taken.has(letter)) return letter
  }
  let n = labels.length + 1
  while (taken.has(String(n))) n += 1
  return String(n)
}

/** Wszystkie nazwy w projekcie (także usuniętych — „Cofnij" nie może dać dwóch „B"). */
function allLabels(project: VariantProject): string[] {
  return [chosenLabel(project), ...(project.quoteVariants ?? []).map((v) => v.label)]
}

export function createVariantId(): string {
  return `qv-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

type VariantPatch = Partial<Pick<Project, 'quoteVariants' | 'quoteLabel' | 'quoteVariantId' | 'quote' | 'financials' | 'client'>>

/**
 * „+ Wariant": nowy wariant z podaną migawką (kopia bieżącego albo pusta).
 * Pierwszy raz wybrany dostaje nazwę „A" zapisaną w projekcie.
 */
/**
 * Nowy wariant (kopia albo pusta wycena) pokazuje marżę jako osobną pozycję
 * (R1, A5; M.J. 2026-10-18). Suma się nie zmienia; szkic PDF kopii zostaje
 * dokładnie taki, jak był (bez wiersza marży czyta się jako 0).
 */
export function withMarginLine(snapshot: QuoteSnapshot | null): QuoteSnapshot | null {
  if (!snapshot || !snapshot.data || typeof snapshot.data !== 'object') return snapshot
  if ((snapshot.data as { marginAsLine?: unknown }).marginAsLine === true) return snapshot
  return { ...snapshot, data: { ...snapshot.data, marginAsLine: true } }
}

export function addVariantPatch(
  project: VariantProject,
  params: { id: string; snapshot: QuoteSnapshot | null; label?: string; now: Date }
): { patch: VariantPatch; variant: QuoteVariant } {
  const at = params.now.toISOString()
  const variant: QuoteVariant = {
    id: params.id,
    label: params.label?.trim() || nextVariantLabel(allLabels(project)),
    snapshot: withMarginLine(params.snapshot),
    createdAt: at,
    updatedAt: at,
  }
  const patch: VariantPatch = { quoteVariants: [...(project.quoteVariants ?? []), variant] }
  if (!project.quoteLabel?.trim()) patch.quoteLabel = DEFAULT_CHOSEN_LABEL
  return { patch, variant }
}

/** Zapis dokumentu wariantu: tylko jego wpis (żadnych finansów). `null` = wariantu nie ma. */
export function variantSnapshotPatch(
  project: Pick<Project, 'quoteVariants'>,
  variantId: string,
  snapshot: QuoteSnapshot | null,
  now: Date
): VariantPatch | null {
  const list = project.quoteVariants ?? []
  if (!list.some((v) => v.id === variantId)) return null
  return {
    quoteVariants: list.map((v) => (v.id === variantId ? { ...v, snapshot, updatedAt: now.toISOString() } : v)),
  }
}

/** Zmiana nazwy (wybranego → `quoteLabel`). Pusta nazwa = brak zmiany. */
export function renameVariantPatch(project: VariantProject, variantId: string, label: string, now: Date): VariantPatch | null {
  const name = label.trim().replace(/\s+/g, ' ')
  if (!name) return null
  if (variantId === chosenVariantId(project)) return name === project.quoteLabel ? null : { quoteLabel: name }
  const list = project.quoteVariants ?? []
  if (!list.some((v) => v.id === variantId && v.label !== name)) return null
  return { quoteVariants: list.map((v) => (v.id === variantId ? { ...v, label: name, updatedAt: now.toISOString() } : v)) }
}

/**
 * Miękkie usunięcie wariantu. Wybranego nie da się usunąć („Najpierw wybierz
 * inny wariant do rozliczeń") — `null`.
 */
export function deleteVariantPatch(project: VariantProject, variantId: string, now: Date): VariantPatch | null {
  if (variantId === chosenVariantId(project)) return null
  const list = project.quoteVariants ?? []
  if (!list.some((v) => v.id === variantId && !v.deletedAt)) return null
  return { quoteVariants: list.map((v) => (v.id === variantId ? { ...v, deletedAt: now.toISOString() } : v)) }
}

/** „Cofnij" usunięcia. */
export function restoreVariantPatch(project: VariantProject, variantId: string): VariantPatch | null {
  const list = project.quoteVariants ?? []
  if (!list.some((v) => v.id === variantId && v.deletedAt)) return null
  return {
    quoteVariants: list.map((v) => {
      if (v.id !== variantId) return v
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { deletedAt: _removed, ...rest } = v
      return rest as QuoteVariant
    }),
  }
}

export type ChooseVariantPlan =
  | {
      status: 'ready'
      patch: VariantPatch
      /** Finanse przed i po (do pytania i komunikatu). */
      before: ProjectFinancials | null
      after: ProjectFinancials | null
      /** Projekt ma finanse z importu (bez wyceny) — wybór je zastąpi, trzeba zapytać. */
      replacesImported: boolean
      /** Id wariantu, który przestał być wybrany („Cofnij" wybiera go z powrotem). */
      previousId: string
    }
  /** `blocked` — wycena projektu czeka na odpowiedź o finanse z importu; najpierw ona. */
  | { status: 'unchanged' | 'missing' | 'blocked' }

/**
 * „Wybrany do rozliczeń": migawka wariantu idzie do `quote`, dotychczasowy
 * wybór staje się zwykłym wariantem (z trwałym id i nazwą), finanse liczą się
 * z nowego wyboru (te same reguły co zapis wyceny, `planProjectSave`).
 *
 * Projekt bez wyceny (pusta „A") zostawia ją jako pusty wariant, żeby
 * „Cofnij" miało do czego wrócić.
 */
export function chooseVariantPlan(project: Project, variantId: string, now: Date): ChooseVariantPlan {
  const previousId = chosenVariantId(project)
  if (variantId === previousId) return { status: 'unchanged' }
  const target = findVariant(project, variantId)
  if (!target || target.deletedAt) return { status: 'missing' }

  const at = now.toISOString()
  const demoted: QuoteVariant = {
    id: previousId,
    label: chosenLabel(project),
    snapshot: project.quote ?? null,
    createdAt: project.createdAt || at,
    updatedAt: project.quote?.savedAt || project.updatedAt || at,
  }
  const others = (project.quoteVariants ?? []).filter((v) => v.id !== variantId && v.id !== previousId)
  // Na miejscu wybranego wariantu — kolejność listy się nie przestawia.
  const position = (project.quoteVariants ?? []).findIndex((v) => v.id === variantId)
  const quoteVariants = [...others]
  quoteVariants.splice(Math.min(position, quoteVariants.length), 0, demoted)

  const snapshot: QuoteSnapshot =
    (target.snapshot as QuoteSnapshot | null) ??
    ({ version: 2, savedAt: at, ...blankQuoteSnapshot(project.client), pdfDraft: null } as QuoteSnapshot)
  // Te same reguły co zapis wyceny: finanse z kalkulatora, klient projektu (albo z wyceny, gdy pusty).
  const after = computeSnapshotFinancials(snapshot, now)
  const client = clientAfterSave(project, snapshot)

  return {
    status: 'ready',
    patch: {
      quote: snapshot,
      quoteLabel: target.label.trim() || nextVariantLabel(allLabels(project)),
      quoteVariantId: target.id,
      quoteVariants,
      financials: after,
      client,
    },
    before: project.financials,
    after,
    replacesImported: !project.quote && !!project.financials,
    previousId,
  }
}

/**
 * Czy zmiana statusu ma zapytać „Który wariant przyjął klient?": przejście z
 * wyceny / nieprzyjętej do „W realizacji" / „Zrealizowany", gdy są warianty.
 */
export function asksWhichVariant(
  project: Pick<Project, 'status' | 'quoteVariants' | 'quoteVariantId'>,
  next: Project['status']
): boolean {
  const counts = (s: Project['status']) => s === 'won' || s === 'done'
  return !counts(project.status) && counts(next) && hasAlternatives(project)
}

// ── Porównanie wariantów ─────────────────────────────────────────────────────

export interface VariantFigures {
  currency: QuoteCurrency
  /** Netto z kalkulatora w walucie wyceny. */
  netto: number
  /** To samo w zł (EUR × kurs). */
  nettoPln: number
  /** Netto szkicu PDF (ceny poprawione ręcznie), w jego walucie; `null` = PDF idzie za kalkulatorem. */
  pdfNetto: number | null
  pdfCurrency: QuoteCurrency | null
  /** Dni zdjęciowe. */
  shootingDays: number
  /** Osobodni ekipy. */
  crewDays: number
  /** Sprzęt w cenie dla klienta (katalog + wypożyczalnie, tryb szczegółowy) w walucie wyceny; `null` = tryb prosty. */
  gear: number | null
  /** Plan z kalkulatora (jak finanse wybranego wariantu, w zł). */
  zysk: number
  marzaPct: number
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** Liczby do tabeli „Porównaj warianty" — liczone na bieżąco, nigdzie nie zapisywane. */
export function variantFigures(snapshot: unknown, client = ''): VariantFigures {
  const resolved =
    resolveSnapshot(isObject(snapshot) ? (snapshot as Partial<QuoteSnapshot>) : null) ??
    resolveSnapshot(blankQuoteSnapshot(client))
  if (!resolved) throw new Error('pusta wycena bez danych')
  const { data, pricing, margin } = resolved
  const views = quoteViews(data, pricing)
  const totals = computeQuoteTotals(views.client.data, margin, views.client.pricing)
  const draft = isObject(snapshot) && isObject(snapshot.pdfDraft) ? (snapshot.pdfDraft as Partial<LocalPdfState>) : null
  // Plan jak finanse wariantu po wyborze: przychód z PDF (R2), gdy jest szkic.
  const financials = computeSnapshotFinancials({ data, pricingConfig: pricing, marginMultiplier: margin, pdfDraft: draft })
  const pdfNetto = draft && isObject(draft.rows) ? pdfRowsTotal(draft.rows as LocalPdfState['rows']) : null
  const gear = quoteGearFigures(views.client.data)
  const shootingDays = data.isDetailedProdukcja
    ? safeArray(data.detailedShootingDays).length
    : safeNum((data as QuoteData).dniZdjeciowe, 0, 0)
  return {
    currency: views.money.currency,
    netto: totals.sumaNetto,
    nettoPln: toPln(totals.sumaNetto, views.money),
    pdfNetto,
    pdfCurrency: pdfNetto == null ? null : draft?.currency === 'EUR' ? 'EUR' : 'PLN',
    shootingDays,
    crewDays: computeTotalCrewDays(data),
    gear: data.isDetailedProdukcja ? gear.charged + gear.external : null,
    zysk: financials?.zysk ?? 0,
    marzaPct: financials?.marzaPct ?? 0,
  }
}

// ── Nazwa pliku PDF ──────────────────────────────────────────────────────────

/** Dopisek do nazwy pliku PDF: „ (wariant B)" tylko, gdy projekt ma kilka wariantów. */
export function pdfVariantSuffix(label: string | null): string {
  return label ? ` (wariant ${label})` : ''
}

// ── „Scal osoby" w wariantach ────────────────────────────────────────────────

export interface VariantCrewRef {
  variantId: string
  dayId: string
  lineId: string
  from: string
}

function variantDays(snapshot: QuoteSnapshot | null | undefined): { id: string; crew?: { id: string; personId?: string }[] }[] {
  const days = snapshot && isObject(snapshot.data) ? (snapshot.data as Partial<QuoteData>).detailedShootingDays : undefined
  return Array.isArray(days) ? (days as { id: string; crew?: { id: string; personId?: string }[] }[]) : []
}

function rewriteVariantCrew(
  project: Pick<Project, 'quoteVariants'>,
  decide: (variantId: string, dayId: string, line: { id: string; personId?: string }) => string | null
): VariantPatch | null {
  let changed = false
  const quoteVariants = (project.quoteVariants ?? []).map((variant) => {
    const snapshot = variant.snapshot as QuoteSnapshot | null
    let variantChanged = false
    const days = variantDays(snapshot).map((day) => {
      if (!Array.isArray(day.crew)) return day
      let dayChanged = false
      const crew = day.crew.map((line) => {
        const next = decide(variant.id, day.id, line)
        if (next == null || next === line.personId) return line
        dayChanged = true
        return { ...line, personId: next }
      })
      if (!dayChanged) return day
      variantChanged = true
      return { ...day, crew }
    })
    if (!variantChanged || !snapshot) return variant
    changed = true
    return { ...variant, snapshot: { ...snapshot, data: { ...snapshot.data, detailedShootingDays: days } } as QuoteSnapshot }
  })
  return changed ? { quoteVariants } : null
}

/**
 * „Scal osoby": pozycje ekipy w wariantach (także usuniętych) wskazują osobę,
 * która zostaje. Zwraca łatę i odwołania do „Cofnij".
 */
export function retargetVariantCrew(
  project: Pick<Project, 'quoteVariants'>,
  sourceIds: string[],
  targetId: string
): { patch: VariantPatch; refs: VariantCrewRef[] } | null {
  const sources = new Set(sourceIds)
  const refs: VariantCrewRef[] = []
  const patch = rewriteVariantCrew(project, (variantId, dayId, line) => {
    if (!line.personId || !sources.has(line.personId)) return null
    refs.push({ variantId, dayId, lineId: line.id, from: line.personId })
    return targetId
  })
  return patch ? { patch, refs } : null
}

/** „Cofnij" scalenia w wariantach: poprzednia osoba tam, gdzie pozycja wciąż wskazuje docelową. */
export function restoreVariantCrew(
  project: Pick<Project, 'quoteVariants'>,
  refs: VariantCrewRef[],
  targetId: string
): VariantPatch | null {
  const byLine = new Map(refs.map((r) => [`${r.variantId}|${r.dayId}|${r.lineId}`, r.from]))
  return rewriteVariantCrew(project, (variantId, dayId, line) => {
    const from = byLine.get(`${variantId}|${dayId}|${line.id}`)
    return from && line.personId === targetId ? from : null
  })
}

// ── „Wycena wysłana" po „Pobierz PDF" ────────────────────────────────────────

/**
 * Wydarzenie `quote_sent` proponowane po pobraniu PDF (nigdy samo): kwota =
 * suma netto PDF w zł (to zobaczył klient; EUR × kurs szkicu), wersja = nazwa
 * wariantu, gdy projekt ma kilka.
 */
export function quoteSentEvent(params: {
  id: string
  projectId: string
  date: string
  pdfNetto: number
  pdfCurrency: QuoteCurrency
  pdfRate: number
  variantLabel: string | null
  now: Date
}): TimelineEvent {
  const at = params.now.toISOString()
  const pln = params.pdfCurrency === 'EUR' ? params.pdfNetto * params.pdfRate : params.pdfNetto
  return {
    id: params.id,
    kind: 'quote_sent',
    projectId: params.projectId,
    start: params.date,
    title: params.variantLabel ? `Wycena wysłana — wariant ${params.variantLabel}` : 'Wycena wysłana',
    notes: '',
    data: {
      amountNetto: Math.round(pln * 100) / 100,
      ...(params.variantLabel ? { quoteVersion: params.variantLabel } : {}),
    },
    source: { type: 'manual' },
    createdAt: at,
    updatedAt: at,
  }
}
