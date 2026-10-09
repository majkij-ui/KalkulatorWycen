'use client'

/**
 * Edycja propozycji przed akceptacją. Zmienia tylko kopię w pamięci ekranu —
 * plik w `inbox/` zostaje taki, jak go zapisał Claude, a do danych trafia
 * dopiero przyjęta wersja.
 *
 * Wydarzenie edytuje się tym samym szkicem co w kalendarzu (`event-draft.ts`
 * przez `draftFromProposal` / `proposalWithDraft`), więc obowiązują te same
 * reguły: godzina tylko dla typów z godziną, koniec tylko dla zakresów,
 * nieznane klucze `data` zostają.
 */

import { useId, useState } from 'react'
import { EVENT_KINDS, eventKind } from '@/lib/event-kinds'
import { draftFromProposal, proposalWithDraft } from '@/lib/inbox'
import type { EventDraft } from '@/lib/event-draft'
import type { NewProjectFields, ProjectFields, Proposal } from '@/lib/inbox-types'
import { LEAD_SOURCES, LEAD_SOURCE_LABELS, type ProjectContact } from '@/lib/project-types'
import { isLeadQuality } from '@/lib/marketing-types'
import { FieldLabel, QualityPicker, inputClass } from '@/components/marketing/marketing-bits'

/** Typy do wyboru: bez spraw firmy (zakup sprzętu żyje w katalogu, marketing w kampaniach). */
const PICKABLE_KINDS = EVENT_KINDS.filter((k) => k.scope !== 'business')

export function LeadSourceSelect({
  id,
  value,
  onChange,
}: {
  id: string
  value: string | undefined
  onChange: (value: string | undefined) => void
}) {
  const known = (LEAD_SOURCES as readonly string[]).includes(value ?? '')
  return (
    <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)} className={inputClass}>
      <option value="">— nieustalone —</option>
      {LEAD_SOURCES.map((s) => (
        <option key={s} value={s}>
          {LEAD_SOURCE_LABELS[s]}
        </option>
      ))}
      {value && !known && <option value={value}>{value}</option>}
    </select>
  )
}

export function ContactFields({
  idPrefix,
  value,
  onChange,
}: {
  idPrefix: string
  value: ProjectContact | undefined
  onChange: (next: ProjectContact) => void
}) {
  const contact = value ?? { name: '', email: '', phone: '' }
  const set = (key: 'name' | 'email' | 'phone', text: string) => onChange({ ...contact, [key]: text })
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {(
        [
          ['name', 'Osoba kontaktowa'],
          ['email', 'E-mail'],
          ['phone', 'Telefon'],
        ] as const
      ).map(([key, label]) => (
        <div key={key}>
          <FieldLabel htmlFor={`${idPrefix}-${key}`}>{label}</FieldLabel>
          <input
            id={`${idPrefix}-${key}`}
            value={contact[key] ?? ''}
            onChange={(e) => set(key, e.target.value)}
            className={inputClass}
          />
        </div>
      ))}
    </div>
  )
}

