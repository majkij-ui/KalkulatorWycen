'use client'

import { useState } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { FileTester } from '@/components/file-tester'
import { QuoteCalculator } from '@/components/quote-calculator'

export default function Home() {
  const [response, setResponse] = useState('')

  async function handleSafeAction() {
    try {
      const result = await invoke<string>('safe_local_action', { name: 'Michal' })
      setResponse(result)
    } catch (error) {
      console.error('Błąd wywołania Rust:', error)
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <section
        className="shrink-0 border-b border-white/10 bg-zinc-900/40 px-6 py-4 backdrop-blur-xl"
        aria-label="Integracja Tauri — Rust"
      >
        <h1 className="text-lg font-semibold text-zinc-100">QuoteGen — wersja desktopowa</h1>
        <p className="mt-1 text-xs text-zinc-500">
          Przykładowe wywołanie komendy Rust przez <code className="text-zinc-400">invoke</code> (możesz tu podłączyć zapis stanu).
          Po zmianach w Rust lub uprawnieniach fs — zrestartuj całkowicie aplikację Tauri.
        </p>
        <button
          type="button"
          onClick={handleSafeAction}
          disabled={!isTauri()}
          title={isTauri() ? undefined : 'Dostępne tylko w aplikacji Tauri'}
          className="mt-3 h-10 rounded-md border border-white/10 bg-zinc-800 px-4 text-sm text-zinc-100 transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Wywołaj bezpieczną akcję lokalną (Rust)
        </button>
        {response ? (
          <p className="mt-3 text-sm text-orange-500" role="status">
            {response}
          </p>
        ) : null}
        <div className="mt-6 max-w-2xl">
          <FileTester />
        </div>
      </section>
      <QuoteCalculator />
    </div>
  )
}
