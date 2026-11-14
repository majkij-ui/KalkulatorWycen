/**
 * Wyciąg z banku: odczyt pliku CSV i kopia operacji w hubie.
 *
 * Na razie jeden układ: mBank, „Lista operacji" (Historia → Eksport do CSV).
 * Plik niczego nie zmienia w projektach: operacje trafiają do kopii
 * (`bank/operacje.json`), a hub zestawia je z fakturami z KSeF (`bank-match.ts`)
 * i z podatkami (`taxes.ts`).
 *
 * Moduł czysty — testy w `bank.test.ts`.
 */

import { z } from 'zod'

export const BANK_DIR = 'bank'
export const BANK_FILE = 'operacje.json'
export const BANK_FORMAT = 'nonoise-hub-bank'
export const BANK_VERSION = 1

/**
 * Czym jest operacja dla huba:
 *  - `income`    wpłata z zewnątrz (kandydat na zapłatę faktury),
 *  - `internal`  przelew między własnymi rachunkami (także techniczne przelewy VAT),
 *  - `tax_vat`   VAT do urzędu skarbowego,
 *  - `tax_flat`  ryczałt (symbol PPE),
 *  - `zus`       składki ZUS,
 *  - `fee`       opłata bankowa,
 *  - `outside`   reszta wychodzących: prywatne, PIT-38, VAT-9M — poza hubem (decyzja M.J., 2026-11-14).
 */
export const BANK_KINDS = ['income', 'internal', 'tax_vat', 'tax_flat', 'zus', 'fee', 'outside'] as const
export type BankKind = (typeof BANK_KINDS)[number]

export const bankOperationSchema = z
  .object({
    id: z.string().min(1),
    /** RRRR-MM-DD. */
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    /** Opis z banku, z pojedynczymi spacjami. */
    description: z.string().catch(''),
    account: z.string().catch(''),
    category: z.string().catch(''),
    amount: z.number().finite(),
    currency: z.string().catch('PLN'),
    kind: z.enum(BANK_KINDS).catch('outside'),
    /** Rachunek drugiej strony (koniec opisu); pusty, gdy bank go nie podał. */
    counterAccount: z.string().catch(''),
  })
  .passthrough()
export type BankOperation = z.infer<typeof bankOperationSchema>

export interface BankImport {
  name: string
  importedAt: string
  /** Okres z nagłówka pliku, RRRR-MM-DD. */
  from: string
  to: string
  operations: number
}

export interface BankCopy {
  operations: BankOperation[]
  imports: BankImport[]
}

export const EMPTY_BANK: BankCopy = { operations: [], imports: [] }

export class BankFileError extends Error {}

// ── Odczyt pliku ─────────────────────────────────────────────────────────────

/** Bajty pliku → tekst: mBank daje UTF-8 z BOM, starsze eksporty Windows-1250. */
export function decodeBankFile(bytes: Uint8Array): string {
  const utf8 = new TextDecoder('utf-8').decode(bytes)
  const text = utf8.includes('�') ? new TextDecoder('windows-1250').decode(bytes) : utf8
  return text.replace(/^﻿/, '')
}

/** Pola wiersza rozdzielone średnikiem; cudzysłów w cudzysłowie to `""`. */
function splitRow(line: string): string[] {
  const fields: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (char === '"') quoted = false
      else field += char
    } else if (char === '"') quoted = true
    else if (char === ';') {
      fields.push(field)
      field = ''
    } else field += char
  }
  fields.push(field)
  return fields
}

const polishDay = (value: string) => {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value.trim())
  return match ? `${match[3]}-${match[2]}-${match[1]}` : ''
}

function classify(description: string, category: string, amount: number): BankKind {
  const text = description.toUpperCase()
  if (/PRZELEW VAT (PRZYCH|WYCH)\. WŁASNY|PRZELEW VAT (PRZYCHODZĄCY|WYCHODZĄCY) TECHN|POTRĄCENIE WIERZYTELNOŚCI/.test(text)) return 'internal'
  if (category === 'Przelew własny' || category === 'Księgowanie VAT') return 'internal'
  if (/URZĄD SKARBOWY/.test(text)) {
    // VAT-9M (zaległość sprzed rejestracji) i PIT-38 (prywatny) nie są podatkami firmy w hubie.
    if (/VAT-9M|PIT-38/.test(text)) return 'outside'
    if (/URZĄD SKARBOWY, VAT\b/.test(text)) return 'tax_vat'
    if (/URZĄD SKARBOWY, PPE\b/.test(text)) return 'tax_flat'
    return 'outside'
  }
  if (/ZAKŁAD UBEZPIECZEŃ SPOŁECZNYCH|PRZELEW ZEWNĘTRZNY DO ZUS/.test(text)) return 'zus'
  if (/^OPŁATA /.test(text)) return 'fee'
  return amount > 0 ? 'income' : 'outside'
}

