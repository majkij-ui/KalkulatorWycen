import assert from 'node:assert/strict'
import { constants, generateKeyPairSync, privateDecrypt, X509Certificate } from 'node:crypto'
import { test } from 'node:test'
import type { KsefCache } from './ksef-cache'
import { ksefFetchVia, syncProgressText, syncSummary, type Invoke } from './ksef-app-bridge'
import { createKsefClient, encryptForKsef, KsefApiError, publicKeyInfoFromCertificate } from './ksef-client'
import type { KsefDirection, KsefInvoice } from './ksef-invoices'
import { runKsefSync, type KsefSyncClient, type KsefSyncProgress, type KsefSyncResult } from './ksef-sync'

const NOW = '2026-11-14T09:00:00.000Z'

function invoice(ksefNumber: string, direction: KsefDirection = 'sale', ksefDate = '2026-11-10'): KsefInvoice {
  return {
    ksefNumber,
    invoiceNumber: `FV/${ksefNumber}`,
    direction,
    issueDate: ksefDate,
    ksefDate,
    counterpartyName: 'Klient sp. z o.o.',
    counterpartyNip: '1111111111',
    counterpartyId: 'Nip:1111111111',
    netAmount: 1000,
    grossAmount: 1230,
    vatAmount: 230,
    currency: 'PLN',
    invoiceType: 'Vat',
    isCorrection: false,
  }
}

const XML = '<Faktura><Fa><Platnosc><TerminPlatnosci><Termin>2026-11-24</Termin></TerminPlatnosci></Platnosc></Fa></Faktura>'

/** KSeF na niby: lista na kierunek i licznik pobrań treści; `fail` rzuca zamiast odpowiadać. */
function fakeClient(lists: Partial<Record<KsefDirection, KsefInvoice[] | Error>>, failDownloadAfter = Infinity) {
  const calls = { list: [] as Array<{ direction: KsefDirection; from: string; to: string }>, xml: [] as string[] }
  const client: KsefSyncClient = {
    async listInvoices(params) {
      calls.list.push(params)
      const answer = lists[params.direction] ?? []
      if (answer instanceof Error) throw answer
      return answer
    },
    async getInvoiceXml(ksefNumber) {
      if (calls.xml.length >= failDownloadAfter) throw new KsefApiError('KSeF: limit', 429, 1800)
      calls.xml.push(ksefNumber)
      return XML
    },
  }
  return { client, calls }
}

const base = { environment: 'prod', nip: '9591756851', from: '2026-02-01', now: NOW }
const none = { sale: null, purchase: null }

test('pierwsze pobranie: cały zakres, treść każdej faktury, sprzedaż przed zakupami', async () => {
  const { client, calls } = fakeClient({ sale: [invoice('S1')], purchase: [invoice('P1', 'purchase'), invoice('P2', 'purchase')] })
  const result = await runKsefSync({ ...base, client, previous: none })

  assert.deepEqual(calls.list.map((call) => [call.direction, call.from, call.to]), [
    ['sale', '2026-02-01T00:00:00+01:00', NOW],
    ['purchase', '2026-02-01T00:00:00+01:00', NOW],
  ])
  assert.deepEqual(calls.xml, ['S1', 'P1', 'P2'])
  assert.deepEqual(result.fresh, { sale: 1, purchase: 2 })
  assert.equal(result.downloaded, 3)
  assert.equal(result.waiting, 0)
  assert.equal(result.retryInMinutes, null)
  assert.equal(result.caches.sale?.syncedTo, NOW)
  assert.equal(result.caches.sale?.invoices[0].details.dueDate, '2026-11-24')
  assert.equal('hasDetails' in result.caches.sale!.invoices[0], false)
})

test('kolejne pobranie: pyta tylko od poprzedniego (z zakładką 2 dni) i nie pobiera drugi raz treści', async () => {
  const first = await runKsefSync({ ...base, now: '2026-11-10T09:00:00.000Z', client: fakeClient({ sale: [invoice('S1')] }).client, previous: none })
  const { client, calls } = fakeClient({ sale: [invoice('S1'), invoice('S2', 'sale', '2026-11-13')] })
  const result = await runKsefSync({ ...base, client, previous: first.caches })

  assert.equal(calls.list[0].from, '2026-11-08T09:00:00.000Z')
  assert.deepEqual(calls.xml, ['S2'])
  assert.deepEqual(result.fresh, { sale: 1, purchase: 0 })
  assert.deepEqual(result.caches.sale?.invoices.map((item) => item.ksefNumber), ['S1', 'S2'])
  assert.equal(result.caches.sale?.invoices[0].details.dueDate, '2026-11-24')
})

