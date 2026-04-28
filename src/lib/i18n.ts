import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import commonIt from '@/locales/it/common.json'
import authIt from '@/locales/it/auth.json'
import navIt from '@/locales/it/nav.json'
import projectsIt from '@/locales/it/projects.json'
import cronIt from '@/locales/it/cron.json'
import accountsIt from '@/locales/it/accounts.json'
import vaultIt from '@/locales/it/vault.json'
import settingsIt from '@/locales/it/settings.json'

import commonEn from '@/locales/en/common.json'
import authEn from '@/locales/en/auth.json'
import navEn from '@/locales/en/nav.json'
import projectsEn from '@/locales/en/projects.json'
import cronEn from '@/locales/en/cron.json'
import accountsEn from '@/locales/en/accounts.json'
import vaultEn from '@/locales/en/vault.json'
import settingsEn from '@/locales/en/settings.json'

import commonEs from '@/locales/es/common.json'
import authEs from '@/locales/es/auth.json'
import navEs from '@/locales/es/nav.json'
import projectsEs from '@/locales/es/projects.json'
import cronEs from '@/locales/es/cron.json'
import accountsEs from '@/locales/es/accounts.json'
import vaultEs from '@/locales/es/vault.json'
import settingsEs from '@/locales/es/settings.json'

export const SUPPORTED_LANGUAGES = ['it', 'en', 'es'] as const
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

export const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  it: 'Italiano',
  en: 'English',
  es: 'Español',
}

export const LANGUAGE_FLAGS: Record<SupportedLanguage, string> = {
  it: '🇮🇹',
  en: '🇬🇧',
  es: '🇪🇸',
}

const resources = {
  it: {
    common: commonIt,
    auth: authIt,
    nav: navIt,
    projects: projectsIt,
    cron: cronIt,
    accounts: accountsIt,
    vault: vaultIt,
    settings: settingsIt,
  },
  en: {
    common: commonEn,
    auth: authEn,
    nav: navEn,
    projects: projectsEn,
    cron: cronEn,
    accounts: accountsEn,
    vault: vaultEn,
    settings: settingsEn,
  },
  es: {
    common: commonEs,
    auth: authEs,
    nav: navEs,
    projects: projectsEs,
    cron: cronEs,
    accounts: accountsEs,
    vault: vaultEs,
    settings: settingsEs,
  },
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LANGUAGES as unknown as string[],
    nonExplicitSupportedLngs: true,
    load: 'languageOnly',
    ns: ['common', 'auth', 'nav', 'projects', 'cron', 'accounts', 'vault', 'settings'],
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    detection: {
      order: ['cookie', 'localStorage', 'navigator', 'htmlTag'],
      lookupCookie: 'saio_lang',
      lookupLocalStorage: 'saio_lang',
      caches: ['localStorage', 'cookie'],
      cookieMinutes: 60 * 24 * 365,
    },
    react: { useSuspense: false },
  })

// Bootstrap: ensure cookie mirrors the resolved language at first load so the
// backend (magic-link emails) sees the right Accept-Language equivalent.
try {
  const lang = (i18n.resolvedLanguage as SupportedLanguage) || 'en'
  document.cookie = `saio_lang=${lang}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`
} catch { /* ignore */ }

export function setLanguage(lang: SupportedLanguage) {
  void i18n.changeLanguage(lang)
  localStorage.setItem('saio_lang', lang)
  // Mirror the choice on a cookie so the backend uses the same language for
  // server-rendered content (magic-link emails). 1 year, lax, same site only.
  try {
    document.cookie = `saio_lang=${lang}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`
  } catch { /* ignore */ }
}

export function currentLanguage(): SupportedLanguage {
  const lang = i18n.resolvedLanguage as SupportedLanguage | undefined
  return lang && SUPPORTED_LANGUAGES.includes(lang) ? lang : 'en'
}

export default i18n
