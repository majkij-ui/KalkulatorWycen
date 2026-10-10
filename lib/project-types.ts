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
 * `quote` — wycena (także projekt, który jeszcze wyceny nie ma — „brak wyceny")
 * `won`   — klient zaakceptował, projekt w realizacji
 * `done`  — zrealizowany i rozliczony
 * `lost`  — wycena odrzucona
 *
 * Kolejność = etapy wątku (lista statusów w przełączniku idzie tą kolejnością).
 *
 * Statusu `lead` celowo NIE ma (decyzja 2026-10-08, był krótko w T1b): to, że
 * projekt zaczął się od zapytania, mówi wydarzenie `lead_in` w kalendarzu, a
 * lejek (ile zapytań → ile wycen → ile zleceń) liczymy z wydarzeń. Zapisane
 * wcześniej `lead` czyta się jako `quote` dzięki `.catch` w schemacie.
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
 * Czy projekt wlicza się do wyników firmy. Wyceny i przegrane są tylko
 * hipotezami — nigdy nie zasilają przychodu ani ROI sprzętu.
 */
export function countsTowardRevenue(status: ProjectStatus): boolean {
  return status === 'won' || status === 'done'
}

/**
 * Zakładki otwartego projektu (T3). Klucze na stałe, etykiety w interfejsie:
 * `sprzet` to od T5a zakładka „Realizacja" (dni, sprzęt, ekipa, koszty, plan).
 */
export const PROJECT_TABS = ['os', 'wycena', 'sprzet', 'notatki'] as const
export type ProjectTab = (typeof PROJECT_TABS)[number]

/**
 * Zakładka przy otwarciu projektu: projekt w realizacji albo zrealizowany
 * otwiera się na osi czasu (tam toczy się jego życie), wycena i nieprzyjęta —
 * w kalkulatorze (decyzja 2026-10-09).
 */
export function defaultProjectTab(status: ProjectStatus): ProjectTab {
  return countsTowardRevenue(status) ? 'os' : 'wycena'
}

/** Filtry listy projektów z notatek: „tylko projekty / też wyceny / tylko wyceny". */
export const PROJECT_FILTERS = ['all', 'projects', 'quotes'] as const
export type ProjectFilter = (typeof PROJECT_FILTERS)[number]

/**
 * `hideLost` — przełącznik „Ukryj nieprzyjęte" (domyślnie włączony): odrzucone
 * wyceny to archiwum, nie coś, co chce się przeglądać na co dzień.
 */
export function matchesFilter(
  status: ProjectStatus,
  filter: ProjectFilter,
  options: { hideLost?: boolean } = {}
): boolean {
  if (options.hideLost && status === 'lost') return false
  if (filter === 'all') return true
  if (filter === 'projects') return status === 'won' || status === 'done'
  return status === 'quote' || status === 'lost'
}

// ── Pochodzenie klienta ──────────────────────────────────────────────────────

/**
 * Skąd przyszedł klient projektu (rozwijana lista w pasku projektu, zestawienie
 * w zakładce Marketing). To cecha PROJEKTU; kanał konkretnej wiadomości (mail,
 * telefon) żyje w wydarzeniu `lead_in`. Pole `leadSource` jest wolnym stringiem
 * — klucze z listy są na zawsze, etykiety można zmieniać, nieznany klucz
 * pokazuje się dosłownie.
 */
export const LEAD_SOURCES = ['powracajacy', 'polecenie', 'networking', 'google_ads', 'inne'] as const
export type LeadSource = (typeof LEAD_SOURCES)[number]

export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  powracajacy: 'Powracający klient',
  polecenie: 'Polecenie (z ust do ust)',
  networking: 'Networking na żywo',
  google_ads: 'Google Ads',
  inne: 'Inne',
}

/** Etykieta pochodzenia; pusty string = nieustalone. */
export function leadSourceLabel(source: string | undefined | null): string {
  if (!source) return ''
  return LEAD_SOURCE_LABELS[source as LeadSource] ?? source
}

// ── Sprzęt ───────────────────────────────────────────────────────────────────

