'use client'

/**
 * Pole „Osoba" w wierszu ekipy (T9a): wybór z bazy Ekipa — najpierw ludzie z
 * rolą tego wiersza, potem wszyscy — z „+ Nowa osoba" na miejscu. Wolny tekst
 * dalej działa (osoba spoza bazy); imię w wierszu jest zamrożone do
 * wyświetlania, a powiązanie trzyma `personId`.
 *
 * Wybór osoby ustawia `personId`, imię i domyślną stawkę z jej karty. Pisanie
 * innego imienia zrywa powiązanie — to już inna osoba.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Plus, UserCheck } from 'lucide-react'
import { useCrew } from '@/lib/crew-context'
import { crewMemberByName, crewPickerOptions, crewRoleByName, type CrewMember } from '@/lib/crew-types'
import { personKey, type CrewSuggestion } from '@/lib/project-costs'
import type { ProjectCost } from '@/lib/project-types'
import { pln } from '@/components/calendar/calendar-bits'

type Option =
  | { type: 'member'; member: CrewMember; section: 'role' | 'all' }
  | { type: 'outsider'; suggestion: CrewSuggestion }
  | { type: 'create'; name: string }

const MAX_OTHERS = 30

export function PersonPicker({
  cost,
  outsiders,
  onChange,
  className = '',
}: {
  cost: ProjectCost
  /** Imiona z innych projektów spoza bazy (ostatnia rola i stawka). */
  outsiders: CrewSuggestion[]
  onChange: (patch: Partial<ProjectCost>) => void
  className?: string
}) {
  const id = useId()
  const listId = `${id}-list`
  const { people, roles, addPerson } = useCrew()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const value = cost.person ?? ''
  const linked = cost.personId ? (people.find((m) => m.id === cost.personId && !m.deletedAt) ?? null) : null
  const role = crewRoleByName(roles, cost.role)
  const roleName = (roleId: string) => roles.find((r) => r.id === roleId)?.name ?? ''

  // Dopóki wiersz ma powiązaną osobę i nikt nie pisze, pokazujemy całą listę.
  const query = linked && personKey(value) === personKey(linked.name) ? '' : value
  const options = useMemo<Option[]>(() => {
    const { withRole, others } = crewPickerOptions(people, role?.id ?? null, query)
    const needle = personKey(query)
    // Podpowiedzi biorą też ten projekt — imię wpisane właśnie w tym wierszu
    // nie może wracać jako „podpowiedź" samego siebie.
    const outside = outsiders
      .filter(
        (s) =>
          !crewMemberByName(people, s.person) &&
          personKey(s.person) !== personKey(value) &&
          (!needle || personKey(s.person).includes(needle))
      )
      .slice(0, 5)
    const list: Option[] = [
      ...withRole.map((member) => ({ type: 'member' as const, member, section: 'role' as const })),
      ...others.slice(0, MAX_OTHERS).map((member) => ({ type: 'member' as const, member, section: 'all' as const })),
      ...outside.map((suggestion) => ({ type: 'outsider' as const, suggestion })),
    ]
    const typed = query.trim()
    if (typed && !crewMemberByName(people, typed)) list.push({ type: 'create', name: typed })
    return list
  }, [people, role?.id, query, outsiders, value])

  useEffect(() => {
    setActive(-1)
  }, [query])

  const pickMember = (member: CrewMember) => {
    onChange({
      personId: member.id,
      person: member.name,
      ...(member.rate ? { unitCost: member.rate } : {}),
      ...(!cost.role?.trim() && member.roleIds.length ? { role: roleName(member.roleIds[0]) } : {}),
    })
  }

  const choose = async (option: Option) => {
    setOpen(false)
    if (option.type === 'member') {
      pickMember(option.member)
      return
    }
    if (option.type === 'outsider') {
      const s = option.suggestion
      onChange({
        personId: undefined,
        person: s.person,
        ...(!cost.role?.trim() && s.role ? { role: s.role } : {}),
        ...(!cost.unitCost && s.unitCost ? { unitCost: s.unitCost } : {}),
      })
      return
    }
    setBusy(true)
    try {
      const member = await addPerson({
        name: option.name,
        roleIds: role ? [role.id] : [],
        rate: cost.unitCost > 0 ? cost.unitCost : undefined,
      })
      if (member) onChange({ personId: member.id, person: member.name })
    } finally {
      setBusy(false)
    }
  }

  const showList = open && options.length > 0
  let lastSection: string | null = null

  return (
    <div className={`relative ${className}`}>
      <input
        ref={inputRef}
        role="combobox"
        aria-label="Osoba"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? `${id}-opt-${active}` : undefined}
        value={value}
        placeholder="Osoba"
        disabled={busy}
        onChange={(e) => {
          const person = e.target.value
          // Inne imię niż powiązanej osoby = inna osoba: powiązanie znika.
          const keepLink = linked && personKey(person) === personKey(linked.name)
          onChange({ person, ...(keepLink ? {} : { personId: undefined }) })
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            setOpen(true)
            const step = e.key === 'ArrowDown' ? 1 : -1
            setActive((i) => (options.length ? (i + step + options.length) % options.length : -1))
          } else if (e.key === 'Enter') {
            if (showList && active >= 0) {
              e.preventDefault()
              void choose(options[active])
            } else {
              setOpen(false)
            }
          } else if (e.key === 'Escape' && showList) {
            e.stopPropagation()
            setOpen(false)
          }
        }}
        className={`h-8 w-full min-w-0 rounded-md border border-white/10 bg-black/40 pl-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-white/30 ${
          linked ? 'pr-7' : 'pr-2'
        }`}
      />
      {linked && (
        <UserCheck
          className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-emerald-400/80"
          aria-label="Osoba z bazy Ekipa"
        />
      )}
      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Osoby"
          className="absolute left-0 top-full z-40 mt-1 max-h-72 w-full min-w-[240px] overflow-auto rounded-lg border border-white/10 bg-zinc-950/95 p-1 shadow-xl backdrop-blur-xl"
        >
          {options.map((option, index) => {
            const section =
              option.type === 'member'
                ? option.section === 'role'
                  ? `Rola: ${role?.name ?? ''}`
                  : role
                    ? 'Pozostali'
                    : 'Ekipa'
                : option.type === 'outsider'
                  ? 'Spoza bazy (z innych projektów)'
                  : null
            const header = section && section !== lastSection ? section : null
            lastSection = section ?? lastSection
            return (
              <li key={`${option.type}-${index}`} role="presentation">
                {header && (
                  <div className="px-2 pb-1 pt-1.5 text-[10px] uppercase tracking-wide text-zinc-600" aria-hidden>
                    {header}
                  </div>
                )}
                <div
                  id={`${id}-opt-${index}`}
                  role="option"
                  aria-selected={index === active}
                  // mousedown zamiast click: inaczej blur pola zamknąłby listę przed wyborem
                  onMouseDown={(e) => {
                    e.preventDefault()
                    void choose(option)
                  }}
                  onMouseEnter={() => setActive(index)}
                  className={`flex cursor-pointer items-baseline justify-between gap-3 rounded-md px-2 py-1.5 text-sm ${
                    index === active ? 'bg-white/10 text-white' : 'text-zinc-300'
                  }`}
                >
                  {option.type === 'member' ? (
                    <>
                      <span className="min-w-0 truncate">
                        {option.member.name}
                        {option.member.id === linked?.id && <span className="ml-1.5 text-[11px] text-emerald-400">wybrana</span>}
                      </span>
                      <span className="shrink-0 text-[11px] text-zinc-500">
                        {[option.member.roleIds.map(roleName).filter(Boolean).slice(0, 2).join(', '), option.member.rate ? pln(option.member.rate) : '']
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </>
                  ) : option.type === 'outsider' ? (
                    <>
                      <span className="min-w-0 truncate">{option.suggestion.person}</span>
                      <span className="shrink-0 text-[11px] text-zinc-500">
                        {[option.suggestion.role, option.suggestion.unitCost ? pln(option.suggestion.unitCost) : '']
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </>
                  ) : (
                    <span className="flex items-center gap-1.5 font-semibold text-primary">
                      <Plus className="size-3.5" />
                      Nowa osoba „{option.name}"{role ? ` (${role.name})` : ''}
                    </span>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
