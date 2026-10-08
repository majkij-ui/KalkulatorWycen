'use client'

/**
 * Formularz leada. Lead to wydarzenie `lead_in` — zapisany tutaj od razu
 * pokazuje się w Kalendarzu, a powiązany projekt ma go w swoim wątku.
 *
 * „Załóż projekt z tego leada" zakłada projekt bez wyceny z klientem, datą,
 * kontaktem i pochodzeniem klienta (z kampanii → Google Ads). Powiązanie z
 * istniejącym projektem uzupełnia mu pochodzenie, jeśli go jeszcze nie miał.
 */

import { useId, useMemo, useState } from 'react'
import { Loader2, Trash2, X } from 'lucide-react'
import { useEvents } from '@/lib/events-context'
import { useProjectHub } from '@/lib/project-hub-context'
import {
  draftFromLead,
  emptyLeadDraft,
  leadDraftProblems,
  leadEventFromDraft,
  type Lead,
  type LeadDraft,
  type LeadProblem,
} from '@/lib/marketing-leads'
import { originForPlatform, type Campaign } from '@/lib/marketing-types'
import { campaignActiveOn } from '@/lib/marketing-calc'
import {
  LEAD_SOURCES,
  LEAD_SOURCE_LABELS,
  PROJECT_STATUS_LABELS,
  type Project,
} from '@/lib/project-types'
import { FieldLabel, QualityPicker, inputClass } from './marketing-bits'

const NEW_PROJECT = '__new__'
const NO_CAMPAIGN = '__none__'

const PROBLEM_TEXT: Record<LeadProblem | 'projectName', string> = {
  date: 'Podaj datę zapytania.',
  time: 'Godzina w formacie GG:MM.',
  name: 'Kto się zgłosił? Wpisz firmę albo osobę.',
  projectName: 'Nadaj nazwę nowemu projektowi.',
}

