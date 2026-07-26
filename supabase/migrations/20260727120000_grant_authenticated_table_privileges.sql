-- authenticated rolü için eksik tablo yetkileri (migration ile üretim eşitliği).
--
-- SORUN: Erken dönem tabloları (cards, assets, payments, card_expenses ...)
-- üretimde Supabase arayüzünden oluşturulmuş; arayüz DML yetkilerini kendisi
-- veriyor. Sonradan yazılan migration dosyalarında ise `grant` satırı yok.
-- Sonuç: migration'lardan sıfırdan kurulan HER ortam (yerel docker, felaket
-- kurtarma sonrası yeni proje) bu tablolarda "permission denied" veriyor —
-- üretim çalışırken yerelde çalışmıyor, yani yerel doğrulama yanıltıcı.
-- 2026-07-27'de yerel docker'da `select ... from public.cards` yetki hatası
-- verdiği için yakalandı.
--
-- ÇÖZÜM: uygulamanın fiilen kullandığı yetkileri açıkça migration'a almak.
-- Grant idempotenttir: üretimde zaten varsa no-op'tur.
--
-- GÜVENLİK: yetki genişletmesi değil, mevcut üretim durumunun kayda geçmesi.
-- Satır bazlı erişim yine RLS own-row policy'leriyle sınırlıdır (her public
-- tablo için CI'da `supabase/tests/rls_audit.sql` zorlar). Grant olmadan RLS
-- zaten devreye giremez.

-- Kullanıcının kendi kayıtlarını yönettiği tam CRUD tabloları.
grant select, insert, update, delete on table public.assets to authenticated;
grant select, insert, update, delete on table public.cards to authenticated;
grant select, insert, update, delete on table public.card_aliases to authenticated;
grant select, insert, update, delete on table public.card_expenses to authenticated;
grant select, insert, update, delete on table public.debts to authenticated;
grant select, insert, update, delete on table public.dismissed_upcoming_items to authenticated;
grant select, insert, update, delete on table public.loans to authenticated;
grant select, insert, update, delete on table public.loan_installments to authenticated;
grant select, insert, update, delete on table public.payments to authenticated;
grant select, insert, update, delete on table public.salary_history to authenticated;

-- Net değer fotoğrafı: günlük upsert (insert + update) ve trend okuması.
grant select, insert, update, delete on table public.net_worth_snapshots to authenticated;

-- Aktivite akışı: RPC'ler yazar, yedek geri yükleme istemciden insert eder,
-- kart sıfırlama akışları siler.
grant select, insert, update, delete on table public.transaction_history to authenticated;

-- Alışveriş listesi (2026-07-24'te eklendi, grant satırı unutulmuştu).
grant select, insert, update, delete on table public.wishlist_items to authenticated;
