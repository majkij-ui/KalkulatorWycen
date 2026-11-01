/**
 * Parser sekcji „Źródło" z maila ze strony (lib/lead-source.ts po stronie
 * NonoiseMedia website). Czysta funkcja: używa jej pole „wklej Źródło" w
 * formularzu leada, a skill `przejrzyj-poczte` zapisuje te same pola w
 * `lead_in.data.ads`.
 *
 * Czytamy po ETYKIETACH, nigdy po pozycji, bo strona pomija puste wiersze.
 * Akceptujemy dwa kształty wklejki: `ETYKIETA<tab / spacje / dwukropek>wartość`
 * w jednej linii oraz etykietę i wartość w osobnych liniach. Wielkość liter i
 * polskie znaki w etykietach nie mają znaczenia (strona pokazuje je wielkimi
 * literami przez CSS, w tekście maila bywają małe).
 */

import { CLICK_ID_PATTERN, type AdConsent } from './marketing-types'

export interface ParsedLeadSource {
  leadId?: string
  fromAds?: boolean
  gclid?: string
  gbraid?: string
  wbraid?: string
  /** Czas lokalny `YYYY-MM-DDTHH:mm:ss` (Europe/Warsaw). */
  clickedAt?: string
  submittedAt?: string
  consent?: AdConsent
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  utmTerm?: string
  landingPath?: string
  email?: string
  phone?: string
  /** Rzeczy, które trzeba poprawić ręcznie (nieprawidłowy click id, nieczytelny czas). */
  problems: string[]
}

type Field = Exclude<keyof ParsedLeadSource, 'problems'>

/** Etykiety po złożeniu (małe litery, bez polskich znaków). */
const LABELS: [Field, RegExp][] = [
  ['leadId', /^lead[\s_-]*id/],
  ['fromAds', /^z[\s_-]*reklamy/],
  ['gclid', /^gclid/],
  ['gbraid', /^gbraid/],
  ['wbraid', /^wbraid/],
  ['email', /^e[\s_-]?mail/],
  ['phone', /^telefon/],
  ['clickedAt', /^klikniecie/],
  ['submittedAt', /^wyslano/],
  ['utmSource', /^utm[\s_-]*source/],
  ['utmMedium', /^utm[\s_-]*medium/],
  ['utmCampaign', /^utm[\s_-]*campaign/],
  ['utmTerm', /^utm[\s_-]*term/],
  ['landingPath', /^strona[\s_-]*wejscia/],
  ['consent', /^zgoda[\s_-]*ad[\s_-]*storage/],
]

const CLICK_IDS = ['gclid', 'gbraid', 'wbraid'] as const

const FIELD_LABEL: Record<Field, string> = {
  leadId: 'Lead ID',
  fromAds: 'Z reklamy',
  gclid: 'gclid',
  gbraid: 'gbraid',
  wbraid: 'wbraid',
  clickedAt: 'Kliknięcie',
  submittedAt: 'Wysłano',
  consent: 'Zgoda ad_storage',
  utmSource: 'utm_source',
  utmMedium: 'utm_medium',
  utmCampaign: 'utm_campaign',
  utmTerm: 'utm_term',
  landingPath: 'Strona wejścia',
  email: 'E-mail',
  phone: 'Telefon',
}

const POLISH: Record<string, string> = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' }

/** Małe litery bez polskich znaków; długość się nie zmienia (indeksy zgadzają się z oryginałem). */
function fold(text: string): string {
  return text.replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, (c) => POLISH[c.toLowerCase()]).toLowerCase()
}

/** Etykieta na początku linii: `[pole, reszta linii]`, gdy po etykiecie jest koniec, odstęp, `:` albo `=`. */
function matchLabel(line: string): [Field, string] | null {
  const folded = fold(line)
  for (const [field, pattern] of LABELS) {
    const match = pattern.exec(folded)
    if (!match) continue
    const rest = line.slice(match[0].length)
    if (rest !== '' && !/^[\s:=]/.test(rest)) continue
    return [field, rest.replace(/^[\s:=]+/, '').trim()]
  }
  return null
}

const HEADING = /^\W*zrodlo\W*$/

const pad = (n: number) => String(n).padStart(2, '0')

