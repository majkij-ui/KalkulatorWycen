/**
 * Komunikaty aplikacji (F1): drobny pasek u dołu okna na rzeczy, które poszły
 * źle w tle — nieudana kopia zapasowa, nieczytelny `company.json`. Nic tu nie
 * blokuje pracy; komunikat zamyka się krzyżykiem.
 */

export interface AppNotice {
  id: string
  text: string
}

let notices: AppNotice[] = []
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((listener) => listener())

/** Dodaje komunikat; ten sam `id` podmienia poprzedni (bez powtórzeń). */
export function pushNotice(id: string, text: string): void {
  notices = [...notices.filter((n) => n.id !== id), { id, text }]
  emit()
}

export function dismissNotice(id: string): void {
  notices = notices.filter((n) => n.id !== id)
  emit()
}

export function getNotices(): AppNotice[] {
  return notices
}

export function subscribeNotices(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
