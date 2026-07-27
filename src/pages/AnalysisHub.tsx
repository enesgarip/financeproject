import { Outlet } from 'react-router'
import { HubNav } from '../components/HubNav'
import { analysisHubTabs } from '../components/navigation'

export function AnalysisHub() {
  return (
    <div>
      <HubNav tabs={analysisHubTabs} />
      <Outlet />
    </div>
  )
}
