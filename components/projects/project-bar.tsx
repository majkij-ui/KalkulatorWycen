'use client'

/**
 * Pasek otwartego projektu — siedzi nad kalkulatorem.
 *
 * Daje to, czego brakowało w bibliotece wycen: kontekst (który projekt jest
 * otwarty), zmianę statusu „wycena → projekt" jednym kliknięciem, datę
 * księgową i powrót do listy.
 */

import { useEffect, useState } from 'react'
import { ArrowLeft, Check, Loader2, Save } from 'lucide-react'
import { useProjectHub } from '@/lib/project-hub-context'
import { ProjectStatusPicker } from './project-status-badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function ProjectBar() {
  const { activeProject, closeProject, saveActiveProject, updateActiveProject, setStatus } =
    useProjectHub()

  const [saving, setSaving] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const [nameDraft, setNameDraft] = useState('')

  // Nazwa jest polem kontrolowanym; synchronizujemy przy zmianie projektu.
  useEffect(() => {
    setNameDraft(activeProject?.name ?? '')
  }, [activeProject?.id, activeProject?.name])

  useEffect(() => {
    if (!justSaved) return
    const timer = setTimeout(() => setJustSaved(false), 1800)
    return () => clearTimeout(timer)
  }, [justSaved])

  if (!activeProject) return null

  const handleSave = async () => {
    setSaving(true)
    await saveActiveProject()
    setSaving(false)
    setJustSaved(true)
  }

  const commitName = () => {
    const trimmed = nameDraft.trim()
    if (trimmed && trimmed !== activeProject.name) {
      updateActiveProject({ name: trimmed })
    } else {
      setNameDraft(activeProject.name)
    }
  }

  return (
    // Celowo NIE sticky: przyklejony zostaje nagłówek kalkulatora z sumą netto,
    // bo to jego wartość śledzi się podczas edycji. Dwa przyklejone paski
    // nachodziłyby na siebie (oba `top-0`).
    <div className="border-b border-white/5 bg-black/40">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-3 px-4 py-2.5">
        <Button
          variant="ghost"
          size="sm"
          onClick={closeProject}
          className="h-8 shrink-0 gap-1.5 px-2 text-zinc-400 hover:text-white"
        >
          <ArrowLeft className="size-4" />
          Projekty
        </Button>

        <Input
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          aria-label="Nazwa projektu"
          className="h-8 min-w-[140px] max-w-[260px] flex-1 border-transparent bg-transparent px-2 text-sm font-semibold text-white hover:border-white/10 focus:border-white/20 focus:bg-black/40"
        />

        <Input
          type="date"
          value={activeProject.date}
          onChange={(e) => {
            const next = e.target.value
            if (/^\d{4}-\d{2}-\d{2}$/.test(next)) updateActiveProject({ date: next })
          }}
          aria-label="Data księgowa projektu"
          className="h-8 w-[140px] shrink-0 border-white/10 bg-black/40 px-2 text-xs tabular-nums text-zinc-300"
        />

        <div className="ml-auto flex items-center gap-2">
          <ProjectStatusPicker
            status={activeProject.status}
            onChange={(status) => setStatus(activeProject.id, status)}
          />

          <Button onClick={handleSave} disabled={saving} size="sm" className="h-8 shrink-0 gap-1.5">
            {saving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : justSaved ? (
              <Check className="size-3.5" />
            ) : (
              <Save className="size-3.5" />
            )}
            {justSaved ? 'Zapisano' : 'Zapisz'}
          </Button>
        </div>
      </div>
    </div>
  )
}
