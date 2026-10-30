/**
 * Faktury z KSeF sprowadzone do tego, czego potrzebuje hub.
 *
 * Moduł czysty — testy w `ksef.test.ts`. Niczego nie zapisuje; propozycje dla
 * Skrzynki powstaną z tych rekordów w kolejnym etapie.
 *
 * Metadane KSeF mają kwoty i daty, ale nie mają terminu płatności ani pozycji:
 * te są tylko w XML-u faktury, stąd `parseInvoiceXml`.
 */

export type KsefDirection = 'sale' | 'purchase'

/** `InvoiceMetadata` z KSeF API 2.0 — tylko pola, z których korzystamy. */
export interface KsefInvoiceMetadata {
  ksefNumber: string
  invoiceNumber: string
  issueDate: string
  acquisitionDate: string
  permanentStorageDate: string
  seller: { nip: string; name?: string | null }
  buyer: { identifier: { type: string; value?: string | null }; name?: string | null }
  netAmount: number
  grossAmount: number
  vatAmount: number
  currency: string
  invoiceType: string
}

export interface KsefInvoice {
  ksefNumber: string
  invoiceNumber: string
  direction: KsefDirection
  /** Data wystawienia z faktury: o niej decyduje okres przychodu. */
  issueDate: string
  /** Dzień nadania numeru KSeF w Polsce: wtedy faktura dociera do nabywcy. */
  ksefDate: string
  counterpartyName: string
  /** Pusty, gdy druga strona nie ma NIP-u (konsument, firma z zagranicy). */
  counterpartyNip: string
  netAmount: number
  grossAmount: number
  vatAmount: number
  currency: string
  invoiceType: string
  isCorrection: boolean
}

export interface KsefInvoiceLine {
  name: string
  unit: string
  quantity: number | null
  /** Cena jednostkowa netto albo brutto, zależnie od faktury; `null`, gdy jej brak. */
  unitPriceNet: number | null
  unitPriceGross: number | null
  amountNet: number | null
  amountGross: number | null
  vatRate: string
}

export interface KsefInvoiceDetails {
  /** Najpóźniejszy termin z faktury; pusty, gdy faktura go nie podaje. */
  dueDate: string
  lines: KsefInvoiceLine[]
  /** Faktura korygowana (tylko przy korekcie); puste, gdy korekta ich nie podaje. */
  correctedKsefNumber: string
  correctedNumber: string
}

const CORRECTION_TYPES = new Set(['Kor', 'KorZal', 'KorRoz', 'KorPef', 'KorVatRr'])

const warsawDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Warsaw',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function normalizeKsefInvoice(meta: KsefInvoiceMetadata, direction: KsefDirection): KsefInvoice {
  const isSale = direction === 'sale'
  const buyerNip = meta.buyer.identifier.type === 'Nip' ? (meta.buyer.identifier.value ?? '') : ''
  return {
    ksefNumber: meta.ksefNumber,
    invoiceNumber: meta.invoiceNumber,
    direction,
    issueDate: meta.issueDate,
    ksefDate: warsawDate.format(new Date(meta.acquisitionDate)),
    counterpartyName: (isSale ? meta.buyer.name : meta.seller.name) ?? '',
    counterpartyNip: isSale ? buyerNip : meta.seller.nip,
    netAmount: meta.netAmount,
    grossAmount: meta.grossAmount,
    vatAmount: meta.vatAmount,
    currency: meta.currency,
    invoiceType: meta.invoiceType,
    isCorrection: CORRECTION_TYPES.has(meta.invoiceType),
  }
}

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** Wnętrza wszystkich elementów o tej nazwie; prefiks przestrzeni nazw jest dowolny. */
function elements(xml: string, name: string): string[] {
  const pattern = new RegExp(`<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}>`, 'g')
  return Array.from(xml.matchAll(pattern), (match) => match[1])
}

function text(xml: string, name: string): string {
  const found = elements(xml, name)[0]
  return found === undefined ? '' : unescapeXml(found).trim()
}

function amount(xml: string, name: string): number | null {
  const value = text(xml, name)
  if (value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function parseInvoiceXml(xml: string): KsefInvoiceDetails {
  const dueDates = elements(xml, 'Termin')
    .map((value) => unescapeXml(value).trim())
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
    .sort()
  return {
    dueDate: dueDates.at(-1) ?? '',
    correctedKsefNumber: text(xml, 'NrKSeFFaKorygowanej'),
    correctedNumber: text(xml, 'NrFaKorygowanej'),
    lines: elements(xml, 'FaWiersz').map((line) => ({
      name: text(line, 'P_7'),
      unit: text(line, 'P_8A'),
      quantity: amount(line, 'P_8B'),
      unitPriceNet: amount(line, 'P_9A'),
      unitPriceGross: amount(line, 'P_9B'),
      amountNet: amount(line, 'P_11'),
      amountGross: amount(line, 'P_11A'),
      vatRate: text(line, 'P_12'),
    })),
  }
}
