/**
 * Platform Abstraction Layer (PAL) — V15.9 WS39 Microtask 3
 *
 * Interfaces TypeScript per ottenere feature parity 100% su Windows 10/11 +
 * Ubuntu + macOS. Ogni implementazione platform-specific (`./windows/`,
 * `./linux/`, `./macos/`) realizza queste interfaces in modo nativo per
 * l'OS host.
 *
 * Pattern: factory `getPlatform()` (in `./index.ts`) ritorna l'implementazione
 * giusta basandosi su `os.platform()` ('win32' | 'linux' | 'darwin').
 *
 * Le route Express e i file core (pty-manager, accounts-store, ecc.) NON
 * chiamano direttamente schtasks/winget/cron/launchd: passano sempre dal PAL.
 */

// ──────────────────────── Common types ────────────────────────

export type Platform = 'win32' | 'linux' | 'darwin'
export type ScheduleType = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'ONCE'
export type WeekDay = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN'
export type TaskState = 'ready' | 'disabled' | 'running' | 'queued' | 'unknown'

export interface ScheduleSpec {
  type: ScheduleType
  /** HH:MM (24h). */
  time?: string
  /** Per WEEKLY: giorno della settimana. */
  day?: WeekDay
  /** Per MONTHLY: 1-31. */
  dayOfMonth?: string | number
}

export interface ScheduledTask {
  /** Nome univoco (sintassi accettata: alphanum + dash + underscore). */
  name: string
  /** Comando o path eseguibile. */
  command: string
  /** Se true: comando è path file PS1/sh, altrimenti string-command. */
  commandIsFile?: boolean
  schedule: ScheduleSpec
  /** Stato corrente. */
  state: TaskState
  /** Descrizione breve (max 1024 char). Persistita in commento nativo (Windows: schtasks /comment, Linux: # comment, macOS: <key>Description</key>). */
  description?: string
  /** Markdown rich-text in sidecar `data/cron-meta.json` (no native limit). */
  details?: string
  nextRunAt?: string
  lastRunAt?: string
  lastResult?: number
}

export interface OperationResult<T = unknown> {
  ok: boolean
  output?: string
  exitCode?: number
  error?: string
  data?: T
}

// ──────────────────────── ITaskScheduler ────────────────────────

export interface ITaskScheduler {
  /** Lista tutti i task gestiti (pattern naming `Obsidian-*`, `RM-*`, custom). */
  list(): Promise<ScheduledTask[]>
  /** Dettaglio singolo task. */
  get(name: string): Promise<ScheduledTask | null>
  /** Crea nuovo task. */
  create(task: Omit<ScheduledTask, 'state' | 'lastRunAt' | 'lastResult'>): Promise<OperationResult>
  /** Elimina task per nome. */
  delete(name: string): Promise<OperationResult>
  /** Toggle abilitato. */
  enable(name: string): Promise<OperationResult>
  disable(name: string): Promise<OperationResult>
  /** Esegui ora (manual trigger). */
  run(name: string): Promise<OperationResult>
  /** Rinomina (atomic export+delete+create). */
  rename(oldName: string, newName: string): Promise<OperationResult>
  /** Aggiorna comment/description nativa. */
  setComment(name: string, comment: string): Promise<OperationResult>
}

// ──────────────────────── IPackageManager ────────────────────────

export interface PackageInfo {
  id: string
  installedVersion?: string
  latestVersion?: string
  source?: string
}

export interface IPackageManager {
  /** Nome utente-friendly del package manager nativo (`winget`, `apt`, `brew`). */
  readonly name: string
  /** Verifica se PM disponibile sul sistema. */
  isAvailable(): Promise<boolean>
  /** Versione installata di un pacchetto (null se non installato). */
  getInstalled(packageId: string): Promise<string | null>
  /** Ultima versione disponibile dal registry. */
  getLatest(packageId: string): Promise<string | null>
  /** Upgrade (può richiedere elevation; il PM internamente delega a IElevator se serve). */
  upgrade(packageId: string): Promise<OperationResult>
  /** Install ex-novo. */
  install(packageId: string): Promise<OperationResult>
  /** Lista tutti pacchetti aggiornabili. */
  listOutdated(): Promise<PackageInfo[]>
}

// ──────────────────────── IElevator ────────────────────────

