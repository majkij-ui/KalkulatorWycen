import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createKsefClient, isReadOnlyAccessToken, isReadOnlyEndpoint, KsefApiError, queryWindows } from './ksef-client'
import { normalizeKsefInvoice, parseInvoiceXml, type KsefInvoiceMetadata } from './ksef-invoices'

const metadata: KsefInvoiceMetadata = {
  ksefNumber: '5265877635-20270102-ABC-01',
  invoiceNumber: 'FV/12/2026',
  issueDate: '2026-12-31',
  acquisitionDate: '2027-01-01T23:30:00+00:00',
  permanentStorageDate: '2027-01-01T23:31:00+00:00',
  seller: { nip: '5265877635', name: 'Sprzedawca' },
  buyer: { identifier: { type: 'Nip', value: '7980332920' }, name: 'Nabywca' },
  netAmount: 1000,
  grossAmount: 1230,
  vatAmount: 230,
  currency: 'PLN',
  invoiceType: 'Vat',
}

function jwt(payload: unknown): string {
  return `x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.x`
}

test('sprzedaż: druga strona to nabywca, zakup: sprzedawca', () => {
  const sale = normalizeKsefInvoice(metadata, 'sale')
  assert.equal(sale.counterpartyName, 'Nabywca')
  assert.equal(sale.counterpartyNip, '7980332920')
  const purchase = normalizeKsefInvoice(metadata, 'purchase')
  assert.equal(purchase.counterpartyName, 'Sprzedawca')
  assert.equal(purchase.counterpartyNip, '5265877635')
})

test('nabywca bez NIP-u: pusty NIP, nie identyfikator innego typu', () => {
  const foreign = normalizeKsefInvoice(
    { ...metadata, buyer: { identifier: { type: 'VatUe', value: 'DE123456789' }, name: 'Kunde' } },
    'sale',
  )
  assert.equal(foreign.counterpartyNip, '')
})

test('faktura z 31.12, numer KSeF w styczniu: osobne daty, dzień liczony w Polsce', () => {
  const invoice = normalizeKsefInvoice(metadata, 'sale')
  assert.equal(invoice.issueDate, '2026-12-31')
  // 23:30 UTC 1 stycznia to już 2 stycznia w Warszawie.
  assert.equal(invoice.ksefDate, '2027-01-02')
})

test('faktura korygująca jest oznaczona', () => {
  assert.equal(normalizeKsefInvoice(metadata, 'sale').isCorrection, false)
  assert.equal(normalizeKsefInvoice({ ...metadata, invoiceType: 'Kor' }, 'sale').isCorrection, true)
})

test('XML: pozycje, encje i najpóźniejszy z kilku terminów, także z prefiksem przestrzeni nazw', () => {
  const details = parseInvoiceXml(`
    <tns:Faktura xmlns:tns="x"><tns:Fa>
      <tns:FaWiersz><tns:NrWierszaFa>1</tns:NrWierszaFa><tns:P_7>Obiektyw &amp; filtr</tns:P_7>
        <tns:P_8A>szt</tns:P_8A><tns:P_8B>2</tns:P_8B><tns:P_9A>500.00</tns:P_9A><tns:P_11>1000.00</tns:P_11><tns:P_12>23</tns:P_12></tns:FaWiersz>
      <tns:FaWiersz><tns:P_7>Kabel</tns:P_7><tns:P_9B>123.00</tns:P_9B><tns:P_11A>123.00</tns:P_11A><tns:P_12>zw</tns:P_12></tns:FaWiersz>
      <tns:Platnosc>
        <tns:TerminPlatnosci><tns:Termin>2027-01-15</tns:Termin></tns:TerminPlatnosci>
        <tns:TerminPlatnosci><tns:Termin>2027-02-15</tns:Termin></tns:TerminPlatnosci>
      </tns:Platnosc>
    </tns:Fa></tns:Faktura>`)
  assert.equal(details.dueDate, '2027-02-15')
  assert.equal(details.lines.length, 2)
  assert.deepEqual(details.lines[0], {
    name: 'Obiektyw & filtr',
    unit: 'szt',
    quantity: 2,
    unitPriceNet: 500,
    unitPriceGross: null,
    amountNet: 1000,
    amountGross: null,
    vatRate: '23',
  })
  assert.equal(details.lines[1].amountGross, 123)
  assert.equal(details.lines[1].amountNet, null)
})

