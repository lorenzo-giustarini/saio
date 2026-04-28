import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { DepsCheckBanner } from '@/components/system/DepsCheckBanner'
import { PerfAlert } from '@/components/system/PerfAlert'

export function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Desktop sidebar (≥ lg) */}
      <div className="hidden lg:flex">
        <Sidebar />
      </div>

      {/* Mobile sidebar drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="p-0 w-64">
          <SheetTitle className="sr-only">Menu di navigazione</SheetTitle>
          <Sidebar />
        </SheetContent>
      </Sheet>

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <div className="flex items-center border-b border-border lg:border-none">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden m-2"
            onClick={() => setMobileOpen(true)}
            aria-label="Apri menu"
          >
            <Menu className="w-5 h-5" />
          </Button>
          <div className="flex-1">
            <TopBar />
          </div>
        </div>
        {/* V15.0 WS22 — Alert CPU saturo > 100% sostenuto (top priority, sticky) */}
        <PerfAlert />
        {/* V15.0 WS10 — Banner deps mancanti (auto-hide se tutto ok o dismissed) */}
        <DepsCheckBanner />
        <main className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="container mx-auto px-4 md:px-6 py-4 md:py-8 animate-fade-in max-w-full">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
