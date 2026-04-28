import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from '@/components/layout/Layout'
import { InboxPage } from '@/pages/Inbox'
import { TasksPage } from '@/pages/Tasks'
import { ProjectsPage } from '@/pages/Projects'
import { ProjectDetailPage } from '@/pages/ProjectDetail'
import { NewProjectPage } from '@/pages/NewProject'
import { DeepResearchPage } from '@/pages/DeepResearch'
import { AccountsPage } from '@/pages/Accounts'
import { TaskTypesPage } from '@/pages/TaskTypes'
import { ExtrasPage } from '@/pages/Extras'
import { CronPage } from '@/pages/Cron'
import { RecipesPage } from '@/pages/Recipes'
import ClaimPage from '@/pages/Claim'
import MagicLinkSentPage from '@/pages/MagicLinkSent'
import LoginPage from '@/pages/Login'
import EnrollTotpPage from '@/pages/EnrollTotp'
import VerifyTotpPage from '@/pages/VerifyTotp'
import SettingsAccessPage from '@/pages/SettingsAccess'
import { RequireAuth, RequireOwner } from '@/components/auth/RequireAuth'
import { CommandPalette } from '@/components/addons/CommandPalette'
import { useSSE } from '@/hooks/useSSE'

// Lazy-load heavy pages (recharts, MarkdownRenderer tree)
const DocsPageLazy = lazy(() => import('@/pages/Docs').then((m) => ({ default: m.DocsPage })))
const MetricsPageLazy = lazy(() => import('@/pages/Metrics').then((m) => ({ default: m.MetricsPage })))
const ArchivePageLazy = lazy(() => import('@/pages/Archive').then((m) => ({ default: m.ArchivePage })))

const LazyFallback = ({ label }: { label?: string }) => (
  <div className="py-12 text-center text-muted-foreground text-sm">{label || 'Caricamento...'}</div>
)

export default function App() {
  useSSE()
  return (
    <>
      <CommandPalette />
      <Routes>
        {/* PUBLIC routes — V15.0 WS3 (3G claim, 3A login, 3B totp, 3H settings) */}
        <Route path="/claim" element={<ClaimPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/magic-sent" element={<MagicLinkSentPage />} />
        <Route path="/enroll-totp" element={<EnrollTotpPage />} />
        <Route path="/verify-totp" element={<VerifyTotpPage />} />

        {/* GATED routes — V15.0 WS3-3C RequireAuth wrapper. In dev locale,
            DASHBOARD_AUTH_REQUIRED=false fa sì che /api/auth/me ritorni un user
            placeholder e RequireAuth lascia passare. */}
        <Route
          path="/"
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route index element={<Navigate to="/inbox" replace />} />
          <Route path="inbox" element={<InboxPage />} />
          <Route path="tasks" element={<TasksPage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/new" element={<NewProjectPage />} />
          <Route path="projects/:id" element={<ProjectDetailPage />} />
          <Route
            path="archive"
            element={
              <Suspense fallback={<div className="py-12 text-center text-muted-foreground text-sm">Caricamento...</div>}>
                <ArchivePageLazy />
              </Suspense>
            }
          />
          <Route
            path="metrics"
            element={
              <Suspense fallback={<div className="py-12 text-center text-muted-foreground text-sm">Caricamento metriche...</div>}>
                <MetricsPageLazy />
              </Suspense>
            }
          />
          <Route path="extras" element={<ExtrasPage />} />
          <Route
            path="docs"
            element={
              <Suspense fallback={<LazyFallback label="Caricamento vault..." />}>
                <DocsPageLazy />
              </Suspense>
            }
          />
          <Route
            path="docs/*"
            element={
              <Suspense fallback={<LazyFallback label="Caricamento vault..." />}>
                <DocsPageLazy />
              </Suspense>
            }
          />
          <Route path="cron" element={<CronPage />} />
          <Route path="recipes" element={<RecipesPage />} />
          <Route path="deep-research" element={<DeepResearchPage />} />
          <Route path="accounts" element={<AccountsPage />} />
          <Route path="accounts/task-types" element={<TaskTypesPage />} />
          <Route
            path="settings/access"
            element={
              <RequireOwner>
                <SettingsAccessPage />
              </RequireOwner>
            }
          />
          <Route path="*" element={<Navigate to="/inbox" replace />} />
        </Route>
      </Routes>
    </>
  )
}
