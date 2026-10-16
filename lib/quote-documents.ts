/**
 * Wycena jako dokument projektu (Q1, PLAN-AFTER-TEST-DRIVE §4a / §8).
 *
 * Każdy projekt ma WŁASNY dokument wyceny: dane, cennik, marżę i szkic PDF.
 * Nie ma już jednego kalkulatora, do którego projekt się wgrywa i z którego
 * zapisuje „Zapisz". Ten magazyn trzyma dokumenty, nad którymi pracujesz, i
 * sam je zapisuje do projektu (`Project.quote` + policzone `financials`):
 * chwilę po ostatniej zmianie, przy zmianie projektu i przy zamknięciu okna.
 *
 * Zasady:
 *   - źródłem prawdy jest `Project.quote` — dokument bez czekających zmian
 *     zawsze odpowiada temu, co jest w projekcie (zmiana z zewnątrz, np.
 *     „Scal osoby", daje nowy dokument i nowy `epoch`);
 *   - czekające zmiany (bufor) wygrywają z projektem, dopóki się nie zapiszą;
 *   - zapis decyduje `planProjectSave` (`project-save.ts`): projekt bez wyceny
 *     z finansami z importu pyta raz, zanim je zastąpi — do odpowiedzi zmiany
 *     zostają w pamięci, nic nie trafia do pliku;
 *   - zmiany „ciche" (`silent`) — automatyczne poprawki szkicu PDF — nie
 *     wywołują zapisu; jadą z następną prawdziwą zmianą;
 *   - „Cofnij zmiany z tej sesji" przywraca wycenę i finanse z chwili, gdy
 *     dokument pierwszy raz otwarto w tej sesji.
 *
 * Bez Reacta i bez Tauri — timery i zapis wstrzykiwane, więc całość jest
 * testowana w `quote-documents.test.ts`.
 *
 * Q2 (warianty A/B/C, `quote-variants.ts`): klucz dokumentu to `docId`. Id
 * projektu = wariant wybrany do rozliczeń (`Project.quote`, zapis jak wyżej);
 * `projekt#wariant` = pozostały wariant — jego zapis (`writeVariant`) zmienia
 * tylko jego wpis w `Project.quoteVariants`: bez finansów i bez pytania o
 * import, bo warianty nie liczą pieniędzy. „Cofnij zmiany z tej sesji" działa
 * na każdy dokument osobno.
 */

import { DEFAULT_PRICING, type PricingConfigShape } from './pricing-config'
import { mergeQuoteDataPartial, resolveSnapshot } from './quote-financials'
import { blankQuoteSnapshot, planProjectSave } from './project-save'
import type { Project, ProjectFinancials } from './project-types'
import type { QuoteSnapshot } from './quote-library'
import type { QuoteData } from './quote-types'
import { findVariant, parseDocId } from './quote-variants'

// ── Dokument ─────────────────────────────────────────────────────────────────

export interface QuoteDoc {
  data: QuoteData
  /** Cennik TEJ wyceny (zawsze w PLN). */
  pricingConfig: PricingConfigShape
  marginMultiplier: number
  /**
   * Szkic PDF (`LocalPdfState` + `uwagiManualText`). `null` = PDF jeszcze nie
   * edytowany: zakładka PDF buduje go z kalkulatora i idzie za jego zmianami.
   */
  pdfDraft: unknown
  /** Nieznane pola migawki (nowsza wersja, `npm run data`) — wracają przy zapisie. */
  extra?: Record<string, unknown>
}

const SNAPSHOT_KEYS = new Set(['version', 'savedAt', 'data', 'pricingConfig', 'marginMultiplier', 'pdfDraft'])

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** Pusta wycena: klient z projektu, domyślny cennik użytkownika (albo fabryczny), marża 0 %. */
export function blankDoc(client: string, defaultPricing: PricingConfigShape | null): QuoteDoc {
  const blank = blankQuoteSnapshot(client, defaultPricing)
  return {
    data: mergeQuoteDataPartial(blank.data),
    pricingConfig: blank.pricingConfig ?? DEFAULT_PRICING,
    marginMultiplier: blank.marginMultiplier,
    pdfDraft: null,
  }
}

