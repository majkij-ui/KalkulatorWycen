/**
 * Klient KSeF API 2.0 TYLKO DO ODCZYTU.
 *
 * Każde żądanie przechodzi przez `READ_ONLY_ENDPOINTS`: czego nie ma na liście,
 * tego klient nie wyśle, nawet z błędu w kodzie. To drugie zabezpieczenie obok
 * tokenu z samym `InvoiceRead`, którego zakres sprawdza KSeF.
 *
 * Token nie trafia do komunikatów błędów ani do logów. Dokumentacja:
 * https://github.com/CIRFMF/ksef-docs
 *
 * Moduł działa tak samo w Node (`npm run data -- ksef-sync`) i w oknie aplikacji
 * (przycisk w Finanse → KSeF): szyfruje przez WebCrypto, bez `node:crypto`.
 */

import {
  normalizeKsefInvoice,
  type KsefDirection,
  type KsefInvoice,
  type KsefInvoiceMetadata,
} from './ksef-invoices'

export const KSEF_BASE_URLS = {
  test: 'https://api-test.ksef.mf.gov.pl/v2',
  demo: 'https://api-demo.ksef.mf.gov.pl/v2',
  prod: 'https://api.ksef.mf.gov.pl/v2',
} as const

export type KsefEnvironment = keyof typeof KSEF_BASE_URLS

const READ_ONLY_ENDPOINTS: ReadonlyArray<{ method: 'GET' | 'POST'; path: RegExp }> = [
  { method: 'GET', path: /^\/security\/public-key-certificates$/ },
  { method: 'POST', path: /^\/auth\/challenge$/ },
  { method: 'POST', path: /^\/auth\/ksef-token$/ },
  { method: 'GET', path: /^\/auth\/[\w-]+$/ },
  { method: 'POST', path: /^\/auth\/token\/redeem$/ },
  { method: 'POST', path: /^\/invoices\/query\/metadata$/ },
  { method: 'GET', path: /^\/invoices\/ksef\/[\w-]+$/ },
]

function bytesFromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = ''
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)))
  return btoa(binary)
}

/** Jeden element DER: znacznik, początek treści i koniec. */
function derElement(bytes: Uint8Array, offset: number) {
  const first = bytes[offset + 1]
  let header = 2
  let length = first
  if (first & 0x80) {
    const count = first & 0x7f
    length = 0
    for (let index = 0; index < count; index += 1) length = length * 256 + bytes[offset + 2 + index]
    header = 2 + count
  }
  return { tag: bytes[offset], start: offset, content: offset + header, end: offset + header + length }
}

/**
 * Klucz publiczny (SubjectPublicKeyInfo) z certyfikatu X.509 w DER. WebCrypto nie
 * czyta certyfikatów, a klucz leży w stałym miejscu: siódme pole danych certyfikatu
 * (po wersji, numerze, algorytmie, wystawcy, ważności i podmiocie).
 */
export function publicKeyInfoFromCertificate(certificate: Uint8Array): Uint8Array<ArrayBuffer> {
  const whole = derElement(certificate, 0)
  const data = derElement(certificate, whole.content)
  let field = derElement(certificate, data.content)
  if (field.tag === 0xa0) field = derElement(certificate, field.end)
  for (let skipped = 0; skipped < 5; skipped += 1) field = derElement(certificate, field.end)
  if (whole.tag !== 0x30 || field.tag !== 0x30 || field.end > data.end) {
    throw new Error('KSeF: nie da się odczytać klucza publicznego z certyfikatu')
  }
  return certificate.slice(field.start, field.end) as Uint8Array<ArrayBuffer>
}

/** RSA-OAEP z SHA-256 (także w MGF1), jak wymaga KSeF dla tokenu. Wynik w base64. */
export async function encryptForKsef(publicKeyInfo: Uint8Array<ArrayBuffer>, text: string): Promise<string> {
  const key = await crypto.subtle.importKey('spki', publicKeyInfo, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt'])
  const encrypted = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, key, new TextEncoder().encode(text))
  return base64FromBytes(new Uint8Array(encrypted))
}

export function isReadOnlyEndpoint(method: string, path: string): boolean {
  const pathname = path.split('?')[0]
  return READ_ONLY_ENDPOINTS.some((endpoint) => endpoint.method === method && endpoint.path.test(pathname))
}

/**
 * Czy token dostępu ma wyłącznie `InvoiceRead`. KSeF zapisuje uprawnienia w polu
 * `per` tokenu JWT jako tekst z tablicą JSON. Gdy pola nie da się odczytać,
 * odpowiedź brzmi „nie”: lepiej odmówić niż pracować z tokenem o nieznanym zakresie.
 */
