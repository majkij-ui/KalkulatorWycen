/**
 * Call sheet dnia realizacji (T5b) — rekord w `call-sheets.json`.
 *
 * Powiązanie: `CallSheet.dayId` → `Project.gearDays[].id` (dzień realizacji),
 * tak samo jak `ProjectCost.dayId`. Dzień wskazuje swoje wydarzenie w
 * kalendarzu (`eventId` + `eventDay`), więc wielodniowe zdjęcia mają osobny
 * call sheet na każdy dzień, a przesunięcie zdjęć w kalendarzu przenosi call
 * sheet razem z dniem. (Plan zakładał `shoot_day.data.callSheetId` — jedno
 * pole na całe wydarzenie nie pomieściłoby call sheetu na każdy dzień i nie
 * działałoby dla dni bez daty; patrz plan „T5b as built".)
 *
 * Call sheet trzyma TYLKO to, czego hub nie wie: harmonogram, tagi, godzinę
 * zbiórki, uwagi i własne poprawki. Data, miejsce, ekipa z telefonami, sprzęt
 * dnia i kontakt do klienta czyta się na żywo z kalendarza, Realizacji, bazy
 * Ekipa, siatki sprzętu i projektu (`call-sheet.ts`). Pole wpisane tutaj
 * WYGRYWA z tym, co podpowiada hub — hub nigdy go nie nadpisze, a call sheet
 * niczego w hubie nie zmienia.
 *
 * Wszystko `.passthrough()`, nowe pola tylko opcjonalne, usuwanie miękkie
 * (`deletedAt`) — także wpisów harmonogramu, tagów, osób i kontaktów.
 */

import { z } from 'zod'
import { categorySchema, lenientList, plannerEventSchema } from './schedule-types'

const optionalText = z.string().optional().catch(undefined)
const optionalId = z.string().min(1).optional().catch(undefined)
/** Godzina jako minuty od północy. */
const optionalMinutes = z.number().int().min(0).max(1439).optional().catch(undefined)
const optionalFlag = z.boolean().optional().catch(undefined)

/**
 * Osoba na call sheecie. Z `costId` to poprawka wiersza ekipy dnia z
 * Realizacji (puste pole = wartość z Realizacji / bazy Ekipa); bez `costId` to
 * osoba dopisana tylko tutaj (np. ktoś od klienta, kierowca agencji).
 */
export const callSheetCrewSchema = z
  .object({
    id: z.string().min(1),
    /** `ProjectCost.id` wiersza ekipy tego dnia. */
    costId: optionalId,
    name: optionalText,
    role: optionalText,
    phone: optionalText,
    email: optionalText,
    /** Własna godzina zbiórki tej osoby; brak = ogólna. */
    callTime: optionalMinutes,
    note: optionalText,
    /** Nie drukuj tej osoby (np. montażysta przypięty do dnia, ale nie na planie). */
    hidden: optionalFlag,
    deletedAt: optionalText,
  })
  .passthrough()
export type CallSheetCrewEntry = z.infer<typeof callSheetCrewSchema>

/** Dodatkowy kontakt dnia: lokacja, catering, wypożyczalnia. */
export const callSheetContactSchema = z
  .object({
    id: z.string().min(1),
    /** Kim jest dla dnia („Lokacja", „Catering"). */
    label: optionalText,
    name: optionalText,
    phone: optionalText,
    email: optionalText,
    note: optionalText,
    deletedAt: optionalText,
  })
  .passthrough()
export type CallSheetContact = z.infer<typeof callSheetContactSchema>

/** Poprawki kontaktu do klienta (pusty = z projektu). */
export const callSheetClientSchema = z
  .object({
    name: optionalText,
    phone: optionalText,
    email: optionalText,
    hidden: optionalFlag,
  })
  .passthrough()
export type CallSheetClient = z.infer<typeof callSheetClientSchema>

/** Rzecz do spakowania spoza katalogu (baterie, taśma, przedłużacze). */
export const callSheetGearExtraSchema = z
  .object({
    id: z.string().min(1),
    text: z.string().catch(''),
    deletedAt: optionalText,
  })
  .passthrough()
export type CallSheetGearExtra = z.infer<typeof callSheetGearExtraSchema>

/** Skąd przyszedł harmonogram, gdy zaimportowano dzień z CallSheetWiz. */
export const callSheetImportSchema = z
  .object({
    type: z.string().min(1),
    /** `SavedDay.id` w CallSheetWiz. */
    id: optionalText,
    title: optionalText,
    /** `SavedDay.date` (ISO) — data, którą dzień miał w CallSheetWiz. */
    date: optionalText,
    at: optionalText,
  })
  .passthrough()

export const callSheetSchema = z
  .object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    /** Dzień realizacji (`Project.gearDays[].id`). */
    dayId: z.string().min(1),
    /** Własny tytuł; brak = nazwa projektu. */
    title: optionalText,
    /** Własne miejsce; brak = miejsce z wydarzenia w kalendarzu. */
    location: optionalText,
    /** Adres, wejście, parking, piętro. */
    locationNotes: optionalText,
    /** Ogólna zbiórka ekipy; brak = początek pierwszego wpisu harmonogramu. */
    callTime: optionalMinutes,
    /** Uwagi na call sheet (pogoda, BHP, catering, dress code). */
    notes: optionalText,
    schedule: lenientList(plannerEventSchema),
    categories: lenientList(categorySchema),
    crew: lenientList(callSheetCrewSchema),
    contacts: lenientList(callSheetContactSchema),
    client: callSheetClientSchema.optional().catch(undefined),
    gearExtra: lenientList(callSheetGearExtraSchema),
    importedFrom: callSheetImportSchema.optional().catch(undefined),
    createdAt: z.string().catch(''),
    updatedAt: z.string().catch(''),
    /** Miękkie usunięcie całego call sheetu (ISO). */
    deletedAt: optionalText,
  })
  .passthrough()
export type CallSheet = z.infer<typeof callSheetSchema>

// ── Identyfikatory ───────────────────────────────────────────────────────────

function randomSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function createCallSheetId(): string {
  return `cs-${randomSuffix()}`
}

/** Id wpisu w call sheecie (harmonogram, punkt, osoba, kontakt, tag). */
export function createCallSheetItemId(prefix = 'cse'): string {
  return `${prefix}-${randomSuffix()}`
}
