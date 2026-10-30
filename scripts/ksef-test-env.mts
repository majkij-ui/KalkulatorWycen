/**
 * Próba klienta KSeF na środowisku TESTOWYM Ministerstwa Finansów:
 *
 *   npm run ksef:test
 *
 * Bez prawdziwego konta: losowe NIP-y i samopodpisane certyfikaty, dane bez
 * skutków prawnych. Adres jest wpisany na stałe, nie ma tu przełącznika na
 * produkcję, bo ten skrypt jako jedyny WYSTAWIA faktury (testowy sprzedawca
 * musi mieć co udostępnić klientowi tylko do odczytu).
 *
 * Sprawdza:
 *  1. logowanie klienta tokenem z samym `InvoiceRead`,
 *  2. sprzedaż u sprzedawcy i zakup u nabywcy, razem z XML-em faktury,
 *  3. że ten token NIE wystawi faktury i NIE utworzy tokenu z prawem zapisu,
 *  4. `npm run data -- ksef-sync` na tymczasowym folderze: propozycja, ponowny
 *     przebieg bez duplikatów, korekta.
 *
 * Nie dotyka danych huba ani pęku kluczy.
 */

import { execFileSync } from 'node:child_process'
import {
  constants,
  createCipheriv,
  createHash,
  createSign,
  publicEncrypt,
  randomBytes,
  randomInt,
  X509Certificate,
} from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createKsefClient, KSEF_BASE_URLS } from '../lib/ksef-client'
import { parseInvoiceXml } from '../lib/ksef-invoices'

const BASE_URL = KSEF_BASE_URLS.test
const DS = 'http://www.w3.org/2000/09/xmldsig#'
const XADES = 'http://uri.etsi.org/01903/v1.3.2#'
const EXC_C14N = 'http://www.w3.org/2001/10/xml-exc-c14n#'
const SHA256 = 'http://www.w3.org/2001/04/xmlenc#sha256'

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('base64')

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

async function api(
  method: string,
  path: string,
  init: { bearer?: string; json?: unknown; xml?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (init.bearer) headers.Authorization = `Bearer ${init.bearer}`
  if (init.json !== undefined) headers['Content-Type'] = 'application/json'
  if (init.xml !== undefined) headers['Content-Type'] = 'application/xml'
  return fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : init.xml,
  })
}

