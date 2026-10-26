import { Link, Outlet } from 'react-router'
import { HubNav } from '../components/HubNav'
import { liabilitiesHubTabs } from '../components/navigation'

export function LiabilitiesHub() {
  return (
    <div>
      <HubNav tabs={liabilitiesHubTabs} />
      <p className="mb-4 text-sm text-ink-muted">Kredi kartı borçları için <Link className="inline-flex min-h-11 items-center font-semibold text-primary" to="/kartlar?section=kartlar">Kredi kartlarına git →</Link></p>
      <Outlet />
    </div>
  )
}
