'use client'

/**
 * Role Ekipy: nazwa, stawka dla klienta, mój koszt, grupa; wycofanie i
 * przywrócenie. Wbudowane role, których nie edytowano, biorą nazwę i stawkę
 * z cennika domyślnego („z cennika"; Ustawienia → „Zapisz stawki jako
 * domyślne") — pierwsza zmiana zapisuje je do pliku i od tej chwili mają
 * własne stawki (decyzja 7: stawkę dla klienta daje rola). W otwartej wycenie
 * wbudowane role liczą się z jej własnego cennika (`quoteRoles`).
 */

import { useState } from 'react'
import { Plus, RotateCcw } from 'lucide-react'
import { useCrew } from '@/lib/crew-context'
import { CREW_ROLE_GROUPS, crewRoleGroupLabel, isBuiltInCrewRole, type CrewRole } from '@/lib/crew-types'
import { parseAmount } from '@/lib/event-draft'
import { toDateKey } from '@/lib/project-types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const field = 'h-8 border-white/10 bg-black/40 text-sm'

function rateText(value: number | undefined): string {
  return value ? String(value).replace('.', ',') : ''
}

function RoleRow({ role, fromPricing }: { role: CrewRole; fromPricing: boolean }) {
  const { saveRole } = useCrew()
  const [name, setName] = useState(role.name)
  const [clientRate, setClientRate] = useState(rateText(role.clientRate))
  const [costRate, setCostRate] = useState(rateText(role.costRate))
  const [group, setGroup] = useState(role.group)

  const dirty =
    name.trim() !== role.name ||
    (parseAmount(clientRate) ?? 0) !== role.clientRate ||
    (parseAmount(costRate) ?? undefined) !== role.costRate ||
    group !== role.group

  const save = async () => {
    if (!name.trim()) return
    const next: CrewRole = { ...role, name: name.trim(), clientRate: parseAmount(clientRate) ?? 0, group }
    const cost = parseAmount(costRate)
    if (cost !== undefined) next.costRate = cost
    else delete next.costRate
    await saveRole(next)
  }

  const groups = (CREW_ROLE_GROUPS as readonly string[]).includes(role.group)
    ? CREW_ROLE_GROUPS
    : [...CREW_ROLE_GROUPS, role.group]

  return (
    <div className={`rounded-lg border border-white/5 px-3 py-2 ${role.retiredAt ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Nazwa roli" className={`${field} min-w-0 flex-1`} />
        <select
          value={group}
          onChange={(e) => setGroup(e.target.value)}
          aria-label="Grupa roli"
          className="h-8 rounded-md border border-white/10 bg-black/40 px-2 text-xs text-zinc-200"
        >
          {groups.map((g) => (
            <option key={g} value={g}>
              {crewRoleGroupLabel(g)}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
        <label className="flex items-center gap-1">
          klient
          <Input
            inputMode="decimal"
            value={clientRate}
            onChange={(e) => setClientRate(e.target.value)}
            aria-label="Stawka dla klienta za dzień"
            className={`${field} w-20 text-right tabular-nums`}
          />
          zł/dzień
        </label>
        <label className="flex items-center gap-1" title="Mój koszt, gdy nie wiadomo jeszcze, kto pojedzie">
          mój koszt
          <Input
            inputMode="decimal"
            value={costRate}
            placeholder="—"
            onChange={(e) => setCostRate(e.target.value)}
            aria-label="Mój koszt za dzień"
            className={`${field} w-20 text-right tabular-nums`}
          />
          zł
        </label>
        {fromPricing && (
          <span
            className="rounded bg-zinc-800 px-1.5 py-px text-[10px] text-zinc-400"
            title="Stawka z cennika domyślnego (Ustawienia → Zapisz stawki jako domyślne). W wycenie liczy się cennik tej wyceny."
          >
            z cennika
          </span>
        )}
        <span className="ml-auto flex items-center gap-1">
          {dirty && (
            <Button size="sm" className="h-7 text-xs" onClick={save} disabled={!name.trim()}>
              Zapisz
            </Button>
          )}
          {role.retiredAt ? (
            <button
              type="button"
              onClick={() => {
                const next: CrewRole = { ...role }
                delete next.retiredAt
                void saveRole(next)
              }}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 font-semibold text-zinc-400 hover:text-zinc-100"
            >
              <RotateCcw className="size-3" />
              Przywróć
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void saveRole({ ...role, retiredAt: toDateKey(new Date()) })}
              className="rounded-md px-1.5 py-1 font-semibold text-zinc-500 hover:text-zinc-200"
              title="Zostaje w historii, znika z list wyboru"
            >
              Wycofaj
            </button>
          )}
        </span>
      </div>
    </div>
  )
}

export function CrewRolesSheet() {
  const { roles, storedRoleIds, addRole } = useCrew()
  const [name, setName] = useState('')
  const [group, setGroup] = useState<string>('ekipa')
  const [clientRate, setClientRate] = useState('')
  const [showRetired, setShowRetired] = useState(false)

  const retiredCount = roles.filter((r) => r.retiredAt).length
  const visible = roles.filter((r) => showRetired || !r.retiredAt)
  const groups = [...new Set(visible.map((r) => r.group))]

  return (
    <div className="flex flex-col gap-5">
      <header>
        <div className="text-[11px] uppercase tracking-widest text-zinc-500">Ekipa</div>
        <h2 className="mt-1 text-xl font-bold tracking-tight text-white">Role</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Rola to to, za co płaci klient — stawka dla klienta pochodzi z roli. Ile płacę ja, wynika z osoby (jej
          stawka); „mój koszt" roli przydaje się, gdy nie wiadomo jeszcze, kto pojedzie.
        </p>
      </header>

      {groups.map((g) => (
        <section key={g} className="space-y-1.5">
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">{crewRoleGroupLabel(g)}</h3>
          {visible
            .filter((r) => r.group === g)
            .map((role) => (
              <RoleRow
                key={`${role.id}-${role.updatedAt ?? ''}-${role.clientRate}`}
                role={role}
                fromPricing={isBuiltInCrewRole(role.id) && !storedRoleIds.has(role.id)}
              />
            ))}
        </section>
      ))}

      {retiredCount > 0 && (
        <label className="flex items-center gap-1.5 text-xs text-zinc-400">
          <input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} className="accent-emerald-500" />
          Pokaż wycofane ({retiredCount})
        </label>
      )}

      <section className="space-y-2 border-t border-white/5 pt-4">
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">Nowa rola</h3>
        <div className="flex flex-wrap items-center gap-1.5">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="np. Operator drona, Montażysta"
            aria-label="Nazwa nowej roli"
            className={`${field} min-w-0 flex-1`}
          />
          <select
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            aria-label="Grupa nowej roli"
            className="h-8 rounded-md border border-white/10 bg-black/40 px-2 text-xs text-zinc-200"
          >
            {CREW_ROLE_GROUPS.map((g) => (
              <option key={g} value={g}>
                {crewRoleGroupLabel(g)}
              </option>
            ))}
          </select>
          <Input
            inputMode="decimal"
            value={clientRate}
            onChange={(e) => setClientRate(e.target.value)}
            placeholder="klient zł/dzień"
            aria-label="Stawka dla klienta za dzień"
            className={`${field} w-28 text-right tabular-nums`}
          />
          <Button
            size="sm"
            className="h-8 gap-1 text-xs"
            disabled={!name.trim()}
            onClick={async () => {
              await addRole({ name, group, clientRate: parseAmount(clientRate) ?? 0 })
              setName('')
              setClientRate('')
            }}
          >
            <Plus className="size-3.5" />
            Dodaj rolę
          </Button>
        </div>
      </section>
    </div>
  )
}
