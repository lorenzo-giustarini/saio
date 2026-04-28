/**
 * V15.0 WS7 — Tutte le stringhe del wizard in italiano.
 * Centralizzate qui per facilitare manutenzione + futura i18n.
 */

// V15.0 WS8 — Provider preset SMTP (8 entry inclusa "tuo dominio" custom)
export const SMTP_PRESETS = [
  {
    id: 'outlook',
    label: 'Outlook / Hotmail / Live',
    host: 'smtp-mail.outlook.com',
    port: 587,
    hint: "Se hai l'autenticazione a 2 fattori attiva, devi generare un'App Password da account.live.com/proofs/AppPassword. Username = email completa.",
  },
  {
    id: 'icloud',
    label: 'iCloud Mail',
    host: 'smtp.mail.me.com',
    port: 587,
    hint: 'Apple richiede una App-specific Password. Vai su appleid.apple.com → Sign-In and Security → App-Specific Passwords → genera. Username = email completa @icloud.com.',
  },
  {
    id: 'yahoo',
    label: 'Yahoo Mail',
    host: 'smtp.mail.yahoo.com',
    port: 587,
    hint: 'Yahoo richiede App Password. Vai su Yahoo Account Security → Generate app password. Username = email completa @yahoo.com.',
  },
  {
    id: 'aruba',
    label: 'Aruba',
    host: 'smtp.aruba.it',
    port: 465,
    hint: 'Username = email completa, password = password account Aruba. Porta 465 (SSL) raccomandata.',
  },
  {
    id: 'register-it',
    label: 'Register.it',
    host: 'mail.register.it',
    port: 465,
    hint: 'Username = email completa, password = password account hosting Register.it. Porta 465 (SSL).',
  },
  {
    id: 'mailgun',
    label: 'Mailgun',
    host: 'smtp.mailgun.org',
    port: 587,
    hint: 'Username = postmaster@mg.tuodominio.com (NON la API key), password = SMTP password Mailgun. Trovi entrambi su mailgun.com → Sending → Domain Settings → SMTP credentials.',
  },
  {
    id: 'sendgrid',
    label: 'SendGrid',
    host: 'smtp.sendgrid.net',
    port: 587,
    hint: 'Username letterale: apikey (la stringa "apikey", tutto minuscolo). Password = la tua API key SendGrid. Trova su sendgrid.com → Settings → API Keys.',
  },
  {
    id: 'custom',
    label: 'Tuo dominio (custom)',
    host: '',
    port: 587,
    hint: 'Inserisci manualmente i parametri SMTP forniti dal tuo IT manager o dal supporto del provider email. Se hai un cPanel/Plesk, di solito il host è "mail.tuodominio.com".',
  },
] as const

export type SmtpPresetId = (typeof SMTP_PRESETS)[number]['id']