export function isReadOnlyAccessToken(accessToken: string): boolean {
  try {
    const body = accessToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(new TextDecoder().decode(bytesFromBase64(body))) as { per?: unknown }
    const permissions: unknown = typeof payload.per === 'string' ? JSON.parse(payload.per) : payload.per
    return Array.isArray(permissions) && permissions.length === 1 && permissions[0] === 'InvoiceRead'
  } catch {
    return false
  }
}

export class KsefApiError extends Error {
  readonly status: number
  /** Sekundy z nagłówka `Retry-After` przy przekroczeniu limitu (429). */
  readonly retryAfter?: number

  constructor(message: string, status: number, retryAfter?: number) {
    super(message)
    this.name = 'KsefApiError'
    this.status = status
    this.retryAfter = retryAfter
  }
}

export interface KsefClientOptions {
  environment: KsefEnvironment
  nip: string
  token: string
  fetchImpl?: typeof fetch
  /** Oczekiwanie między sprawdzeniami statusu logowania. */
  sleep?: (ms: number) => Promise<void>
}

export interface ListInvoicesParams {
  direction: KsefDirection
  /** ISO 8601. Zakres dotyczy trwałego zapisu w KSeF, jak zaleca dokumentacja. */
  from: string
  to: string
}

interface MetadataPage {
  hasMore: boolean
  isTruncated: boolean
  invoices: KsefInvoiceMetadata[]
}

const AUTH_IN_PROGRESS = 100
const AUTH_SUCCESS = 200
const AUTH_POLL_ATTEMPTS = 30
const PAGE_SIZE = 100
/**
 * KSeF odrzuca zakres dłuższy niż 100 dni (kod 21405), więc dłuższy dzielimy na okna.
 * Okna możliwie długie: lista ma limit 20 zapytań na godzinę.
 */
const MAX_WINDOW_DAYS = 99
const DAY_MS = 86_400_000
/**
 * Limity KSeF (limity/limity-api.md): treść faktury 8/s, 16/min, 64/h; lista
 * metadanych 8/s, 16/min, 20/h. Limit sekundowy i minutowy przeczekujemy sami,
 * godzinowy zgłaszamy.
 */
const MAX_AUTO_WAIT_SECONDS = 65
const RATE_LIMIT_RETRIES = 3
/** Odstęp między pobraniami treści faktur: 15 na minutę, poniżej limitu 16. */
const DOWNLOAD_SPACING_MS = 4000

/** Sąsiadujące okna pokrywające cały zakres; przedział odwraca się tylko przy złych danych. */
export function queryWindows(from: string, to: string): Array<{ from: string; to: string }> {
  const end = Date.parse(to)
  const windows: Array<{ from: string; to: string }> = []
  let start = Date.parse(from)
  if (Number.isNaN(start) || Number.isNaN(end)) return [{ from, to }]
  while (start + MAX_WINDOW_DAYS * DAY_MS < end) {
    const next = start + MAX_WINDOW_DAYS * DAY_MS
    windows.push({ from: new Date(start).toISOString(), to: new Date(next).toISOString() })
    start = next
  }
  windows.push({ from: new Date(start).toISOString(), to: new Date(end).toISOString() })
  return windows
}

