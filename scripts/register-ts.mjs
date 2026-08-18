/** Podpina resolver rozszerzeń przed uruchomieniem testów (`node --import`). */
import { register } from 'node:module'

register('./ts-resolver.mjs', import.meta.url)
