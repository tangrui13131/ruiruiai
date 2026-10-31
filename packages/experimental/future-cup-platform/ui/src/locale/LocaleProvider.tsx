import { createContext, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { localeDictionaries } from './types.ts'
import type { Dictionary, LocaleName } from './types.ts'

interface LocaleContextValue {
  readonly locale: LocaleName
  readonly dictionary: Dictionary
  setLocale(locale: LocaleName): void
}

const LocaleContext = createContext<LocaleContextValue | undefined>(undefined)

/** Provide the management application's typed locale dictionary. */
export function LocaleProvider({
  children,
  initialLocale = 'zh-CN',
}: {
  readonly children: ReactNode
  readonly initialLocale?: LocaleName
}) {
  const [locale, setLocale] = useState<LocaleName>(initialLocale)
  const value = useMemo<LocaleContextValue>(() => ({
    locale,
    dictionary: localeDictionaries[locale],
    setLocale,
  }), [locale])
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

/** Read the active locale and dictionary. */
export function useLocale(): LocaleContextValue {
  const value = useContext(LocaleContext)
  if (value === undefined) throw new Error('useLocale must be used inside LocaleProvider')
  return value
}
