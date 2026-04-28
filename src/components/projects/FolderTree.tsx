import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Folder, FolderOpen, ChevronRight, ChevronDown } from 'lucide-react'
import { SessionStatusDot } from './SessionStatusDot'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface ProjectForTree {
  id: string
  name: string
  status: string
  category?: string
  nextAction?: string
  folder?: string
  sessionStatus?: string
  archived?: boolean
  tags?: string[]
}

interface FolderNodeData {
  name: string
  path: string
  projects: ProjectForTree[]
  children: FolderNodeData[]
}

/**
 * Build nested folder tree from flat projects with `folder` field like "Clients/Herbalife/UK".
 * Root projects (no folder) are returned as root.projects.
 */
export function buildFolderTree(projects: ProjectForTree[]): FolderNodeData {
  const root: FolderNodeData = { name: '', path: '', projects: [], children: [] }

  for (const p of projects) {
    if (!p.folder || p.folder.trim() === '') {
      root.projects.push(p)
      continue
    }

    const segments = p.folder.split('/').filter(Boolean)
    let cursor = root
    let accum = ''
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      accum = accum ? `${accum}/${seg}` : seg
      let child = cursor.children.find((c) => c.name === seg)
      if (!child) {
        child = { name: seg, path: accum, projects: [], children: [] }
        cursor.children.push(child)
      }
      cursor = child
    }
    cursor.projects.push(p)
  }

  // Sort children alphabetically at each level
  const sortRecursive = (node: FolderNodeData) => {
    node.children.sort((a, b) => a.name.localeCompare(b.name))
    node.projects.sort((a, b) => a.name.localeCompare(b.name))
    node.children.forEach(sortRecursive)
  }
  sortRecursive(root)

  return root
}

/** Returns all unique folder paths found in a projects list (for "Move to..." dropdown) */
export function listAllFolders(projects: ProjectForTree[]): string[] {
  const folders = new Set<string>()
  for (const p of projects) {
    if (!p.folder) continue
    const segments = p.folder.split('/').filter(Boolean)
    let accum = ''
    for (const seg of segments) {
      accum = accum ? `${accum}/${seg}` : seg
      folders.add(accum)
    }
  }
  return Array.from(folders).sort()
}

const statusBorder: Record<string, string> = {
  green: 'hover:border-emerald-500/50 hover:shadow-[0_0_20px_rgba(16,185,129,0.15)]',
  yellow: 'hover:border-amber-500/50 hover:shadow-[0_0_20px_rgba(245,158,11,0.15)]',
  red: 'hover:border-red-500/50 hover:shadow-[0_0_20px_rgba(239,68,68,0.15)]',
  paused: 'hover:border-slate-500/50',
  unknown: 'hover:border-slate-500/50',
}

function MiniProjectCard({ p }: { p: ProjectForTree }) {
  return (
    <Link to={`/projects/${p.id}`} className="block group">
      <Card
        className={cn(
          'transition-all duration-300 cursor-pointer',
          statusBorder[p.status] || statusBorder.unknown
        )}
      >
        <CardContent className="py-3 px-4">
          <div className="flex items-center gap-2">
            <SessionStatusDot status={(p.sessionStatus as any) || 'idle'} />
            <h4 className="font-medium text-sm truncate flex-1">{p.name}</h4>
            {p.category && (
              <Badge variant="secondary" className="text-[10px] h-4 px-1.5 shrink-0">
                {p.category}
              </Badge>
            )}
          </div>
          {p.nextAction && (
            <p className="text-[11px] text-muted-foreground mt-1 line-clamp-1 pl-4">
              {p.nextAction}
            </p>
          )}
        </CardContent>
      </Card>
    </Link>
  )
}

function FolderNode({
  node,
  depth,
  defaultExpanded = false,
}: {
  node: FolderNodeData
  depth: number
  defaultExpanded?: boolean
}) {
  const [expanded, setExpanded] = useState(defaultExpanded || depth === 0)
  const totalCount = useMemo(() => {
    const countRec = (n: FolderNodeData): number =>
      n.projects.length + n.children.reduce((sum, c) => sum + countRec(c), 0)
    return countRec(node)
  }, [node])

  return (
    <div className="space-y-1">
      <button
        onClick={() => setExpanded((x) => !x)}
        className={cn(
          'flex items-center gap-1.5 w-full text-left px-2 py-1.5 rounded hover:bg-accent/50 transition-colors',
          'text-sm font-medium'
        )}
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
        )}
        {expanded ? (
          <FolderOpen className="w-4 h-4 text-violet-400" />
        ) : (
          <Folder className="w-4 h-4 text-violet-400" />
        )}
        <span>{node.name}</span>
        <span className="text-xs text-muted-foreground ml-auto pr-2">{totalCount}</span>
      </button>
      {expanded && (
        <div className="space-y-1.5" style={{ paddingLeft: `${(depth + 1) * 20}px` }}>
          {node.projects.map((p) => (
            <MiniProjectCard key={p.id} p={p} />
          ))}
          {node.children.map((child) => (
            <FolderNode key={child.path} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

export function FolderTree({ projects }: { projects: ProjectForTree[] }) {
  const tree = useMemo(() => buildFolderTree(projects), [projects])
  if (tree.children.length === 0 && tree.projects.length === 0) {
    return (
      <div className="text-xs text-muted-foreground italic py-4 text-center">
        Nessuna cartella. Assegna una cartella a un progetto dal suo dettaglio (Sposta in...).
      </div>
    )
  }
  return (
    <div className="space-y-1">
      {tree.children.map((child) => (
        <FolderNode key={child.path} node={child} depth={0} defaultExpanded />
      ))}
    </div>
  )
}
