# Expense Contexts and Cars

Bu doküman `/odemeler/baglamlar` ve `/varliklar/araclar` için davranış kaynağıdır.

## Değişmezler

- Özellikler finans çekirdeğine yazmaz. Ledger, kart borcu, ekstre, net değer, bütçe uyarısı ve nakit akışı mevcut kaynaklarından türemeye devam eder.
- Kart gideri `card_expenses` içinde tek kez bulunur; `car_id` / `context_id` yalnız raporlama etiketidir.
- Kart-dışı gider `car_expenses` veya `context_expenses` içinde bulunur. UI aynı gerçek giderin kart ve manuel kaynakta iki kez girilmemesi gerektiğini açıklar.
- RLS own-row politikalarına ek olarak kart annotation trigger'ı hedef araç/bağlamın aynı kullanıcıya ait olduğunu doğrular.

## Genel gider bağlamları

`expense_contexts.kind` yalnız `pet` veya `project` olabilir. Evcil hayvan bağlamı kategori bazlı gider görünümü sunar. Proje bağlamı opsiyonel bütçe ve tarih aralığı taşır; burn-down tüm zamanlar birleşik giderinden hesaplanır.

**Süre / süresizlik.** `starts_on` ve `ends_on` nullable; DB ve form tarihi zorunlu tutmaz. Evcil hayvan doğası gereği süresizdir — formu tarih alanı göstermez (`kind==='pet'`). Proje türünde tarihler opsiyoneldir; **bitiş boş bırakılırsa bağlam süresiz** sürer. `ends_on` null olan her bağlam özet kartında "Süresiz" rozetiyle işaretlenir.

## Yakıt ölçümü

Litre ve odometre, hem manuel araç giderinde hem etiketli kart giderinde nullable annotation'dır. Tüketim ardışık ve artan odometreli dolumlar arasında hesaplanır:

- `L/100 km = sonraki dolum litresi × 100 / kilometre farkı`
- `TL/km = ölçümlü dolum maliyeti / kilometre farkı`

İlk dolum baz noktasıdır. Eksik veya geriye giden kilometre tüketim mesafesi üretmez.

## Hatırlatıcı ve push

`car_reminders` tarih, kilometre veya ikisini taşır. Sayfada 30 gün / 1.000 km kala “Yaklaşıyor”, hedef geçince “Gecikti” görünür. Tarihli reminder için `push-notify` 7 gün kala `car_reminder_due_7d` üretir ve `notification_preferences.cars_enabled` kapısına uyar.

Tekrarlı iş tamamlanınca tarih `repeat_months`, kilometre `repeat_km` kadar ileri taşınır. Tekrarsız iş aktif listeden silinir.

## TCO

Araç maliyet karnesi birleşik giderlerden yıl toplamı, yıl içinde geçen gün başına maliyet, önceki yıl toplamı ve yakıt metriklerini üretir. İndirilen PNG araç/plaka, banka veya hesap adı içermez.
