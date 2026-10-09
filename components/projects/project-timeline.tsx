'use client'

/**
 * Zakładka „Oś czasu" otwartego projektu (T3, plan §6b).
 *
 * Ten sam wątek co w kalendarzu — wydarzenia z `events.json`, liczby z
 * `thread-stats.ts` — tylko z projektem wybranym z góry. Obok: lead, z
 * którego projekt się zaczął (jakość, kampania, kanał), i kontakt do klienta.
 * Nic tu nie jest liczone na zapas: wszystko wynika z wydarzeń.
 */

import { useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { buildCalendarEntries } from '@/lib/calendar-entries'
import { useEvents } from '@/lib/events-context'
import { useEquipment } from '@/lib/equipment-context'
import { useProjectHub } from '@/lib/project-hub-context'
import { hasContact } from '@/lib/clients'
import { leadsFromEvents, patchLeadEvent, type Lead } from '@/lib/marketing-leads'
import { LEAD_QUALITIES, LEAD_QUALITY_LABELS, type LeadQuality } from '@/lib/marketing-types'
import { leadSourceLabel, toDateKey, type Project, type ProjectContact } from '@/lib/project-types'
import { plural } from '@/lib/pl-plural'
import { useCampaigns } from '@/components/marketing/use-campaigns'
import { ThreadStatsList, ThreadTimeline } from '@/components/calendar/thread-panel'
import { EventForm, type FormTarget } from '@/components/calendar/event-form'
import { EventNotice, noticeAfterSave, type EventNoticeState } from '@/components/calendar/event-notice'
import { archivo, formatDay, mono, tileFor } from '@/components/calendar/calendar-bits'

const QUALITY_TONE: Record<LeadQuality, string> = {
  fake: 'border-red-400/40 bg-red-500/10 text-red-200',
  good: 'border-sky-400/40 bg-sky-500/10 text-sky-200',
  very_good: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200',
}

const cardClass = 'rounded-xl border border-white/5 bg-zinc-900/40 p-4'
const inputClass =
  'h-8 w-full rounded-md border border-white/10 bg-black/40 px-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-white/30'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[84px_minmax(0,1fr)] gap-2 text-sm">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="min-w-0 break-words text-zinc-200">{children}</dd>
    </div>
  )
}

