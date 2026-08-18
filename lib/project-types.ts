/**
 * Model danych "Project Hub" (v3).
 *
 * Projekt jest NADZBIOREM wyceny: opakowuje istniejący `QuoteSnapshot` zamiast
 * go przepisywać, więc kalkulator działa bez zmian, a stare zapisy migrują
 * jeden do jednego (patrz `project-migration.ts`).
 *
 * Ten moduł musi zostać CZYSTY — bez importów Tauri/React — bo korzystają z
 * niego funkcje liczące i testy (`node --test`). Warstwa zapisu żyje osobno w
 * `project-library.ts`, `equipment-catalog.ts` i `finances-store.ts`.
 */

import { z } from 'zod'
import type { QuoteSnapshot } from './quote-library'

/** Wersja schematu plików danych v3. Podnosimy przy każdej zmianie łamiącej. */
export const PROJECT_SCHEMA_VERSION = 1 as const

// ── Statusy ──────────────────────────────────────────────────────────────────

/**
 * `quote` — sama wycena, nie wiadomo czy wejdzie
 * `won`   — klient zaakceptował, projekt w realizacji
 * `done`  — zrealizowany i rozliczony
 * `lost`  — wycena odrzucona
 */
export const PROJECT_STATUSES = ['quote', 'won', 'done', 'lost'] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  quote: 'Wycena',
  won: 'W realizacji',
  done: 'Zrealizowany',
  lost: 'Nieprzyjęta',
}

/**
 * Czy projekt wlicza się do wyników firmy. Wyceny (`quote`) i przegrane
 * (`lost`) są tylko hipotezami — nigdy nie zasilają przychodu ani ROI sprzętu.
 */
export function countsTowardRevenue(status: ProjectStatus): boolean {
  return status === 'won' || status === 'done'
}

/** Filtry listy projektów z notatek: „tylko projekty / też wyceny / tylko wyceny". */
export const PROJECT_FILTERS = ['all', 'projects', 'quotes'] as const
export type ProjectFilter = (typeof PROJECT_FILTERS)[number]

export function matchesFilter(status: ProjectStatus, filter: ProjectFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'projects') return status === 'won' || status === 'done'
  return status === 'quote' || status === 'lost'
}

// ── Sprzęt ───────────────────────────────────────────────────────────────────

export const EQUIPMENT_CATEGORIES = ['kamery', 'swiatlo', 'dzwiek', 'inne'] as const
export type EquipmentCategory = (typeof EQUIPMENT_CATEGORIES)[number]

export const EQUIPMENT_CATEGORY_LABELS: Record<EquipmentCategory, string> = {
  kamery: 'Kamery',
  swiatlo: 'Światło',
  dzwiek: 'Dźwięk',
  inne: 'Inne',
}

export const equipmentItemSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  category: z.enum(EQUIPMENT_CATEGORIES).catch('inne'),
  /** Cena zakupu (PLN netto). 0 = nieznana / sprzęt nie własny. */
  purchasePrice: z.number().finite().nonnegative().catch(0),
  /** Średnia cena rentalowa za dzień (PLN netto) — podstawa wyceny ROI. */
  rentalDayRate: z.number().finite().nonnegative().catch(0),
  /** ISO YYYY-MM-DD; pusty = nieznana. */
  purchaseDate: z.string().catch(''),
  notes: z.string().catch(''),
})
export type EquipmentItem = z.infer<typeof equipmentItemSchema>

/** Użycie sprzętu w projekcie. Trzymane PRZY projekcie — brak osieroconych relacji. */
export const projectEquipmentUsageSchema = z.object({
  itemId: z.string().min(1),
  /** Liczba dni na planie. */
  days: z.number().finite().nonnegative().catch(0),
})
export type ProjectEquipmentUsage = z.infer<typeof projectEquipmentUsageSchema>

// ── Koszty stałe firmy ───────────────────────────────────────────────────────

export const FIXED_COST_TYPES = ['zus', 'marketing', 'other'] as const
export type FixedCostType = (typeof FIXED_COST_TYPES)[number]

export const FIXED_COST_TYPE_LABELS: Record<FixedCostType, string> = {
  zus: 'ZUS',
  marketing: 'Marketing',
  other: 'Inne',
}

