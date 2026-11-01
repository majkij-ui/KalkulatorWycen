/**
 * Zapis wysłanych konwersji (`ads-exports.json`) — schemat rekordu.
 *
 * Klucz pary to `(leadEventId, conversionKey)`; par może być kilka rekordów
 * (cofnięty eksport i ponowny). Rekordów się nie usuwa: cofnięcie zmienia
 * `status` na `cancelled`. Czas i wartość są zamrożone przy pierwszym eksporcie,
 * bo Google rozpoznaje duplikat po identyfikatorze, nazwie i czasie.
 *
 * Schemat jest tolerancyjny (`catch`, `passthrough`): nieznane pola przeżywają
 * zapis, a rekord z nieznanym `conversionKey` nie pasuje do żadnej znanej pary,
 * ale też nie ginie przy następnym zapisie pliku.
 */

import { z } from 'zod'

export const ADS_EXPORT_STATUSES = ['pending', 'confirmed', 'cancelled'] as const
export type AdsExportStatus = (typeof ADS_EXPORT_STATUSES)[number]

export const adsExportRecordSchema = z
  .object({
    id: z.string().min(1),
    /** `id` wydarzenia `lead_in`. */
    leadEventId: z.string().catch(''),
    /** `ads.leadId` ze strony (może być pusty). */
    leadId: z.string().catch(''),
    /** `lead` / `won`; nieznana wartość zostaje jako tekst. */
    conversionKey: z.string().catch(''),
    conversionName: z.string().catch(''),
    /** Czas lokalny `YYYY-MM-DDTHH:mm:ss` (Europe/Warsaw), zamrożony. */
    conversionTime: z.string().catch(''),
    value: z.number().finite().catch(0),
    currency: z.string().optional().catch(undefined),
    /** Nieznany status czyta się jako `pending`: para nie pojedzie drugi raz. */
    status: z.enum(ADS_EXPORT_STATUSES).catch('pending'),
    /** ISO UTC; wszystkie wiersze jednego pliku mają ten sam. */
    exportedAt: z.string().catch(''),
    confirmedAt: z.string().optional().catch(undefined),
    cancelledAt: z.string().optional().catch(undefined),
  })
  .passthrough()

export type AdsExportRecord = z.infer<typeof adsExportRecordSchema>