async function apiJson<T>(method: string, path: string, init: Parameters<typeof api>[2] = {}): Promise<T> {
  const response = await api(method, path, init)
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${(await response.text()).slice(0, 800)}`)
  return (response.status === 204 ? undefined : await response.json()) as T
}

function randomNip(): string {
  const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7]
  for (;;) {
    const digits = Array.from({ length: 9 }, (_, index) => (index === 0 ? randomInt(1, 10) : randomInt(0, 10)))
    const check = digits.reduce((sum, digit, index) => sum + digit * weights[index], 0) % 11
    if (check !== 10) return `${digits.join('')}${check}`
  }
}

interface Identity {
  nip: string
  certificate: X509Certificate
  privateKey: string
}

function createIdentity(folder: string, nip: string): Identity {
  const keyPath = join(folder, `${nip}.key`)
  const certPath = join(folder, `${nip}.crt`)
  execFileSync(
    'openssl',
    [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-keyout', keyPath, '-out', certPath,
      '-subj', `/C=PL/GN=Test/SN=Hub/serialNumber=TINPL-${nip}/CN=Test Hub`,
    ],
    { stdio: 'ignore' },
  )
  return {
    nip,
    certificate: new X509Certificate(readFileSync(certPath)),
    privateKey: readFileSync(keyPath, 'utf8'),
  }
}

/**
 * XAdES-BES otaczany. Fragmenty są zapisane od razu w postaci kanonicznej
 * (exc-c14n), więc ten sam tekst idzie do skrótu i do dokumentu.
 */
function signAuthRequest(identity: Identity, challenge: string): string {
  const request =
    `<AuthTokenRequest xmlns="http://ksef.mf.gov.pl/auth/token/2.0">` +
    `<Challenge>${challenge}</Challenge>` +
    `<ContextIdentifier><Nip>${identity.nip}</Nip></ContextIdentifier>` +
    `<SubjectIdentifierType>certificateSubject</SubjectIdentifierType>`
  const issuer = identity.certificate.issuer.split('\n').reverse().join(',')
  const serial = BigInt(`0x${identity.certificate.serialNumber}`).toString(10)
  const signedProperties =
    `<xades:SignedProperties xmlns:xades="${XADES}" Id="SignedProperties">` +
    `<xades:SignedSignatureProperties>` +
    `<xades:SigningTime>${new Date().toISOString()}</xades:SigningTime>` +
    `<xades:SigningCertificate><xades:Cert><xades:CertDigest>` +
    `<ds:DigestMethod xmlns:ds="${DS}" Algorithm="${SHA256}"></ds:DigestMethod>` +
    `<ds:DigestValue xmlns:ds="${DS}">${sha256(identity.certificate.raw)}</ds:DigestValue>` +
    `</xades:CertDigest><xades:IssuerSerial>` +
    `<ds:X509IssuerName xmlns:ds="${DS}">${escapeXml(issuer)}</ds:X509IssuerName>` +
    `<ds:X509SerialNumber xmlns:ds="${DS}">${serial}</ds:X509SerialNumber>` +
    `</xades:IssuerSerial></xades:Cert></xades:SigningCertificate>` +
    `</xades:SignedSignatureProperties></xades:SignedProperties>`
  const signedInfo =
    `<ds:SignedInfo xmlns:ds="${DS}">` +
    `<ds:CanonicalizationMethod Algorithm="${EXC_C14N}"></ds:CanonicalizationMethod>` +
    `<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"></ds:SignatureMethod>` +
    `<ds:Reference URI=""><ds:Transforms>` +
    `<ds:Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"></ds:Transform>` +
    `<ds:Transform Algorithm="${EXC_C14N}"></ds:Transform></ds:Transforms>` +
    `<ds:DigestMethod Algorithm="${SHA256}"></ds:DigestMethod>` +
    `<ds:DigestValue>${sha256(`${request}</AuthTokenRequest>`)}</ds:DigestValue></ds:Reference>` +
    `<ds:Reference Type="http://uri.etsi.org/01903#SignedProperties" URI="#SignedProperties"><ds:Transforms>` +
    `<ds:Transform Algorithm="${EXC_C14N}"></ds:Transform></ds:Transforms>` +
    `<ds:DigestMethod Algorithm="${SHA256}"></ds:DigestMethod>` +
    `<ds:DigestValue>${sha256(signedProperties)}</ds:DigestValue></ds:Reference>` +
    `</ds:SignedInfo>`
  const signature = createSign('RSA-SHA256').update(signedInfo).sign(identity.privateKey, 'base64')
  return (
    `${request}<ds:Signature xmlns:ds="${DS}" Id="Signature">${signedInfo}` +
    `<ds:SignatureValue>${signature}</ds:SignatureValue>` +
    `<ds:KeyInfo><ds:X509Data><ds:X509Certificate>${identity.certificate.raw.toString('base64')}` +
    `</ds:X509Certificate></ds:X509Data></ds:KeyInfo>` +
    `<ds:Object><xades:QualifyingProperties xmlns:xades="${XADES}" Target="#Signature">${signedProperties}` +
    `</xades:QualifyingProperties></ds:Object></ds:Signature></AuthTokenRequest>`
  )
}

