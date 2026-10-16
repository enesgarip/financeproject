# README ekran görüntüleri

Son çekim: **16 Ekim 2026**, Mürekkep ve Safir teması ve ortak Türkçe dil
sözlüğü. Kaynak: `scripts/capture-screenshots.mjs`; görsel sözleşme:
[`../UI_ARCHITECTURE.md`](../UI_ARCHITECTURE.md).

Görseller yerel Supabase demo hesabından (`t@t.com`) alınır. Üretim verisi,
gerçek banka ekstresi veya canlı AI yanıtı kullanılmaz. Çekim aracı loopback dışı
sunucu adresini reddeder ve dış ağ isteklerini engeller. Yerel demo ortamında
normal kur/net değer/ekstre otomasyonları çalışabilir; yeni ödeme/harcama veya
AI isteği bilerek gönderilmez. Rakamlar temsili, tarihler görecelidir.

| Dosya | Rota / görünüm |
| --- | --- |
| `login.png` | `/login`, safir giriş/marka |
| `dashboard.png` | `/`, masaüstü açık tema |
| `dashboard-mobile.png` | `/`, 390 × 844 telefon görünümü |
| `dashboard-dark.png` | `/`, masaüstü koyu tema |
| `accounts.png` | `/kartlar`, hesaplar bölümü |
| `loans.png` | `/borclar/krediler` |
| `payments.png` | `/odemeler`, varsayılan Yaklaşanlar |
| `analysis.png` | `/analiz` |
| `assistant.png` | `/analiz/asistan`, seed'deki temsili sohbet; Gemini çağrısı yok |
| `decision.png` | `/odemeler/alsam-mi` |

Masaüstü 1320 × 900 CSS px; DPR 2, `tr-TR`, `Europe/Istanbul`, azaltılmış
hareket. PNG'ler masaüstünde 2640 × 1800, telefonda 780 × 1688 pikseldir.

## Yeniden çekim

Docker, Node ve paket kilidindeki Playwright Chromium gerekir. Önce yerel
verinin yalnız demo fixture'ları olduğundan emin ol. Seed reset'i yerel
finans verisini siler; kişisel yerel verinin üstüne çalıştırma.

```bash
npm ci
npx playwright install chromium
npm run db:seed:local
npm run dev:local
# Başka terminalde, aynı checkout içinde:
node scripts/capture-screenshots.mjs
```

`BASE_URL` isteğe bağlıdır; yalnız `http://localhost`, `http://127.0.0.1` veya
IPv6 loopback kabul edilir. Auth token/secret veya browser storage state repo'ya
kaydedilmez. Çekim sonrasında tüm PNG'leri açıp tema, rota, font ve demo
içeriğini kontrol et; iki ana README'deki görsel açıklamalarını aynı değişiklikte
güncelle. Bu araç işlevsel test veya tam erişilebilirlik denetimi değildir.
