/**
 * V15.0 WS3-3C — Route wrapper auth-gated.
 * Loading skeleton mentre fetch /me. 401 → redirect /login con state da preservare.
 */
import { type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useMe } from '@/hooks/useAuth'

export function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation()
  const { data, isLoading, isError } = useMe()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground text-sm">Loading…</div>
      </div>
    )
  }

  if (isError || !data) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <>{children}</>
}

export function RequireOwner({ children }: { children: ReactNode }) {
  const { data, isLoading } = useMe()
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground text-sm">Loading…</div>
      </div>
    )
  }
  if (!data || data.role !== 'owner') {
    return <Navigate to="/inbox" replace />
  }
  return <>{children}</>
}
