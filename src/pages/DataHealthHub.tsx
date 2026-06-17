import { Outlet } from 'react-router-dom'
import { HubNav } from '../components/HubNav'
import { dataHealthHubTabs } from '../components/navigation'

export function DataHealthHub() {
  return (
    <div>
      <HubNav tabs={dataHealthHubTabs} />
      <Outlet />
    </div>
  )
}