/** Mały, stały skrót tekstu (FNV-1a): id operacji ma być takie samo przy każdym wczytaniu pliku. */
function hash(text: string): string {
  let value = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index)
    value = Math.imul(value, 0x01000193)
  }
  return (value >>> 0).toString(16).padStart(8, '0')
}

export interface ParsedBankFile {
  from: string
  to: string
  operations: BankOperation[]
}

/** „Lista operacji" mBanku. Rzuca `BankFileError`, gdy to inny plik. */
export function parseMbankList(text: string): ParsedBankFile {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  const header = lines.findIndex((line) => line.startsWith('#Data operacji;#Opis operacji;#Rachunek;#Kategoria;#Kwota'))
  if (header === -1) {
    throw new BankFileError(
      'To nie wygląda na „Listę operacji” z mBanku (Historia → Eksport → CSV). Innych banków i układów hub jeszcze nie czyta.',
    )
  }
  const periodLine = lines.findIndex((line) => line.startsWith('#Za okres'))
  const [from, to] = periodLine === -1 ? ['', ''] : splitRow(lines[periodLine + 1] ?? '').map(polishDay)

  const seen = new Map<string, number>()
  const operations: BankOperation[] = []
  for (const line of lines.slice(header + 1)) {
    const [date, rawDescription, account, category, rawAmount] = splitRow(line)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) continue
    const money = /^(-?[\d\s ]+,\d{2})\s*([A-Z]{3})$/.exec((rawAmount ?? '').trim())
    if (!money) continue
    const amount = Number(money[1].replace(/[\s ]/g, '').replace(',', '.'))
    const description = rawDescription.replace(/\s+/g, ' ').trim()
    const counterAccount = /(?:^| )((?:[A-Z]{2})?\d{20,30})$/.exec(description)?.[1] ?? ''
    // Dwie identyczne operacje jednego dnia (np. dwie opłaty) różni kolejny numer.
    const base = `${date}|${amount.toFixed(2)}|${money[2]}|${account}|${description}`
    const occurrence = seen.get(base) ?? 0
    seen.set(base, occurrence + 1)
    operations.push({
      id: `op-${date}-${hash(base)}${occurrence ? `-${occurrence + 1}` : ''}`,
      date,
      description,
      account,
      category,
      amount,
      currency: money[2],
      kind: classify(description, category, amount),
      counterAccount,
    })
  }
  if (operations.length === 0) throw new BankFileError('W pliku nie ma żadnej operacji.')
  const days = operations.map((operation) => operation.date).sort()
  return { from: from || days[0], to: to || days.at(-1)!, operations }
}

// ── Kopia w hubie ────────────────────────────────────────────────────────────

/** Dokłada plik do kopii: operacje już znane (to samo id) się nie dublują. */
export function mergeBankFile(copy: BankCopy, file: ParsedBankFile, name: string, now: string): { copy: BankCopy; added: number } {
  const known = new Set(copy.operations.map((operation) => operation.id))
  const fresh = file.operations.filter((operation) => !known.has(operation.id))
  return {
    added: fresh.length,
    copy: {
      operations: [...copy.operations, ...fresh].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)),
      imports: [...copy.imports, { name, importedAt: now, from: file.from, to: file.to, operations: file.operations.length }],
    },
  }
}

export function parseBankCopy(raw: unknown): BankCopy | null {
  if (!raw || typeof raw !== 'object') return null
  const file = raw as Record<string, unknown>
  if (file.format !== BANK_FORMAT || typeof file.version !== 'number' || file.version > BANK_VERSION) return null
  const operations = Array.isArray(file.operations)
    ? file.operations.flatMap((entry) => {
        const parsed = bankOperationSchema.safeParse(entry)
        return parsed.success ? [parsed.data] : []
      })
    : []
  const imports = Array.isArray(file.imports) ? (file.imports as BankImport[]).filter((entry) => entry && typeof entry.from === 'string') : []
  return { operations, imports }
}

export function bankCopyFile(copy: BankCopy) {
  return { format: BANK_FORMAT, version: BANK_VERSION, ...copy }
}

/** Czy wyciągi obejmują ten dzień (żeby „brak przelewu" nie znaczył „brak wyciągu"). */
export function bankCovers(copy: BankCopy, day: string): boolean {
  return copy.imports.some((entry) => entry.from <= day && day <= entry.to)
}

/** Ostatni dzień objęty wyciągami; pusty, gdy nic nie wczytano. */
export function bankCoveredTo(copy: BankCopy): string {
  return copy.imports.map((entry) => entry.to).sort().at(-1) ?? ''
}
