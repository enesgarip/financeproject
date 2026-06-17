import { Outlet } from 'react-router-dom'
import { HubNav } from '../components/HubNav'
import { planningHubTabs } from '../components/navigation'

export function PlanningHub() {
  return (
    <div>
      <HubNav tabs={planningHubTabs} />
      <Outlet />
    </div>
  )
}
