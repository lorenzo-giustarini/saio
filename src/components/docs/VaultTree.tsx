import { useState } from 'react'
import { ChevronRight, ChevronDown, FileText, Folder, FolderOpen } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface TreeNode {
  type: 'dir' | 'file'
  name: string
  path: string
  size?: number
  mtime?: string
  children?: TreeNode[]
}

interface VaultTreeProps {
  nodes: TreeNode[]
  selectedPath: string | null
  onSelect: (node: TreeNode) => void
  query?: string
}

export function VaultTree({ nodes, selectedPath, onSelect, query = '' }: VaultTreeProps) {
  const filter = query.toLowerCase().trim()
  const shouldShow = (node: TreeNode): boolean => {
    if (!filter) return true
    if (node.name.toLowerCase().includes(filter)) return true
    if (node.type === 'dir' && node.children) {
      return node.children.some(shouldShow)
    }
    return false
  }
  return (
    <div className="space-y-0.5">
      {nodes.filter(shouldShow).map((node) => (
        <TreeItem key={node.path} node={node} selectedPath={selectedPath} onSelect={onSelect} depth={0} query={filter} />
      ))}
    </div>
  )
}

function TreeItem({
  node,
  selectedPath,
  onSelect,
  depth,
  query,
}: {
  node: TreeNode
  selectedPath: string | null
  onSelect: (node: TreeNode) => void
  depth: number
  query: string
}) {
  const [open, setOpen] = useState(depth < 1 || !!query)
  const isSelected = selectedPath === node.path
  const paddingLeft = `${depth * 12 + 6}px`

  if (node.type === 'dir') {
    return (
      <div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center gap-1 py-1 px-1 rounded hover:bg-accent text-xs"
          style={{ paddingLeft }}
        >
          {open ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
          {open ? <FolderOpen className="w-3.5 h-3.5 text-amber-400" /> : <Folder className="w-3.5 h-3.5 text-amber-400/70" />}
          <span className="truncate text-muted-foreground">{node.name}</span>
          <span className="ml-auto text-[9px] text-muted-foreground/60">{node.children?.length || 0}</span>
        </button>
        {open && node.children && (
          <div>
            {node.children
              .filter((n) => {
                if (!query) return true
                if (n.name.toLowerCase().includes(query)) return true
                if (n.type === 'dir' && n.children) {
                  return n.children.some((nc) => nc.name.toLowerCase().includes(query))
                }
                return false
              })
              .map((child) => (
                <TreeItem key={child.path} node={child} selectedPath={selectedPath} onSelect={onSelect} depth={depth + 1} query={query} />
              ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <button
      onClick={() => onSelect(node)}
      className={cn(
        'w-full flex items-center gap-2 py-1 px-1 rounded text-xs transition-colors',
        isSelected
          ? 'bg-primary/20 text-primary font-medium'
          : 'hover:bg-accent text-foreground/80'
      )}
      style={{ paddingLeft }}
    >
      <span className="w-3 h-3" />
      <FileText className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate text-left">{node.name.replace(/\.md$/, '')}</span>
    </button>
  )
}
