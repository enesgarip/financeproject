# Aylık hedef takibi

7 Kasım 2026. Birikim hedefinin toplam ilerlemesinden ayrı, bilgi amaçlı aylık
alışkanlık takibidir. Bakiye, varlık, kasa rezervi, harcanabilir tutar, ledger
ve hedefin `current_amount` alanını değiştirmez.

- Basit TL/gram/çeyrek hedef kartında **Aylık takip** açılır. Karma hedefte
  tek bir ortak birim olmadığı için bu alan sunulmaz.
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
- Tamamlanan ay ✓, kapandığında kanıtlı eksik ay ✕, cari eksik ay Bekliyor.
  Takip öncesinde yeterli alım kaydı varsa ✓ gösterilir; yetersiz/kayıtsız
  geçmiş ✕ sayılmaz, **Kayıt yok** görünür. Elle takipte de kayıtsız eski ay
  başarısızlık sayılmaz. Eksik geçmiş için kullanıcı toplam miktarı girer.
- Yıl seçimi geçmişe erişir; henüz gelmeyen aylar gösterilmez. Gizlilik
  miktarları maskeler. Sorgu hatası eski/sıfır veriyi doğrulanmış gibi sunmaz.

Veri erişimi `data/repositories/savingsGoalsRepo.ts`, saf hesap
`utils/goalMonthly.ts`, UI `components/finance/GoalMonthlyChecklist.tsx`.
Sorgu kullanıcı bazlı `['goal-monthly', userId]` anahtarıyla paylaşılır;
geçmişin üç tablosu PK imleciyle 500'lük sayfalarda tamamlanır. Altın CRUD
yenilemesi ve finansal invalidation bu anahtarı da geçersiz kılar.

Migration `20261107120000_goal_monthly_checklist.sql`: own-row RLS,
authenticated CRUD grant'leri, hedef+sahip FK, ay/miktar/kaynak kısıtları.
JSON export/restore iki tabloyu içerir; eski yedekte yoksa boş kalır. Restore
tek transaction içinde eski zinciri sürdürür; yanlış sahiplik/bozuk çocuk
satırı reset dahil tüm işlemi geri alır. Reset/hedef silme FK cascade ile
aylık geçmişi de kaldırır. İç restore fonksiyonunun execute yetkisi kapalıdır.

Kanıt: `utils/goalMonthly.test.ts`, `savingsGoalsRepo.monthly.test.ts`,
`supabase/tests/goal_monthly_checklist.sql`,
`tests/e2e/simplification.spec.ts` (320px plan oluşturma, otomatik alımlar,
elle 0, kaydetme hatası/retry, plan sürümü, elle toplamı kaldırma ve yenileme).
