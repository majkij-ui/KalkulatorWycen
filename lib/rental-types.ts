/**
 * Słownik wynajmowanego sprzętu (U2, plan §17.1): to, co M.J. wypożycza, a
 * czego nie ma w katalogu własnego sprzętu („Sony FX6", „Prompter"). Osobny
 * plik `rental-items.json`, żeby wynajmowany sprzęt nigdy nie trafił do list
 * wyboru, list pakowania ani statystyk spłaty własnego sprzętu.
 *
 * Słownik trzyma tylko nazwę; kwoty, dni i wypożyczalnia są na wierszu kosztu
 * w Realizacji (`ProjectCost.rentalItemId`), a statystyki liczą się z wierszy
 * (`rentals.ts`) — fakty zapisane, liczby wyprowadzone (§3.4/1).
 *
 * `.passthrough()`, pola opcjonalne bez wartości domyślnych, miękkie usuwanie.
 */

import { z } from 'zod'

export const rentalItemSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().catch(''),
    /** Notatka („zwykle z CamCam, 2 akumulatory"). */
    notes: z.string().optional().catch(undefined),
    createdAt: z.string().catch(''),
    updatedAt: z.string().optional().catch(undefined),
    /** Miękkie usunięcie; wiersze w projektach zostają i pokazują nazwę z dopiskiem. */
    deletedAt: z.string().optional().catch(undefined),
  })
  .passthrough()
export type RentalItem = z.infer<typeof rentalItemSchema>

export function createRentalItemId(): string {
  return `ri-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}
