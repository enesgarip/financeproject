import { beforeEach, expect, it, vi } from 'vitest'
import type { FinanceSnapshot } from '../data/repositories/financeSnapshotRepo'
import { recordDailyGoalSnapshots } from './dailyGoalSnapshots'

const mocks = vi.hoisted(() => ({ buckets: vi.fn(), write: vi.fn() }))
vi.mock('../data/repositories/kasaBucketsRepo', () => ({ fetchKasaBuckets: mocks.buckets }))
vi.mock('../data/repositories/analysisRepo', () => ({ recordSavingsGoalSnapshots: mocks.write }))
vi.mock('../lib/stockQuotesClient', () => ({ normalizeTicker: () => null, fetchStockPrices: async () => null }))
function snapshot() {
  return {
    assets: [], cards: [], savingsGoalComponents: [],
    savingsGoals: [{ id:'g',status:'active',value_type:'TRY',current_amount:0,target_amount:1000 }],
    savingsGoalSources: [{ id:'s',goal_id:'g',component_id:null,kind:'kasa_bucket',bucket_id:'b',sort_order:0 }],
  } as unknown as FinanceSnapshot
}
beforeEach(() => {
  mocks.buckets.mockReset().mockResolvedValue({ ok:true,data:[{id:'b',reserved_amount:500}] })
  mocks.write.mockReset().mockResolvedValue({ ok:true,data:true })
})
it('başarılı 500 TL kaynağı yazar; okuma hatasını 0 TL olarak yazmaz', async () => {
  expect(await recordDailyGoalSnapshots('u',snapshot(),null,()=>false)).toBe(true)
  expect(mocks.write).toHaveBeenLastCalledWith('u',[{goalId:'g',amount:500}])
  mocks.write.mockClear()
  mocks.buckets.mockResolvedValue({ok:false,error:{message:'Ağ hatası'}})
  expect(await recordDailyGoalSnapshots('u',snapshot(),null,()=>false)).toBe(false)
  expect(mocks.write).not.toHaveBeenCalled()
})
it('doğrulanmış gerçek sıfır kaybolmaz; kısmi kaynak eksikliği yazılmaz', async () => {
  mocks.buckets.mockResolvedValue({ok:true,data:[{id:'b',reserved_amount:0}]})
  expect(await recordDailyGoalSnapshots('u',snapshot(),null,()=>false)).toBe(true)
  expect(mocks.write).toHaveBeenLastCalledWith('u',[{goalId:'g',amount:0}])
  const data = snapshot()
  data.savingsGoalSources.push({...data.savingsGoalSources[0],id:'missing',bucket_id:'gone'})
  mocks.write.mockClear()
  expect(await recordDailyGoalSnapshots('u',data,null,()=>false)).toBe(false)
  expect(mocks.write).not.toHaveBeenCalled()
})
it('eksik bileşenli karma hedefi yazmaz; bağımsız tam hedefi korur', async () => {
  const data = snapshot()
  data.savingsGoals[0].value_type='composite'
  data.savingsGoalComponents=[{id:'c',goal_id:'g',value_type:'TRY',current_amount:0,target_amount:1000}] as FinanceSnapshot['savingsGoalComponents']
  data.savingsGoalSources[0].component_id='c'
  data.savingsGoals.push({...data.savingsGoals[0],id:'manual',value_type:'TRY',current_amount:20})
  mocks.buckets.mockResolvedValue({ok:false})
  expect(await recordDailyGoalSnapshots('u',data,null,()=>false)).toBe(false)
  expect(mocks.write).toHaveBeenCalledWith('u',[{goalId:'manual',amount:20}])
})
it('otomatik varlığın fiyatı yokken saklı değerini canlı hedef noktası saymaz', async () => {
  const data=snapshot()
  data.savingsGoalSources=[{...data.savingsGoalSources[0],kind:'asset',asset_id:'a',bucket_id:null}]
  data.assets=[{id:'a',category:'Nakit',currency:'USD',unit:'adet',amount:10,estimated_value_try:350,auto_valued:true}] as FinanceSnapshot['assets']
  expect(await recordDailyGoalSnapshots('u',data,null,()=>false)).toBe(false)
  expect(mocks.write).not.toHaveBeenCalled()
  data.savingsGoals[0].value_type='gram_altin'
  data.assets[0]={...data.assets[0],category:'Altın',unit:'gram',amount:2}
  expect(await recordDailyGoalSnapshots('u',data,null,()=>false)).toBe(true)
  expect(mocks.write).toHaveBeenCalledWith('u',[{goalId:'g',amount:2}])
})
it('yazma hatası, eksik tablo ve iptal başarı damgası üretmez', async () => {
  mocks.write.mockResolvedValue({ok:false,error:{message:'Yazılamadı'}})
  expect(await recordDailyGoalSnapshots('u',snapshot(),null,()=>false)).toBe(false)
  mocks.write.mockResolvedValue({ok:true,data:false})
  expect(await recordDailyGoalSnapshots('u',snapshot(),null,()=>false)).toBe(false)
  mocks.write.mockClear()
  expect(await recordDailyGoalSnapshots('u',snapshot(),null,()=>true)).toBe(false)
  expect(mocks.write).not.toHaveBeenCalled()
})
