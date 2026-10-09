'use client'

/**
 * Nagłówek otwartego projektu (T3, plan §6b) — zastąpił zatłoczony pasek.
 *
 *   wiersz 1: powrót do listy · status · „Zapisz"
 *   wiersz 2: nazwa na całą szerokość (zawija się, nigdy nie jest ściśnięta)
 *   wiersz 3: klient · data księgowa · pochodzenie klienta · „Zapłacone"
 *
 * Wszystko poza „Zapisz" zapisuje się od razu. „Zapisz" utrwala wycenę z
 * kalkulatora i pyta, zanim zastąpi finanse spoza kalkulatora
 * (`lib/project-save.ts`).
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Check, Loader2, Save, X } from 'lucide-react'
import { useProjectHub } from '@/lib/project-hub-context'
import { useEvents } from '@/lib/events-context'
import { clientDirectory } from '@/lib/clients'
import { leadsFromEvents } from '@/lib/marketing-leads'
import { LEAD_QUALITY_LABELS } from '@/lib/marketing-types'
import { LEAD_SOURCES, LEAD_SOURCE_LABELS, countsTowardRevenue, leadSourceLabel } from '@/lib/project-types'
import { ProjectStatusPicker } from './project-status-badge'
import { PaidToggle } from './paid-toggle'
import { ClientCombobox } from './client-combobox'
import { Button } from '@/components/ui/button'
import type { SaveActiveProjectResult } from '@/lib/project-hub-context'

type ReplacePrompt = Extract<SaveActiveProjectResult, { status: 'needs-confirmation' }>

const archivo = { fontFamily: 'var(--font-archivo)' }

function formatPln(amount: number): string {
  return `${Math.round(amount).toLocaleString('pl-PL', { useGrouping: 'always' })} zł`
}

const fieldClass =
  'h-8 rounded-md border border-white/10 bg-black/40 px-2 text-sm text-zinc-200 outline-none [color-scheme:dark] focus:border-white/30'

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-[11px] text-zinc-500">
        {label}
      </label>
      {children}
    </div>
  )
}

export function ProjectHeader() {
  const { activeProject, projects, closeProject, saveActiveProject, updateActiveProject, changeActiveClient, setStatus } =
    useProjectHub()
  const { events } = useEvents()
  const [saving, setSaving] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const [nameDraft, setNameDraft] = useState(activeProject?.name ?? '')
  const [contactNotice, setContactNotice] = useState<string | null>(null)
  const [replacePrompt, setReplacePrompt] = useState<ReplacePrompt | null>(null)
  const nameRef = useRef<HTMLTextAreaElement>(null)

  const directory = useMemo(() => clientDirectory(projects), [projects])

  // Pierwszy lead w wątku — podpowiedź przy pochodzeniu klienta.
  const firstLead = useMemo(() => {
    if (!activeProject) return null
    return leadsFromEvents(events).filter((l) => l.projectId === activeProject.id).at(-1) ?? null
  }, [events, activeProject])

  useEffect(() => {
    setNameDraft(activeProject?.name ?? '')
  }, [activeProject?.name])

  // Nazwa zawija się zamiast uciekać w bok: pole rośnie z treścią.
  useLayoutEffect(() => {
    const el = nameRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [nameDraft])

  useEffect(() => {
    if (!justSaved) return
    const timer = setTimeout(() => setJustSaved(false), 1800)
    return () => clearTimeout(timer)
  }, [justSaved])

  useEffect(() => {
    if (!contactNotice) return
    const timer = setTimeout(() => setContactNotice(null), 6000)
    return () => clearTimeout(timer)
  }, [contactNotice])

  if (!activeProject) return null

  const handleSave = async (replaceFinancials = false) => {
    setSaving(true)
    const result = await saveActiveProject({ replaceFinancials })
    setSaving(false)
    if (result.status === 'needs-confirmation') {
      setReplacePrompt(result)
      return
    }
    setReplacePrompt(null)
    if (result.status === 'saved') setJustSaved(true)
  }

  const commitName = () => {
    const trimmed = nameDraft.trim().replace(/\s+/g, ' ')
    if (trimmed && trimmed !== activeProject.name) void updateActiveProject({ name: trimmed })
    else setNameDraft(activeProject.name)
  }

  const commitClient = async (name: string) => {
    const choice = await changeActiveClient(name)
    if (choice?.contactFrom) {
      const who = choice.patch.contact?.name?.trim()
      setContactNotice(`Kontakt${who ? ` (${who})` : ''} skopiowany z projektu „${choice.contactFrom.name}".`)
    }
  }

  const leadHint = firstLead
    ? `Lead z ${firstLead.date.split('-').reverse().join('.')}${firstLead.quality ? ` · ${LEAD_QUALITY_LABELS[firstLead.quality]}` : ''}`
    : 'Skąd przyszedł klient'

  return (
    // Celowo NIE sticky: przyklejony zostaje nagłówek kalkulatora z sumą netto.
    <div className="border-b border-white/5 bg-black/40">
      <div className="mx-auto max-w-4xl px-4 pb-4 pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={closeProject}
            className="-ml-2 h-8 shrink-0 gap-1.5 px-2 text-zinc-400 hover:text-white"
          >
            <ArrowLeft className="size-4" />
            Projekty
          </Button>

          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <ProjectStatusPicker
              status={activeProject.status}
              onChange={(status) => setStatus(activeProject.id, status)}
            />
            <Button
              onClick={() => handleSave()}
              disabled={saving || !!replacePrompt}
              size="sm"
              className="h-8 shrink-0 gap-1.5"
              title="Zapisz wycenę z kalkulatora w projekcie"
            >
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

        <textarea
          ref={nameRef}
          rows={1}
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value.replace(/\n/g, ' '))}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              e.currentTarget.blur()
            }
            if (e.key === 'Escape') {
              setNameDraft(activeProject.name)
              e.currentTarget.blur()
            }
          }}
          aria-label="Nazwa projektu"
          spellCheck={false}
          className="-mx-2 mt-2 block w-[calc(100%+1rem)] resize-none overflow-hidden rounded-md border border-transparent bg-transparent px-2 py-1 text-2xl font-semibold leading-tight tracking-tight text-white outline-none hover:border-white/10 focus:border-white/20 focus:bg-black/40"
          style={archivo}
        />

        <div className="mt-3 flex flex-wrap items-end gap-x-3 gap-y-2">
          <Field label="Klient">
            <ClientCombobox
              value={activeProject.client}
              directory={directory}
              onCommit={(name) => void commitClient(name)}
              free
              placeholder="Wpisz albo wybierz…"
              ariaLabel="Klient"
              className="w-60"
            />
          </Field>

          <Field label="Data księgowa" htmlFor="project-date">
            <input
              id="project-date"
              type="date"
              value={activeProject.date}
              onChange={(e) => {
                const next = e.target.value
                if (/^\d{4}-\d{2}-\d{2}$/.test(next)) void updateActiveProject({ date: next })
              }}
              className={`${fieldClass} w-[150px] tabular-nums`}
            />
          </Field>

          <Field label="Pochodzenie klienta" htmlFor="project-origin">
            <select
              id="project-origin"
              value={activeProject.leadSource ?? ''}
              onChange={(e) => void updateActiveProject({ leadSource: e.target.value || undefined })}
              title={leadHint}
              className={`${fieldClass} w-[190px] ${activeProject.leadSource ? '' : 'text-zinc-500'}`}
            >
              <option value="">Nieustalone</option>
              {LEAD_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {LEAD_SOURCE_LABELS[s]}
                </option>
              ))}
              {activeProject.leadSource && !(LEAD_SOURCES as readonly string[]).includes(activeProject.leadSource) && (
                <option value={activeProject.leadSource}>{leadSourceLabel(activeProject.leadSource)}</option>
              )}
            </select>
          </Field>

          {countsTowardRevenue(activeProject.status) && (
            <div className="pb-0.5">
              <PaidToggle project={activeProject} />
            </div>
          )}
        </div>

        {contactNotice && (
          <p className="mt-2 flex items-center gap-2 text-xs text-emerald-300/90" role="status">
            {contactNotice}
            <button
              type="button"
              onClick={() => setContactNotice(null)}
              aria-label="Zamknij"
              className="rounded p-0.5 text-zinc-500 hover:text-zinc-200"
            >
              <X className="size-3" />
            </button>
          </p>
        )}

        {replacePrompt && (
          // Projekt ma finanse spoza kalkulatora (np. retro-import) — zapis
          // wyceny by je zastąpił, więc tylko po jawnej zgodzie.
          <div
            className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-200/90"
            role="alert"
          >
            <span className="min-w-0 flex-1">
              Ten projekt ma finanse z importu ({formatPln(replacePrompt.current.sumaNetto)}). Zastąpić je wyceną z
              kalkulatora ({formatPln(replacePrompt.proposed?.sumaNetto ?? 0)})?
            </span>
            <Button
              size="sm"
              variant="destructive"
              className="h-7 px-2 text-xs"
              disabled={saving}
              onClick={() => handleSave(true)}
            >
              Zastąp
            </Button>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setReplacePrompt(null)}>
              Anuluj
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
