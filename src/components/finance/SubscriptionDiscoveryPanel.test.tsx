// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BalancePrivacyProvider } from '../../hooks/useBalancePrivacy'
import { StatementSubscriptionDiscovery, SubscriptionDiscoveryPanel } from './SubscriptionDiscoveryPanel'
import type { DiscoveryExpense, DiscoveryPayment } from '../../utils/subscriptionDiscovery'
import type { Card } from '../../types/database'

const mocks = vi.hoisted(() => ({ fetch:vi.fn(), save:vi.fn(), expenses:vi.fn() }))
vi.mock('../../auth/useAuth', () => ({ useAuth: () => ({user:{id:'u'}}) }))
vi.mock('../../data/repositories/cardsRepo', () => ({ fetchCardPaymentMatchRows:(...args:unknown[]) => mocks.fetch(...args), fetchSubscriptionExpenses:(...args:unknown[]) => mocks.expenses(...args) }))
vi.mock('../../data/repositories/crudRepo', () => ({ saveCrudRow:(...args:unknown[]) => mocks.save(...args) }))
const cards = [{id:'black',card_name:'Black',card_type:'kredi_karti' as const}]
const expenses:DiscoveryExpense[] = ['2026-08-15','2026-09-15','2026-10-15'].map((spent_at) => ({id:spent_at,card_id:'black',spent_at,amount:69.9,status:'posted',installment_count:1,description:'AMAZON PRIME',category:'Abonelik',note:null}))
const payment:DiscoveryPayment = {id:'p',title:'Prime',amount:69.9,amount_status:'exact',due_date:'2026-11-15',status:'bekliyor',payment_method:'bank_auto',auto_source_card_id:'black',recurrence:'monthly',recurrence_day:15,recurrence_end_date:null,match_merchant:'AMAZON PRIME'}
function show(children = <SubscriptionDiscoveryPanel expenses={expenses} payments={[]} cards={cards} />) {
  const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})
  return render(<QueryClientProvider client={client}><BalancePrivacyProvider>{children}</BalancePrivacyProvider></QueryClientProvider>)
}
beforeEach(() => {
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date(2026,9,18))
  mocks.fetch.mockReset().mockResolvedValue({ok:true,data:[]})
  mocks.save.mockReset().mockResolvedValue({ok:true,data:{id:'new'}})
  mocks.expenses.mockReset().mockResolvedValue({ok:true,data:expenses})
})
afterEach(() => {cleanup();localStorage.clear();vi.useRealTimers()})

it('kullanıcı inceleyip aylık tekrarı onaylamadan kayıt yazmaz; çift tıklama tek kayıt üretir', async () => {
  show()
  fireEvent.click(screen.getByRole('button',{name:'İncele ve planla'}))
  expect(screen.getByRole('button',{name:'Aylık planı kaydet'}).hasAttribute('disabled')).toBe(true)
  expect(mocks.save).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('checkbox'))
  const button=screen.getByRole('button',{name:'Aylık planı kaydet'})
  fireEvent.click(button);fireEvent.click(button)
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1))
  expect(mocks.save).toHaveBeenCalledWith('payments',expect.objectContaining({user_id:'u',recurrence:'monthly',payment_method:'bank_auto',auto_source_card_id:'black',amount:69.9}),null)
  await screen.findByRole('status')
})
it('başka yüzeyden eklenmiş planı son okumada bulursa kopya yazmaz',async () => {
  mocks.fetch.mockResolvedValue({ok:true,data:[payment]})
  show();fireEvent.click(screen.getByRole('button',{name:'İncele ve planla'}));fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Aylık planı kaydet'}))
  await screen.findByRole('status');expect(mocks.save).not.toHaveBeenCalled()
})
it('sunucuya ulaşmış kaydın yanıtı kaybolduysa yeniden deneme kopya oluşturmaz',async () => {
  mocks.save.mockResolvedValueOnce({ok:false,error:{message:'Yanıt alınamadı.'}})
  mocks.fetch.mockResolvedValueOnce({ok:true,data:[]}).mockResolvedValue({ok:true,data:[payment]})
  show();fireEvent.click(screen.getByRole('button',{name:'İncele ve planla'}));fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Aylık planı kaydet'}))
  await screen.findByRole('alert')
  fireEvent.click(screen.getByRole('button',{name:'Aylık planı kaydet'}));await screen.findByRole('status')
  expect(mocks.save).toHaveBeenCalledTimes(1)
})
it('tek seferlik kaydın yalnız tekrar metadata alanlarını günceller', async () => {
  const single={...payment,recurrence:'none' as const}
  mocks.fetch.mockResolvedValue({ok:true,data:[single]})
  show(<SubscriptionDiscoveryPanel expenses={expenses} payments={[single]} cards={cards} />)
  fireEvent.click(screen.getByRole('button',{name:'Aylık tekrarı düzenle'}));fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Aylık planı kaydet'}))
  await waitFor(() => expect(mocks.save).toHaveBeenCalled())
  const payload=mocks.save.mock.calls[0]![1]
  expect(payload).toEqual({recurrence:'monthly',recurrence_day:15,due_date:'2026-11-15',recurrence_end_date:null})
  expect(mocks.save.mock.calls[0]![2]).toBe('p')
})
it('kayıt hatası görünür ve taslak korunarak yeniden denenebilir',async () => {
  mocks.save.mockResolvedValueOnce({ok:false,error:{message:'Bağlantı kurulamadı.'}})
  show();fireEvent.click(screen.getByRole('button',{name:'İncele ve planla'}));fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Aylık planı kaydet'}))
  await screen.findByRole('alert');expect(screen.queryByRole('status')).toBeNull()
  fireEvent.click(screen.getByRole('button',{name:'Aylık planı kaydet'}));await screen.findByRole('status')
  expect(mocks.save).toHaveBeenCalledTimes(2)
})
it('sekizden fazla aday gösterilir; gizlilik maskesi tutarı saklar',() => {
  localStorage.setItem('financeproject.balancePrivacy','hidden')
  const many=Array.from({length:10},(_,i) => expenses.map((e) => ({...e,id:`${i}:${e.id}`,description:`Hizmet ${i}`}))).flat()
  show(<SubscriptionDiscoveryPanel expenses={many} payments={[]} cards={cards} />)
  expect(screen.getAllByRole('article')).toHaveLength(10)
  expect(within(screen.getAllByRole('article')[9]!).getByText('Hizmet 9')).toBeTruthy()
  expect(screen.queryByText(/69,90/)).toBeNull()
})
it('ekstre kaydı başarılı olsa da tarama hatası boş liste gibi gösterilmez; tekrar denenir',async () => {
  mocks.expenses.mockResolvedValueOnce({ok:false,error:{message:'Hata'}})
  show(<StatementSubscriptionDiscovery card={cards[0] as Card} />)
  await screen.findByRole('alert');expect(screen.queryByText(/tekrar bulunamadı/)).toBeNull()
  fireEvent.click(screen.getByRole('button',{name:'Tekrar dene'}))
  await screen.findByText('AMAZON PRIME')
})