/**
 * Dokument z zapisanej migawki — dane, cennik i marża dokładnie tak, jak liczy
 * je `computeSnapshotFinancials` (`resolveSnapshot`), więc stara wycena liczy
 * się po otwarciu identycznie. `null` = migawka bez danych wyceny.
 */
export function docFromSnapshot(snapshot: unknown): QuoteDoc | null {
  if (!isObject(snapshot)) return null
  const resolved = resolveSnapshot(snapshot as Partial<QuoteSnapshot>)
  if (!resolved) return null
  const extra: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(snapshot)) {
    if (!SNAPSHOT_KEYS.has(key)) extra[key] = value
  }
  return {
    data: resolved.data,
    pricingConfig: resolved.pricing,
    marginMultiplier: resolved.margin,
    pdfDraft: isObject(snapshot.pdfDraft) ? snapshot.pdfDraft : null,
    ...(Object.keys(extra).length ? { extra } : {}),
  }
}

/** Dokument projektu: jego wycena albo pusta wycena z klientem projektu. */
export function docFromProject(
  project: Pick<Project, 'quote' | 'client'>,
  defaultPricing: PricingConfigShape | null
): QuoteDoc {
  return docFromSnapshot(project.quote) ?? blankDoc(project.client, defaultPricing)
}

/** Migawka do zapisu w `Project.quote` (ten sam kształt co dotąd: wersja 2). */
export function docToSnapshot(doc: QuoteDoc, now: Date = new Date()): QuoteSnapshot {
  return {
    ...doc.extra,
    version: 2,
    savedAt: now.toISOString(),
    data: doc.data,
    pricingConfig: doc.pricingConfig,
    marginMultiplier: doc.marginMultiplier,
    pdfDraft: doc.pdfDraft ?? null,
  }
}

// ── Magazyn ──────────────────────────────────────────────────────────────────

/**
 * `saved` — nic nie czeka · `pending` — zapis za chwilę · `saving` — w toku ·
 * `needs-confirmation` — finanse z importu, czeka na „Zastąp" · `error` — zapis się nie udał.
 */
export type QuoteDocStatus = 'saved' | 'pending' | 'saving' | 'needs-confirmation' | 'error'

export interface QuoteDocState {
  status: QuoteDocStatus
  /** Kwoty do pytania „Zastąpić finanse z importu?". */
  prompt: { current: ProjectFinancials; proposed: ProjectFinancials | null } | null
  /** Rośnie, gdy dokument podmieniono w całości (wyczyszczenie, import, zmiana z zewnątrz). */
  epoch: number
  /** Czy w tej sesji coś w tej wycenie zmieniono (jest co cofnąć). */
  changedThisSession: boolean
  error: string | null
}

/** Łata zapisu na najświeższej wersji projektu. */
export type QuoteDocPatch = Pick<Project, 'quote' | 'financials'> & Partial<Pick<Project, 'client'>>

export interface QuoteDocumentStoreOptions {
  /** Najświeższa wersja projektu (`null` = nie ma / usunięty). */
  getProject: (id: string) => Project | null
  /** Domyślny cennik użytkownika dla pustych wycen (`null` = fabryczny). */
  defaultPricing: () => PricingConfigShape | null
  write: (id: string, patch: QuoteDocPatch) => Promise<void>
  /** Zapis wariantu (niewybranego): tylko jego migawka w `Project.quoteVariants`. */
  writeVariant?: (projectId: string, variantId: string, snapshot: QuoteSnapshot | null) => Promise<void>
  delayMs?: number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  now?: () => Date
}

