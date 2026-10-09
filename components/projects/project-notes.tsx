'use client'

/**
 * Zakładka „Notatki" — `Project.notes`, wnioski z projektu. Zapis automatyczny:
 * chwilę po ostatnim naciśnięciu klawisza, przy wyjściu z pola i przy zmianie
 * zakładki. Zapis idzie przez hub na NAJŚWIEŻSZEJ wersji projektu, więc nie
 * cofa zmian zrobionych w międzyczasie w nagłówku.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { useProjectHub } from '@/lib/project-hub-context'
import type { Project } from '@/lib/project-types'

const SAVE_DELAY_MS = 700

export function ProjectNotes({ project }: { project: Project }) {
  const { updateProject } = useProjectHub()
  const [text, setText] = useState(project.notes)
  const [state, setState] = useState<'saved' | 'dirty' | 'saving'>('saved')
  const pendingRef = useRef<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const flush = useCallback(async () => {
    clearTimeout(timerRef.current)
    const value = pendingRef.current
    if (value === null) return
    pendingRef.current = null
    setState('saving')
    await updateProject(project.id, { notes: value })
    // Ktoś pisał dalej w trakcie zapisu — zostaje „niezapisane" do kolejnego.
    setState(pendingRef.current === null ? 'saved' : 'dirty')
  }, [project.id, updateProject])

  // Wyjście z zakładki (odmontowanie) zapisuje to, co czeka.
  const flushRef = useRef(flush)
  flushRef.current = flush
  useEffect(() => () => void flushRef.current(), [])

  // Notatki zmienione z zewnątrz (import z rozmowy z Claude) — tylko gdy nic nie czeka.
  useEffect(() => {
    if (pendingRef.current === null && state === 'saved') setText(project.notes)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.notes])

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold text-white" style={{ fontFamily: 'var(--font-archivo)' }}>
          Notatki
        </h2>
        <span className="flex items-center gap-1.5 text-xs text-zinc-500" role="status" aria-live="polite">
          {state === 'saving' ? (
            <>
              <Loader2 className="size-3 animate-spin" /> Zapisywanie…
            </>
          ) : state === 'dirty' ? (
            'Niezapisane zmiany'
          ) : (
            <>
              <Check className="size-3" /> Zapisano
            </>
          )}
        </span>
      </div>
      <p className="mt-1 text-sm text-zinc-500">
        Wnioski z projektu: co poszło dobrze, co następnym razem wycenić albo zaplanować inaczej.
      </p>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          pendingRef.current = e.target.value
          setState('dirty')
          clearTimeout(timerRef.current)
          timerRef.current = setTimeout(() => void flush(), SAVE_DELAY_MS)
        }}
        onBlur={() => void flush()}
        aria-label="Notatki projektu"
        placeholder="np. Montaż zajął 2 dni dłużej niż w wycenie — klient prosił o 3 rundy poprawek."
        className="mt-4 min-h-[320px] w-full resize-y rounded-xl border border-white/10 bg-black/40 p-4 text-sm leading-relaxed text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-white/25"
      />
    </div>
  )
}