function LeadCard({ lead, more, onEdit }: { lead: Lead; more: number; onEdit: () => void }) {
  const { save } = useEvents()
  const { campaigns } = useCampaigns()
  const campaign = lead.campaignId ? campaigns.find((c) => c.id === lead.campaignId) : undefined
  const contact = [lead.contactName, lead.email, lead.phone].filter(Boolean)

  return (
    <section className={cardClass} aria-label="Lead">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-white" style={archivo}>
          Lead
        </h3>
        <button type="button" onClick={onEdit} className="text-xs font-semibold text-zinc-400 hover:text-white">
          Edytuj
        </button>
      </div>
      <p className="mt-0.5 text-xs text-zinc-500" style={mono}>
        {formatDay(lead.date)} {lead.date.slice(0, 4)}
        {lead.time ? `, ${lead.time}` : ''}
      </p>

      <div className="mt-3 flex flex-wrap gap-1" role="group" aria-label="Jakość leada">
        {LEAD_QUALITIES.map((q) => {
          const active = lead.quality === q
          return (
            <button
              key={q}
              type="button"
              aria-pressed={active}
              onClick={() => void save(patchLeadEvent(lead.event, { quality: active ? null : q }))}
              className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                active ? QUALITY_TONE[q] : 'border-white/10 text-zinc-500 hover:text-zinc-200'
              }`}
            >
              {LEAD_QUALITY_LABELS[q]}
            </button>
          )
        })}
      </div>

      <dl className="mt-3 space-y-1.5">
        <Row label="Skąd">
          {campaign ? `Kampania: ${campaign.name}` : lead.campaignId ? 'Kampania (usunięta)' : leadSourceLabel(lead.origin) || '—'}
        </Row>
        {lead.channel && <Row label="Kanał">{lead.channel}</Row>}
        {lead.summary && <Row label="Zapytanie">{lead.summary}</Row>}
        {contact.length > 0 && <Row label="Kontakt">{contact.join(' · ')}</Row>}
      </dl>
      {more > 0 && (
        <p className="mt-3 text-xs text-zinc-500">
          + {more} {plural(more, 'kolejny lead', 'kolejne leady', 'kolejnych leadów')} w wątku
        </p>
      )}
    </section>
  )
}

function ContactCard({ project, lead }: { project: Project; lead: Lead | null }) {
  const { updateProject } = useProjectHub()
  const [draft, setDraft] = useState<ProjectContact>(
    () => project.contact ?? { name: '', email: '', phone: '' }
  )

  // Kontakt mógł przyjść z wyboru klienta w nagłówku albo z importu. Po
  // wartościach, nie po obiekcie: odczyt pliku po zapisie daje nowy obiekt z
  // tymi samymi danymi i nie może skasować tego, co właśnie wpisujesz.
  const savedKey = JSON.stringify([project.contact?.name, project.contact?.email, project.contact?.phone])
  useEffect(() => {
    setDraft(project.contact ?? { name: '', email: '', phone: '' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey])

  const commit = (next: ProjectContact) => {
    const before = project.contact ?? { name: '', email: '', phone: '' }
    const changed = (['name', 'email', 'phone'] as const).some((k) => (next[k] ?? '').trim() !== (before[k] ?? '').trim())
    if (!changed) return
    // Spread zachowuje pola kontaktu, których formularz nie zna.
    void updateProject(project.id, {
      contact: { ...before, name: next.name.trim(), email: next.email.trim(), phone: next.phone.trim() },
    })
  }

  const leadContact =
    lead && (lead.contactName || lead.email || lead.phone)
      ? { name: lead.contactName, email: lead.email, phone: lead.phone }
      : null

  const field = (key: keyof Pick<ProjectContact, 'name' | 'email' | 'phone'>, label: string, type = 'text') => (
    <div>
      <label htmlFor={`contact-${key}`} className="mb-1 block text-[11px] text-zinc-500">
        {label}
      </label>
      <input
        id={`contact-${key}`}
        type={type}
        value={draft[key] ?? ''}
        onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
        onBlur={() => commit(draft)}
        className={inputClass}
      />
    </div>
  )

  return (
    <section className={cardClass} aria-label="Kontakt">
      <h3 className="text-sm font-semibold text-white" style={archivo}>
        Kontakt
      </h3>
      <div className="mt-3 space-y-2">
        {field('name', 'Osoba')}
        {field('email', 'E-mail', 'email')}
        {field('phone', 'Telefon', 'tel')}
      </div>
      {!hasContact(project.contact) && leadContact && (
        <button
          type="button"
          onClick={() => commit(leadContact)}
          className="mt-3 text-xs font-semibold text-primary hover:underline"
        >
          Przepisz z leada ({[leadContact.name, leadContact.email, leadContact.phone].filter(Boolean).join(', ')})
        </button>
      )}
    </section>
  )
}

export function ProjectTimeline({ project }: { project: Project }) {
  const today = toDateKey(new Date())
  const { events } = useEvents()
  const { items } = useEquipment()
  const [form, setForm] = useState<{ target: FormTarget; key: number } | null>(null)
  const [notice, setNotice] = useState<EventNoticeState | null>(null)

  const entries = useMemo(
    () => buildCalendarEntries(events, items).filter((e) => e.projectId === project.id),
    [events, items, project.id]
  )
  const leads = useMemo(() => leadsFromEvents(events).filter((l) => l.projectId === project.id), [events, project.id])
  // Najstarszy lead = początek wątku; leady są posortowane od najnowszego.
  const firstLead = leads.at(-1) ?? null
  const tile = tileFor(project)

  const openForm = (target: FormTarget) => setForm((prev) => ({ target, key: (prev?.key ?? 0) + 1 }))

  useEffect(() => {
    if (!form) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setForm(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [form])

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-white" style={archivo}>
          Oś czasu{' '}
          <span className="text-sm font-normal text-zinc-500" style={mono}>
            {entries.length} {plural(entries.length, 'wydarzenie', 'wydarzenia', 'wydarzeń')}
          </span>
        </h2>
        <button
          type="button"
          onClick={() => openForm({ mode: 'new', date: today, projectId: project.id })}
          className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-white/70"
        >
          <Plus className="size-3.5" />
          Dodaj wydarzenie
        </button>
      </div>

      <ThreadStatsList entries={entries} today={today} tile={tile} inline className="mt-3" />

      {notice && <EventNotice notice={notice} onDone={() => setNotice(null)} className="mt-3" />}

      <div className="mt-5 grid gap-6 md:grid-cols-[minmax(0,1fr)_300px]">
        <section aria-label="Wydarzenia projektu" className="min-w-0">
          {entries.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-zinc-500">
              Ten projekt nie ma jeszcze wydarzeń. Dodaj lead, odpowiedź, dzień zdjęciowy albo fakturę — liczby
              policzą się same.
            </div>
          ) : (
            <ThreadTimeline
              entries={entries}
              today={today}
              tile={tile}
              onEdit={(entry) => openForm({ mode: 'edit', entry })}
            />
          )}
        </section>

        <aside className="min-w-0 space-y-4" aria-label="Szczegóły wątku">
          {form ? (
            <div className={cardClass}>
              <EventForm
                key={form.key}
                target={form.target}
                onClose={() => setForm(null)}
                onSaved={(info) => {
                  setForm(null)
                  setNotice(noticeAfterSave(info))
                }}
                onDeleted={(event) => {
                  setForm(null)
                  setNotice({ type: 'deleted', event })
                }}
              />
            </div>
          ) : (
            <>
              {firstLead && (
                <LeadCard
                  lead={firstLead}
                  more={leads.length - 1}
                  onEdit={() => {
                    const entry = entries.find((e) => e.id === firstLead.id)
                    if (entry) openForm({ mode: 'edit', entry })
                  }}
                />
              )}
              <ContactCard project={project} lead={firstLead} />
            </>
          )}
        </aside>
      </div>
    </div>
  )
}
