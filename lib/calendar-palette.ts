/**
 * Paleta kalendarza — dwa niezależne kanały koloru.
 *
 *   PROJEKT  → przygaszony kafel z kolorową krawędzią (tło niskiej jasności)
 *   TYP      → mały pełny „chip" z ciemnym tekstem (wysoka jasność)
 *
 * Kanały różnią się FORMĄ i jasnością, nie tylko odcieniem, więc nawet
 * pomarańczowy chip „zdjęcia" na pomarańczowym kaflu projektu pozostaje
 * czytelny. Typ jest zawsze dodatkowo podpisany słowem — znaczenie nigdy nie
 * zależy od samego koloru.
 *
 * Projekt zapisuje KLUCZ slotu (`'amber'`), nie hex — paletę można
 * przeprojektować bez migracji danych. Moduł czysty: bez React/Tauri.
 */

// ── Projekty: 12 slotów co ~30° odcienia w OKLCH ─────────────────────────────

/**
 * [odcień, nasycenie tła kafla, nasycenie krawędzi]. Nasycenie jest strojone
 * per odcień, bo zakres sRGB w OKLCH jest nierówny: turkus i cyjan przy ciemnym
 * tle mieszczą dużo mniej chromy niż fiolet. Wartości tuż pod granicą gamutu —
 * przeglądarka nic nie obcina, więc odcień nie „płynie".
 */
const PROJECT_COLORS = {
  coral: [25, 0.065, 0.14],
  orange: [55, 0.065, 0.14],
  amber: [80, 0.06, 0.14],
  lemon: [105, 0.06, 0.14],
  lime: [130, 0.065, 0.14],
  green: [155, 0.065, 0.14],
  teal: [185, 0.05, 0.125],
  cyan: [215, 0.05, 0.125],
  blue: [250, 0.065, 0.13],
  violet: [290, 0.065, 0.14],
  magenta: [325, 0.065, 0.14],
  rose: [355, 0.065, 0.14],
} as const satisfies Record<string, readonly [number, number, number]>

export type ProjectColorKey = keyof typeof PROJECT_COLORS

/** Odcień slotu — do próbek i wykresów. */
export const PROJECT_COLOR_HUES = Object.fromEntries(
  Object.entries(PROJECT_COLORS).map(([key, [hue]]) => [key, hue])
) as Record<ProjectColorKey, number>
export const PROJECT_COLOR_KEYS = Object.keys(PROJECT_COLOR_HUES) as ProjectColorKey[]

/**
 * Kolejność przydziału nowym projektom: krok 5 po kole barw (5 i 12 są
 * względnie pierwsze), więc kolejne projekty dostają odległe odcienie, a po
 * 12 projektach każdy slot był użyty dokładnie raz.
 */
export const PROJECT_COLOR_ORDER: ProjectColorKey[] = PROJECT_COLOR_KEYS.map(
  (_, i) => PROJECT_COLOR_KEYS[(i * 5) % PROJECT_COLOR_KEYS.length]
)

/** Najmniej używany slot (remis → pierwszy w kolejności przydziału). */
export function nextProjectColor(used: readonly string[]): ProjectColorKey {
  const counts = new Map<string, number>()
  used.forEach((key) => counts.set(key, (counts.get(key) ?? 0) + 1))
  let best = PROJECT_COLOR_ORDER[0]
  let bestCount = Infinity
  for (const key of PROJECT_COLOR_ORDER) {
    const count = counts.get(key) ?? 0
    if (count < bestCount) {
      best = key
      bestCount = count
    }
  }
  return best
}

export function isProjectColorKey(key: unknown): key is ProjectColorKey {
  return typeof key === 'string' && key in PROJECT_COLORS
}

/** FNV-1a — krótki, deterministyczny skrót id (bez zależności). */
function hashId(id: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/**
 * Kolor projektu: zapisany slot, a gdy go brak (projekty sprzed kalendarza,
 * import) — slot wyliczony ze skrótu id. Skrót jest STABILNY: kolor starego
 * projektu nie zmienia się, gdy dochodzą nowe. Pierwszy zapis projektu go utrwala.
 */
export function projectColorFor(project: { id: string; colorKey?: string | null }): ProjectColorKey {
  if (isProjectColorKey(project.colorKey)) return project.colorKey
  return PROJECT_COLOR_KEYS[hashId(project.id) % PROJECT_COLOR_KEYS.length]
}

export interface TileColors {
  /** Tło kafla — ciemne, nasycone na tyle, by odróżnić projekty. */
  bg: string
  /** Lewa krawędź kafla i próbka koloru projektu w legendach. */
  edge: string
  /** Tekst nazwy projektu na kaflu. */
  text: string
}

/** Kafel dla wydarzeń bez projektu (zakup sprzętu, marketing). */
export const NEUTRAL_TILE: TileColors = {
  bg: 'oklch(0.25 0.006 260)',
  edge: 'oklch(0.58 0.01 260)',
  text: 'oklch(0.9 0.006 260)',
}

/** Nieznany klucz (np. z nowszej wersji aplikacji) → kafel neutralny, nie błąd. */
export function projectTile(key: string | null | undefined): TileColors {
  const slot = key ? PROJECT_COLORS[key as ProjectColorKey] : undefined
  if (!slot) return NEUTRAL_TILE
  const [hue, bgChroma, edgeChroma] = slot
  return {
    bg: `oklch(0.3 ${bgChroma} ${hue})`,
    edge: `oklch(0.74 ${edgeChroma} ${hue})`,
    text: `oklch(0.94 0.025 ${hue})`,
  }
}

// ── Typy wydarzeń: 5 grup + „inne" ───────────────────────────────────────────

export const EVENT_GROUPS = ['sprzedaz', 'produkcja', 'post', 'pieniadze', 'firma', 'inne'] as const
export type EventGroup = (typeof EVENT_GROUPS)[number]

export const EVENT_GROUP_LABELS: Record<EventGroup, string> = {
  sprzedaz: 'Sprzedaż',
  produkcja: 'Produkcja',
  post: 'Postprodukcja',
  pieniadze: 'Pieniądze',
  firma: 'Firma',
  inne: 'Inne',
}

/**
 * Odcienie grup dobrane znaczeniowo: zdjęcia = pomarańcz marki (najważniejszy
 * dzień w projekcie), pieniądze = zieleń, sprzedaż = róż (maile, jak w
 * notatkach), postprodukcja = fiolet (praca przy ekranie), firma = chłodny cyjan.
 */
const GROUP_COLORS: Record<EventGroup, readonly [hue: number, chroma: number] | null> = {
  sprzedaz: [350, 0.12],
  produkcja: [55, 0.12],
  post: [295, 0.1],
  pieniadze: [155, 0.13],
  firma: [215, 0.13],
  inne: null,
}

export interface ChipColors {
  bg: string
  text: string
}

export function groupChip(group: EventGroup): ChipColors {
  const color = GROUP_COLORS[group]
  if (!color) return { bg: 'oklch(0.78 0 0)', text: 'oklch(0.2 0 0)' }
  const [hue, chroma] = color
  return {
    bg: `oklch(0.81 ${chroma} ${hue})`,
    text: `oklch(0.2 0.035 ${hue})`,
  }
}
