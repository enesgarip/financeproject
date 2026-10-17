import { describe, expect, it } from 'vitest'
import { candidatePlanDraft, discoverSubscriptions, type DiscoveryExpense, type DiscoveryPayment } from './subscriptionDiscovery'
import { paymentMatchesExpense } from './paymentMatching'

const now = new Date(2026, 9, 18)
function expense(date: string, amount = 269, description = 'FS *SUPERCELLSTORE fsprg.nl NLD', extra: Partial<DiscoveryExpense> = {}): DiscoveryExpense {
  return { id: `${date}:${amount}`, card_id: 'black', spent_at: date, amount, description, category: 'Abonelik', status: 'posted', installment_count: 1, note: null, ...extra }
}
function plan(extra: Partial<DiscoveryPayment> = {}): DiscoveryPayment {
  return { id: 'p', title: 'Youtube Premium', amount: 239.99, amount_status: 'exact', due_date: '2026-11-16', status: 'bekliyor', payment_method: 'bank_auto', auto_source_card_id: 'black', recurrence: 'none', recurrence_day: null, recurrence_end_date: null, ...extra }
}
const youtube = ['2026-05-17', '2026-06-17', '2026-07-17', '2026-08-17', '2026-09-17'].map((d, i) => expense(d, i < 2 ? 159.99 : 239.99, 'GOOGLE *YouTube LONDON GBR'))

