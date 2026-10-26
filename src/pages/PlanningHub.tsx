import { Link, Outlet, useLocation, useNavigate } from 'react-router'
import { HubNav } from '../components/HubNav'
import { planningHubTabs } from '../components/navigation'
import { Select } from '../components/ui/input'

export function PlanningHub() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  return (
    <div>
      <div className="hidden md:block"><HubNav tabs={planningHubTabs} /></div>
      <label className="mb-4 block text-sm font-semibold md:hidden">Plan bölümü
        <Select className="mt-1" value={pathname} onChange={(event) => navigate(event.target.value)}>
          {planningHubTabs.map((tab) => <option key={tab.to} value={tab.to}>{tab.label}</option>)}
        </Select>
      </label>
      <Outlet />
      <p className="mt-6 border-t border-line py-3 text-xs text-ink-muted">Gelir kaydın için <Link className="inline-flex min-h-11 items-center font-semibold text-primary" to="/varliklar/maas">Maaş geçmişi →</Link></p>
    </div>
  )
}