/** Czas lokalny `YYYY-MM-DDTHH:mm:ss`, jeśli data i godzina istnieją naprawdę. */
function localTime(date: string, time: string): string | null {
  const [y, mo, d] = date.split('-').map(Number)
  const [h, mi, s = 0] = time.split(':').map(Number)
  const probe = new Date(Date.UTC(y, mo - 1, d, h, mi, s))
  const ok =
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === mo - 1 &&
    probe.getUTCDate() === d &&
    probe.getUTCHours() === h &&
    probe.getUTCMinutes() === mi &&
    probe.getUTCSeconds() === s
  return ok ? `${date}T${pad(h)}:${pad(mi)}:${pad(s)}` : null
}

function warsawLocal(date: Date): string | null {
  if (Number.isNaN(date.getTime())) return null
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Warsaw',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date)
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`
  } catch {
    return null
  }
}

/**
 * `2026-10-31 14:22:19 Europe/Warsaw` → `2026-10-31T14:22:19`.
 * Awaryjny zapis strony to ISO w UTC (`...Z`) — przeliczamy go na czas warszawski.
 */
export function parseSourceTime(value: string): string | null {
  const text = value.trim()
  const local = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)(?:\s*Europe\/Warsaw)?$/.exec(text)
  if (local) return localTime(local[1], local[2])
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
    return warsawLocal(new Date(text))
  }
  return null
}

function parseConsent(value: string): AdConsent {
  const folded = fold(value.trim())
  return folded === 'granted' || folded === 'denied' ? folded : 'unknown'
}

function parseYesNo(value: string): boolean | undefined {
  const folded = fold(value.trim())
  if (['tak', 'yes', 'true'].includes(folded)) return true
  if (['nie', 'no', 'false'].includes(folded)) return false
  return undefined
}

/**
 * Pola sekcji „Źródło" z wklejonego maila. Gdy jest nagłówek „ŹRÓDŁO",
 * czytamy tylko to, co po jego ostatnim wystąpieniu (treść wiadomości może
 * wspominać „e-mail"); bez nagłówka czytamy całość. Brak sekcji → `null`.
 */
export function parseLeadSource(text: string): ParsedLeadSource | null {
  if (typeof text !== 'string') return null
  const lines = text
    .normalize('NFC')
    .replace(/[ ​]/g, ' ')
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())

  let start = 0
  lines.forEach((line, index) => {
    if (HEADING.test(fold(line))) start = index + 1
  })

  const raw = new Map<Field, string>()
  for (let i = start; i < lines.length; i += 1) {
    if (!lines[i]) continue
    const hit = matchLabel(lines[i])
    if (!hit) continue
    let [field, value] = hit
    if (!value) {
      // Kształt „etykieta, potem wartość w następnej linii" (puste linie pomijamy).
      let next = i + 1
      while (next < lines.length && !lines[next]) next += 1
      if (next < lines.length) {
        value = lines[next]
        i = next
      }
    }
    if (value) raw.set(field, value)
  }
  if (raw.size === 0) return null

  const result: ParsedLeadSource = { problems: [] }
  const copyText = (field: Field) => {
    const value = raw.get(field)
    if (value) (result as unknown as Record<string, unknown>)[field] = value
  }
  ;(['leadId', 'utmSource', 'utmMedium', 'utmCampaign', 'utmTerm', 'landingPath', 'email', 'phone'] as const).forEach(copyText)

  CLICK_IDS.forEach((field) => {
    const value = raw.get(field)
    if (!value) return
    if (CLICK_ID_PATTERN.test(value)) result[field] = value
    else {
      const shown = value.length > 24 ? `${value.slice(0, 24)}…` : value
      result.problems.push(`${FIELD_LABEL[field]}: nieprawidłowy format („${shown}"), nie zapisano. Sprawdź, czy wklejono go w całości`)
    }
  })

  ;(['clickedAt', 'submittedAt'] as const).forEach((field) => {
    const value = raw.get(field)
    if (!value) return
    const time = parseSourceTime(value)
    if (time) result[field] = time
    else result.problems.push(`${FIELD_LABEL[field]}: nie rozpoznano czasu („${value.slice(0, 40)}"), pominięto`)
  })

  const consent = raw.get('consent')
  if (consent) result.consent = parseConsent(consent)

  // Z reklamy: „tak" albo jakikolwiek click id w mailu (także źle przepisany).
  const anyClickId = CLICK_IDS.some((field) => raw.has(field))
  const flag = raw.has('fromAds') ? parseYesNo(raw.get('fromAds') as string) : undefined
  if (anyClickId || flag === true) result.fromAds = true
  else if (flag === false) result.fromAds = false

  return result
}
