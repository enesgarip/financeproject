// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NotificationSettings } from './NotificationSettings'

const mocks=vi.hoisted(()=>({health:vi.fn(),unavailable:vi.fn(),user:{id:'u'}}))
vi.mock('../../auth/useAuth',()=>({useAuth:()=>({user:mocks.user})}))
vi.mock('../../lib/pushClient',()=>({currentPushUnavailableReason:mocks.unavailable,getPushPermission:()=> 'granted',isSubscribedOnThisDevice:async()=>true,getCurrentPushEndpoint:()=>null,subscribeToPush:vi.fn(),unsubscribeFromPush:vi.fn()}))
vi.mock('../../services/pushNotifications',()=>({sendTestPushNotification:vi.fn()}))
vi.mock('../../data/repositories/notificationPreferencesRepo',()=>({
  fetchLastNotification:async()=>({ok:true,data:null}),fetchAutomationHealth:mocks.health,
  fetchNotificationPreferences:async()=>({ok:true,data:{payments_enabled:true,loans_enabled:true,statements_enabled:true,weekly_enabled:true,cars_enabled:true,provisions_enabled:true,goals_enabled:true,sms_alerts_enabled:true,quiet_hours_start:22,quiet_hours_end:8}}),
  upsertNotificationPreferences:vi.fn(),
}))
afterEach(cleanup)
beforeEach(()=>mocks.unavailable.mockReturnValue(null))
it('push desteklenmese de otomasyon sağlık durumu görünür',async()=>{
  mocks.unavailable.mockReturnValue('unsupported-browser')
  mocks.health.mockResolvedValue({ok:true,data:{maintenance:{ok:false,errors:2},scheduler:null,unknown_deliveries:1,retry_deliveries:0,failed_deliveries:0}})
  render(<NotificationSettings />)
  expect(await screen.findByText('Kart bakımında 2 hata var.')).toBeTruthy()
  expect(screen.getByText(/Bu tarayıcı Web Push/)).toBeTruthy()
})
it('bakım ve belirsiz/başarısız cihaz durumunu gösterir; sessiz saati erteleme olarak açıklar',async()=>{
  mocks.health.mockResolvedValue({ok:true,data:{maintenance:{ok:false,errors:2},scheduler:null,unknown_deliveries:1,retry_deliveries:2,failed_deliveries:3}})
  render(<NotificationSettings />)
  expect(await screen.findByText('Kart bakımında 2 hata var.')).toBeTruthy()
  expect(screen.getByText(/1 bildirimin teslim sonucu belirsiz/)).toBeTruthy()
  expect(screen.getByText(/2 cihaz teslimi yeniden denenecek/)).toBeTruthy()
  expect(screen.getByText(/3 cihaz teslimi başarısız/)).toBeTruthy()
  expect(screen.getByText(/sessiz saat bittikten sonraki kontrolde/)).toBeTruthy()
  expect(screen.getByText('Zamanlayıcı henüz yapılandırılmadı.')).toBeTruthy()
})
it('sağlık sorgusu hatasını başarılı durum gibi göstermez',async()=>{
  mocks.health.mockResolvedValue({ok:false,error:{message:'Ağ hatası'}})
  render(<NotificationSettings />)
  expect(await screen.findByText(/Otomasyon durumu alınamadı/)).toBeTruthy()
  expect(screen.queryByText('Son kart bakımı başarılı.')).toBeNull()
})