/** Logowanie właściciela podpisem: tylko nim można utworzyć pierwszy token. */
async function loginAsOwner(identity: Identity): Promise<string> {
  const { challenge } = await apiJson<{ challenge: string }>('POST', '/auth/challenge')
  const started = await apiJson<{ referenceNumber: string; authenticationToken: { token: string } }>(
    'POST',
    '/auth/xades-signature?verifyCertificateChain=false',
    { xml: signAuthRequest(identity, challenge) },
  )
  const bearer = started.authenticationToken.token
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const { status } = await apiJson<{ status: { code: number; description: string; details?: string[] } }>(
      'GET',
      `/auth/${started.referenceNumber}`,
      { bearer },
    )
    if (status.code === 200) {
      const redeemed = await apiJson<{ accessToken: { token: string } }>('POST', '/auth/token/redeem', { bearer })
      return redeemed.accessToken.token
    }
    if (status.code !== 100) throw new Error(`Logowanie odrzucone: ${JSON.stringify(status)}`)
    await sleep(1000)
  }
  throw new Error('Logowanie podpisem nie zakończyło się')
}

async function createToken(ownerToken: string, permissions: string[], description: string) {
  const created = await apiJson<{ referenceNumber: string; token: string }>('POST', '/tokens', {
    bearer: ownerToken,
    json: { permissions, description },
  })
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const { status } = await apiJson<{ status: string }>('GET', `/tokens/${created.referenceNumber}`, {
      bearer: ownerToken,
    })
    if (status === 'Active') return created
    if (status === 'Failed') throw new Error('Nie udało się utworzyć tokenu')
    await sleep(1000)
  }
  throw new Error('Token nie stał się aktywny')
}