export const COPY = {
  intro: {
    title: 'Configura come ricevere le email di accesso',
    body: 'Per accedere a SAIO ti serve un modo per ricevere i magic link via email. Scegli come vuoi configurare il tuo provider email.',
    cardGmail: {
      title: 'Gmail',
      desc: 'Setup guidato passo-passo con la tua Gmail. Raccomandato se non hai un dominio personalizzato.',
    },
    cardCustom: {
      title: 'Email del tuo dominio',
      desc: 'Inserisci i parametri SMTP del tuo provider (utile se hai un dominio o un server email proprio).',
    },
    advanced: {
      title: 'Altri provider',
      resendDesc: 'Resend (account API key + dominio verificato)',
      debugDesc: 'Dev mode (link in console, no email reali) — solo per sviluppo',
    },
    skipBtn: 'Ho già configurato, salta wizard',
  },
  gmail: {
    step1: {
      title: 'Apri il tuo Account Google',
      body: 'Per generare una "App Password" specifica per SAIO, devi entrare nelle impostazioni di sicurezza del tuo account Google.\n\nClicca il bottone qui sotto per aprire Google Account in una nuova scheda. Tienila aperta — ti servirà negli step successivi.',
      action: 'Apri myaccount.google.com',
      url: 'https://myaccount.google.com',
    },
    step2: {
      title: 'Cerca "Sicurezza" nel menu sinistro',
      body: 'Nella scheda di Google Account che hai appena aperto, vedi un menu a sinistra con voci come "Home", "Informazioni personali", "Sicurezza".\n\nClicca su SICUREZZA.\n\nSe la voce non c\'è, controlla che la tua autenticazione a 2 fattori sia attiva (è un requisito per generare App Passwords).',
      note: 'Se il tuo account è gestito da un\'azienda (workspace), potresti non avere la possibilità di creare App Passwords. In quel caso usa un account Gmail personale o passa a "Email del tuo dominio".',
    },
    step3: {
      title: 'Cerca "App password" nella barra di ricerca',
      body: 'Nella sezione Sicurezza, cerca "app password" o "password per le app" usando la barra di ricerca in alto della pagina Google Account.\n\nCliccala dai risultati.\n\nSe Google ti chiede di reinserire la password del tuo account per accedere a questa sezione, fallo.',
    },
    step4: {
      title: 'Crea una nuova App Password',
      body: 'Sei nella pagina "App password". Vedrai un campo dove inserire un nome per identificare la nuova password.\n\nScrivi: SAIO Dashboard\n\nClicca CREA. Google ti mostrerà una password di 16 caratteri (es. "abcd efgh ijkl mnop"). Copiala — ci servirà allo step successivo.',
      warning: '⚠️ Google la mostra una sola volta. Se la chiudi senza copiare, devi generarne un\'altra.',
    },
    step5: {
      title: 'Inserisci i tuoi dati',
      body: 'Incolla qui sotto la password di 16 caratteri che Google ti ha mostrato, insieme alla tua email Gmail completa.',
      emailLabel: 'Email Gmail',
      emailPlaceholder: 'tu@gmail.com',
      passLabel: 'App Password',
      passPlaceholder: 'xxxx xxxx xxxx xxxx',
      passHint: 'Gli spazi vengono rimossi automaticamente. Devono essere 16 caratteri.',
      submitBtn: 'Salva configurazione',
    },
  },
  providerPicker: {
    title: 'Quale provider email usi?',
    body: 'Seleziona il tuo provider per ricevere istruzioni precise. Se non lo trovi nella lista, scegli "Tuo dominio (custom)" e inserisci i dati SMTP manualmente.',
    presetSubtitle: (host: string, port: number) => `${host} · porta ${port}`,
  },
  validation: {
    idle: '',
    validating: 'Verifica connessione SMTP…',
    valid: '✓ Connessione SMTP verificata',
    invalidPrefix: '⚠️ ',
    salvaDisabledTooltip: 'Verifica le credenziali (esci dal campo password) prima di salvare',
  },
  customSmtp: {
    title: 'Email del tuo dominio (SMTP)',
    titleWithPreset: (label: string) => `Configura ${label}`,
    body: 'Inserisci i parametri SMTP del tuo provider. Se non li conosci, chiedi al tuo IT manager o al supporto del provider email.',
    bodyWithPreset: 'Host e porta sono pre-compilati per questo provider. Inserisci username e password.',
    presetBadge: 'Pre-compilato',
    hostLabel: 'Host SMTP',
    hostPlaceholder: 'mail.tuodominio.com',
    portLabel: 'Porta',
    portHint: '587 STARTTLS · 465 SSL',
    userLabel: 'Username',
    userPlaceholder: 'tu@tuodominio.com',
    passLabel: 'Password',
    fromLabel: 'Mittente',
    fromHint: 'Default: stesso valore di Username',
    submitBtn: 'Salva configurazione',
  },
  resend: {
    title: 'Resend',
    body: 'Inserisci la tua API key Resend (re_…) e l\'indirizzo mittente verificato.',
    apiKeyLabel: 'Resend API Key',
    apiKeyPlaceholder: 're_xxxxxxxxxxxx',
    fromLabel: 'Mittente',
    fromPlaceholder: 'auth@tuodominio.com (o onboarding@resend.dev per test)',
    submitBtn: 'Salva configurazione',
  },
  debug: {
    title: 'Dev mode (no email)',
    body: 'In dev mode i magic link vengono stampati nel log del backend invece di essere inviati via email. Utile solo per sviluppo locale o testing.',
    warning: '⚠️ Da non usare in produzione: chiunque acceda al log del server può fare login.',
    submitBtn: 'Attiva dev mode',
  },
  done: {
    title: '✓ Configurazione salvata',
    body: 'Ottimo! Ora SAIO può inviare magic link tramite il provider che hai scelto.\n\nChiudi questo wizard e completa il claim della dashboard inserendo la tua email — riceverai il magic link nella tua inbox entro pochi secondi.',
    closeBtn: 'Procedi al claim',
  },
  errors: {
    rate_limited: 'Troppi tentativi di setup. Aspetta un\'ora e riprova.',
    already_claimed: 'Dashboard già claimato. Per cambiare config, modifica .env.local via SSH.',
    invalid_body: 'Dati non validi. Controlla i campi inseriti.',
    setup_failed: 'Salvataggio fallito sul server. Riprova o controlla i log.',
    network: 'Errore di rete. Riprova fra qualche secondo.',
  },
  buttons: {
    back: '← Indietro',
    next: 'Avanti →',
    cancel: 'Annulla',
    save: 'Salva',
  },
} as const
