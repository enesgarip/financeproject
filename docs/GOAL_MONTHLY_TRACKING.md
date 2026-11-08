# Aylık hedef takibi

8 Kasım: hedefte aylık plan/gerçekleşen/kalan özeti varsayılan görünür; para
ayırma aynı bölümdedir. Geçmiş Aylık takip'te açılır. Aynı `buildGoalMonthlyRows`
ve kullanıcı sorgusu kullanılır; kayıtsız miktar sıfır değildir. Tarihe göre
ayırma önerisi ayrı adlandırılır; aylık bilgi kaydı toplam birikim/rezervle
toplanmaz. Sözleşme: `docs/SIMPLIFICATION_FLOWS_2026-11-08.md`.

7 Kasım 2026. Birikim hedefinin toplam ilerlemesinden ayrı, bilgi amaçlı aylık
alışkanlık takibidir. Bakiye, varlık, kasa rezervi, harcanabilir tutar, ledger
ve hedefin `current_amount` alanını değiştirmez.

- Basit TL/gram/çeyrek ve karma hedef kartında **Aylık takip** açılır. Karma
  hedefte her bileşen ayrı açılır ve kendi biriminde planlanır: örneğin aynı
  hedef altında ayda **5 gram**, **1 çeyrek** ve **10.000 TL**. Bir bileşenin
  planı, sürümü veya elle girişi diğer bileşenin tamamlanmasını değiştirmez.
- Yeni planın birimi hedef/bileşenin birimidir; TL karşılığına çevrilmez.
  Mevcut aylık planın birimi korunur: hedef/bileşen sonradan düzenlense de
  önceki gram miktarı TL veya çeyrek miktarı olarak yeniden yorumlanmaz.
- Aylık miktar ve başlangıç ayı seçilir. TL elle izlenir; gram/çeyrek için
  altın defterindeki **o türün tüm alımları** veya elle takip seçilir.
  Bir hedefe özel altın tahsisi varsayılmaz; aynı türü izleyen iki hedef aynı
  alımları görebilir. Kaynak kapsamı formda ve listede açıkça yazılır.
- Otomatik gerçekleşme: `gold_lots.direction='buy'`, gerçek `purchase_date`
  ayı, ilgili `gold_type`. Tarihsiz/gelecek tarihli kayıt sayılmaz. Satışlar
  alım alışkanlığını geri almaz. Fazla alım sonraki aya devretmez. Gram
  miktarı altı ondalıkla gösterilip değerlendirilir; TL kuruşla değerlendirilir.
- `savings_goal_monthly_plans`: hedef + geçerlilik ayı benzersiz, birim/miktar/
  kaynak sürümleri. İlk plan geçmişten başlayabilir; sonraki UI değişiklikleri
  cari aydan geçerlidir, önceki ayların planını yeniden yazmaz. Otomatik
  kapsam `automatic_from` ile planın oluşturulduğu ayda başlar.
- `savings_goal_monthly_entries`: hedef + ay benzersiz. Elle girilen değer
  o ayın **toplamıdır**, otomatik alıma eklenmez. 0 geçerli bir gerçekleşmeme
  kaydıdır. Girişi kaldırmak tekrar otomatik hesaba/kayıtsız duruma döndürür.
- Karma hedefte `savings_goal_component_monthly_plans` bileşen + geçerlilik
  ayı, `savings_goal_component_monthly_entries` bileşen + ay ile benzersizdir.
  Basit hedefin mevcut tabloları/API değişmez. Bileşen planları aynı sürüm,
  kaynak ve gerçekleşme kurallarını kullanır. Aynı türü izleyen iki bileşen
  otomatik takipte aynı tüm-alım kayıtlarını görebilir; tahsis yapılmaz.
- Tamamlanan ay ✓, kapandığında kanıtlı eksik ay ✕, cari eksik ay Bekliyor.
  Takip öncesinde yeterli alım kaydı varsa ✓ gösterilir; yetersiz/kayıtsız
  geçmiş ✕ sayılmaz, **Kayıt yok** görünür. Elle takipte de kayıtsız eski ay
  başarısızlık sayılmaz. Eksik geçmiş için kullanıcı toplam miktarı girer.
- Yıl seçimi geçmişe erişir; henüz gelmeyen aylar gösterilmez. Gizlilik
  miktarları maskeler. Sorgu hatası eski/sıfır veriyi doğrulanmış gibi sunmaz.

Veri erişimi `data/repositories/savingsGoalsRepo.ts`, saf hesap
`utils/goalMonthly.ts`, UI `components/finance/GoalMonthlyChecklist.tsx`.
Sorgu kullanıcı bazlı `['goal-monthly', userId]` anahtarıyla paylaşılır;
geçmişin beş tablosu PK imleciyle 500'lük sayfalarda tamamlanır. Altın CRUD
yenilemesi ve finansal invalidation bu anahtarı da geçersiz kılar.

Migration `20261107120000_goal_monthly_checklist.sql`: own-row RLS,
authenticated CRUD grant'leri, hedef+sahip FK, ay/miktar/kaynak kısıtları.
JSON export/restore iki tabloyu içerir; eski yedekte yoksa boş kalır. Restore
tek transaction içinde eski zinciri sürdürür; yanlış sahiplik/bozuk çocuk
satırı reset dahil tüm işlemi geri alır. Reset/hedef silme FK cascade ile
aylık geçmişi de kaldırır. İç restore fonksiyonunun execute yetkisi kapalıdır.

`20261107160000_component_monthly_goals.sql` iki bileşen tablosunu ekler;
own-row RLS/CRUD grant, hedef+sahip ve bileşen+hedef+sahip FK'leri çapraz
bağlantıyı reddeder. Bileşen silme yalnız kendi aylık geçmişini cascade
ile temizler. JSON yedek/transactional restore iki tabloyu da içerir;
bileşenler önce yüklenir. Eski yedek ve basit hedef kayıtları uyumludur.

Kanıt: `utils/goalMonthly.test.ts`, `savingsGoalsRepo.monthly.test.ts`,
`supabase/tests/goal_monthly_checklist.sql`,
`supabase/tests/component_monthly_goals.sql`,
`tests/e2e/simplification.spec.ts` (320px plan oluşturma, otomatik alımlar,
elle 0, kaydetme hatası/retry, plan sürümü, elle toplamı kaldırma ve yenileme;
karma hedefte üç birimde plan, bağımsız giriş/silme, kalıcılık ve gizlilik).