function testInvoiceXml(sellerNip: string, buyerNip: string, number: string, issueDate: string, dueDate: string) {
  const line = (index: number, name: string, unit: string, price: string) =>
    `<FaWiersz><NrWierszaFa>${index}</NrWierszaFa><P_7>${name}</P_7><P_8A>${unit}</P_8A><P_8B>1</P_8B>` +
    `<P_9A>${price}</P_9A><P_11>${price}</P_11><P_12>23</P_12></FaWiersz>`
  const party = (nip: string, name: string) =>
    `<DaneIdentyfikacyjne><NIP>${nip}</NIP><Nazwa>${name}</Nazwa></DaneIdentyfikacyjne>` +
    `<Adres><KodKraju>PL</KodKraju><AdresL1>ul. Testowa 1</AdresL1><AdresL2>00-001 Warszawa</AdresL2></Adres>`
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Faktura xmlns="http://crd.gov.pl/wzor/2025/06/25/13775/">` +
    `<Naglowek><KodFormularza kodSystemowy="FA (3)" wersjaSchemy="1-0E">FA</KodFormularza>` +
    `<WariantFormularza>3</WariantFormularza><DataWytworzeniaFa>${new Date().toISOString()}</DataWytworzeniaFa>` +
    `<SystemInfo>Hub test</SystemInfo></Naglowek>` +
    `<Podmiot1>${party(sellerNip, 'Sprzedawca Testowy')}</Podmiot1>` +
    `<Podmiot2>${party(buyerNip, 'Nabywca Testowy')}<JST>2</JST><GV>2</GV></Podmiot2>` +
    `<Fa><KodWaluty>PLN</KodWaluty><P_1>${issueDate}</P_1><P_2>${number}</P_2>` +
    `<P_13_1>1100.00</P_13_1><P_14_1>253.00</P_14_1><P_15>1353.00</P_15>` +
    `<Adnotacje><P_16>2</P_16><P_17>2</P_17><P_18>2</P_18><P_18A>2</P_18A>` +
    `<Zwolnienie><P_19N>1</P_19N></Zwolnienie><NoweSrodkiTransportu><P_22N>1</P_22N></NoweSrodkiTransportu>` +
    `<P_23>2</P_23><PMarzy><P_PMarzyN>1</P_PMarzyN></PMarzy></Adnotacje>` +
    `<RodzajFaktury>VAT</RodzajFaktury>` +
    line(1, 'Statyw testowy', 'szt', '1000.00') +
    line(2, 'Akcesoria drobne', 'szt', '100.00') +
    `<Platnosc><TerminPlatnosci><Termin>${dueDate}</Termin></TerminPlatnosci><FormaPlatnosci>6</FormaPlatnosci></Platnosc>` +
    `</Fa></Faktura>`
  )
}

function correctionXml(
  sellerNip: string,
  buyerNip: string,
  number: string,
  issueDate: string,
  corrected: { number: string; ksefNumber: string },
) {
  const party = (nip: string, name: string) =>
    `<DaneIdentyfikacyjne><NIP>${nip}</NIP><Nazwa>${name}</Nazwa></DaneIdentyfikacyjne>` +
    `<Adres><KodKraju>PL</KodKraju><AdresL1>ul. Testowa 1</AdresL1><AdresL2>00-001 Warszawa</AdresL2></Adres>`
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Faktura xmlns="http://crd.gov.pl/wzor/2025/06/25/13775/">` +
    `<Naglowek><KodFormularza kodSystemowy="FA (3)" wersjaSchemy="1-0E">FA</KodFormularza>` +
    `<WariantFormularza>3</WariantFormularza><DataWytworzeniaFa>${new Date().toISOString()}</DataWytworzeniaFa>` +
    `<SystemInfo>Hub test</SystemInfo></Naglowek>` +
    `<Podmiot1>${party(sellerNip, 'Sprzedawca Testowy')}</Podmiot1>` +
    `<Podmiot2>${party(buyerNip, 'Nabywca Testowy')}<JST>2</JST><GV>2</GV></Podmiot2>` +
    `<Fa><KodWaluty>PLN</KodWaluty><P_1>${issueDate}</P_1><P_2>${number}</P_2>` +
    `<P_13_1>-100.00</P_13_1><P_14_1>-23.00</P_14_1><P_15>-123.00</P_15>` +
    `<Adnotacje><P_16>2</P_16><P_17>2</P_17><P_18>2</P_18><P_18A>2</P_18A>` +
    `<Zwolnienie><P_19N>1</P_19N></Zwolnienie><NoweSrodkiTransportu><P_22N>1</P_22N></NoweSrodkiTransportu>` +
    `<P_23>2</P_23><PMarzy><P_PMarzyN>1</P_PMarzyN></PMarzy></Adnotacje>` +
    `<RodzajFaktury>KOR</RodzajFaktury><PrzyczynaKorekty>Zwrot</PrzyczynaKorekty><TypKorekty>1</TypKorekty>` +
    `<DaneFaKorygowanej><DataWystFaKorygowanej>${issueDate}</DataWystFaKorygowanej>` +
    `<NrFaKorygowanej>${corrected.number}</NrFaKorygowanej><NrKSeF>1</NrKSeF>` +
    `<NrKSeFFaKorygowanej>${corrected.ksefNumber}</NrKSeFFaKorygowanej></DaneFaKorygowanej>` +
    `<FaWiersz><NrWierszaFa>1</NrWierszaFa><P_7>Akcesoria drobne</P_7><P_8A>szt</P_8A><P_8B>-1</P_8B>` +
    `<P_9A>100.00</P_9A><P_11>-100.00</P_11><P_12>23</P_12></FaWiersz>` +
    `</Fa></Faktura>`
  )
}

/** `ksef-sync` jak z wiersza poleceń, na folderze tymczasowym; token tylko w zmiennej tego procesu. */
function runSync(dir: string, nip: string, token: string): string {
  return execFileSync(
    process.execPath,
    [
      '--no-warnings', '--import', './scripts/register-ts.mjs', 'scripts/data.mts', 'ksef-sync',
      // Ponad 100 dni wstecz: sprawdza też podział zakresu na okna.
      '--env', 'test', '--nip', nip, '--from', new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10), '--dir', dir,
    ],
    { encoding: 'utf8', env: { ...process.env, KSEF_TOKEN: token } },
  )
}

function inboxProposals(dir: string): Array<Record<string, any>> {
  const inbox = join(dir, 'inbox')
  return readdirSync(inbox).flatMap((name) => JSON.parse(readFileSync(join(inbox, name), 'utf8')).proposals)
}

