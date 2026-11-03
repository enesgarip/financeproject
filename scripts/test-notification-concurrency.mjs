import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
const container='supabase_db_financeproject', subscription=randomUUID(), reference=`audit-${randomUUID()}`
const args=['exec','-i',container,'psql','-U','postgres','-d','postgres','-qAt','-v','ON_ERROR_STOP=1','-f','-']
function sql(text) {
  const r=spawnSync('docker',args,{input:text,encoding:'utf8'})
  if(r.status!==0) throw new Error(r.stderr||'Yerel SQL başarısız.')
  return r.stdout
}
function claim() {
  return new Promise((resolve,reject)=>{
    const child=spawn('docker',args),out=[],err=[]
    child.stdout.on('data',b=>out.push(b));child.stderr.on('data',b=>err.push(b));child.on('error',reject)
    child.on('close',code=>code===0?resolve(Buffer.concat(out).toString().trim()):reject(new Error(Buffer.concat(err).toString())))
    child.stdin.end(`begin; select public.claim_notification_delivery('11111111-1111-1111-1111-111111111111','audit','${reference}','${subscription}'); select pg_sleep(0.05); commit;`)
  })
}
try {
  sql(`insert into public.push_subscriptions(id,user_id,endpoint,p256dh,auth) values('${subscription}','11111111-1111-1111-1111-111111111111','https://audit.example.test/${subscription}','fake','fake');`)
  const results=await Promise.allSettled([claim(),claim(),claim()])
  if(results.some(r=>r.status==='rejected')) throw new Error('Paralel yerel SQL hatası.')
  if(results.filter(r=>r.status==='fulfilled' && r.value.includes('token')).length!==1) throw new Error('Aynı cihaz/olay birden çok worker tarafından sahiplenildi.')
  console.log('Üç eşzamanlı worker: aynı cihaz/olay için yalnız bir teslim claim edildi.')
} finally { sql(`delete from public.push_subscriptions where id='${subscription}';`) }