export type ElevatorOp =
  | { op: 'task-enable'; taskName: string }
  | { op: 'task-disable'; taskName: string }
  | { op: 'task-run'; taskName: string }
  | { op: 'task-delete'; taskName: string }
  | { op: 'task-create'; taskName: string; spec: ScheduleSpec; command: string; description?: string }
  | { op: 'task-rename'; taskName: string; newName: string }
  | { op: 'task-export-xml'; taskName: string }
  | { op: 'task-create-from-xml'; taskName: string; xmlPath: string }
  | { op: 'task-set-comment'; taskName: string; comment: string }
  | { op: 'pkg-upgrade'; package: string }
  | { op: 'pkg-install'; package: string }
  | { op: 'shell'; command: string; args?: string[] }

/**
 * Elevator: esegue operazioni che richiedono privilegi admin SENZA popup UAC.
 *
 * Pattern Windows (V14.27 + V15.2 WS32): task scheduler `RM-Dashboard-Cron-Manager`
 * con `RunLevel=Highest`, triggerato dal proprietario user via `schtasks /run`.
 * IPC via file JSON in `data/elevator/cmd-*.json` → `result-*.json`.
 *
 * Pattern Linux: PolicyKit (`pkexec`) per GUI prompts una-tantum, poi sudo
 * tokens/cache. Policy file `/usr/share/polkit-1/actions/...policy`.
 *
 * Pattern macOS: `osascript -e 'do shell script ... with administrator privileges'`.
 */
export interface IElevator {
  /** Verifica se l'elevator è disponibile/configurato. */
  isAvailable(): Promise<boolean>
  /** Esegue una operazione elevated. */
  run(op: ElevatorOp): Promise<OperationResult>
  /** Setup iniziale (registra task scheduler / policy file / etc). Idempotente. */
  setup(): Promise<OperationResult>
  /** Rimozione setup (uninstall). */
  teardown(): Promise<OperationResult>
}

// ──────────────────────── IShell (PTY) ────────────────────────

export interface ShellSpec {
  /** Eseguibile shell (cmd.exe / bash / zsh). */
  shellPath: string
  /** Args per spawn iniziale (es. ['/k', cmd] per cmd.exe, ['-c', cmd] per bash). */
  args: (commandString: string) => string[]
  /** Env vars supplementari. */
  env?: Record<string, string>
}

export interface IShell {
  /** Shell di default per l'OS (cmd.exe Win, bash/zsh Unix). */
  defaultShell(): ShellSpec
  /** Risolve un eseguibile nel PATH (cross-platform `where`/`which`). */
  resolveExecutable(name: string): Promise<string | null>
  /** Spawn detached background (es. per pre-spawn update). */
  spawnDetached(executable: string, args: string[]): Promise<OperationResult>
}

// ──────────────────────── IPaths ────────────────────────

export interface IPaths {
  /** Home directory (`~`). */
  home(): string
  /** Config directory (Windows: %APPDATA%, Unix: $XDG_CONFIG_HOME ?? $HOME/.config). */
  configDir(appName: string): string
  /** Data directory (Windows: %LOCALAPPDATA%, Unix: $XDG_DATA_HOME ?? $HOME/.local/share). */
  dataDir(appName: string): string
  /** Cache directory (Windows: %LOCALAPPDATA%/Cache, Unix: $XDG_CACHE_HOME). */
  cacheDir(appName: string): string
  /** Vault path (`~/.claude/projects/...`). */
  claudeVaultDir(): string
  /** SSH dir (`~/.ssh`). */
  sshDir(): string
}

// ──────────────────────── IInstaller (CLI tools) ────────────────────────

export interface IInstaller {
  /** Verifica se un CLI è installato (in PATH). */
  isInstalled(cliName: string): Promise<boolean>
  /** Installa un CLI tool tramite il package manager nativo o npm globale. */
  installCli(spec: { cliName: string; npmPackage?: string; brewFormula?: string; aptPackage?: string; wingetId?: string }): Promise<OperationResult>
}

// ──────────────────────── Aggregate Platform ────────────────────────

export interface IPlatform {
  readonly platform: Platform
  readonly taskScheduler: ITaskScheduler
  readonly packageManager: IPackageManager
  readonly elevator: IElevator
  readonly shell: IShell
  readonly paths: IPaths
  readonly installer: IInstaller
}
