/**
 * OKLCH → sRGB, gamut i kontrast WCAG.
 *
 * Paleta kalendarza jest definiowana w OKLCH (równa jasność między odcieniami),
 * ale ekran wyświetla sRGB. Zbyt duże nasycenie przeglądarka obcina, a wtedy
 * odcień „płynie". `fitOklch` przycina nasycenie do granicy gamutu dla danej
 * jasności i odcienia, więc każdy kolor wygląda tak, jak go zaprojektowano.
 * Moduł czysty — testy w `oklch.test.ts`.
 */

export type Oklch = readonly [l: number, c: number, h: number]

/** OKLCH → liniowe sRGB (bez przycinania; wartości spoza 0–1 = poza gamutem). */
export function oklchToLinearSrgb([l, c, h]: Oklch): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180)
  const b = c * Math.sin((h * Math.PI) / 180)
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ]
}

const EPS = 1e-4

export function inSrgbGamut(color: Oklch): boolean {
  return oklchToLinearSrgb(color).every((v) => v >= -EPS && v <= 1 + EPS)
}

/** Największe nasycenie mieszczące się w sRGB przy danej jasności i odcieniu. */
export function maxChroma(l: number, h: number): number {
  let lo = 0
  let hi = 0.4
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (inSrgbGamut([l, mid, h])) lo = mid
    else hi = mid
  }
  return lo
}

/** Kolor z nasyceniem przyciętym do gamutu (z 2% zapasu na zaokrąglenia). */
export function fitColor(l: number, c: number, h: number): Oklch {
  return [l, Math.min(c, maxChroma(l, h) * 0.98), h]
}

export function toCss([l, c, h]: Oklch): string {
  return `oklch(${+l.toFixed(3)} ${+c.toFixed(4)} ${h})`
}

/** Skrót: dopasuj do gamutu i zwróć jako CSS. */
export function fitOklch(l: number, c: number, h: number): string {
  return toCss(fitColor(l, c, h))
}

/** Luminancja względna WCAG (liniowe sRGB, przycięte do 0–1). */
export function relativeLuminance(color: Oklch): number {
  const [r, g, b] = oklchToLinearSrgb(color).map((v) => Math.min(1, Math.max(0, v)))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Kontrast WCAG 2.x (1–21). */
export function contrastRatio(a: Oklch, b: Oklch): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}