/**
 * Znane kategorie w kolejności pakowania wozu (i sekcji sprzętu dnia
 * zdjęciowego w wycenie: kamery → obiektywy → stabilizacja → podgląd → światło).
 *
 * `category` w rekordzie to WOLNY string, nie enum (zasada 4 planu): kategoria
 * dopisana przez nowszą wersję albo import przeżywa zapis w starszej i
 * pokazuje się dosłownie, zamiast po cichu zamienić się w „inne".
 */
export const EQUIPMENT_CATEGORIES = [
  'kamery',
  'obiektywy',
  'stabilizacja',
  'podglad',
  'swiatlo',
  'dzwiek',
  'zasilanie',
  'drony',
  'inne',
] as const
export type EquipmentCategory = (typeof EQUIPMENT_CATEGORIES)[number]

export const EQUIPMENT_CATEGORY_LABELS: Record<EquipmentCategory, string> = {
  kamery: 'Kamery',
  obiektywy: 'Obiektywy',
  stabilizacja: 'Stabilizacja',
  podglad: 'Podgląd',
  swiatlo: 'Światło',
  dzwiek: 'Dźwięk',
  zasilanie: 'Zasilanie',
  drony: 'Drony',
  inne: 'Inne',
}

/** Etykieta kategorii; nieznany klucz pokazuje się dosłownie. */
export function equipmentCategoryLabel(category: string): string {
  return EQUIPMENT_CATEGORY_LABELS[category as EquipmentCategory] ?? category
}

/** Pozycja kategorii w kolejności pakowania; nieznane na końcu, za „inne". */
export function equipmentCategoryRank(category: string): number {
  const index = (EQUIPMENT_CATEGORIES as readonly string[]).indexOf(category)
  return index === -1 ? EQUIPMENT_CATEGORIES.length : index
}

export const equipmentItemSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    /** Klucz z `EQUIPMENT_CATEGORIES` albo dowolny tekst. */
    category: z.string().min(1).catch('inne'),
    /** Cena zakupu JEDNEJ sztuki (PLN netto). 0 = nieznana / sprzęt nie własny. */
    purchasePrice: z.number().finite().nonnegative().catch(0),
    /** Średnia cena rentalowa JEDNEJ sztuki za dzień (PLN netto) — podstawa ROI. */
    rentalDayRate: z.number().finite().nonnegative().catch(0),
    /**
     * Ile identycznych sztuk mam (2× ta sama lampa). Brak = 1. Zainwestowane =
     * cena × sztuki; na planie liczy się tyle sztuk, ile realnie pojechało.
     */
    quantity: z.number().int().min(1).optional().catch(undefined),
    /** ISO YYYY-MM-DD; pusty = nieznana. */
    purchaseDate: z.string().catch(''),
    /**
     * Sprzedany / zepsuty (YYYY-MM-DD). Zostaje w historii i statystykach,
     * znika z list wyboru w projektach.
     */
    retiredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
    notes: z.string().catch(''),
  })
  .passthrough()
export type EquipmentItem = z.infer<typeof equipmentItemSchema>

/** Liczba posiadanych sztuk (brak pola = 1). */
export function unitsOwned(item: Pick<EquipmentItem, 'quantity'>): number {
  return item.quantity && item.quantity > 0 ? item.quantity : 1
}

/**
 * Tablica, w której uszkodzony element znika, a reszta zostaje. Zwykłe
 * `z.array(...).catch([])` wyzerowałoby CAŁĄ listę przez jeden zły wpis.
 */
function lenientArray<S extends z.ZodTypeAny>(schema: S) {
  return z
    .array(z.unknown())
    .catch([])
    .transform((list) =>
      list.flatMap((entry) => {
        const parsed = schema.safeParse(entry)
        return parsed.success ? [parsed.data as z.output<S>] : []
      })
    )
}

/** Jedna pozycja sprzętu w dniu zdjęciowym. */
export const gearLineSchema = z
  .object({
    itemId: z.string().min(1),
    /** Ile sztuk pojechało tego dnia (≥ 1). */
    qty: z.number().int().min(1).catch(1),
  })
  .passthrough()
