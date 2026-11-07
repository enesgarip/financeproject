// Aynı şema manifestiyle gerçek yerel dump→boş DB restore→ödeme + tekrar kanıtı.
// Üretim URL'si/anahtarı kabul etmez; yalnız yerel Supabase docker container'ı.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const container = 'supabase_db_financeproject'
const db = `finance_restore_${process.pid}_${Date.now()}`
if (!/^finance_restore_\d+_\d+$/.test(db)) throw new Error('Geçersiz test DB adı.')
const schemas = readFileSync(new URL('./backup-schemas.txt', import.meta.url), 'utf8').trim().split(/\r?\n/)
if (schemas.some(s => !/^[a-z_]+$/.test(s)) || !schemas.includes('private')) throw new Error('Eksik/geçersiz yedek kapsamı.')
function docker(args, input) {
  const result = spawnSync('docker', ['exec', '-i', container, ...args], { input, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || 'Yerel DB komutu başarısız.')
  return result.stdout
}
const sql = (database, text) => docker(['psql','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-At','-f','-'], text)
const user = randomUUID(), bank = randomUUID(), debt = randomUUID(), request = randomUUID()
const credit = randomUUID(), foreignEvent = randomUUID()
const claims = `set local request.jwt.claim.sub='${user}'; set local request.jwt.claims='{"sub":"${user}","role":"authenticated"}';`
const args = JSON.stringify({ p_debt_id: debt, p_account_card_id: bank, p_amount: 100, p_skip_account_move: false })
const payment = `select public.submit_finance_payment('${request}','settle_personal_debt','${args}'::jsonb);`
let created = false, seeded = false
try {
  sql('postgres', `begin;
    insert into auth.users(id,email) values('${user}','backup-${user}@example.test');
    insert into public.cards(id,user_id,bank_name,card_name,card_type,current_balance) values('${bank}','${user}','Test','Restore','banka_karti',1000);
    insert into public.cards(id,user_id,bank_name,card_name,card_type,credit_limit,statement_day,due_day) values('${credit}','${user}','Test','Restore USD','kredi_karti',10000,25,10);
    insert into public.debts(id,user_id,person_name,direction,value_type,amount,estimated_value_try,status) values('${debt}','${user}','Restore Kişisi','borç_aldım','TRY',500,500,'açık');
    ${claims} set local role authenticated; ${payment}
    select public.queue_foreign_card_sms('${user}','${credit}',59.99,'USD','Restore USD',now(),'Diğer','${foreignEvent}','LOCAL-RESTORE-FOREIGN'); commit;`)
  seeded = true
  const dump = docker(['pg_dump','-U','postgres','-d','postgres',...schemas.map(s => `--schema=${s}`)])
  if (!dump.includes('finance_payment_requests') || !dump.includes('CREATE SCHEMA private')) throw new Error('Private makbuz dump içinde değil.')
  sql('postgres', `create database "${db}" template template0;`)
  created = true
  sql(db, 'drop schema public;')
  // Managed auth/storage default ACL'lerini yalnız provider admin geri kurabilir.
  // Dump ACL'leri sıyırmak private SECURITY DEFINER fonksiyonlarını public'e açardı.
  // CI socket'i admin için parola ister. Değer host'a/log'a taşınmaz;
  // yalnız sabit yerel container'ın kendi env'i psql'a aktarılır.
  docker(['sh','-c','export PGPASSWORD="$POSTGRES_PASSWORD"; exec psql -w -h 127.0.0.1 -U supabase_admin -d "$1" -v ON_ERROR_STOP=1 -At -f -','restore',db], dump)
  sql(db, `begin; ${claims} set local role authenticated; ${payment} reset role;
    do $$ begin
      if has_function_privilege('anon','public.submit_finance_payment(uuid,text,jsonb)','EXECUTE') or
        has_function_privilege('authenticated','public.claim_notification_delivery(uuid,text,text,uuid)','EXECUTE') then
        raise exception 'Restore yetki sınırını bozdu.';
      end if;
      if (select current_balance from public.cards where id='${bank}') <> 900 or (select estimated_value_try from public.debts where id='${debt}') <> 400 then
        raise exception 'Restore aynı ödeme niyetini yeniden uyguladı.';
      end if;
      if not exists(select 1 from private.finance_payment_requests where user_id='${user}' and request_id='${request}') then raise exception 'Makbuz kayboldu.'; end if;
    end $$;
    set local role authenticated;
    select public.submit_finance_payment('${randomUUID()}','settle_personal_debt','${args}'::jsonb);
    do $$ begin
      if not exists(select 1 from public.foreign_card_sms where user_id='${user}' and source_event_id='${foreignEvent}' and native_amount=59.99 and completed_at is null) then
        raise exception 'Restore bekleyen dövizli SMS kaydını korumadı.';
      end if;
    end $$;
    select public.complete_foreign_card_sms((select id from public.foreign_card_sms where user_id='${user}' and source_event_id='${foreignEvent}'),100.25);
    select public.complete_foreign_card_sms((select id from public.foreign_card_sms where user_id='${user}' and source_event_id='${foreignEvent}'),100.25);
    reset role;
    do $$ begin
      if (select current_balance from public.cards where id='${bank}') <> 800 or (select estimated_value_try from public.debts where id='${debt}') <> 300 then raise exception 'Restore sonrası yeni ödeme çalışmadı.'; end if;
      if (select debt_amount from public.cards where id='${credit}')<>100.25 or (select count(*) from public.card_expenses where card_id='${credit}')<>1 then raise exception 'Restore sonrası dövizli SMS tamamlama/retry hatalı.'; end if;
    end $$; rollback;`)
  console.log('Gerçek yerel dump/restore: private kod + ödeme makbuzu/retry + yeni ödeme + dövizli SMS/kesin TL/retry başarılı.')
} finally {
  if (created) sql('postgres', `drop database "${db}" with (force);`)
  if (seeded) sql('postgres', `begin; ${claims} select public.reset_user_finance_data(); delete from auth.users where id='${user}'; commit;`)
}