export function LeadForm({
  lead,
  defaults,
  campaigns,
  onClose,
}: {
  lead: Lead | null
  /** `followDate` = kampania wynika z daty leada (aż do ręcznego wyboru). */
  defaults: { date: string; campaignId: string | null; followDate: boolean }
  campaigns: Campaign[]
  onClose: () => void
}) {
  const id = useId()
  const { save, remove } = useEvents()
  const { projects, createProjectWithoutQuote, updateProject } = useProjectHub()

  const [draft, setDraft] = useState<LeadDraft>(() =>
    lead ? draftFromLead(lead) : emptyLeadDraft(defaults)
  )
  const [newProject, setNewProject] = useState(false)
  const [projectName, setProjectName] = useState('')
  const [showProblems, setShowProblems] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)

  const set =(patch: Partial<LeadDraft>) => setDraft((d) => ({ ...d, ...patch }))

  const clients = useMemo(
    () => [...new Set(projects.map((p) => p.client.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pl')),
    [projects]
  )
  const campaign = campaigns.find((c) => c.id === draft.campaignId) ?? null
  const origin = campaign ? originForPlatform(campaign.platform) : draft.origin

  const problems: (LeadProblem | 'projectName')[] = [
    ...leadDraftProblems(draft),
    ...(newProject && !(projectName.trim() || draft.name.trim()) ? (['projectName'] as const) : []),
  ]

  // Nowy lead: kampania podąża za datą (ta, która wtedy trwała), dopóki
  // użytkownik nie wybierze jej sam. Edycja nigdy jej nie zmienia.
  const [campaignTouched, setCampaignTouched] = useState(!!lead || !defaults.followDate)
  const changeDate = (date: string) => {
    if (campaignTouched) set({ date })
    else set({ date, campaignId: campaignActiveOn(campaigns, date)?.id ?? null })
  }

  const submit = async () => {
    if (problems.length) {
      setShowProblems(true)
      return
    }
    setBusy(true)
    try {
      let projectId = draft.projectId
      if (newProject) {
        const contact =
          draft.contactName || draft.email || draft.phone
            ? { name: draft.contactName.trim(), email: draft.email.trim(), phone: draft.phone.trim() }
            : undefined
        const project = await createProjectWithoutQuote({
          name: projectName.trim() || draft.name.trim(),
          client: draft.name,
          date: draft.date,
          leadSource: origin || undefined,
          contact,
        })
        projectId = project?.id ?? null
      } else if (projectId && origin) {
        const linked = projects.find((p) => p.id === projectId)
        if (linked && !linked.leadSource) await updateProject(projectId, { leadSource: origin })
      }
      await save(leadEventFromDraft({ ...draft, projectId }, lead?.event ?? null))
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const projectOption = (p: Project) => (
    <option key={p.id} value={p.id}>
      {p.name}
      {p.client && p.client !== p.name ? ` (${p.client})` : ''} · {PROJECT_STATUS_LABELS[p.status]}
    </option>
  )

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
      className="space-y-4"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-xl font-semibold text-white" style={{ fontFamily: 'var(--font-archivo)' }}>
          {lead ? 'Lead' : 'Nowy lead'}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Zamknij formularz"
          className="rounded-md p-1 text-zinc-500 outline-none hover:bg-white/5 hover:text-zinc-200 focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <X className="size-4" />
        </button>
      </div>

      <div>
        <span className="mb-1 block text-[11px] text-zinc-500">Jakość</span>
        <QualityPicker value={draft.quality} onChange={(quality) => set({ quality })} />
        <p className="mt-1 text-[11px] text-zinc-600">
          Fałszywy = szuka pracy, spam, sprawa niezwiązana. Nie liczy się do realnych leadów.
        </p>
      </div>

      <div className="grid grid-cols-[1fr_7rem] gap-2">
        <div>
          <FieldLabel htmlFor={`${id}-date`}>Data zapytania</FieldLabel>
          <input id={`${id}-date`} type="date" value={draft.date} onChange={(e) => changeDate(e.target.value)} className={inputClass} />
        </div>
        <div>
          <FieldLabel htmlFor={`${id}-time`}>Godzina</FieldLabel>
          <input id={`${id}-time`} type="time" value={draft.time} onChange={(e) => set({ time: e.target.value })} className={inputClass} />
        </div>
      </div>

      <div>
        <FieldLabel htmlFor={`${id}-name`}>Firma / osoba</FieldLabel>
        <input
          id={`${id}-name`}
          value={draft.name}
          onChange={(e) => set({ name: e.target.value })}
          list={`${id}-clients`}
          placeholder="np. Interprint Polska"
          className={inputClass}
          autoFocus={!lead}
        />
        <datalist id={`${id}-clients`}>
          {clients.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <FieldLabel htmlFor={`${id}-campaign`}>Skąd przyszedł</FieldLabel>
          <select
            id={`${id}-campaign`}
            value={draft.campaignId ?? NO_CAMPAIGN}
            onChange={(e) => {
              setCampaignTouched(true)
              set({ campaignId: e.target.value === NO_CAMPAIGN ? null : e.target.value })
            }}
            className={inputClass}
          >
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name || 'Kampania bez nazwy'}
              </option>
            ))}
            <option value={NO_CAMPAIGN}>Spoza kampanii</option>
          </select>
        </div>
        {draft.campaignId ? (
          <div>
            <FieldLabel htmlFor={`${id}-channel`}>Kanał</FieldLabel>
            <ChannelInput id={`${id}-channel`} value={draft.channel} onChange={(channel) => set({ channel })} />
          </div>
        ) : (
          <div>
            <FieldLabel htmlFor={`${id}-origin`}>Pochodzenie</FieldLabel>
            <select id={`${id}-origin`} value={draft.origin} onChange={(e) => set({ origin: e.target.value })} className={inputClass}>
              <option value="">Nie wiadomo</option>
              {LEAD_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {LEAD_SOURCE_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      {!draft.campaignId && (
        <div>
          <FieldLabel htmlFor={`${id}-channel2`}>Kanał</FieldLabel>
          <ChannelInput id={`${id}-channel2`} value={draft.channel} onChange={(channel) => set({ channel })} />
        </div>
      )}

      <div>
        <FieldLabel htmlFor={`${id}-summary`}>O co pyta</FieldLabel>
        <input
          id={`${id}-summary`}
          value={draft.summary}
          onChange={(e) => set({ summary: e.target.value })}
          placeholder="np. 2 filmy korporacyjne, fabryka"
          className={inputClass}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2">
          <FieldLabel htmlFor={`${id}-contact`}>Osoba kontaktowa</FieldLabel>
          <input id={`${id}-contact`} value={draft.contactName} onChange={(e) => set({ contactName: e.target.value })} className={inputClass} />
        </div>
        <div>
          <FieldLabel htmlFor={`${id}-email`}>E-mail</FieldLabel>
          <input id={`${id}-email`} type="email" value={draft.email} onChange={(e) => set({ email: e.target.value })} className={inputClass} />
        </div>
        <div>
          <FieldLabel htmlFor={`${id}-phone`}>Telefon</FieldLabel>
          <input id={`${id}-phone`} type="tel" value={draft.phone} onChange={(e) => set({ phone: e.target.value })} className={inputClass} />
        </div>
      </div>

      <div>
        <FieldLabel htmlFor={`${id}-project`}>Projekt</FieldLabel>
        <select
          id={`${id}-project`}
          value={newProject ? NEW_PROJECT : (draft.projectId ?? '')}
          onChange={(e) => {
            const value = e.target.value
            setNewProject(value === NEW_PROJECT)
            set({ projectId: value && value !== NEW_PROJECT ? value : null })
          }}
          className={inputClass}
        >
          <option value="">Bez projektu</option>
          <option value={NEW_PROJECT}>+ Załóż projekt z tego leada…</option>
          {projects.map(projectOption)}
        </select>
        {newProject && (
          <div className="mt-2 rounded-lg border border-white/10 bg-white/[0.02] p-2.5">
            <FieldLabel htmlFor={`${id}-project-name`}>Nazwa projektu</FieldLabel>
            <input
              id={`${id}-project-name`}
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder={draft.name || 'np. Interprint — filmy korporacyjne'}
              className={inputClass}
            />
            <p className="mt-1.5 text-[11px] text-zinc-500">
              Projekt bez wyceny: klient, data i kontakt z leada
              {origin ? `, pochodzenie „${LEAD_SOURCE_LABELS[origin as keyof typeof LEAD_SOURCE_LABELS] ?? origin}"` : ''}.
              Wycenę zrobisz w zakładce Projekty.
            </p>
          </div>
        )}
      </div>

      <div>
        <FieldLabel htmlFor={`${id}-notes`}>Notatki</FieldLabel>
        <textarea
          id={`${id}-notes`}
          value={draft.notes}
          onChange={(e) => set({ notes: e.target.value })}
          rows={3}
          className={`${inputClass} h-auto resize-y py-1.5`}
        />
      </div>

      {showProblems && problems.length > 0 && (
        <ul className="space-y-0.5 text-xs text-red-300" role="alert">
          {problems.map((p) => (
            <li key={p}>{PROBLEM_TEXT[p]}</li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={busy}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-60"
        >
          {busy && <Loader2 className="size-3.5 animate-spin" />}
          Zapisz
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-3 py-1.5 text-xs font-semibold text-zinc-400 outline-none hover:text-zinc-100 focus-visible:ring-2 focus-visible:ring-white/60"
        >
          Anuluj
        </button>
        {lead &&
          (confirmDelete ? (
            <button
              type="button"
              onClick={async () => {
                await remove(lead.id)
                onClose()
              }}
              className="ml-auto rounded-md bg-red-500/15 px-2 py-1.5 text-xs font-semibold text-red-300 outline-none hover:bg-red-500/25 focus-visible:ring-2 focus-visible:ring-white/60"
            >
              Na pewno usuń
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="ml-auto flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-semibold text-zinc-500 outline-none hover:bg-red-500/10 hover:text-red-300 focus-visible:ring-2 focus-visible:ring-white/60"
            >
              <Trash2 className="size-3.5" />
              Usuń
            </button>
          ))}
      </div>
    </form>
  )
}

function ChannelInput({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  return (
    <>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        list={`${id}-list`}
        placeholder="formularz, mail…"
        className={inputClass}
      />
      <datalist id={`${id}-list`}>
        {['formularz', 'mail', 'telefon', 'Instagram DM'].map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </>
  )
}