export type GearLine = z.infer<typeof gearLineSchema>

/**
 * Dzień realizacji (zdjęciowy albo przygotowań): co realnie pojechało na plan,
 * a przez `ProjectCost.dayId` także ekipa i koszty tego dnia. To dane PROJEKTU
 * (użycie), nie wyceny (cena) — nie zmieniają kwot oferty.
 *
 * Datę dnia trzyma KALENDARZ (decyzja M.J. 2026-10-09, wariant A): dzień
 * wskazuje swoje wydarzenie (`eventId` + `eventDay`), a `date` to tylko
 * ostatnia znana data — dla dnia bez wydarzenia, po usunięciu wydarzenia i dla
 * starszej wersji aplikacji, która powiązań nie zna (`realization-days.ts`).
 */
export const gearDaySchema = z
  .object({
    id: z.string().min(1),
    /** Własna nazwa dnia; pusta = „Dzień N". */
    label: z.string().catch(''),
    /** YYYY-MM-DD albo '' — bez daty liczy się data księgowa projektu. */
    date: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/).catch(''),
    lines: lenientArray(gearLineSchema),
    /** Wydarzenie `shoot_day` / `prep_day`, które jest tym dniem. */
    eventId: z.string().min(1).optional().catch(undefined),
    /** Który dzień wydarzenia wielodniowego (0 = pierwszy); brak = 0. */
    eventDay: z.number().int().min(0).optional().catch(undefined),
    /** Typ dnia bez wydarzenia (`shoot_day` / `prep_day`); brak = zdjęciowy. */
    kind: z.string().min(1).optional().catch(undefined),
    /** Miękkie usunięcie (ISO); koszty dnia dostają ten sam znacznik. */
    deletedAt: z.string().optional().catch(undefined),
  })
  .passthrough()
export type GearDay = z.infer<typeof gearDaySchema>

/**
 * Zestaw sprzętu (G6): zapisany komplet pozycji katalogu („Wywiad", „Event"),
 * dodawany jednym klikiem do dnia wyceny albo dnia Realizacji. Trzyma tylko
 * pozycje i sztuki — ceny zawsze z katalogu w chwili użycia.
 */
/** Ekipa w zestawie (T9b): rola, opcjonalnie osoba, liczba osób. Stawki zawsze z bazy Ekipa. */
export const kitCrewLineSchema = z
  .object({
    roleId: z.string().min(1),
    personId: z.string().min(1).optional().catch(undefined),
    qty: z.number().int().min(1).catch(1),
  })
  .passthrough()
export type KitCrewLine = z.infer<typeof kitCrewLineSchema>

export const gearKitSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().catch(''),
    lines: lenientArray(gearLineSchema),
    /** Ekipa zestawu (T9b) — brak pola = zestaw tylko ze sprzętem. */
    crew: lenientArray(kitCrewLineSchema).optional(),
    createdAt: z.string().catch(''),
  })
  .passthrough()
export type GearKit = z.infer<typeof gearKitSchema>

/**
 * Użycie sprzętu w projekcie w STARYM kształcie (faza 3): pozycja × liczba dni,
 * bez podziału na dni. Wciąż czytane — projekt bez `gearDays` liczy się z tego
 * pola (`projectGearDays` w gear-usage.ts zamienia je na dni).
 */
export const projectEquipmentUsageSchema = z.object({
  itemId: z.string().min(1),
  /** Liczba dni na planie. */
  days: z.number().finite().nonnegative().catch(0),
})
export type ProjectEquipmentUsage = z.infer<typeof projectEquipmentUsageSchema>

// ── Koszty rzeczywiste projektu ──────────────────────────────────────────────

/**
 * Kategorie kosztów rzeczywistych (zakładka Realizacja). Klucze na zawsze,
 * etykiety można zmieniać; `category` w rekordzie to wolny string, nieznany
 * klucz pokazuje się dosłownie.
 */
