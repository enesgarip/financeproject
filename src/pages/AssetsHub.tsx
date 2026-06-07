import { Outlet } from 'react-router-dom'
import { HubNav } from '../components/HubNav'
import { assetsHubTabs } from '../components/navigation'

export function AssetsHub() {
  return (
    <div>
      <HubNav tabs={assetsHubTabs} />
      <Outlet />
    </div>
  )
}
