/**
 * Harmonogram dnia w call sheecie (T5b) — kształt z CallSheetWiz
 * (`PlannerEvent`, `EventSubItem`, `Category`, `SavedDay`), tu jako schematy
 * Zod w stylu huba: `.passthrough()`, uszkodzony wpis listy znika, reszta
 * zostaje, nowe pola tylko opcjonalne.
 *
 * Czasy to minuty od północy (`time.ts`). Dwie zmiany względem CallSheetWiz:
 *  - kolor tagu to KLUCZ slotu palety kalendarza (`'cyan'`), nie hex (plan
 *    §3.4 reguła 7). Hex z importu starego pliku zamienia się na najbliższy
 *    slot (`paletteKeyForHex`), oryginał zostaje w `importedColor`;
 *  - wpisy harmonogramu i tagi usuwa się MIĘKKO (`deletedAt`), więc „Cofnij"
 *    przywraca dokładnie to, co zniknęło, a nic nie przepada.
 *
 * Moduł czysty: bez Reacta i zapisu.
 */

import { z } from 'zod'
import { PROJECT_COLOR_HUES, PROJECT_COLOR_KEYS, projectTile, type ProjectColorKey, type TileColors } from './calendar-palette'

/** Tablica, w której uszkodzony element znika, a reszta zostaje. */
export function lenientList<S extends z.ZodTypeAny>(schema: S) {
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

const optionalText = z.string().optional().catch(undefined)

// ── Schematy ─────────────────────────────────────────────────────────────────

/** Punkt do odhaczenia pod wpisem („ujęcie", „packshot", „B-roll"). */
export const eventSubItemSchema = z
  .object({
    id: z.string().min(1),
    text: z.string().catch(''),
    isCompleted: z.boolean().catch(false),
  })
  .passthrough()
export type EventSubItem = z.infer<typeof eventSubItemSchema>

/** Wpis harmonogramu. Czas = minuty od północy; bez liczb wpis nie ma sensu i znika. */
export const plannerEventSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().catch(''),
    startMinutes: z.number().finite(),
    endMinutes: z.number().finite(),
    /** Id tagu; '' = bez tagu (szary). */
    categoryId: z.string().catch(''),
    notes: optionalText,
    subItems: lenientList(eventSubItemSchema).optional(),
    /** Miękkie usunięcie (ISO); „Cofnij" zdejmuje znacznik. */
    deletedAt: optionalText,
  })
  .passthrough()
export type PlannerEvent = z.infer<typeof plannerEventSchema>

/** Tag (dział): „Kamera", „Obsada". `color` = klucz slotu palety kalendarza. */
export const categorySchema = z
  .object({
    id: z.string().min(1),
    label: z.string().catch(''),
    color: z.string().catch(''),
    /** Hex z CallSheetWiz, gdy tag przyszedł z importu. */
    importedColor: optionalText,
    deletedAt: optionalText,
  })
  .passthrough()
export type Category = z.infer<typeof categorySchema>

// ── Domyślne tagi ────────────────────────────────────────────────────────────

/** Tagi nowego call sheetu — działy z CallSheetWiz po polsku, plus przerwy. */
export const DEFAULT_CATEGORIES: readonly Category[] = [
  { id: 'camera', label: 'Kamera', color: 'cyan' },
  { id: 'talent', label: 'Obsada', color: 'magenta' },
  { id: 'art', label: 'Scenografia', color: 'violet' },
  { id: 'logistics', label: 'Logistyka', color: 'lime' },
  { id: 'meals', label: 'Przerwy', color: 'amber' },
]

/** Kolory do wyboru przy nowym tagu (kolejność koła barw). */
export const TAG_COLOR_KEYS: readonly ProjectColorKey[] = PROJECT_COLOR_KEYS

// ── Kolory ───────────────────────────────────────────────────────────────────

function srgbToLinear(channel: number): number {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** Hex `#rrggbb` → OKLCH [L, C, h°]; `null` dla czegoś, co nie jest hexem. */
export function hexToOklch(hex: string): [number, number, number] | null {
  const normalized = hex.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null
  const value = parseInt(normalized, 16)
  const r = srgbToLinear((value >> 16) & 255)
  const g = srgbToLinear((value >> 8) & 255)
  const b = srgbToLinear(value & 255)
  // sRGB liniowe → OKLab (Björn Ottosson)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  const C = Math.sqrt(A * A + B * B)
  const h = ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360
  return [L, C, h]
}

/**
 * Najbliższy odcieniem slot palety dla koloru z CallSheetWiz. Kolor prawie
 * szary (bez odcienia) → `null`, czyli neutralny tag.
 */
export function paletteKeyForHex(hex: string): ProjectColorKey | null {
  const color = hexToOklch(hex)
  if (!color || color[1] < 0.05) return null
  const hue = color[2]
  let best: ProjectColorKey | null = null
  let bestDistance = Infinity
  for (const key of PROJECT_COLOR_KEYS) {
    const raw = Math.abs(PROJECT_COLOR_HUES[key] - hue)
    const distance = Math.min(raw, 360 - raw)
    if (distance < bestDistance) {
      best = key
      bestDistance = distance
    }
  }
  return best
}

export interface TagStyle {
  label: string
  /** Kafel na osi czasu: ciemne tło, jasna krawędź, jasny tekst (jak w kalendarzu). */
  tile: TileColors
}

/**
 * Wygląd tagu. Brak tagu, nieznany albo usunięty tag → neutralny „bez tagu".
 * Klucz spoza palety (np. hex z importu, którego nie zamieniono) też daje
 * neutralny kafel zamiast błędu.
 */
export function tagStyle(category: Pick<Category, 'label' | 'color' | 'deletedAt'> | null | undefined): TagStyle {
  if (!category || category.deletedAt) return { label: 'Bez tagu', tile: projectTile(null) }
  return { label: category.label.trim() || 'Bez nazwy', tile: projectTile(category.color) }
}

// ── Plik CallSheetWiz ────────────────────────────────────────────────────────

/** Dzień zapisany w CallSheetWiz (`SavedDay`) — eksport „Export all" albo pojedynczy dzień. */
export interface SavedDay {
  id: string
  dayTitle: string
  /** ISO, w CallSheetWiz zapisywane w lokalne południe. */
  date: string
  events: PlannerEvent[]
  categories: Category[]
}
