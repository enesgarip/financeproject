import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createHmac, webcrypto } from 'node:crypto'
import { buildSync } from 'esbuild'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'

// Gerçek edge entry'sini çalıştır; yalnız Deno host, REST ve dış push transport'u sahte.
// SQL sahiplenme/izin/lease sözleşmesi ayrıca gerçek PostgreSQL'de test edilir.
type Row = Record<string, unknown>
type Candidate = { userId:string;notificationType:string;referenceId:string;payload:Row }
type Summary = { deviceDeliveries:number;failed:number;unknown:number }
type Api = {
  loadCandidates(database:ReturnType<typeof db>, subs:Row[], day:string, weekday:string):Promise<Candidate[]>
  applyPreferences(c:Candidate[], p:Map<string,Row>, hour:number):Candidate[]
  deliverCandidates(database:ReturnType<typeof db>,subs:Map<string,Row[]>,c:Candidate[],keys:unknown,subject:string,log:boolean):Promise<Summary>
  getVapidKeys(value:string):Promise<unknown>
  isAuthorized(req:Request,key:string):Promise<boolean>
  createRestClient(url:string,key:string):{select<T>(table:string,params:Record<string,string>):Promise<T[]>}
}
const dir=path.resolve('supabase/functions/push-notify')
const code=buildSync({stdin:{contents:readFileSync(path.join(dir,'index.ts'),'utf8')+'\nexport {loadCandidates,applyPreferences,deliverCandidates,getVapidKeys,isAuthorized,createRestClient};',resolveDir:dir,loader:'ts'},bundle:true,write:false,format:'cjs',platform:'browser'}).outputFiles[0].text
const key=Buffer.from([...Array(31).fill(0),1]).toString('base64url')
const env:Record<string,string>={SUPABASE_URL:'https://db.example.test',SUPABASE_SERVICE_ROLE_KEY:'fake-service',VAPID_PRIVATE_KEY:key,VAPID_SUBJECT:'mailto:test@example.test',PUSH_CRON_SECRET:'fake-local-cron-secret'}
function harness(transport:typeof fetch) {
  let handler=(async()=>new Response()) as (r:Request)=>Promise<Response>
  const module={exports:{}}
  new Function('Deno','fetch','crypto','module','exports',code)({env:{get:(k:string)=>env[k]},serve:(h:typeof handler)=>{handler=h}},transport,webcrypto,module,module.exports)
  return {api:module.exports as Api,handle:(r:Request)=>handler(r)}
}
function db(seed:Record<string,Row[]>={}) {
  const deliveries=new Map<string,{token:string;status:string}>()
  return {deliveries,failFinish:false,
    async select<T>(table:string,params:Record<string,string|string[]>):Promise<T[]> {
      let rows=seed[table]??[]
      for(const [key,filters] of Object.entries(params)) {
        if(['select','order','limit'].includes(key)) continue
        for(const filter of Array.isArray(filters)?filters:[filters]) rows=rows.filter(row=>{
          const value=String(row[key])
          if(filter.startsWith('in.(')) return filter.slice(4,-1).replaceAll('"','').split(',').includes(value)
          if(filter==='not.is.null') return row[key]!=null
          const [op,...right]=filter.split('.'), target=right.join('.')
          return op==='eq'?value===target:op==='gte'?value>=target:op==='lte'?value<=target:op==='gt'?Number(value)>Number(target):false
        })
      }
      return rows as T[]
    },
    async rpc<T>(name:string,args:Row):Promise<T> {
      if(name==='claim_notification_delivery') {
        const id=[args.p_user_id,args.p_type,args.p_reference,args.p_subscription_id].join(':')
        const old=deliveries.get(id)
        if(old && old.status!=='retry') return null as T
        const row={token:`token-${deliveries.size}-${old?.token??''}`,status:'sending'}
        deliveries.set(id,row);return {token:row.token} as T
      }
      if(this.failFinish) throw new Error('Synthetic completion failure')
      for(const row of deliveries.values()) if(row.token===args.p_token) row.status=String(args.p_status)
      return undefined as T
    },
    async deleteById() {},
  }
}
const sub={id:'a',user_id:'u',endpoint:'https://push.example.test/a',auth:'',p256dh:''}
const candidate:Candidate={userId:'u',notificationType:'payment_due_tomorrow',referenceId:'p:2026-11-10',payload:{title:'Test',body:'Sentetik',url:'/odemeler',tag:'test'}}
let cryptoSub:Row
beforeAll(async()=>{
  const pair=await webcrypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits'])
  cryptoSub={...sub,p256dh:Buffer.from(await webcrypto.subtle.exportKey('raw',pair.publicKey)).toString('base64url'),auth:Buffer.alloc(16,7).toString('base64url')}
})
afterEach(()=>vi.useRealTimers())
it('UI aylık vadesi yarın ve haftalık push adayına girer; biten plan girmez',async()=>{
  const {api}=harness(vi.fn())
  const payment={id:'p',user_id:'u',title:'Kira',amount:1000,due_date:'2026-10-10',status:'bekliyor',recurrence:'monthly',recurrence_day:10,recurrence_end_date:null}
  const candidates=await api.loadCandidates(db({payments:[payment]}),[sub],'2026-11-09','Mon')
  expect(candidates.find(c=>c.notificationType==='payment_due_tomorrow')?.referenceId).toBe('p:2026-11-10')
  const ended=await api.loadCandidates(db({payments:[{...payment,recurrence_end_date:'2026-11-01'}]}),[sub],'2026-11-09','Mon')
  expect(ended.some(c=>c.notificationType==='payment_due_tomorrow')).toBe(false)
})
it('sessiz saatteki aday ilk uygun saat tekrarında değerlendirilir; kapalı tür gönderilmez',()=>{
  const {api}=harness(vi.fn()), prefs=new Map([['u',{payments_enabled:true,quiet_hours_start:22,quiet_hours_end:8}]])
  expect(api.applyPreferences([candidate],prefs,7)).toHaveLength(0)
  expect(api.applyPreferences([candidate],prefs,8)).toHaveLength(1)
  expect(api.applyPreferences([candidate],new Map([['u',{payments_enabled:false}]]),8)).toHaveLength(0)
})
it('REST 1000 sınırını aşar; sonraki sayfa hatası kısmi başarı olmaz',async()=>{
  const transport=vi.fn<typeof fetch>().mockImplementation(async input=>{
    const offset=Number(new URL(String(input)).searchParams.get('offset'))
    return Response.json(Array.from({length:offset<1000?500:101},(_,i)=>({id:offset+i})))
  })
  const {api}=harness(transport)
  expect(await api.createRestClient(env.SUPABASE_URL,'key').select('notification_log',{})).toHaveLength(1101)
  expect(transport).toHaveBeenCalledTimes(3)
  transport.mockClear().mockImplementation(async input=>Number(new URL(String(input)).searchParams.get('offset'))>0?new Response('',{status:500}):Response.json(Array.from({length:500},(_,i)=>({id:i}))))
  await expect(api.createRestClient(env.SUPABASE_URL,'key').select('notification_log',{})).rejects.toThrow()
})
it('bir cihaz başarılıysa yalnız başarısız cihaz yeniden denenir',async()=>{
  let secondFails=true
  const transport=vi.fn<typeof fetch>().mockImplementation(async input=>new Response('',{status:String(input).endsWith('/b')&&secondFails?503:201}))
  const {api}=harness(transport), database=db(), keys=await api.getVapidKeys(key)
  const subs=new Map([['u',[cryptoSub,{...cryptoSub,id:'b',endpoint:'https://push.example.test/b'}]]])
  expect(await api.deliverCandidates(database,subs,[candidate],keys,'mailto:test@example.test',true)).toMatchObject({deviceDeliveries:1,failed:1})
  secondFails=false
  expect(await api.deliverCandidates(database,subs,[candidate],keys,'mailto:test@example.test',true)).toMatchObject({deviceDeliveries:1,failed:0})
  expect(transport.mock.calls.filter(([url])=>String(url).endsWith('/a'))).toHaveLength(1)
})
it('push kabulünden sonra DB sonucu kaybolursa kör tekrar göndermez',async()=>{
  const transport=vi.fn<typeof fetch>().mockResolvedValue(new Response('',{status:201}))
  const {api}=harness(transport), database=db(), keys=await api.getVapidKeys(key), subs=new Map([['u',[cryptoSub]]])
  database.failFinish=true
  expect(await api.deliverCandidates(database,subs,[candidate],keys,'mailto:test@example.test',true)).toMatchObject({failed:1,unknown:1})
  database.failFinish=false
  await api.deliverCandidates(database,subs,[candidate],keys,'mailto:test@example.test',true)
  expect(transport).toHaveBeenCalledTimes(1)
})
it('geç günlük bildirim ertesi gün telefon kuyruğundan ulaşmasın diye TTL gece yarısında biter',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-03T23:59:00+03:00'))
  const transport=vi.fn<typeof fetch>().mockResolvedValue(new Response('',{status:201}))
  const {api}=harness(transport), keys=await api.getVapidKeys(key)
  await api.deliverCandidates(db(),new Map([['u',[cryptoSub]]]),[candidate],keys,'mailto:test@example.test',true)
  expect(new Headers(transport.mock.calls[0][1]?.headers).get('TTL')).toBe('60')
})
it('transport timeout belirsiz kaydedilir; 410 aboneliği temizler',async()=>{
  const transport=vi.fn<typeof fetch>().mockRejectedValue(new Error('Timeout'))
  const {api}=harness(transport), database=db(), keys=await api.getVapidKeys(key), subs=new Map([['u',[cryptoSub]]])
  expect(await api.deliverCandidates(database,subs,[candidate],keys,'mailto:test@example.test',true)).toMatchObject({unknown:1})
  await api.deliverCandidates(database,subs,[candidate],keys,'mailto:test@example.test',true)
  expect(transport).toHaveBeenCalledTimes(1)
  transport.mockResolvedValue(new Response('',{status:410}))
  const fresh=db(), deleted=vi.spyOn(fresh,'deleteById')
  await api.deliverCandidates(fresh,subs,[candidate],keys,'mailto:test@example.test',true)
  expect(deleted).toHaveBeenCalledWith('push_subscriptions','a')
})
it.each([500,200])('bakım HTTP/alt işlem hatasını abonelik olmasa da yeşil saymaz (%i)',async status=>{
  const {handle}=harness(vi.fn<typeof fetch>().mockImplementation(async input=>String(input).includes('/rpc/')?Response.json({ok:false,errors:1},{status}):Response.json([])))
  const response=await handle(new Request('https://local.example.test/push-notify',{method:'POST',headers:{'x-cron-secret':env.PUSH_CRON_SECRET},body:'{}'}))
  expect(response.status).toBe(502)
  expect(await response.json()).toMatchObject({ok:false})
})
it('DB imzasını kabul eder; eski/yanlış imza ve public anahtar yetki vermez',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-03T10:00:00Z'))
  const {api}=harness(vi.fn()), timestamp=String(Date.now()/1000), nonce='00000000-0000-4000-8000-000000000001'
  const signature=createHmac('sha256',env.PUSH_CRON_SECRET).update(`${timestamp}:${nonce}`).digest('hex')
  const headers={'x-cron-timestamp':timestamp,'x-cron-nonce':nonce,'x-cron-signature':signature}
  expect(await api.isAuthorized(new Request('https://example.test',{headers}),'key')).toBe(true)
  expect(await api.isAuthorized(new Request('https://example.test',{headers:{...headers,'x-cron-signature':'0'.repeat(64)}}),'key')).toBe(false)
  vi.setSystemTime(new Date('2026-11-03T10:03:00Z'))
  expect(await api.isAuthorized(new Request('https://example.test',{headers}),'key')).toBe(false)
  expect(await api.isAuthorized(new Request('https://example.test',{headers:{apikey:'public'}}),'key')).toBe(false)
})