export function createKsefClient(options: KsefClientOptions) {
  const { environment, nip, token } = options
  const fetchImpl = options.fetchImpl ?? fetch
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const baseUrl = KSEF_BASE_URLS[environment]
  let accessToken: Promise<string> | null = null

  async function request(
    method: 'GET' | 'POST',
    path: string,
    init: { bearer?: string; json?: unknown; accept?: string } = {},
    retriesLeft = RATE_LIMIT_RETRIES,
  ): Promise<Response> {
    if (!isReadOnlyEndpoint(method, path)) {
      throw new Error(`KSeF: ${method} ${path} nie jest na liście operacji tylko do odczytu`)
    }
    const headers: Record<string, string> = { Accept: init.accept ?? 'application/json' }
    if (init.bearer) headers.Authorization = `Bearer ${init.bearer}`
    if (init.json !== undefined) headers['Content-Type'] = 'application/json'
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers,
      body: init.json === undefined ? undefined : JSON.stringify(init.json),
    })
    if (response.ok) return response
    const detail = (await response.text()).slice(0, 500)
    const retryAfter = Number(response.headers.get('Retry-After')) || undefined
    if (response.status === 429 && retriesLeft > 0 && (retryAfter ?? 1) <= MAX_AUTO_WAIT_SECONDS) {
      await sleep((retryAfter ?? 1) * 1000)
      return request(method, path, init, retriesLeft - 1)
    }
    throw new KsefApiError(`KSeF: ${method} ${path} → ${response.status} ${detail}`, response.status, retryAfter)
  }

  async function encryptToken(timestampMs: number): Promise<string> {
    const response = await request('GET', '/security/public-key-certificates')
    const certificates = (await response.json()) as Array<{ certificate: string; usage: string[] }>
    const certificate = certificates.find((entry) => entry.usage.includes('KsefTokenEncryption'))
    if (!certificate) throw new Error('KSeF: brak klucza publicznego do szyfrowania tokenu')
    const publicKeyInfo = publicKeyInfoFromCertificate(bytesFromBase64(certificate.certificate))
    return encryptForKsef(publicKeyInfo, `${token}|${timestampMs}`)
  }

  async function authenticate(): Promise<string> {
    const challengeResponse = await request('POST', '/auth/challenge')
    const { challenge, timestampMs } = (await challengeResponse.json()) as { challenge: string; timestampMs: number }
    const started = await request('POST', '/auth/ksef-token', {
      json: {
        challenge,
        contextIdentifier: { type: 'Nip', value: nip },
        encryptedToken: await encryptToken(timestampMs),
      },
    })
    const { referenceNumber, authenticationToken } = (await started.json()) as {
      referenceNumber: string
      authenticationToken: { token: string }
    }
    for (let attempt = 0; attempt < AUTH_POLL_ATTEMPTS; attempt += 1) {
      const statusResponse = await request('GET', `/auth/${referenceNumber}`, { bearer: authenticationToken.token })
      const { status } = (await statusResponse.json()) as { status: { code: number; description: string } }
      if (status.code === AUTH_SUCCESS) {
        const redeemed = await request('POST', '/auth/token/redeem', { bearer: authenticationToken.token })
        const body = (await redeemed.json()) as { accessToken: { token: string } }
        if (!isReadOnlyAccessToken(body.accessToken.token)) {
          throw new Error('KSeF: ten token może więcej niż czytać faktury. Hub przyjmuje tylko token tylko do odczytu (InvoiceRead).')
        }
        return body.accessToken.token
      }
      if (status.code !== AUTH_IN_PROGRESS) {
        throw new Error(`KSeF: logowanie odrzucone (${status.code}): ${status.description}`)
      }
      await sleep(1000)
    }
    throw new Error('KSeF: logowanie nie zakończyło się w oczekiwanym czasie')
  }

  /** Token dostępu jest krótkotrwały: wystarcza na jedną synchronizację, między nimi logujemy się od nowa. */
  function getAccessToken(): Promise<string> {
    accessToken ??= authenticate()
    return accessToken
  }

  async function listInvoices({ direction, from, to }: ListInvoicesParams): Promise<KsefInvoice[]> {
    const bearer = await getAccessToken()
    const found = new Map<string, KsefInvoice>()
    for (const window of queryWindows(from, to)) {
      await collectWindow(bearer, direction, window, found)
    }
    return [...found.values()]
  }

  async function collectWindow(
    bearer: string,
    direction: KsefDirection,
    window: { from: string; to: string },
    found: Map<string, KsefInvoice>,
  ): Promise<void> {
    let rangeFrom = window.from
    let pageOffset = 0
    for (;;) {
      const query = `pageOffset=${pageOffset}&pageSize=${PAGE_SIZE}&sortOrder=Asc`
      const response = await request('POST', `/invoices/query/metadata?${query}`, {
        bearer,
        json: {
          subjectType: direction === 'sale' ? 'Subject1' : 'Subject2',
          dateRange: { dateType: 'PermanentStorage', from: rangeFrom, to: window.to },
        },
      })
      const page = (await response.json()) as MetadataPage
      for (const invoice of page.invoices) {
        found.set(invoice.ksefNumber.toLowerCase(), normalizeKsefInvoice(invoice, direction))
      }
      if (!page.hasMore) return
      // Wynik ucięty przez limit KSeF: dalej od ostatniej daty, duplikaty odpadają po numerze KSeF.
      const last = page.invoices.at(-1)
      if (page.isTruncated && last) {
        rangeFrom = last.permanentStorageDate
        pageOffset = 0
      } else {
        pageOffset += 1
      }
    }
  }

  async function getInvoiceXml(ksefNumber: string): Promise<string> {
    await sleep(DOWNLOAD_SPACING_MS)
    const response = await request('GET', `/invoices/ksef/${encodeURIComponent(ksefNumber)}`, {
      bearer: await getAccessToken(),
      accept: 'application/xml',
    })
    return response.text()
  }

  return { getAccessToken, listInvoices, getInvoiceXml }
}
