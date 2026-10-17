// The UI language: English by default, Ukrainian or Russian when chosen in the settings.
// Picked once at load (stored per browser); changing it reloads the page, so strings computed when
// a module loads (option lists, labels) follow too. Game names stay in English in every language.

import { readStored, writeStored } from '../lib/storage'
import { en } from './en'
import { ru } from './ru'
import { uk } from './uk'

/** The shape of a dictionary: Russian (the original) with its literal strings widened. */
type Widen<T> = T extends string
  ? string
  : T extends (...args: infer A) => infer R
    ? (...args: A) => Widen<R>
    : T extends readonly (infer U)[]
      ? readonly Widen<U>[]
      : T extends object
        ? { readonly [K in keyof T]: Widen<T[K]> }
        : T
export type Strings = Widen<typeof ru>

export type Lang = 'en' | 'uk' | 'ru'

export const LANGS: readonly { id: Lang; name: string }[] = [
  { id: 'en', name: 'English' },
  { id: 'uk', name: 'Українська' },
  { id: 'ru', name: 'Русский' },
]

const KEY = 'edk.lang'
const DICTIONARIES: Record<Lang, Strings> = { en, uk, ru }
/** Intl locale of each language (dates; numbers keep one format everywhere). */
const LOCALES: Record<Lang, string> = { en: 'en-GB', uk: 'uk-UA', ru: 'ru-RU' }

export const lang: Lang = readStored(KEY, ['en', 'uk', 'ru'], 'en')
export const locale = LOCALES[lang]
export const t: Strings = DICTIONARIES[lang]

/** Switches the language: stored, then the page reloads in it. */
export function setLang(next: Lang): void {
  if (next === lang) return
  writeStored(KEY, next)
  window.location.reload()
}
