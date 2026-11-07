# Dövizli kart SMS'leri

7 Kasım 2026. Kabul: döviz tutarıyla bekleyen kayıt göster, bankanın kesin TL
tutarını kullanıcı tamamlasın. Kurdan tahmini borç üretilmez.

- `utils/smsParser.ts` ve parse-sms edge aynası DenizBank'ın “tarihinde …
  kartinizla … firmasindan … USD islem” biçiminde USD/EUR/GBP birimini korur.
  TL/TRY eski sözleşmeyi sürdürür. `ParsedCardSms.currency` doluysa amount dövizdir.
- Webhook alias/sahiplik kontrolünden sonra `queue_foreign_card_sms` çağırır;
  TL yazıcısına döviz tutarı vermez. Kuyruk hatasında HTTP 502 döner. Başarı
  günlüğünün TL amount alanı boştur. Döviz tutarı privacy uyumlu panelde görünür.
- `foreign_card_sms` kullanıcı+kart, döviz tutarı/birimi, satıcı, saniyeli banka
  zamanı, ham SMS, kaynak kimliği ve tamamlama makbuzunu saklar. Beklerken
  kart/hesap/ledger, bütçe, rapor ve harcanabilir tutarı değiştirmez.
- `app/useForeignCardSms.ts` Özet/Hesaplar için kullanıcıya özel 60 saniyelik
  `['foreign-card-sms', userId]` cache'idir. `foreignCardSmsRepo.ts` eski sahipli
  hata günlüklerini PK imleciyle 500'lük sayfalarda tarar; normalize mesajları
  tekilleştirir, yalnız tekil kart alias'ı bulunan döviz SMS'lerini kurtarır.
  Eski hata günlüğü değişmez. Eksik tarama/eşleşme uyarılır, mevcut liste görünür kalır.
- Özet'te adet ve toplamların bu işlemleri içermediği açıklanır. Hesaplar'da
  satıcı, banka zamanı ve maskelenebilir döviz tutarı vardır; `#doviz-sms` ve
  özellik rehberi bölümü açar. Panodan doldur döviz tutarını TL alanına taşımaz.

`complete_foreign_card_sms` sahibinin satırını FOR UPDATE ile kilitler.
Sıfır/negatif/sonlu olmayan/iki ondalıktan uzun TL reddedilir. Kanonik
`add_card_expense`, aynı SMS olay kimliğiyle **provizyon** yazar; otomatik ödeme
eşleme ve taksit niyeti kuralları mevcut SMS sırasındadır. Dönem/kesim validasyonu
aşılmaz. Tamamlanan TL ve zaman aynı transaction'da saklanır: aynı TL ile retry
no-op, farklı TL ile tekrar hatadır. Kayıp yanıtta form tutarı korunur; başarılı
yazım sonrası yenileme hatası yazım başarısızlığı gibi sunulmaz.

Kuyrukta kullanıcı+olay ve kullanıcı+normalize ham mesaj hash'i benzersizdir;
farklı çağırıcı kimliğiyle aynı SMS'te ilk kimlik korunur. Aynı olay kimliğinde
farklı payload reddedilir. Banka metni saniyeli olduğundan eski normalize-hash
fallback sözleşmesi sürer; saniyesiz hesap hareketi bu akışa girmez.
Hash kuyruk/JSON restore yazımında PostgreSQL'in yerleşik SHA-256 işlevi ve
açık UTF-8 dönüşümüyle hesaplanır. Tablo tanımı pgcrypto işlevine bağımlı değildir;
aynı şema manifestiyle boş veritabanına gerçek dump/restore bu sırayı doğrular.

Migration `20261107210000_foreign_card_sms_pending.sql`: own-row SELECT RLS,
yazma yalnız sahiplik doğrulayan RPC'lerdedir. Kuyruğa servis veya kayıt sahibi,
tamamlamaya authenticated sahip erişir. Kart+sahip FK çapraz bağlantıyı reddeder;
kart/full reset cascade ile kuyruğu temizler. JSON yedek/atomik restore bekleyen
ve tamamlanan makbuzları kart/harcamadan sonra taşır; hash yeniden hesaplanır,
user_id oturuma yazılır. Bozuk çocuk reset dahil restore'u geri alır. Bu tabloyu
içeren yedekte atomik RPC yoksa REST fallback **reset öncesinde durur**.

Kanıt: `smsParser.test.ts`, `clipboardExpense.test.ts`, gerçek edge harness'i
`tests/edge/parseSms.test.ts`, `foreignCardSmsRepo.test.ts`,
`supabase/tests/foreign_card_sms.sql`, `backup.restore.test.ts` ve 320px
Playwright (eski kayıt kurtarma, Özet uyarısı, gizlilik, kesin TL, kayıp yanıt).
