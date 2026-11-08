# Bağlı iş akışları — 8 Kasım 2026

Kullanıcı 1, 2, 3 ve 5'i onayladı. Altın alımı/hesap/hedef birleştirmesi (4)
kapsam dışıdır. Önceki sunum paketi: `docs/SIMPLIFICATION_FLOWS_2026-11-08.md`.
Bu paket iki RPC/tablo ekler: `20261108140000_linked_finance_workflows.sql`.

## Harcama ve raporlama

Araç ve aktif gider grubu kartları ortak Harcama kaydet'i `car`/`context` hazır
seçimiyle açar. URL değerleri mevcut kullanıcı listesinde doğrulanır; silinmiş
veya tamamlanmış seçimle kayıt gönderilmez. Etiketler aynı harcamadadır; ikinci
`car_expenses`/`context_expenses` gideri yazılmaz. İlgili cache'ler yenilenir.
Etiket hatası yazılmış harcamayı başarısız göstermez; uyarı ve mevcut hareketi
ilişkilendirme yolu vardır. Bu hash bağlantısı kesinleşmiş ve provizyon
hareketlerini ikinci borç yazmadan etiketler. Eski kart-dışı rapor formları korunur.

Form düğmesine odak geçince mobil alt bar gizli kalır; Kaydet dokunuşunun
üstüne geri açılıp gönderimi yutmaz.

## Bakım tamamlama

Tamamlandı tarih/km, gider ve sonraki plan formunu açar. Masrafsız, mevcut
hesap/kart harcaması, mevcut araç gideri veya yeni hesapları etkilemeyen rapor
gideri seçilir. Tekrar gerçekleşen tarih/km'den önerilir ve düzenlenebilir.
Sonraki iki alan boşsa hatırlatıcı kapanır; tamamlanma geçmişi ayrıca korunur.

`complete_car_service` sahiplik ve hatırlatıcı sürümünü kilitleyerek gider,
etiket, km, sonraki plan ve makbuzu atomik yazar. Aynı UUID/gövde yalnız makbuz
okur; farklı gövde/eski sürüm reddedilir. İstek önce kullanıcı/hatırlatıcı bazlı
localStorage'a yazılır. Belirsiz yanıtta alanlar kilitli kalır; yeniden
açma/yenileme aynı isteği doğrular. Reset/restore yalnız o kullanıcının bekleyen
niyetini temizler. Rapor gideri bakiye/ledger yazmaz. Son 50 tamamlanan iş açılır.

## Gelen para

Hesap hareketlerinde Gelen para neydi? son 30 gerçek manuel/SMS girişini açar.
Maaş/Diğer/Kendi hesaplarımdan transfer etiketleri bilgi amaçlıdır; bakiye,
maaş geçmişi ve karşı hesabı değiştirmez. Alacak tahsilatı yalnız açık **TL**
alacağına, girişin ve kalan alacağın tutarını aşmayan açık miktarla bağlanır.
Bakiye tekrar artmaz. Girişin kalanını başka alacaklara dağıtma bu pakette yoktur.

`classify_account_income` kaynak hareketi kilitler; hareket başına tek kalıcı
sınıf ve aynı isteğe güvenli tekrar sağlar. Çıkış/açılış/düzeltme uygun kaynak
değildir. SMS'in otomatik kapattığı alacak tekrar eşlenmez. Tahsilat mevcut
`private.settle_personal_debt_internal` skip-account yoludur; tek `debt` geçmiş
olayı kaynak hareket tarihinde `income-match:<movement_id>` ile yazılır.
Eski history ve ledger güncellenmez. Alacak dışı etiket history üretmez.

## Saklama ve sahiplik

`account_income_labels`/`car_service_completions` yalnız sahibi tarafından
okunur; istemci doğrudan yazamaz. JSON yedek/atomik restore parent-first'tür;
composite sahiplik FK'leri çapraz kullanıcı bağını reddeder. Reset parent
cascade ile temizler. Atomik RPC yoksa bu kayıtları içeren yedek REST replay
veya reset başlatmaz. Eski yedekler uyumludur; iç restore helper'ı dışarıya kapalıdır.

## Ay kapanışı

Altı kontrolden ilgili işe geçiş, hedefte Ay kapanışına dön ve rapora geçiş
vardır. Kabuk yalnız `/analiz#ay-kapanisi` dönüş hedefini kabul eder.
Yazmalar ortak snapshot'ı yeniler; dönüşte ay kapanışı o veriyi yeniden türetir.

## Kanıt ve boyut

`supabase/tests/linked_finance_workflows.sql` gerçek Postgres'te tekillik,
bakiye/ledger değişmezliği, rollback, sahiplik, restore/reset'i kapsar.
`tests/e2e/simplification.spec.ts` dört akışın kayıp yanıt/yenileme, etiket,
ilk Kaydet dokunuşu ve dönüşünü sınar. `carServicePlan.test.ts` ay sonu/km;
`carServiceAttempt.test.ts` niyet izolasyonu; kart repo/backup testleri kısmi
başarı ve atomik restore sınırlarını kapsar. Son kapı sonucu BACKLOG kaydındadır.

Yeni lazy gelir/bakım formlarıyla yerel JS gzip 1038,7 kB ölçüldü; toplam tavan
1060 kB oldu. Entry/vendor tavanları değişmedi; ortam farkı için pay korunur.