test('nic nowego w KSeF: zero pobrań, kopia zostaje, data przejrzenia się przesuwa', async () => {
  const first = await runKsefSync({ ...base, now: '2026-11-10T09:00:00.000Z', client: fakeClient({ sale: [invoice('S1')] }).client, previous: none })
  const { client, calls } = fakeClient({})
  const result = await runKsefSync({ ...base, client, previous: first.caches })

  assert.deepEqual(calls.xml, [])
  assert.deepEqual(result.fresh, { sale: 0, purchase: 0 })
  assert.equal(result.caches.sale?.invoices.length, 1)
  assert.equal(result.caches.sale?.syncedTo, NOW)
})

test('limit na listę: stara kopia i stara data zostają, druga lista idzie dalej', async () => {
  const first = await runKsefSync({ ...base, now: '2026-11-10T09:00:00.000Z', client: fakeClient({ sale: [invoice('S1')] }).client, previous: none })
  const { client } = fakeClient({ sale: new KsefApiError('KSeF: limit', 429, 1500), purchase: [invoice('P1', 'purchase')] })
  const result = await runKsefSync({ ...base, client, previous: first.caches })

  assert.deepEqual(result.listed, { sale: false, purchase: true })
  assert.equal(result.caches.sale?.syncedTo, '2026-11-10T09:00:00.000Z')
  assert.equal(result.caches.sale?.invoices.length, 1)
  assert.equal(result.caches.purchase?.invoices.length, 1)
  assert.equal(result.retryInMinutes, 25)
})

test('limit na listę przy pierwszym pobraniu: nie powstaje pusta kopia', async () => {
  const { client } = fakeClient({ sale: new KsefApiError('KSeF: limit', 429), purchase: new KsefApiError('KSeF: limit', 429) })
  const result = await runKsefSync({ ...base, client, previous: none })

  assert.deepEqual(result.caches, { sale: null, purchase: null })
  assert.equal(result.retryInMinutes, 60)
})

test('limit w połowie pobierania treści: pobrane zostają, reszta czeka na następny raz', async () => {
  const { client } = fakeClient({ sale: [invoice('S1'), invoice('S2'), invoice('S3')] }, 2)
  const seen: KsefSyncProgress[] = []
  const result = await runKsefSync({ ...base, client, previous: none, onProgress: (progress) => seen.push(progress) })

  assert.equal(result.downloaded, 2)
  assert.equal(result.waiting, 1)
  assert.equal(result.retryInMinutes, 30)
  assert.deepEqual(result.caches.sale?.invoices.map((item) => item.hasDetails), [undefined, undefined, false])
  assert.deepEqual(seen.at(-1), { step: 'limited', what: 'details', minutes: 30, done: 2, planned: 3 })

  // Następny przebieg dobiera tylko brakującą.
  const next = fakeClient({})
  const second = await runKsefSync({ ...base, client: next.client, previous: result.caches })
  assert.deepEqual(next.calls.xml, ['S3'])
  assert.equal(second.waiting, 0)
})

test('więcej faktur niż limit na przebieg: nadwyżka czeka', async () => {
  const { client, calls } = fakeClient({ sale: [invoice('S1'), invoice('S2'), invoice('S3')] })
  const result = await runKsefSync({ ...base, client, previous: none, maxDownloads: 2 })

  assert.equal(calls.xml.length, 2)
  assert.equal(result.waiting, 1)
  assert.equal(result.retryInMinutes, null)
})

test('inny błąd niż limit przerywa synchronizację', async () => {
  const { client } = fakeClient({ sale: new KsefApiError('KSeF: odmowa', 401) })
  await assert.rejects(runKsefSync({ ...base, client, previous: none }), /odmowa/)
})

test('kopia z innego środowiska albo innej firmy nie miesza się z nową', async () => {
  const foreign: KsefCache = { fetchedAt: NOW, environment: 'test', nip: base.nip, from: base.from, syncedTo: NOW, invoices: [] }
  const { client, calls } = fakeClient({ sale: [invoice('S1')] })
  const result = await runKsefSync({ ...base, client, previous: { sale: foreign, purchase: null } })

  assert.equal(calls.list[0].from, '2026-02-01T00:00:00+01:00')
  assert.equal(result.caches.sale?.environment, 'prod')
})