export interface QuoteDocumentStore {
  /** Bieżący dokument projektu (czekające zmiany albo to, co w projekcie). */
  get: (id: string) => QuoteDoc
  state: (id: string) => QuoteDocState
  /**
   * Zmiana dokumentu. `updater` zwracający ten sam obiekt = brak zmiany.
   * `silent` — bez zapisu (jedzie z następną zmianą); `replace` — nowy `epoch`.
   */
  edit: (id: string, updater: (doc: QuoteDoc) => QuoteDoc, options?: { silent?: boolean; replace?: boolean }) => void
  /** Zapisz teraz (zamiast po opóźnieniu). */
  flush: (id: string) => Promise<void>
  flushAll: () => Promise<void>
  /** Zapisz teraz wszystkie dokumenty projektu (wybrany i warianty). */
  flushProject: (projectId: string) => Promise<void>
  /** „Zastąp" — zapis wyceny zamiast finansów z importu. */
  confirmReplace: (id: string) => Promise<void>
  /** „Cofnij zmiany" przy pytaniu o import — porzuca czekające zmiany. */
  discard: (id: string) => void
  /** „Cofnij zmiany z tej sesji" — wycena i finanse jak przy pierwszym otwarciu. */
  restoreSession: (id: string) => Promise<void>
  /** Projekty z niezapisanymi zmianami (np. czekające na odpowiedź). */
  pendingIds: () => string[]
  /**
   * Porzuć dokument (następny odczyt zbuduje go z projektu od nowa). Samo id
   * projektu porzuca też dokumenty jego wariantów (projekt usunięty).
   */
  forget: (id: string) => void
  subscribe: (listener: () => void) => () => void
  /** Numer wersji magazynu — dla `useSyncExternalStore`. */
  version: () => number
}

export const QUOTE_SAVE_DELAY_MS = 600

interface Entry {
  doc: QuoteDoc
  /** Obiekt `Project.quote` (albo klucz pustej wyceny), z którego jest `doc`. */
  sourceRef: unknown
  /** Ten sam stan jako JSON — kopia z pliku po zapisie to ten sam dokument. */
  sourceKey: string
  dirty: boolean
  /** Edycja w trakcie zapisu: po zapisie trzeba zapisać jeszcze raz. */
  editedDuringSave: boolean
  saving: Promise<void> | null
  timer: unknown
  status: QuoteDocStatus
  prompt: QuoteDocState['prompt']
  epoch: number
  origin: Pick<Project, 'quote' | 'financials'>
  changedThisSession: boolean
  /** Czy w tej sesji coś z tej wyceny trafiło do pliku (bez tego „Cofnij zmiany" nie ma czego cofać w pliku). */
  savedThisSession: boolean
  error: string | null
}

const BLANK_PREFIX = '\u0000blank:'

interface DocSource {
  project: Project
  /** `Project.quote` (wybrany) albo migawka wariantu; `null` = pusta wycena. */
  quote: unknown
  /** `null` = wybrany wariant (zapis z finansami). */
  variantId: string | null
}

