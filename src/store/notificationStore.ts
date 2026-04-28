import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface Notification {
  id: string
  ts: string
  type: 'waiting_user' | 'task_done' | 'task_failed' | 'info'
  projectId?: string
  title: string
  message: string
  read: boolean
}

interface NotificationStore {
  items: Notification[]
  add: (n: Omit<Notification, 'id' | 'ts' | 'read'>) => void
  markRead: (id: string) => void
  markAllRead: () => void
  clear: () => void
  unreadCount: () => number
}

export const useNotifications = create<NotificationStore>()(
  persist(
    (set, get) => ({
      items: [],
      add: (n) => {
        const item: Notification = {
          ...n,
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          ts: new Date().toISOString(),
          read: false,
        }
        set((s) => ({ items: [item, ...s.items].slice(0, 100) }))
      },
      markRead: (id) => {
        set((s) => ({
          items: s.items.map((i) => (i.id === id ? { ...i, read: true } : i)),
        }))
      },
      markAllRead: () => {
        set((s) => ({ items: s.items.map((i) => ({ ...i, read: true })) }))
      },
      clear: () => set({ items: [] }),
      unreadCount: () => get().items.filter((i) => !i.read).length,
    }),
    { name: 'rm-dashboard-notifications-v1' }
  )
)