function EventEditor({
  proposal,
  onApply,
  onCancel,
}: {
  proposal: Extract<Proposal, { type: 'event' }>
  onApply: (next: Proposal) => void
  onCancel: () => void
}) {
  const id = useId()
  const [draft, setDraft] = useState<EventDraft>(() => draftFromProposal(proposal))
  const [quality, setQuality] = useState(() =>
    isLeadQuality(proposal.event.data.quality) ? proposal.event.data.quality : null
  )
  const kind = eventKind(draft.kind)
  const set = (patch: Partial<EventDraft>) => setDraft((d) => ({ ...d, ...patch }))

  const apply = () => {
    const next = proposalWithDraft(proposal, draft)
    if (next.event.kind === 'lead_in' && quality) next.event = { ...next.event, data: { ...next.event.data, quality } }
    onApply(next)
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <FieldLabel htmlFor={`${id}-kind`}>Typ</FieldLabel>
          <select
            id={`${id}-kind`}
            value={draft.kind}
            onChange={(e) => set({ kind: e.target.value })}
            className={inputClass}
          >
            {PICKABLE_KINDS.map((k) => (
              <option key={k.key} value={k.key}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <FieldLabel htmlFor={`${id}-title`}>Tytuł</FieldLabel>
          <input
            id={`${id}-title`}
            value={draft.title}
            onChange={(e) => set({ title: e.target.value })}
            placeholder={kind.label}
            className={inputClass}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div>
          <FieldLabel htmlFor={`${id}-date`}>{kind.range ? 'Od' : 'Data'}</FieldLabel>
          <input
            id={`${id}-date`}
            type="date"
            value={draft.date}
            onChange={(e) => set({ date: e.target.value })}
            className={inputClass}
          />
        </div>
        {kind.timed && (
          <div>
            <FieldLabel htmlFor={`${id}-time`}>Godzina</FieldLabel>
            <input
              id={`${id}-time`}
              type="time"
              value={draft.time}
              onChange={(e) => set({ time: e.target.value })}
              className={inputClass}
            />
          </div>
        )}
        {kind.range && (
          <div>
            <FieldLabel htmlFor={`${id}-end`}>Do (włącznie)</FieldLabel>
            <input
              id={`${id}-end`}
              type="date"
              value={draft.endDate}
              min={draft.date}
              onChange={(e) => set({ endDate: e.target.value })}
              className={inputClass}
            />
          </div>
        )}
      </div>
      {kind.fields && kind.fields.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {kind.fields.map((field) => (
            <div key={field.key}>
              <FieldLabel htmlFor={`${id}-f-${field.key}`}>{field.label}</FieldLabel>
              <input
                id={`${id}-f-${field.key}`}
                type={field.type === 'date' ? 'date' : 'text'}
                inputMode={field.type === 'number' ? 'decimal' : undefined}
                value={draft.fields[field.key] ?? ''}
                onChange={(e) => set({ fields: { ...draft.fields, [field.key]: e.target.value } })}
                placeholder={field.placeholder}
                className={inputClass}
              />
            </div>
          ))}
        </div>
      )}
      {draft.kind === 'lead_in' && (
        <div>
          <span className="mb-1 block text-[11px] text-zinc-500">Jakość leada</span>
          <QualityPicker size="sm" value={quality} onChange={setQuality} />
        </div>
      )}
      <div>
        <FieldLabel htmlFor={`${id}-notes`}>Notatki</FieldLabel>
        <textarea
          id={`${id}-notes`}
          value={draft.notes}
          onChange={(e) => set({ notes: e.target.value })}
          rows={2}
          className={`${inputClass} h-auto resize-y py-1.5`}
        />
      </div>
      <EditorButtons onApply={apply} onCancel={onCancel} />
    </div>
  )
}

function ProjectFieldsEditor({
  proposal,
  onApply,
  onCancel,
}: {
  proposal: Extract<Proposal, { type: 'project_update' | 'project_new' }>
  onApply: (next: Proposal) => void
  onCancel: () => void
}) {
  const id = useId()
  const isNew = proposal.type === 'project_new'
  const [fields, setFields] = useState<NewProjectFields & ProjectFields>(() =>
    proposal.type === 'project_new' ? { ...proposal.project } : { name: '', client: '', ...proposal.set }
  )
  const [ifMissing, setIfMissing] = useState(proposal.type === 'project_update' ? proposal.ifMissing : true)
  const set = (patch: Partial<NewProjectFields & ProjectFields>) => setFields((f) => ({ ...f, ...patch }))

  const apply = () => {
    if (proposal.type === 'project_new') {
      onApply({ ...proposal, project: { ...proposal.project, ...fields, name: fields.name.trim() || proposal.project.name } })
    } else {
      const { contact, leadSource, client } = fields
      onApply({
        ...proposal,
        ifMissing,
        set: {
          ...proposal.set,
          contact,
          leadSource,
          client: client?.trim() ? client.trim() : undefined,
        },
      })
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {isNew && (
          <div>
            <FieldLabel htmlFor={`${id}-name`}>Nazwa projektu</FieldLabel>
            <input id={`${id}-name`} value={fields.name} onChange={(e) => set({ name: e.target.value })} className={inputClass} />
          </div>
        )}
        <div>
          <FieldLabel htmlFor={`${id}-client`}>Klient</FieldLabel>
          <input
            id={`${id}-client`}
            value={fields.client ?? ''}
            onChange={(e) => set({ client: e.target.value })}
            className={inputClass}
          />
        </div>
        {isNew && (
          <div>
            <FieldLabel htmlFor={`${id}-date`}>Data księgowa</FieldLabel>
            <input
              id={`${id}-date`}
              type="date"
              value={fields.date ?? ''}
              onChange={(e) => set({ date: e.target.value || undefined })}
              className={inputClass}
            />
          </div>
        )}
        <div>
          <FieldLabel htmlFor={`${id}-source`}>Pochodzenie klienta</FieldLabel>
          <LeadSourceSelect id={`${id}-source`} value={fields.leadSource} onChange={(leadSource) => set({ leadSource })} />
        </div>
      </div>
      <ContactFields idPrefix={`${id}-contact`} value={fields.contact} onChange={(contact) => set({ contact })} />
      {!isNew && (
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          <input type="checkbox" checked={ifMissing} onChange={(e) => setIfMissing(e.target.checked)} />
          Uzupełnij tylko puste pola projektu (nie nadpisuj tego, co już jest)
        </label>
      )}
      <EditorButtons onApply={apply} onCancel={onCancel} />
    </div>
  )
}

function EditorButtons({ onApply, onCancel }: { onApply: () => void; onCancel: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onApply}
        className="rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-900 outline-none hover:bg-white focus-visible:ring-2 focus-visible:ring-white/70"
      >
        Zastosuj zmiany
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="rounded-md px-3 py-1.5 text-xs font-semibold text-zinc-400 outline-none hover:text-zinc-100 focus-visible:ring-2 focus-visible:ring-white/60"
      >
        Anuluj
      </button>
    </div>
  )
}

export function ProposalEditor({
  proposal,
  onApply,
  onCancel,
}: {
  proposal: Proposal
  onApply: (next: Proposal) => void
  onCancel: () => void
}) {
  return (
    <div className="mt-2 rounded-lg border border-white/10 bg-black/30 p-3">
      {proposal.type === 'event' ? (
        <EventEditor proposal={proposal} onApply={onApply} onCancel={onCancel} />
      ) : (
        <ProjectFieldsEditor proposal={proposal} onApply={onApply} onCancel={onCancel} />
      )}
    </div>
  )
}
