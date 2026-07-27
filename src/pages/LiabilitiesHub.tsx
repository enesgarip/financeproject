import { Outlet } from 'react-router'
import { HubNav } from '../components/HubNav'
import { liabilitiesHubTabs } from '../components/navigation'

export function LiabilitiesHub() {
  return (
    <div>
      <HubNav tabs={liabilitiesHubTabs} />
      <Outlet />
    </div>
  )
}