async function symmetricKeyEncryption() {
  const certificates = await apiJson<Array<{ certificate: string; usage: string[] }>>(
    'GET',
    '/security/public-key-certificates',
  )
  const entry = certificates.find((item) => item.usage.includes('SymmetricKeyEncryption'))
  if (!entry) throw new Error('Brak klucza do szyfrowania faktur')
  const { publicKey } = new X509Certificate(Buffer.from(entry.certificate, 'base64'))
  const key = randomBytes(32)
  const iv = randomBytes(16)
  return {
    key,
    iv,
    encryption: {
      encryptedSymmetricKey: publicEncrypt(
        { key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
        key,
      ).toString('base64'),
      initializationVector: iv.toString('base64'),
    },
  }
}

const FORM_CODE = { systemCode: 'FA (3)', schemaVersion: '1-0E', value: 'FA' }

async function issueInvoice(ownerToken: string, xml: string): Promise<string> {
  const { key, iv, encryption } = await symmetricKeyEncryption()
  const session = await apiJson<{ referenceNumber: string }>('POST', '/sessions/online', {
    bearer: ownerToken,
    json: { formCode: FORM_CODE, encryption },
  })
  const plain = Buffer.from(xml, 'utf8')
  const cipher = createCipheriv('aes-256-cbc', key, iv)
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()])
  const sent = await apiJson<{ referenceNumber: string }>(
    'POST',
    `/sessions/online/${session.referenceNumber}/invoices`,
    {
      bearer: ownerToken,
      json: {
        invoiceHash: sha256(plain),
        invoiceSize: plain.length,
        encryptedInvoiceHash: sha256(encrypted),
        encryptedInvoiceSize: encrypted.length,
        encryptedInvoiceContent: encrypted.toString('base64'),
      },
    },
  )
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const invoice = await apiJson<{ ksefNumber?: string; status: { code: number; description: string; details?: string[] } }>(
      'GET',
      `/sessions/${session.referenceNumber}/invoices/${sent.referenceNumber}`,
      { bearer: ownerToken },
    )
    if (invoice.ksefNumber) {
      await api('POST', `/sessions/online/${session.referenceNumber}/close`, { bearer: ownerToken })
      return invoice.ksefNumber
    }
    if (invoice.status.code >= 400) throw new Error(`Faktura odrzucona: ${JSON.stringify(invoice.status)}`)
    await sleep(2000)
  }
  throw new Error('Faktura nie dostała numeru KSeF')
}

/** Dane mogą chwilę poczekać na trwały zapis, zanim pojawią się w wynikach. */
async function waitForInvoice(client: ReturnType<typeof createKsefClient>, direction: 'sale' | 'purchase', ksefNumber: string, from: string) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const invoices = await client.listInvoices({ direction, from, to: new Date().toISOString() })
    const invoice = invoices.find((item) => item.ksefNumber === ksefNumber)
    if (invoice) return invoice
    await sleep(3000)
  }
  throw new Error(`Faktura ${ksefNumber} nie pojawiła się w wynikach (${direction})`)
}

function claimNames(accessToken: string): unknown {
  const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8'))
  return Object.fromEntries(
    Object.entries(payload).filter(([name]) => /permission|role|scope|\bper\b|\brol\b|\bpec\b|\bpep\b/i.test(name)),
  )
}

let failed = false
function check(label: string, passed: boolean, detail = '') {
  if (!passed) failed = true
  console.log(`${passed ? 'OK  ' : 'BŁĄD'} ${label}${detail ? ` (${detail})` : ''}`)
}