test('XML bez terminu płatności: pusty termin', () => {
  assert.equal(parseInvoiceXml('<Faktura><Fa></Fa></Faktura>').dueDate, '')
})

test('lista operacji przepuszcza odczyt, a blokuje wystawianie i zarządzanie', () => {
  assert.equal(isReadOnlyEndpoint('POST', '/invoices/query/metadata?pageOffset=0'), true)
  assert.equal(isReadOnlyEndpoint('GET', '/invoices/ksef/123-abc'), true)
  assert.equal(isReadOnlyEndpoint('POST', '/sessions/online'), false)
  assert.equal(isReadOnlyEndpoint('POST', '/sessions/online/1/invoices'), false)
  assert.equal(isReadOnlyEndpoint('POST', '/tokens'), false)
  assert.equal(isReadOnlyEndpoint('DELETE', '/tokens/1'), false)
  assert.equal(isReadOnlyEndpoint('POST', '/permissions/persons/grants'), false)
  assert.equal(isReadOnlyEndpoint('DELETE', '/invoices/ksef/123'), false)
})

test('token dostępu: tylko samo InvoiceRead przechodzi, nieczytelny zakres nie', () => {
  assert.equal(isReadOnlyAccessToken(jwt({ per: '["InvoiceRead"]' })), true)
  assert.equal(isReadOnlyAccessToken(jwt({ per: ['InvoiceRead'] })), true)
  assert.equal(isReadOnlyAccessToken(jwt({ per: '["InvoiceRead","InvoiceWrite"]' })), false)
  assert.equal(isReadOnlyAccessToken(jwt({ per: '["Owner"]' })), false)
  assert.equal(isReadOnlyAccessToken(jwt({ per: '[]' })), false)
  assert.equal(isReadOnlyAccessToken(jwt({})), false)
  assert.equal(isReadOnlyAccessToken('zepsuty'), false)
})

/** Odpowiedzi KSeF do `listInvoices`, razem z logowaniem. */
function fakeFetch(pages: unknown[], onQuery?: (url: string, body: unknown) => void): typeof fetch {
  let page = 0
  const access = jwt({ per: '["InvoiceRead"]' })
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/security/public-key-certificates')) return json([{ certificate: TEST_CERT, usage: ['KsefTokenEncryption'] }])
    if (url.endsWith('/auth/challenge')) return json({ challenge: 'c', timestampMs: 1 })
    if (url.endsWith('/auth/ksef-token')) return json({ referenceNumber: 'r', authenticationToken: { token: 't' } })
    if (url.endsWith('/auth/r')) return json({ status: { code: 200, description: 'ok' } })
    if (url.endsWith('/auth/token/redeem')) return json({ accessToken: { token: access } })
    if (url.includes('/invoices/query/metadata')) {
      onQuery?.(url, JSON.parse(String(init?.body)))
      const body = pages[page]
      page += 1
      return body instanceof Response ? body : json(body)
    }
    throw new Error(`nieoczekiwane żądanie ${url}`)
  }) as typeof fetch
}