export const COST_CATEGORIES = [
  'ekipa',
  'wynajem',
  'dojazd',
  'catering',
  'nocleg',
  'sprzet',
  'preprodukcja',
  'postprodukcja',
  'inne',
] as const
export type CostCategory = (typeof COST_CATEGORIES)[number]

export const COST_CATEGORY_LABELS: Record<CostCategory, string> = {
  ekipa: 'Ekipa',
  wynajem: 'Wynajem (sprzęt, studio, lokacja)',
  dojazd: 'Dojazd',
  catering: 'Catering',
  nocleg: 'Nocleg',
  sprzet: 'Sprzęt kupiony pod projekt',
  preprodukcja: 'Preprodukcja',
  postprodukcja: 'Postprodukcja',
  inne: 'Inne',
}

/** Etykieta kategorii kosztu; nieznany klucz pokazuje się dosłownie. */
export function costCategoryLabel(category: string): string {
  return COST_CATEGORY_LABELS[category as CostCategory] ?? category
}

/**
 * Jeden koszt rzeczywisty projektu (PLN netto): ilość × stawka. Ekipa to
 * koszt z osobą i rolą, zwykle 1 × stawka dzienna, przypięty do dnia.
 *
 * Koszty NIE zmieniają `financials` ani Finansów — to dane wejściowe dla T6
 * (plan vs rzeczywistość w Finansach). `.passthrough()` i miękkie usuwanie.
 */
export const projectCostSchema = z
  .object({
    id: z.string().min(1),
    /** Klucz z `COST_CATEGORIES` albo dowolny tekst. */
    category: z.string().min(1).catch('inne'),
    /** Stawka za jednostkę, PLN netto. */
    unitCost: z.number().finite().nonnegative().catch(0),
    // Reszta pól jest opcjonalna i bez wartości domyślnych: brakujące pole
    // zostaje brakujące, więc `npm run data` nie uzna rekordu za „poprawiony".
    /** Ilość jednostek; brak = 1 (`costAmount`). */
    quantity: z.number().finite().nonnegative().optional().catch(undefined),
    /** Opis pozycji („Wynajem studia", „Paliwo Poznań"). */
    label: z.string().optional().catch(undefined),
    /** Osoba (ekipa) — imię zamrożone w chwili wpisania, do wyświetlania. */
    person: z.string().optional().catch(undefined),
    /**
     * Osoba z bazy Ekipa (`crew.json`, T9a). Brak = wpisana tekstem; statystyki
     * dopasowują wtedy osobę po imieniu (`personKey`).
     */
    personId: z.string().min(1).optional().catch(undefined),
    /** Rola na planie (ekipa): „Operator B", „Gafer". */
    role: z.string().optional().catch(undefined),
    /** Dzień realizacji (`gearDays[].id`); brak = koszt całego projektu. */
    dayId: z.string().min(1).optional().catch(undefined),
    /** Skąd pozycja: brak = wpisana ręcznie, `plan` = przepisana z planu wyceny. */
    source: z.string().optional().catch(undefined),
    createdAt: z.string().optional().catch(undefined),
    /** Miękkie usunięcie (ISO); „Cofnij" przywraca pozycje o tym samym znaczniku. */
    deletedAt: z.string().optional().catch(undefined),
  })
  .passthrough()
export type ProjectCost = z.infer<typeof projectCostSchema>

// ── Koszty stałe firmy ───────────────────────────────────────────────────────

export const FIXED_COST_TYPES = ['zus', 'marketing', 'other'] as const
export type FixedCostType = (typeof FIXED_COST_TYPES)[number]

export const FIXED_COST_TYPE_LABELS: Record<FixedCostType, string> = {
  zus: 'ZUS',
  marketing: 'Marketing',
  other: 'Inne',
}

const optionalCount = z.number().finite().nonnegative().optional().catch(undefined)