describe('ekstre abonelik keşfi', () => {
  it('iki ay olası, üç ay güçlü adaydır; girdi ve finans planı değişmez', () => {
    const rows = [expense('2026-08-15'), expense('2026-09-15')]
    expect(discoverSubscriptions(rows, [], now)[0]?.confidence).toBe('possible')
    expect(discoverSubscriptions([...rows, expense('2026-10-15')], [], now)[0]?.confidence).toBe('strong')
    expect(rows).toHaveLength(2)
  })
  it('yazım farkı ve ek alışveriş Supercell tekrarını gizlemez; aylık olduğu varsayılmaz', () => {
    const rows = ['2026-05-07','2026-06-04','2026-07-03','2026-08-06','2026-09-03','2026-10-01'].map((d, i) => expense(d, 269, i < 3 ? 'FS *SUPERCELLSTORE fsprg.nl NLD' : 'FS *SUPERCELLSTORE fsprg nl NLD'))
    const result = discoverSubscriptions([...rows, expense('2026-07-16', 549)], [], now)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ amount: 269, confidence: 'strong', calendarMonthly: false, status: 'new' })
    expect(result[0]!.dates).toHaveLength(6)
  })
  it('YouTube zammı eski fiyatla ortalanmaz; mevcut tek seferlik kaydı bulur', () => {
    const result = discoverSubscriptions(youtube, [plan()], now)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ amount: 239.99, priceChanged: true, status: 'missing_recurrence', paymentId: 'p' })
    expect(discoverSubscriptions(youtube, [plan({ recurrence: 'monthly' })], now)[0]?.status).toBe('planned')
  })
  it('Apple tutar ve günü ayrı izler; hizmet adı uydurmaz ve tek işlemi önermez', () => {
    const rows = ['2026-07','2026-08','2026-09'].flatMap((m) => [expense(`${m}-08`,499.99,'APPLE.COM/BILL CORK IRL'),expense(`${m}-11`,129.99,'APPLE.COM/BILL CORK IRL')])
    const result = discoverSubscriptions([...rows, expense('2026-08-10',6999.99,'APPLE.COM/BILL CORK IRL')], [], now)
    expect(result).toHaveLength(2)
    expect(result.every((r) => r.needsServiceName)).toBe(true)
    expect(result.map((r) => r.amount)).toEqual([499.99,129.99])
    expect(candidatePlanDraft(result[0]!, 'APPLE.COM/BILL CORK IRL', 8, now)).toBeNull()
    expect(candidatePlanDraft(result[0]!, 'Benim hizmetim', 8, now)).toMatchObject({ match_amount:499.99, match_merchant:'apple com bill', due_date:'2026-11-08' })
  })
  it('Apple yalnız açık tutar eşleşmesiyle planlanmış sayılır; birden çok eşleşme yazılamaz', () => {
    const rows = ['2026-07-08','2026-08-08','2026-09-08'].map((d) => expense(d,499.99,'APPLE.COM/BILL CORK IRL'))
    const applePlan = plan({ title:'ChatGPT', amount:499.99, match_amount:499.99, recurrence:'monthly' })
    expect(discoverSubscriptions(rows,[applePlan],now)[0]).toMatchObject({ status:'planned', needsServiceName:false })
    expect(discoverSubscriptions(rows,[applePlan,{...applePlan,id:'p2'}],now)[0]?.status).toBe('ambiguous')
  })
  it('Apple planı zamlandıysa eski aynı-gün fiyatını eksik hizmet diye planlatmaz', () => {
    const rows=['2026-07-11','2026-08-11','2026-09-11'].map((d) => expense(d,129.99,'APPLE.COM/BILL CORK IRL'))
    const updated=plan({title:'iCloud+',amount:169.99,match_amount:169.99,recurrence:'monthly',recurrence_day:11})
    expect(discoverSubscriptions([...rows,expense('2026-10-11',169.99,'APPLE.COM/BILL CORK IRL')],[updated],now)[0]?.status).toBe('ambiguous')
  })
  it('market/yakıt, taksit, provizyon, iptal/iade, gelecek ve eski kayıtları dışlar', () => {
    for (const extra of [{category:'Market',description:'MARKET'}, {category:'Ulaşım',description:'BUPET OPET'}, {installment_count:3}, {status:'provision' as const}, {status:'cancelled' as const}, {amount:-269}]) {
      expect(discoverSubscriptions(['2026-08-15','2026-09-15','2026-10-15'].map((d) => expense(d,269,undefined,extra)),[],now)).toEqual([])
    }
    expect(discoverSubscriptions([expense('2025-09-15'),expense('2026-10-19')],[],now)).toEqual([])
    expect(discoverSubscriptions([expense('2026-08-01'),expense('2026-09-23')],[],now)).toEqual([])
  })
  it('kartları, mükerrer id ve aynı ay iki fatura sözleşmesini karıştırmaz', () => {
    expect(discoverSubscriptions([expense('2026-08-15'),expense('2026-09-15',269,undefined,{card_id:'gold'})],[],now)).toEqual([])
    const rows = [expense('2026-08-15'),expense('2026-09-15')]
    expect(discoverSubscriptions([...rows,...rows],[],now)[0]?.dates).toHaveLength(2)
    const bills = ['2026-08-08','2026-09-08','2026-10-08'].flatMap((d) => [expense(d,300,'BUSKİ'),expense(d,400,'BUSKİ')])
    expect(discoverSubscriptions(bills,[],now)).toEqual([])
  })
  it('değişken fatura son tutarıyla önerilir; taslak karta bağlıdır, nakit ödeme yazmaz', () => {
    const result = discoverSubscriptions(['2026-07-08','2026-08-08','2026-09-08'].map((d,i) => expense(d,200+i*100,'BUSKİ')),[],now)
    expect(result[0]).toMatchObject({variable:true,amount:400})
    expect(candidatePlanDraft(result[0]!, 'Su', 31, new Date(2027,1,1))).toMatchObject({due_date:'2027-02-28',match_amount:null,payment_method:'bank_auto',auto_source_card_id:'black',recurrence:'monthly'})
    expect(candidatePlanDraft(result[0]!,'Su',0,now)).toBeNull()
    expect(candidatePlanDraft(result[0]!,'',8,now)).toBeNull()
  })
  it('eski düzenli adayın etkinliği ve aynı gün vadesi doğru kalır', () => {
    const result = discoverSubscriptions([expense('2026-05-08'),expense('2026-06-08')],[],now)
    expect(result[0]?.isActive).toBe(false)
    expect(candidatePlanDraft(result[0]!,'Paket',18,now)?.due_date).toBe('2026-10-18')
  })
  it('planın ürettiği hareketleri banka tekrarı sanmaz ve kategori korunur', () => {
    const rows = ['2026-08-08','2026-09-08'].map((d) => expense(d,500,'SİGORTA PAKETİ',{category:'Sigorta'}))
    expect(discoverSubscriptions(rows.map((r) => ({...r,note:'Ödeme kaydından oluşturuldu.'})),[],now)).toEqual([])
    expect(candidatePlanDraft(discoverSubscriptions(rows,[],now)[0]!,'Sigorta',8,now)?.category).toBe('Sigorta')
  })
  it('birleşik Prime işyeri mevcut planla eşleşir; kısaltılmış Supercell tek akıştır', () => {
    const primeRows=['2026-07-15','2026-08-15','2026-09-15'].map((d) => expense(d,69.9,'IYZICO /AMAZONPRIMET'))
    expect(discoverSubscriptions(primeRows,[plan({title:'amazon prime',amount:69.9,recurrence:'monthly'})],now)[0]?.status).toBe('planned')
    const draft=candidatePlanDraft(discoverSubscriptions(primeRows,[],now)[0]!,'Amazon Prime',15,now)!
    expect(draft.match_merchant).toBe('iyzico amazonprimet')
    expect(paymentMatchesExpense(draft,'IYZICO /AMAZONPRIMET',69.9)).toBe(true)
    const gameRows=['2026-06-04','2026-07-03','2026-08-06','2026-09-03','2026-10-01'].map((d,i) => expense(d,269,i<2?'FS *SUPERCELLSTORE fsprg.nl NLD':'FS *SUPERCELLSTORE fsprg'))
    const result=discoverSubscriptions(gameRows,[],now)
    expect(result).toHaveLength(1)
    expect(result[0]!.dates).toHaveLength(5)
  })
  it('kimliği belirsiz fatura tekrarı mevcut kurum planını kopyalatmaz', () => {
    const rows=['2026-08-25','2026-09-25'].map((d) => expense(d,427,'TURK TELEKOM MOBİL 543761'))
    const existing=plan({title:'Telefonum',match_merchant:'TURK TELEKOM MOBİL',match_reference:'5437616572',recurrence:'monthly'})
    expect(discoverSubscriptions(rows,[existing],now)[0]?.status).toBe('ambiguous')
    expect(discoverSubscriptions(rows,[plan({title:'BenimTelefon',recurrence:'monthly'})],now)[0]?.status).toBe('ambiguous')
  })
})
