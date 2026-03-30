'use client'

import { useState } from 'react'
import { writeTextFile, readTextFile, exists, mkdir, BaseDirectory } from '@tauri-apps/plugin-fs'
import { isTauri } from '@tauri-apps/api/core'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const DEMO_FILE = 'my-quotes.txt'
const DEMO_TEXT = 'Tauri file system is working!'

/**
 * Test zapisu/odczytu w katalogu aplikacji (BaseDirectory.AppData).
 * Na macOS: ~/Library/Application Support/<bundle-id>/
 *
 * Po zmianie zależności Rust lub `capabilities` — pełny restart aplikacji Tauri.
 */
export function FileTester() {
  const [content, setContent] = useState('')
  const [status, setStatus] = useState('')
  const tauri = isTauri()

  async function handleSaveFile() {
    if (!tauri) return
    try {
      const dirExists = await exists('', { baseDir: BaseDirectory.AppData })
      if (!dirExists) {
        await mkdir('', { baseDir: BaseDirectory.AppData })
      }
      await writeTextFile(DEMO_FILE, DEMO_TEXT, { baseDir: BaseDirectory.AppData })
      setStatus('Plik zapisany poprawnie.')
    } catch (error) {
      console.error(error)
      setStatus(`Błąd zapisu: ${String(error)}`)
    }
  }

  async function handleReadFile() {
    if (!tauri) return
    try {
      const text = await readTextFile(DEMO_FILE, { baseDir: BaseDirectory.AppData })
      setContent(text)
      setStatus('Plik odczytany poprawnie.')
    } catch (error) {
      console.error(error)
      setStatus(`Błąd odczytu: ${String(error)}`)
    }
  }

  return (
    <div
      className={cn(
        'rounded-lg border border-white/10 bg-zinc-900/40 p-4 backdrop-blur-xl',
        !tauri && 'opacity-60'
      )}
    >
      <h2 className="text-base font-semibold text-zinc-100">Test lokalnego systemu plików</h2>
      <p className="mt-1 text-xs text-zinc-500">
        Ścieżki przez <code className="text-zinc-400">BaseDirectory.AppData</code> — bez hardcodowania (np. na Macu katalog wsparcia aplikacji).
      </p>
      {!tauri ? (
        <p className="mt-2 text-xs text-zinc-500">Dostępne w aplikacji Tauri (nie w zwykłej przeglądarce).</p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-3">
        <Button type="button" variant="outline" size="lg" disabled={!tauri} onClick={handleSaveFile}>
          Zapisz plik
        </Button>
        <Button type="button" variant="outline" size="lg" disabled={!tauri} onClick={handleReadFile}>
          Odczytaj plik
        </Button>
      </div>
      {status ? (
        <p className="mt-3 text-sm text-zinc-300" role="status">
          <span className="font-medium text-zinc-400">Status:</span> {status}
        </p>
      ) : null}
      {content ? (
        <p className="mt-2 text-sm text-orange-500">
          <span className="font-medium text-zinc-400">Treść pliku:</span> {content}
        </p>
      ) : null}
    </div>
  )
}
