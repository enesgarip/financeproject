import assert from 'node:assert/strict'
import { it } from 'node:test'
import { configurePushScheduler } from '../../scripts/configure-push-scheduler.mjs'

const env={SUPABASE_PROJECT_REF:'testproject',SUPABASE_ACCESS_TOKEN:'test-token',SUPABASE_ANON_KEY:'test-public-key-long',PUSH_CRON_SECRET:"test-cron's-long-secret"}
it('scheduler kurulumu env sırrını shell argümanı yerine doğrulanmış API gövdesine taşır',async()=>{
  let calls=0
  await configurePushScheduler(env,async(url,init)=>{
    calls++
    assert.equal(url,'https://api.supabase.com/v1/projects/testproject/database/query')
    assert.equal(init.headers.Authorization,'Bearer test-token')
    const {query}=JSON.parse(init.body)
    assert.ok(query.includes("test-cron''s-long-secret"))
    assert.ok(!query.includes('dispatch_push_notifications()'))
    return Response.json([{configured:true}])
  })
  assert.equal(calls,1)
})
it('scheduler hata yanıtındaki sır SQL/log hata metnine sızmaz',async()=>{
  for(const response of [Response.json({message:env.PUSH_CRON_SECRET},{status:400}),new Response(env.PUSH_CRON_SECRET),Response.json([{configured:false}])]) {
    await assert.rejects(configurePushScheduler(env,async()=>response),error=>!error.message.includes(env.PUSH_CRON_SECRET))
  }
})
it('geçersiz proje veya eksik sır ağ çağrısından önce reddedilir',async()=>{
  const request=()=>{throw new Error('Ağ çağrısı yapılmamalıydı.')}
  await assert.rejects(configurePushScheduler({...env,SUPABASE_PROJECT_REF:"x';delete"},request),/ortam ayarları eksik/)
  await assert.rejects(configurePushScheduler({...env,PUSH_CRON_SECRET:''},request),/ortam ayarları eksik/)
})
