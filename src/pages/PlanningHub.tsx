import { Link, Outlet, useLocation } from 'react-router'
import { HubNav } from '../components/HubNav'
import { planningHubTabs } from '../components/navigation'

export function PlanningHub() {
  const { pathname } = useLocation()
  const mainTabs = planningHubTabs.slice(0, 2)
  const tools = planningHubTabs.slice(2)
  const activeTool = tools.find((tab) => tab.to === pathname)
  return (
    <div>
      <HubNav tabs={activeTool ? [...mainTabs, activeTool] : mainTabs} />
      <details key={pathname} className="mb-5 rounded-xl border border-line-strong bg-raised px-4">
        <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-ink-muted">Diğer planlama araçları</summary>
        <nav aria-label="Planlama araçları" className="grid gap-1 pb-3 sm:grid-cols-3">
          {tools.map((tab) => (
            <Link key={tab.to} to={tab.to} aria-current={pathname === tab.to ? 'page' : undefined} className="flex min-h-11 items-center rounded-lg px-3 text-sm text-ink hover:bg-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
              {tab.label === 'Liste' ? 'Alışveriş listesi' : tab.label}
            </Link>
          ))}
        </nav>
      </details>
      <Outlet />
    </div>
  )
}