export const fixedCostSchema = z
  .object({
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
    /**
     * Wydatek kampanii z panelu reklamowego (zakładka Marketing). Ta sama
     * pozycja liczy się w Finansach jako koszt marketingu — jedno miejsce na
     * złotówki. Kliknięcia i wyświetlenia to odczyt z panelu za ten miesiąc.
     */
    campaignId: z.string().min(1).optional().catch(undefined),
    clicks: optionalCount,
    impressions: optionalCount,
  })
  .passthrough()
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

/** Osoba kontaktowa — kopiowana z poprzedniego projektu tego samego klienta. */
export const projectContactSchema = z
  .object({
    name: z.string().catch(''),
    email: z.string().catch(''),
    phone: z.string().catch(''),
  })
  .passthrough()
export type ProjectContact = z.infer<typeof projectContactSchema>

/**
 * `.passthrough()` — pola dopisane przez nowszą wersję (albo przez import
 * Claude'a) przeżywają zapis w starszej. Nowe pola dodajemy jako opcjonalne
 * z `.catch()`, bez podbijania `PROJECT_SCHEMA_VERSION`.
 */
export const projectSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().catch(''),
    /** Klient jako cecha projektu (bez osobnej kartoteki — plan §3.2a). */
    client: z.string().catch(''),
    status: z.enum(PROJECT_STATUSES).catch('quote'),
    /**
     * Slot palety kalendarza (`'amber'`), nie hex. Brak = jeszcze nie wybrany;
     * kolor wylicza wtedy `projectColorFor` i utrwala go pierwszy zapis.
     */
    colorKey: z.string().optional().catch(undefined),
    contact: projectContactSchema.optional().catch(undefined),
    /** Klucz z `LEAD_SOURCES` albo dowolny tekst; brak = nieznane. */
    leadSource: z.string().optional().catch(undefined),
    /**
     * Data księgowa projektu (ISO YYYY-MM-DD) — po niej agregujemy kwartały i
     * lata. Domyślnie dzień utworzenia, edytowalna (zdjęcia bywają w innym
     * miesiącu niż wycena).
     */
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'oczekiwano YYYY-MM-DD'),
    createdAt: z.string().catch(''),
    updatedAt: z.string().catch(''),
    /** `null` = lead bez wyceny. Uszkodzona wartość też daje `null`, nie odrzuca projektu. */
    quote: quoteSnapshotPassthrough.nullable().catch(null),
    financials: projectFinancialsSchema.nullable().catch(null),
    /** Stary kształt użycia sprzętu; czytany tylko, gdy brak `gearDays`. */
    equipment: z.array(projectEquipmentUsageSchema).catch([]),
    /**
     * Sprzęt dzień po dniu (zakładka Sprzęt). Brak pola = projekt jeszcze w
     * starym kształcie (`equipment`); pusta lista = świadomie bez sprzętu.
     */
    gearDays: lenientArray(gearDaySchema).optional(),
    /**
     * Koszty rzeczywiste (zakładka Realizacja): ekipa, wynajem, dojazd…
     * Brak = nic jeszcze nie wpisano. Nie zmieniają `financials` (to T6).
     */
    costs: lenientArray(projectCostSchema).optional(),
    /** Wnioski / lessons learned z projektu. */
    notes: z.string().catch(''),
    /**
     * Id wyceny, z której projekt powstał podczas migracji do v3.
     *
     * Jawnie w schemacie (nie tylko dzięki `.passthrough()`): od tego pola zależy
     * idempotencja migracji — bez niego każdy start duplikowałby całą bibliotekę.
     */
    migratedFromQuoteId: z.string().optional().catch(undefined),
    /**
     * Miękkie usunięcie (ISO). Rekord zostaje w pliku: usunięcie da się cofnąć,
     * a migracja nie wskrzesza usuniętej wyceny. Wątek projektu dostaje ten
     * sam znacznik (`project-deletion.ts`).
     */
    deletedAt: z.string().optional().catch(undefined),
  })
  .passthrough()
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

export function createGearDayId(): string {
  return `gd-${randomSuffix()}`
}

export function createGearKitId(): string {
  return `kit-${randomSuffix()}`
}

export function createProjectCostId(): string {
  return `pc-${randomSuffix()}`
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
