import { Globe } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  LANGUAGE_FLAGS,
  LANGUAGE_LABELS,
  SUPPORTED_LANGUAGES,
  setLanguage,
  type SupportedLanguage,
} from '@/lib/i18n'

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { t, i18n } = useTranslation('common')
  const current = (i18n.resolvedLanguage as SupportedLanguage) || 'en'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={t('language.label')}
      >
        <Globe className="h-3.5 w-3.5" aria-hidden />
        {!compact && (
          <span className="hidden sm:inline">
            {LANGUAGE_FLAGS[current]} {LANGUAGE_LABELS[current]}
          </span>
        )}
        {compact && <span>{LANGUAGE_FLAGS[current]}</span>}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[160px] max-w-[calc(100vw-1.5rem)]">
        {SUPPORTED_LANGUAGES.map((lang) => (
          <DropdownMenuItem
            key={lang}
            onClick={() => setLanguage(lang)}
            className={
              current === lang
                ? 'bg-accent text-accent-foreground'
                : ''
            }
          >
            <span className="mr-2">{LANGUAGE_FLAGS[lang]}</span>
            {LANGUAGE_LABELS[lang]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
