/**
 * Klient KSeF API 2.0 TYLKO DO ODCZYTU.
 *
 * Każde żądanie przechodzi przez `READ_ONLY_ENDPOINTS`: czego nie ma na liście,
 * tego klient nie wyśle, nawet z błędu w kodzie. To drugie zabezpieczenie obok
 * tokenu z samym `InvoiceRead`, którego zakres sprawdza KSeF.
 *
 * Token nie trafia do komunikatów błędów ani do logów. Dokumentacja:
 * https://github.com/CIRFMF/ksef-docs
 */

import { constants, publicEncrypt, X509Certificate } from 'node:crypto'
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
    const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8')) as { per?: unknown }
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
    throw new KsefApiError(`KSeF: ${method} ${path} → ${response.status} ${detail}`, response.status, retryAfter)
  }

  async function encryptToken(timestampMs: number): Promise<string> {
    const response = await request('GET', '/security/public-key-certificates')
    const certificates = (await response.json()) as Array<{ certificate: string; usage: string[] }>
    const certificate = certificates.find((entry) => entry.usage.includes('KsefTokenEncryption'))
    if (!certificate) throw new Error('KSeF: brak klucza publicznego do szyfrowania tokenu')
    const { publicKey } = new X509Certificate(Buffer.from(certificate.certificate, 'base64'))
    return publicEncrypt(
      { key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      Buffer.from(`${token}|${timestampMs}`, 'utf8'),
    ).toString('base64')
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
    let rangeFrom = from
    let pageOffset = 0
    for (;;) {
      const query = `pageOffset=${pageOffset}&pageSize=${PAGE_SIZE}&sortOrder=Asc`
      const response = await request('POST', `/invoices/query/metadata?${query}`, {
        bearer,
        json: {
          subjectType: direction === 'sale' ? 'Subject1' : 'Subject2',
          dateRange: { dateType: 'PermanentStorage', from: rangeFrom, to },
        },
      })
      const page = (await response.json()) as MetadataPage
      for (const invoice of page.invoices) {
        found.set(invoice.ksefNumber.toLowerCase(), normalizeKsefInvoice(invoice, direction))
      }
      if (page.hasMore) {
        pageOffset += 1
        continue
      }
      // Wynik ucięty przez limit KSeF: dalej od ostatniej daty, duplikaty odpadają po numerze KSeF.
      const last = page.invoices.at(-1)
      if (!page.isTruncated || !last) return [...found.values()]
      rangeFrom = last.permanentStorageDate
      pageOffset = 0
    }
  }

  async function getInvoiceXml(ksefNumber: string): Promise<string> {
    const response = await request('GET', `/invoices/ksef/${encodeURIComponent(ksefNumber)}`, {
      bearer: await getAccessToken(),
      accept: 'application/xml',
    })
    return response.text()
  }

  return { getAccessToken, listInvoices, getInvoiceXml }
}
