/**
 * „Scal nazwy" — jedna pisownia klienta w wielu projektach (plan §3.2a, T10).
 *
 * Klient nie ma własnego rekordu, więc scalenie to po prostu przepisanie pola
 * `client` w projektach, których to dotyczy. Dwa przypadki, ten sam mechanizm:
 *  - różne pisownie tego samego klucza („Tchibo" / „tchibo ") → jedna,
 *  - różni klienci, którzy są jednym („Tchibo" + „Tchibo Polska") → jeden.
 *
 * Plan zapamiętuje poprzednią nazwę każdego projektu, więc „Cofnij" przywraca
 * dokładnie to, co było — ale tylko tam, gdzie od scalenia nikt nazwy nie
 * zmienił. Wyceny (`quote`, w tym nazwa klienta drukowana w PDF) zostają
 * nietknięte: liczy się klient z nagłówka projektu.
 *
 * Moduł czysty — testy w `client-merge.test.ts`.
 */

import { clientKey, type ClientInfo } from './clients'
import type { Project } from './project-types'

/** Nazwa tak, jak się ją zapisuje: bez spacji na brzegach i podwójnych spacji. */
export function cleanClientName(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}

export interface ClientRename {
  id: string
  /** Nazwa projektu — do podglądu. */
  name: string
  /** Dotychczasowa wartość pola `client`, dosłownie (do „Cofnij"). */
  from: string
}

export interface ClientMergePlan {
  /** Nowa nazwa klienta. */
  target: string
  targetKey: string
  /** Klucze scalanych klientów (z docelowym). */
  keys: string[]
  /** Projekty, w których zmieni się `client`. */
  changes: ClientRename[]
}

/**
 * Plan scalenia klientów `keys` pod nazwą `targetName`. Zmieniają się tylko
 * projekty, w których pole różni się od docelowej nazwy (także samymi
 * spacjami). `null` = pusta nazwa albo brak klientów do scalenia.
 */
export function planClientMerge(
  projects: Pick<Project, 'id' | 'name' | 'client'>[],
  keys: string[],
  targetName: string
): ClientMergePlan | null {
  const target = cleanClientName(targetName)
  const keySet = new Set(keys.filter(Boolean))
  if (!target || !keySet.size) return null
  const changes = projects
    .filter((p) => keySet.has(clientKey(p.client ?? '')) && p.client !== target)
    .map((p) => ({ id: p.id, name: p.name, from: p.client }))
  return { target, targetKey: clientKey(target), keys: [...keySet], changes }
}

/** Zmiany pola `client` do zapisania jednym ruchem. */
export function mergePatches(plan: ClientMergePlan): { id: string; client: string }[] {
  return plan.changes.map((c) => ({ id: c.id, client: plan.target }))
}

/**
 * „Cofnij": poprzednie nazwy — tylko w projektach, które wciąż mają nazwę ze
 * scalenia (zmiana zrobiona później ręcznie zostaje). Usunięty od tego czasu
 * projekt też się pomija.
 */
export function undoMergePatches(
  projects: Pick<Project, 'id' | 'client'>[],
  plan: ClientMergePlan
): { id: string; client: string }[] {
  const current = new Map(projects.map((p) => [p.id, p.client]))
  return plan.changes.filter((c) => current.get(c.id) === plan.target).map((c) => ({ id: c.id, client: c.from }))
}

// ── Podpowiedzi duplikatów ───────────────────────────────────────────────────

/**
 * Słowa, które nic nie mówią o tym, czy to ten sam klient (formy prawne, kraj).
 * Krótsze niż 3 znaki („sp. z o.o.", „S.A.") odpadają i tak.
 */
const GENERIC_WORDS = new Set([
  'spolka', 'ska', 'spk', 'inc', 'ltd', 'llc', 'gmbh',
  'polska', 'poland', 'group', 'grupa', 'studio', 'the', 'and',
])

function words(key: string): string[] {
  return key
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((w) => w.length >= 3 && !GENERIC_WORDS.has(w))
}

const compact = (key: string) => key.replace(/[^\p{L}\p{N}]+/gu, '')

/**
 * Czy dwa klucze wyglądają na tego samego klienta: wspólne znaczące słowo
 * („tchibo" i „tchibo polska") albo jedna nazwa bez spacji i znaków zaczyna
 * drugą („s-ai" i „sai media"). Tylko podpowiedź — wybór należy do użytkownika.
 */
export function looksLikeSameClient(a: string, b: string): boolean {
  if (!a || !b || a === b) return false
  const wa = new Set(words(a))
  if (words(b).some((w) => wa.has(w))) return true
  const [ca, cb] = [compact(a), compact(b)]
  const [shorter, longer] = ca.length <= cb.length ? [ca, cb] : [cb, ca]
  return shorter.length >= 3 && longer.startsWith(shorter)
}

/** Inni klienci do dołączenia: najpierw podobni do `key`, potem reszta alfabetycznie. */
export function mergeCandidates(
  directory: ClientInfo[],
  key: string
): (ClientInfo & { likely: boolean })[] {
  return directory
    .filter((c) => c.key !== key)
    .map((c) => ({ ...c, likely: looksLikeSameClient(key, c.key) }))
    .sort((a, b) => Number(b.likely) - Number(a.likely) || a.name.localeCompare(b.name, 'pl'))
}