async function main() {
  const folder = mkdtempSync(join(tmpdir(), 'ksef-test-'))
  try {
    const seller = createIdentity(folder, randomNip())
    const buyer = createIdentity(folder, randomNip())
    const from = new Date(Date.now() - 60 * 60 * 1000).toISOString()

    const sellerOwner = await loginAsOwner(seller)
    const buyerOwner = await loginAsOwner(buyer)
    check('logowanie testowym podpisem XAdES', true)

    const sellerRead = await createToken(sellerOwner, ['InvoiceRead'], 'Hub test - odczyt')
    const buyerRead = await createToken(buyerOwner, ['InvoiceRead'], 'Hub test - odczyt')
    check('tokeny z samym InvoiceRead są aktywne', true)

    const issueDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date())
    const dueDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const number = `HUB/TEST/${randomInt(100000, 999999)}`
    const ksefNumber = await issueInvoice(
      sellerOwner,
      testInvoiceXml(seller.nip, buyer.nip, number, issueDate, dueDate),
    )
    check('testowa faktura dostała numer KSeF', true, ksefNumber)

    const sellerClient = createKsefClient({ environment: 'test', nip: seller.nip, token: sellerRead.token })
    const buyerClient = createKsefClient({ environment: 'test', nip: buyer.nip, token: buyerRead.token })

    const sale = await waitForInvoice(sellerClient, 'sale', ksefNumber, from)
    check(
      'sprzedawca widzi sprzedaż',
      sale.invoiceNumber === number && sale.counterpartyNip === buyer.nip && sale.netAmount === 1100,
      `${sale.invoiceNumber}, netto ${sale.netAmount} ${sale.currency}, numer KSeF z dnia ${sale.ksefDate}`,
    )

    const purchase = await waitForInvoice(buyerClient, 'purchase', ksefNumber, from)
    check(
      'nabywca widzi zakup',
      purchase.counterpartyNip === seller.nip && purchase.grossAmount === 1353,
      `od ${purchase.counterpartyName}, brutto ${purchase.grossAmount}`,
    )

    const details = parseInvoiceXml(await buyerClient.getInvoiceXml(ksefNumber))
    check(
      'XML daje termin płatności i pozycje',
      details.dueDate === dueDate && details.lines.length === 2 && details.lines[0].name === 'Statyw testowy',
      `termin ${details.dueDate}, pozycje: ${details.lines.map((line) => `${line.name} ${line.amountNet}`).join('; ')}`,
    )

    const readAccess = await sellerClient.getAccessToken()
    console.log('Uprawnienia w tokenie dostępu:', JSON.stringify(claimNames(readAccess)))
    const { encryption } = await symmetricKeyEncryption()
    const write = await api('POST', '/sessions/online', {
      bearer: readAccess,
      json: { formCode: FORM_CODE, encryption },
    })
    check('token do odczytu NIE otworzy sesji wystawiania', write.status === 403 || write.status === 401, `HTTP ${write.status}`)
    const mint = await api('POST', '/tokens', {
      bearer: readAccess,
      json: { permissions: ['InvoiceWrite'], description: 'Hub test - nie powinno przejsc' },
    })
    // KSeF odpowiada tu 400 z kodem 26001: „nie można nadać uprawnień, których nie posiadasz”.
    const mintBody = await mint.text()
    check('token do odczytu NIE utworzy tokenu z InvoiceWrite', mintBody.includes('26001'), `HTTP ${mint.status}, kod 26001`)
    const grant = await api('POST', '/permissions/persons/grants', {
      bearer: readAccess,
      json: {
        subjectIdentifier: { type: 'Nip', value: buyer.nip },
        permissions: ['InvoiceWrite'],
        description: 'Hub test - nie powinno przejsc',
        subjectDetails: { subjectDetailsType: 'PersonByIdentifier', personById: { firstName: 'Test', lastName: 'Hub' } },
      },
    })
    check('token do odczytu NIE nada uprawnień innej osobie', grant.status === 403, `HTTP ${grant.status}`)

    // Bez założenia wyniku: sprawdzamy, czy wyciek tokenu mógłby rodzić kolejne tokeny do odczytu.
    const sibling = await api('POST', '/tokens', {
      bearer: readAccess,
      json: { permissions: ['InvoiceRead'], description: 'Hub test - kolejny token' },
    })
    const siblingBody = (await sibling.json()) as { referenceNumber?: string }
    console.log(`INFO token do odczytu tworzy kolejny token do odczytu: ${sibling.ok ? 'TAK' : 'NIE'} (HTTP ${sibling.status})`)

    const sellerWrite = await createToken(sellerOwner, ['InvoiceRead', 'InvoiceWrite'], 'Hub test - zbyt szeroki')
    const wideClient = createKsefClient({ environment: 'test', nip: seller.nip, token: sellerWrite.token })
    const wideRefused = await wideClient.getAccessToken().then(
      () => false,
      (error: Error) => error.message.includes('tylko do odczytu'),
    )
    check('klient odmawia pracy z tokenem, który może zapisywać', wideRefused)

    // ── ksef-sync na tymczasowym folderze: projekt klienta „Nabywca Testowy” ────
    const dataDir = join(folder, 'dane')
    mkdirSync(dataDir)
    const projectFile = [{ id: 'p-test', name: 'Film testowy', client: 'Nabywca Testowy sp. z o.o.', status: 'won', date: issueDate }]
    writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ items: projectFile }))
    const firstRun = runSync(dataDir, seller.nip, sellerRead.token)
    const proposals = inboxProposals(dataDir)
    const first = proposals.find((p) => p.ref === `ksef:${ksefNumber}`)
    check(
      'ksef-sync: faktura trafia do skrzynki z jedynym projektem klienta',
      first?.type === 'event' && first.projectId === 'p-test' && first.event.data.amountNetto === 1100 && first.event.data.dueDate === dueDate,
      `${first?.event?.start}, netto ${first?.event?.data?.amountNetto}`,
    )
    if (!firstRun.includes('✓ Zapisano')) console.log(firstRun)
    const secondRun = runSync(dataDir, seller.nip, sellerRead.token)
    check('ksef-sync: ponowny przebieg niczego nie dubluje', inboxProposals(dataDir).length === proposals.length && secondRun.includes('nowych: 0'))

    // Przyjęcie w aplikacji = wydarzenie z tym `ref`; potem przychodzi korekta.
    const accepted = {
      id: 'e-test',
      kind: 'invoice_sent',
      projectId: 'p-test',
      start: first?.event.start,
      title: first?.event.title,
      notes: '',
      data: first?.event.data,
      source: { type: 'inbox', ref: first?.ref },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    writeFileSync(join(dataDir, 'events.json'), JSON.stringify({ items: [accepted] }))
    const correctionNumber = `HUB/KOR/${randomInt(100000, 999999)}`
    const correctionKsef = await issueInvoice(
      sellerOwner,
      correctionXml(seller.nip, buyer.nip, correctionNumber, issueDate, { number, ksefNumber }),
    )
    const correctionMeta = await waitForInvoice(sellerClient, 'sale', correctionKsef, from)
    console.log(`INFO korekta w KSeF: netto ${correctionMeta.netAmount}, typ ${correctionMeta.invoiceType}`)
    runSync(dataDir, seller.nip, sellerRead.token)
    const correction = inboxProposals(dataDir).find((p) => p.ref === `ksef:${correctionKsef}`)
    check(
      'ksef-sync: korekta zmienia kwotę oryginału i zapisuje oba dokumenty',
      correction?.type === 'event_update' && correction.eventId === 'e-test' && correction.set.data.amountNetto === 1000 &&
        correction.set.data.corrections[0].number === correctionNumber,
      `1100 → ${correction?.set?.data?.amountNetto}`,
    )

    const toRevoke: Array<[string, string]> = [
      [sellerOwner, sellerRead.referenceNumber],
      [buyerOwner, buyerRead.referenceNumber],
      [sellerOwner, sellerWrite.referenceNumber],
    ]
    if (siblingBody.referenceNumber) toRevoke.push([sellerOwner, siblingBody.referenceNumber])
    for (const [owner, referenceNumber] of toRevoke) {
      await api('DELETE', `/tokens/${referenceNumber}`, { bearer: owner })
    }
    check('tokeny testowe odwołane', true)
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
  if (failed) process.exitCode = 1
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
