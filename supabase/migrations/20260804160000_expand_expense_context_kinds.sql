-- Bağlam türlerini genişlet: pet/project'e ek olarak seyahat, sağlık, hobi, yan iş.
-- Tür yalnız kategori seti + süreli/süresiz (tarih) davranışını belirler; para
-- modeline dokunmaz — bağlam saf raporlama merceğidir. Mevcut pet/project
-- satırları geçerli kalır (widening CHECK). Yeni tablo yok → grant/RLS değişmez.
alter table public.expense_contexts
  drop constraint if exists expense_contexts_kind_check;

alter table public.expense_contexts
  add constraint expense_contexts_kind_check
  check (kind in ('pet', 'project', 'travel', 'health', 'hobby', 'business'));
