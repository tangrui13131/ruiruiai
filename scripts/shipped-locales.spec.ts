/** Translations preserve executable command examples and named interpolation fields. */
import { expect, it } from 'vitest'
import { localeTokens, hasInvisibleLocaleCharacters } from './shipped-locales.ts'

it('retains repeated placeholders, commands, and API identifiers', () => {
  expect(localeTokens('Use /plan off, /compact and /THEME=dark with {count}, {count} and reasoning_effort.'))
    .toEqual(['/THEME=dark', '/compact', '/plan off', 'reasoning_effort', '{count}', '{count}'])
})

it('ignores translated prose and non-command slashes', () => {
  expect(localeTokens('Cmd/Ctrl+Enter · tok/s · https://example.test/v1')).toEqual([])
  expect(localeTokens('Используйте /plan off и {count}'))
    .toEqual(localeTokens('Use /plan off and {count}'))
})

it.each([['/plan off', '/plan désactivé'], ['/THEME=light', '/THEME=claro'], ['reasoning_effort', 'Reasoning_effort'], ['{count}', '{other}']])('detects a change from %s to %s', (source, translated) => {
  expect(localeTokens(translated)).not.toEqual(localeTokens(source))
})

it('recognizes commands at the start of copy or after CJK punctuation', () => {
  expect(localeTokens('/THEME=auto、/THEME=light')).toEqual(['/THEME=auto', '/THEME=light'])
})

it.each(['\u200b', '\ufeff'])('rejects an invisible translation character', (character) => {
  expect(hasInvisibleLocaleCharacters(`text${character}text`)).toBe(true)
  expect(hasInvisibleLocaleCharacters('normal text')).toBe(false)
})