export const fixedCostSchema = z.object({
  id: z.string().min(1),
  /** Miesiąc rozliczeniowy w formacie YYYY-MM. */
  month: z.string().regex(/^\d{4}-\d{2}$/, 'oczekiwano YYYY-MM'),
  type: z.enum(FIXED_COST_TYPES).catch('other'),
  label: z.string().catch(''),
  amount: z.number().finite().catch(0),
  /**
   * Skąd pochodzi pozycja. `ksef` zarezerwowane pod przyszłą integrację z
   * KSeF — dzięki temu import faktur nie będzie wymagał migracji schematu.
   */
  source: z.enum(['manual', 'ksef']).catch('manual'),
})
export type FixedCost = z.infer<typeof fixedCostSchema>

// ── Wynik finansowy projektu ─────────────────────────────────────────────────

/**
 * Zdenormalizowany wynik finansowy projektu.
 *
 * Świadomie ZAMROŻONY: liczby są przeliczane przy edycji wyceny i zapisywane,
 * a nie liczone na nowo przy każdym otwarciu raportu. Gdyby raport liczył z
 * cennika, zmiana stawek zmieniałaby wstecznie zeszłoroczne wyniki — księga
 * finansowa musi być stabilna. `computedAt` mówi, kiedy zdjęto migawkę.
 */
export const projectFinancialsSchema = z.object({
  sumaNetto: z.number().finite().catch(0),
  koszty: z.number().finite().catch(0),
  podatek: z.number().finite().catch(0),
  zysk: z.number().finite().catch(0),
  marzaPct: z.number().finite().catch(0),
  computedAt: z.string().catch(''),
})
export type ProjectFinancials = z.infer<typeof projectFinancialsSchema>

// ── Projekt ──────────────────────────────────────────────────────────────────

/**
 * Migawka wyceny przechodzi przez walidację NIETKNIĘTA (passthrough).
 * Nigdy nie odrzucamy ani nie obcinamy danych wyceny użytkownika — nawet gdy
 * pochodzą ze starszej wersji o nieznanym kształcie.
 */
const quoteSnapshotPassthrough = z.custom<QuoteSnapshot>(
  (value) => !!value && typeof value === 'object'
)

export const projectSchema = z.object({
  id: z.string().min(1),
  name: z.string().catch(''),
  client: z.string().catch(''),
  status: z.enum(PROJECT_STATUSES).catch('quote'),
  /**
   * Data księgowa projektu (ISO YYYY-MM-DD) — po niej agregujemy kwartały i
   * lata. Domyślnie dzień utworzenia, edytowalna (zdjęcia bywają w innym
   * miesiącu niż wycena).
   */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'oczekiwano YYYY-MM-DD'),
  createdAt: z.string().catch(''),
  updatedAt: z.string().catch(''),
  quote: quoteSnapshotPassthrough,
  financials: projectFinancialsSchema.nullable().catch(null),
  equipment: z.array(projectEquipmentUsageSchema).catch([]),
  /** Wnioski / lessons learned z projektu. */
  notes: z.string().catch(''),
  /**
   * Id wyceny, z której projekt powstał podczas migracji do v3.
   *
   * MUSI być częścią schematu: `z.object` domyślnie obcina nieznane klucze, a
   * bez tego pola migracja przestaje być idempotentna i przy każdym starcie
   * duplikuje całą bibliotekę.
   */
  migratedFromQuoteId: z.string().optional().catch(undefined),
})
export type Project = z.infer<typeof projectSchema>

// ── Identyfikatory (idiom z quote-library.ts) ────────────────────────────────

function randomSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function createProjectId(): string {
  return `p-${randomSuffix()}`
}

export function createEquipmentId(): string {
  return `eq-${randomSuffix()}`
}

export function createFixedCostId(): string {
  return `fc-${randomSuffix()}`
}

// ── Pomocnicze ───────────────────────────────────────────────────────────────

/** `Date` → `YYYY-MM-DD` w czasie LOKALNYM (toISOString przesuwa dobę w PL). */
export function toDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** `YYYY-MM-DD` → `YYYY-MM`; pusty string dla niepoprawnego wejścia. */
export function toMonthKey(dateKey: string): string {
  return /^\d{4}-\d{2}/.test(dateKey) ? dateKey.slice(0, 7) : ''
}

/** Rok z `YYYY-...`; `null` gdy nie da się odczytać. */
export function toYear(dateKey: string): number | null {
  const m = dateKey.match(/^(\d{4})/)
  return m ? Number(m[1]) : null
}

/** Kwartał 1–4 z `YYYY-MM-...`; `null` gdy nie da się odczytać. */
export function toQuarter(dateKey: string): number | null {
  const m = dateKey.match(/^\d{4}-(\d{2})/)
  if (!m) return null
  const month = Number(m[1])
  if (month < 1 || month > 12) return null
  return Math.floor((month - 1) / 3) + 1
}