test('próba na sucho: lista tak, treść nie', async () => {
  const { client, calls } = fakeClient({ sale: [invoice('S1')] })
  const result = await runKsefSync({ ...base, client, previous: none, skipDetails: true })

  assert.deepEqual(calls.xml, [])
  assert.equal(result.waiting, 1)
})

// Samopodpisany certyfikat tylko do testów (ten sam co w ksef.test.ts).
const TEST_CERT =
  'MIICpDCCAYwCCQC8Do4Sd0usbzANBgkqhkiG9w0BAQsFADAUMRIwEAYDVQQDDAlrc2VmLXRlc3QwHhcNMjYxMDMwMTU0NTE4WhcNMzYxMDI3MTU0NTE4WjAUMRIwEAYDVQQDDAlrc2VmLXRlc3QwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC0VG0j+vuyykK5aShmd5ytY/WdYbafvh5UVNM5xxp6n2D9X0a8trqAvabyh/+T5NnG2EfvSVcLyYYvQMXLwOasP2BcQjl29Kv1gLFQYe32oxn7f+CP91aFbidkqPjFXoIxWlOW93oMK+5/U8wyxx7Q1f5MqQfP2ORNjRjmq3Gy7tYVzg1o/D7ot8T9r2GFxNEUchGe5gee4SX58j4pj3N1dxG6D8YsDzldUdlprZl19PG2ktxIOs6I1xeY1pVJdvHWl2opqufwsrbOQCUHbviTtxGPoWlu32SfznxS4oiSV7ZG6+fRcgVp+OuCfKyVZfG1iqpL/1iwkZ/kFPTqujizAgMBAAEwDQYJKoZIhvcNAQELBQADggEBAHXxl2kvNhpfqO50AsAKfoxA4Ft4Xj7OqbWtgPpSrWfaCRUCaOqnPeJNwPhncnTMop0uduiuQN3cxXFlmZd6IwGZWb9ndJ6zaduFma+8A0UPdo8bMNXxJr0NJ9GMC9lMBlKuabI7CmC13u3oWZQwQUyeYV1rMmpf+m3QM7qqdETG9J0SEcagrYR60NL9DG+zFHsM5SBw2Gz7fBm7JmFVpUfx/yU9IClrM6oGEWiI8VhLxvVfCwaa6lKPKRHvipyz6tVP27ix8wRfL+DjNE8q8AJkODdWYzS6d94lHtsZU8R13ncekweQNfvZbXED31i4ETWQt7SOSsalnVvlctoqxBQ='

test('klucz publiczny z certyfikatu: ten sam, który czyta Node', () => {
  const der = Buffer.from(TEST_CERT, 'base64')
  const expected = new X509Certificate(der).publicKey.export({ type: 'spki', format: 'der' })
  assert.deepEqual(Buffer.from(publicKeyInfoFromCertificate(new Uint8Array(der))), expected)
  assert.throws(() => publicKeyInfoFromCertificate(new Uint8Array([1, 2, 3, 4])), /klucza publicznego/)
})

test('szyfrowanie tokenu: RSA-OAEP z SHA-256, odszyfrowuje je klucz prywatny', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const spki = new Uint8Array(publicKey.export({ type: 'spki', format: 'der' }))
  const encrypted = await encryptForKsef(spki, 'tajny-token|1731574800000')
  const plain = privateDecrypt(
    { key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(encrypted, 'base64'),
  )
  assert.equal(plain.toString('utf8'), 'tajny-token|1731574800000')
})

// ── Most do części systemowej aplikacji i teksty przycisku ──

