import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type AnswerType = 'yes' | 'no' | 'skip' | 'comment-only' | null

export interface DraftEntry {
  answer: AnswerType
  comment: string
  voiceUsed: boolean
}

interface DraftStore {
  drafts: Record<string, Record<string, DraftEntry>> // briefId → decisionId → entry
  globalComments: Record<string, string> // briefId → comment
  setAnswer: (briefId: string, decisionId: string, answer: AnswerType) => void
  setComment: (briefId: string, decisionId: string, comment: string, voiceUsed?: boolean) => void
  setGlobalComment: (briefId: string, comment: string) => void
  getDraft: (briefId: string, decisionId: string) => DraftEntry
  clearBrief: (briefId: string) => void
}

const emptyEntry: DraftEntry = { answer: null, comment: '', voiceUsed: false }

export const useDraftStore = create<DraftStore>()(
  persist(
    (set, get) => ({
      drafts: {},
      globalComments: {},
      setAnswer: (briefId, decisionId, answer) => {
        set((s) => {
          const brief = s.drafts[briefId] || {}
          const prev = brief[decisionId] || { ...emptyEntry }
          return {
            drafts: {
              ...s.drafts,
              [briefId]: { ...brief, [decisionId]: { ...prev, answer } },
            },
          }
        })
      },
      setComment: (briefId, decisionId, comment, voiceUsed = false) => {
        set((s) => {
          const brief = s.drafts[briefId] || {}
          const prev = brief[decisionId] || { ...emptyEntry }
          return {
            drafts: {
              ...s.drafts,
              [briefId]: { ...brief, [decisionId]: { ...prev, comment, voiceUsed: voiceUsed || prev.voiceUsed } },
            },
          }
        })
      },
      setGlobalComment: (briefId, comment) => {
        set((s) => ({ globalComments: { ...s.globalComments, [briefId]: comment } }))
      },
      getDraft: (briefId, decisionId) => {
        return get().drafts[briefId]?.[decisionId] || { ...emptyEntry }
      },
      clearBrief: (briefId) => {
        set((s) => {
          const { [briefId]: _, ...rest } = s.drafts
          const { [briefId]: __, ...restGlobals } = s.globalComments
          return { drafts: rest, globalComments: restGlobals }
        })
      },
    }),
    { name: 'rm-dashboard-drafts-v1' }
  )
)
