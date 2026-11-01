'use client'

/**
 * Zapis pliku CSV z konwersjami: w aplikacji natywne „Zapisz jako…" + `writeFile`
 * (jak `export-report.ts`: `fs:allow-write-file` w $HOME i `dialog:allow-save`,
 * żadnego nowego uprawnienia), w przeglądarce zwykłe pobranie.
 *
 * Wynik `cancelled` oznacza, że NIC nie zostało zapisane — wołający nie
 * wpisuje wtedy rekordów `pending`.
 */

import { isTauriRuntime } from './storage'

export type AdsFileResult =
  | { status: 'saved'; path: string }
  | { status: 'downloaded'; fileName: string }
  | { status: 'cancelled' }

export function adsExportFileName(today: string): string {
  return `google-ads-konwersje-${today}.csv`
}

export async function saveAdsCsv(csv: string, fileName: string): Promise<AdsFileResult> {
  if (isTauriRuntime()) {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const { writeFile } = await import('@tauri-apps/plugin-fs')
    const chosen = await save({ defaultPath: fileName, filters: [{ name: 'CSV', extensions: ['csv'] }] })
    if (!chosen) return { status: 'cancelled' }
    // Bez BOM: Google Ads czyta UTF-8 wprost.
    await writeFile(chosen, new TextEncoder().encode(csv))
    return { status: 'saved', path: chosen }
  }

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
  return { status: 'downloaded', fileName }
}