/** Źródło dokumentu: zapisana wycena albo pusta wycena danego klienta. */
function sourceOf(project: { quote: unknown; client: string }): { ref: unknown; key: () => string } {
  if (project.quote) {
    const quote = project.quote
    return { ref: quote, key: () => JSON.stringify(quote) }
  }
  const key = `${BLANK_PREFIX}${project.client}`
  return { ref: key, key: () => key }
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function createQuoteDocumentStore(options: QuoteDocumentStoreOptions): QuoteDocumentStore {
  const delayMs = options.delayMs ?? QUOTE_SAVE_DELAY_MS
  const setTimer = options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))
  const clearTimer = options.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  const now = options.now ?? (() => new Date())

  const entries = new Map<string, Entry>()
  const listeners = new Set<() => void>()
  let version = 0

  const notify = () => {
    version += 1
    listeners.forEach((listener) => listener())
  }

  const derive = (source: DocSource) =>
    docFromSnapshot(source.quote) ?? blankDoc(source.project.client, options.defaultPricing())

  /**
   * Skąd dokument: wybrany wariant = `Project.quote`, pozostały = jego migawka.
   * `null` = projektu albo wariantu nie ma.
   */
  function sourceFor(id: string): DocSource | null {
    const { projectId, variantId } = parseDocId(id)
    const project = options.getProject(projectId)
    if (!project) return null
    if (variantId === null) return { project, quote: project.quote, variantId: null }
    const variant = findVariant(project, variantId)
    return variant ? { project, quote: variant.snapshot ?? null, variantId } : null
  }

  /** Wpis dokumentu, zsynchronizowany z projektem, gdy nic nie czeka na zapis. */
  function entryFor(id: string): Entry | null {
    const found = sourceFor(id)
    const entry = entries.get(id)
    if (!found) return entry ?? null
    const source = sourceOf({ quote: found.quote, client: found.project.client })
    if (!entry) {
      const created: Entry = {
        doc: derive(found),
        sourceRef: source.ref,
        sourceKey: source.key(),
        dirty: false,
        editedDuringSave: false,
        saving: null,
        timer: null,
        status: 'saved',
        prompt: null,
        epoch: 0,
        origin: { quote: found.quote as Project['quote'], financials: found.project.financials },
        changedThisSession: false,
        savedThisSession: false,
        error: null,
      }
      entries.set(id, created)
      return created
    }
    // Czekające zmiany wygrywają; zapis w toku też (jego wynik zaraz wróci).
    if (entry.dirty || entry.saving) return entry
    if (entry.sourceRef === source.ref) return entry
    const key = source.key()
    if (key !== entry.sourceKey) {
      // Zmiana z zewnątrz (inny ekran, „Scal osoby", zmiana klienta pustej wyceny).
      entry.doc = derive(found)
      entry.sourceKey = key
      entry.epoch += 1
    }
    entry.sourceRef = source.ref
    return entry
  }

  function get(id: string): QuoteDoc {
    const entry = entryFor(id)
    if (entry) return entry.doc
    return blankDoc('', options.defaultPricing())
  }

  function state(id: string): QuoteDocState {
    const entry = entryFor(id)
    if (!entry) return { status: 'saved', prompt: null, epoch: 0, changedThisSession: false, error: null }
    return {
      status: entry.status,
      prompt: entry.prompt,
      epoch: entry.epoch,
      changedThisSession: entry.changedThisSession,
      error: entry.error,
    }
  }

  function cancelTimer(entry: Entry) {
    if (entry.timer != null) clearTimer(entry.timer)
    entry.timer = null
  }

  function schedule(id: string, entry: Entry) {
    cancelTimer(entry)
    entry.timer = setTimer(() => {
      entry.timer = null
      void flush(id)
    }, delayMs)
  }

  function edit(id: string, updater: (doc: QuoteDoc) => QuoteDoc, editOptions: { silent?: boolean; replace?: boolean } = {}) {
    const entry = entryFor(id)
    if (!entry) return
    const next = updater(entry.doc)
    if (next === entry.doc) return
    entry.doc = next
    if (editOptions.replace) entry.epoch += 1
    if (editOptions.silent && !entry.dirty) {
      // Poprawka bez decyzji użytkownika: zostaje w pamięci, zapisze się z następną zmianą.
      notify()
      return
    }
    entry.dirty = true
    entry.changedThisSession = true
    if (entry.saving) entry.editedDuringSave = true
    // Czeka na „Zastąp" — zmiany zbierają się w pamięci, nic nie leci do pliku.
    if (entry.status !== 'needs-confirmation') {
      entry.status = entry.saving ? 'saving' : 'pending'
      if (!entry.saving) schedule(id, entry)
    }
    notify()
  }

  async function save(id: string, entry: Entry, replaceFinancials: boolean): Promise<void> {
    const found = sourceFor(id)
    if (!found) {
      // Projekt (albo wariant) usunięty w międzyczasie — nie ma dokąd zapisać.
      entry.dirty = false
      entry.status = 'saved'
      return
    }
    const { project, variantId } = found
    const doc = entry.doc
    const snapshot = docToSnapshot(doc, now())
    if (variantId !== null) {
      // Wariant nie liczy pieniędzy: sama migawka, bez finansów i bez pytania o import.
      await persist(id, entry, snapshot, () => writeVariant(project.id, variantId, snapshot))
      return
    }
    const plan = planProjectSave({ project, snapshot, replaceFinancials, now: now() })
    if (plan.status === 'needs-confirmation') {
      entry.status = 'needs-confirmation'
      entry.prompt = { current: plan.current, proposed: plan.proposed }
      return
    }
    if (plan.source === 'kept') {
      // Pusta wycena projektu bez wyceny — nic do zapisania, projekt zostaje bez wyceny.
      entry.dirty = false
      entry.status = 'saved'
      entry.prompt = null
      return
    }
    await persist(id, entry, snapshot, () =>
      options.write(id, {
        quote: snapshot,
        financials: plan.project.financials,
        client: plan.project.client,
      })
    )
  }

  function writeVariant(projectId: string, variantId: string, snapshot: QuoteSnapshot | null): Promise<void> {
    if (!options.writeVariant) return Promise.reject(new Error('Zapis wariantów niedostępny'))
    return options.writeVariant(projectId, variantId, snapshot)
  }

  /** Zapis migawki i stan wpisu po nim (wspólne dla wybranego wariantu i pozostałych). */
  async function persist(id: string, entry: Entry, snapshot: QuoteSnapshot, run: () => Promise<void>): Promise<void> {
    entry.status = 'saving'
    entry.editedDuringSave = false
    notify()
    try {
      await run()
      entry.sourceRef = snapshot
      entry.sourceKey = JSON.stringify(snapshot)
      entry.savedThisSession = true
      entry.prompt = null
      entry.error = null
      if (entry.editedDuringSave) {
        entry.status = 'pending'
        schedule(id, entry)
      } else {
        entry.dirty = false
        entry.status = 'saved'
      }
    } catch (err) {
      entry.status = 'error'
      entry.error = describeError(err)
    }
  }

  async function flushEntry(id: string, replaceFinancials: boolean): Promise<void> {
    const entry = entries.get(id)
    if (!entry) return
    cancelTimer(entry)
    while (entry.saving) await entry.saving
    if (!entry.dirty) return
    if (entry.status === 'needs-confirmation' && !replaceFinancials) return
    const run = save(id, entry, replaceFinancials).catch((err) => {
      entry.status = 'error'
      entry.error = describeError(err)
    })
    entry.saving = run
    try {
      await run
    } finally {
      entry.saving = null
      notify()
    }
  }

  const flush = (id: string) => flushEntry(id, false)

  async function flushAll(): Promise<void> {
    await Promise.all([...entries.keys()].map((id) => flush(id)))
  }

  const ofProject = (projectId: string) => (id: string) => id === projectId || parseDocId(id).projectId === projectId

  async function flushProject(projectId: string): Promise<void> {
    await Promise.all([...entries.keys()].filter(ofProject(projectId)).map((id) => flush(id)))
  }

  async function confirmReplace(id: string): Promise<void> {
    const entry = entries.get(id)
    if (!entry || entry.status !== 'needs-confirmation') return
    entry.status = 'pending'
    await flushEntry(id, true)
  }

  function resetToSource(entry: Entry) {
    cancelTimer(entry)
    entry.dirty = false
    entry.editedDuringSave = false
    entry.status = 'saved'
    entry.prompt = null
    entry.error = null
    // Następny odczyt zbuduje dokument z projektu od nowa.
    entry.sourceRef = undefined
    entry.sourceKey = ''
  }

  function discard(id: string) {
    const entry = entries.get(id)
    if (!entry) return
    resetToSource(entry)
    // Porzucone zmiany nigdy nie trafiły do pliku — zostaje tylko to, co zapisano wcześniej.
    entry.changedThisSession = entry.savedThisSession
    notify()
  }

  async function restoreSession(id: string): Promise<void> {
    const entry = entries.get(id)
    if (!entry) return
    cancelTimer(entry)
    while (entry.saving) await entry.saving
    const found = sourceFor(id)
    if (found) {
      try {
        if (found.variantId !== null) await writeVariant(found.project.id, found.variantId, entry.origin.quote)
        else await options.write(id, { quote: entry.origin.quote, financials: entry.origin.financials })
      } catch (err) {
        entry.status = 'error'
        entry.error = describeError(err)
        notify()
        return
      }
    }
    resetToSource(entry)
    entry.changedThisSession = false
    entry.savedThisSession = false
    notify()
  }

  function pendingIds(): string[] {
    return [...entries.entries()].filter(([, entry]) => entry.dirty).map(([id]) => id)
  }

  function forget(id: string) {
    const drop = parseDocId(id).variantId === null ? ofProject(id) : (key: string) => key === id
    for (const [key, entry] of [...entries.entries()]) {
      if (!drop(key)) continue
      cancelTimer(entry)
      entries.delete(key)
    }
    notify()
  }

  return {
    get,
    state,
    edit,
    flush,
    flushAll,
    flushProject,
    confirmReplace,
    discard,
    restoreSession,
    pendingIds,
    forget,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    version: () => version,
  }
}
