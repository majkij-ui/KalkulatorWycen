'use client'

/**
 * Kopia operacji z wyciągów bankowych w folderze danych huba (`bank/operacje.json`).
 * Powstaje z plików CSV wczytanych w Finanse → KSeF; da się ją odtworzyć z tych plików,
 * więc nie wchodzi do automatycznych kopii zapasowych (jak kopia faktur z KSeF).
 *
 * W przeglądarce (podgląd deweloperski) kopia to localStorage `nonoise-bank-v1`.
 */

import { BaseDirectory, exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import {
  BANK_DIR,
  BANK_FILE,
  bankCopyFile,
  decodeBankFile,
  EMPTY_BANK,
  mergeBankFile,
  parseBankCopy,
  parseMbankList,
  type BankCopy,
} from './bank-statement'
import { isTauriRuntime } from './storage'

export const WEB_BANK_KEY = 'nonoise-bank-v1'
const PATH = `${BANK_DIR}/${BANK_FILE}`

export async function readBankCopy(): Promise<BankCopy> {
  try {
    if (!isTauriRuntime()) {
      const raw = typeof window === 'undefined' ? null : localStorage.getItem(WEB_BANK_KEY)
      return (raw ? parseBankCopy(JSON.parse(raw)) : null) ?? EMPTY_BANK
    }
    if (!(await exists(PATH, { baseDir: BaseDirectory.AppData }))) return EMPTY_BANK
    return parseBankCopy(JSON.parse(await readTextFile(PATH, { baseDir: BaseDirectory.AppData }))) ?? EMPTY_BANK
  } catch {
    return EMPTY_BANK
  }
}

async function writeBankCopy(copy: BankCopy): Promise<void> {
  const text = JSON.stringify(bankCopyFile(copy), null, 2)
  if (!isTauriRuntime()) {
    localStorage.setItem(WEB_BANK_KEY, text)
    return
  }
  await mkdir(BANK_DIR, { baseDir: BaseDirectory.AppData, recursive: true })
  await writeTextFile(PATH, text, { baseDir: BaseDirectory.AppData })
}

/** Wczytuje plik z banku do kopii. Rzuca `BankFileError`, gdy to nie jest znany układ. */
export async function importBankFile(file: File): Promise<{ copy: BankCopy; added: number; total: number; from: string; to: string }> {
  const parsed = parseMbankList(decodeBankFile(new Uint8Array(await file.arrayBuffer())))
  const merged = mergeBankFile(await readBankCopy(), parsed, file.name, new Date().toISOString())
  await writeBankCopy(merged.copy)
  return { copy: merged.copy, added: merged.added, total: parsed.operations.length, from: parsed.from, to: parsed.to }
}