// Samopodpisany certyfikat tylko do testów: klient bierze z niego klucz publiczny.
const TEST_CERT =
  'MIICpDCCAYwCCQC8Do4Sd0usbzANBgkqhkiG9w0BAQsFADAUMRIwEAYDVQQDDAlrc2VmLXRlc3QwHhcNMjYxMDMwMTU0NTE4WhcNMzYxMDI3MTU0NTE4WjAUMRIwEAYDVQQDDAlrc2VmLXRlc3QwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC0VG0j+vuyykK5aShmd5ytY/WdYbafvh5UVNM5xxp6n2D9X0a8trqAvabyh/+T5NnG2EfvSVcLyYYvQMXLwOasP2BcQjl29Kv1gLFQYe32oxn7f+CP91aFbidkqPjFXoIxWlOW93oMK+5/U8wyxx7Q1f5MqQfP2ORNjRjmq3Gy7tYVzg1o/D7ot8T9r2GFxNEUchGe5gee4SX58j4pj3N1dxG6D8YsDzldUdlprZl19PG2ktxIOs6I1xeY1pVJdvHWl2opqufwsrbOQCUHbviTtxGPoWlu32SfznxS4oiSV7ZG6+fRcgVp+OuCfKyVZfG1iqpL/1iwkZ/kFPTqujizAgMBAAEwDQYJKoZIhvcNAQELBQADggEBAHXxl2kvNhpfqO50AsAKfoxA4Ft4Xj7OqbWtgPpSrWfaCRUCaOqnPeJNwPhncnTMop0uduiuQN3cxXFlmZd6IwGZWb9ndJ6zaduFma+8A0UPdo8bMNXxJr0NJ9GMC9lMBlKuabI7CmC13u3oWZQwQUyeYV1rMmpf+m3QM7qqdETG9J0SEcagrYR60NL9DG+zFHsM5SBw2Gz7fBm7JmFVpUfx/yU9IClrM6oGEWiI8VhLxvVfCwaa6lKPKRHvipyz6tVP27ix8wRfL+DjNE8q8AJkODdWYzS6d94lHtsZU8R13ncekweQNfvZbXED31i4ETWQt7SOSsalnVvlctoqxBQ='

test('stronicowanie i ucięty wynik: bez duplikatów, wszystkie faktury', async () => {
  const second = { ...metadata, ksefNumber: 'B', permanentStorageDate: '2027-01-05T10:00:00+00:00' }
  const third = { ...metadata, ksefNumber: 'C' }
  const queries: Array<{ url: string; from: string }> = []
  const client = createKsefClient({
    environment: 'test',
    nip: '5265877635',
    token: 'tajny',
    sleep: async () => {},
    fetchImpl: fakeFetch(
      [
        { hasMore: true, isTruncated: false, invoices: [metadata] },
        { hasMore: true, isTruncated: true, invoices: [second] },
        { hasMore: false, isTruncated: false, invoices: [second, third] },
      ],
      (url, body) => queries.push({ url, from: (body as { dateRange: { from: string } }).dateRange.from }),
    ),
  })
  const invoices = await client.listInvoices({ direction: 'sale', from: '2027-01-01T00:00:00Z', to: '2027-02-01T00:00:00Z' })
  assert.deepEqual(invoices.map((invoice) => invoice.ksefNumber), [metadata.ksefNumber, 'B', 'C'])
  assert.match(queries[1].url, /pageOffset=1/)
  assert.match(queries[2].url, /pageOffset=0/)
  assert.equal(queries[2].from, second.permanentStorageDate)
})

test('długi zakres: sąsiadujące okna nie dłuższe niż 100 dni, bez dziur', () => {
  const windows = queryWindows('2027-01-01T00:00:00Z', '2028-01-01T00:00:00Z')
  assert.ok(windows.length > 1)
  assert.equal(windows[0].from, '2027-01-01T00:00:00.000Z')
  assert.equal(windows.at(-1)!.to, '2028-01-01T00:00:00.000Z')
  windows.forEach((window, index) => {
    assert.ok(Date.parse(window.to) - Date.parse(window.from) <= 100 * 86_400_000)
    if (index > 0) assert.equal(window.from, windows[index - 1].to)
  })
  assert.equal(queryWindows('2027-01-01T00:00:00Z', '2027-01-10T00:00:00Z').length, 1)
})

test('limit zapytań: błąd z czasem oczekiwania i bez tokenu w treści', async () => {
  const client = createKsefClient({
    environment: 'test',
    nip: '5265877635',
    token: 'tajny',
    sleep: async () => {},
    fetchImpl: fakeFetch([new Response('limit', { status: 429, headers: { 'Retry-After': '60' } })]),
  })
  await assert.rejects(
    () => client.listInvoices({ direction: 'purchase', from: 'a', to: 'b' }),
    (error: unknown) => {
      assert.ok(error instanceof KsefApiError)
      assert.equal(error.status, 429)
      assert.equal(error.retryAfter, 60)
      assert.equal(error.message.includes('tajny'), false)
      return true
    },
  )
})