test('most aplikacji: klient loguje się i pobiera przez polecenie ksef_request, limit wraca z czasem oczekiwania', async () => {
  const access = `x.${Buffer.from(JSON.stringify({ per: '["InvoiceRead"]' })).toString('base64url')}.y`
  const seen: Array<Record<string, unknown>> = []
  let xmlCalls = 0
  const invoke: Invoke = async <T,>(command: string, args?: Record<string, unknown>) => {
    assert.equal(command, 'ksef_request')
    const request = (args as { request: Record<string, string | null> }).request
    seen.push(request)
    const reply = (body: unknown, status = 200, retryAfter: string | null = null) =>
      ({ status, retryAfter, body: typeof body === 'string' ? body : JSON.stringify(body) }) as T
    const path = String(request.path)
    if (path === '/security/public-key-certificates') return reply([{ certificate: TEST_CERT, usage: ['KsefTokenEncryption'] }])
    if (path === '/auth/challenge') return reply({ challenge: 'c', timestampMs: 1 })
    if (path === '/auth/ksef-token') return reply({ referenceNumber: 'r', authenticationToken: { token: 'tymczasowy' } })
    if (path === '/auth/r') return reply({ status: { code: 200, description: 'ok' } })
    if (path === '/auth/token/redeem') return reply({ accessToken: { token: access } })
    if (path.startsWith('/invoices/ksef/')) {
      xmlCalls += 1
      return xmlCalls === 1 ? reply(XML) : reply('limit', 429, '2400')
    }
    throw new Error(`nieoczekiwane żądanie ${path}`)
  }
  const client = createKsefClient({
    environment: 'prod',
    nip: base.nip,
    token: 'tajny-token',
    fetchImpl: ksefFetchVia(invoke, 'prod'),
    sleep: async () => {},
  })

  assert.equal(await client.getInvoiceXml('ABC-1'), XML)
  await assert.rejects(client.getInvoiceXml('ABC-2'), (error: unknown) => error instanceof KsefApiError && error.status === 429 && error.retryAfter === 2400)

  const login = seen.find((request) => request.path === '/auth/ksef-token')
  assert.equal(login?.method, 'POST')
  assert.equal(login?.environment, 'prod')
  assert.equal(String(login?.body).includes('tajny-token'), false)
  const download = seen.find((request) => request.path === '/invoices/ksef/ABC-1')
  assert.deepEqual([download?.method, download?.bearer, download?.accept], ['GET', access, 'application/xml'])
})

test('most aplikacji: adres spoza KSeF nie przechodzi', async () => {
  const fetchImpl = ksefFetchVia(async () => assert.fail('nie powinno dojść do polecenia'), 'prod')
  await assert.rejects(fetchImpl('https://example.com/v2/auth/challenge', { method: 'POST' }), /poza adresem KSeF/)
})

const result = (patch: Partial<KsefSyncResult>): KsefSyncResult => ({
  caches: { sale: null, purchase: null },
  fresh: { sale: 0, purchase: 0 },
  listed: { sale: true, purchase: true },
  downloaded: 0,
  waiting: 0,
  retryInMinutes: null,
  ...patch,
})

test('podsumowanie po pobraniu: każdy przypadek po ludzku', () => {
  assert.deepEqual(syncSummary(result({})), { text: 'W KSeF nie ma nowych faktur.', warning: null })
  assert.equal(syncSummary(result({ fresh: { sale: 1, purchase: 0 }, downloaded: 1 })).text, 'Pobrano z KSeF: 1 nowa faktura sprzedaży.')
  assert.equal(
    syncSummary(result({ fresh: { sale: 2, purchase: 5 }, downloaded: 7 })).text,
    'Pobrano z KSeF: 2 nowe faktury sprzedaży i 5 nowych faktur zakupu.',
  )
  assert.equal(syncSummary(result({ downloaded: 20 })).text, 'Bez nowych faktur. Dociągnięto treść: 20 faktur.')
  assert.deepEqual(syncSummary(result({ fresh: { sale: 0, purchase: 60 }, downloaded: 55, waiting: 5 })), {
    text: 'Pobrano z KSeF: 60 nowych faktur zakupu.',
    warning: 'Treść 5 faktur (pozycje, termin płatności) pobierze się przy następnym razie.',
  })
  assert.deepEqual(syncSummary(result({ listed: { sale: false, purchase: false }, retryInMinutes: 25 })), {
    text: 'Nie udało się sprawdzić nowych faktur.',
    warning: 'KSeF wstrzymał listę faktur (limit na godzinę). Spróbuj za ok. 25 min.',
  })
})

test('postęp pobierania: zdanie pod przyciskiem', () => {
  assert.equal(syncProgressText({ step: 'listing', direction: 'purchase' }), 'Sprawdzam nowe faktury zakupu…')
  assert.equal(syncProgressText({ step: 'details-plan', planned: 0, postponed: 0 }), null)
  assert.equal(syncProgressText({ step: 'details-plan', planned: 3, postponed: 0 }), 'Pobieram treść: 3 faktury, ok. 10 s (KSeF wydaje je powoli)…')
  assert.equal(syncProgressText({ step: 'details-plan', planned: 55, postponed: 7 }), 'Pobieram treść: 55 faktur, ok. 4 min (KSeF wydaje je powoli)…')
  assert.equal(syncProgressText({ step: 'details', done: 2, planned: 3 }), 'Pobieram treść faktur: 2 z 3…')
})
