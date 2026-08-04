# Denge

**Aylık finansal yükünü, vade kaçmadan görünür kılan kişisel finans uygulaması.**

Denge; nakit, kart, kredi, borç ve planlı ödemeleri tek yerde toplayan Türkçe bir
kişisel finans PWA'sıdır. Amaç basit bir "gelir–gider listesi" tutmak değil,
**bu ay ve önümüzdeki aylarda cebinden ne çıkacağını önceden göstermek** —
ekstre kesilmeden, taksit sırası gelmeden, ödeme günü geçmeden.

`React · TypeScript · Supabase · PWA` — tek kullanıcılık, TL, Türkçe.

![Denge — Finans Özeti](docs/screenshots/dashboard.png)

## Ne işe yarar?

Kişisel finansta asıl zorluk tek tek harcamalar değil, **birbirine binen
yükümlülükleri zamanında görebilmektir**: kredi kartı ekstresi, kart taksitleri,
kredi taksitleri, kişilere olan borçlar ve tekrar eden ödemeler aynı ayda üst
üste gelir. Denge bunların hepsini tek modelde toplar ve şu soruya cevap verir:

> _"Bu ay ve sonraki aylarda dengede miyim; nereye, ne zaman, ne kadar ödemem gerekiyor?"_

## Kim için?

Denge; **birden fazla banka hesabı, kredi kartı ve taksit** yürüten, ay içinde
ekstre kesimi, taksit sırası ve tekrar eden ödemeler üst üste bindiğinde nakit
dengesini önceden görmek isteyen kişiler içindir. Kısacası _"bu ay ve sonraki
aylarda cebimden ne çıkacak?"_ sorusuna net cevap arayan tek kişilik bir
kullanımı hedefler (TL, Türkçe arayüz).

**Kim için değil:** çok kullanıcılı şirket muhasebesi, ekip/rol yönetimi ya da
çok para birimli yatırım-portföy takibi için tasarlanmadı.

## Özellikler

- **Hesaplar & varlıklar** — Banka kartları, nakit ve yatırım varlıkları, maaş
  geçmişi ve altın takibi. Bakiyeler olay tabanlı (event-sourced) tutulur.
- **Kredi kartı yönetimi** — Harcama, provizyon, ekstre kesimi, taksitli alışveriş
  ve dönem içi ödemeler. Borç; güncel dönem / ekstre / provizyon kovalarına ayrılır.
- **Krediler & kişisel borçlar** — Kredi taksit planları ve kişilere olan
  borç/alacak takibi; taksit takvimiyle birlikte.
- **Planlama & ödeme takvimi** — Yaklaşan ödemeler, aylık nakit akışı projeksiyonu,
  bütçe uyarıları, birikim hedefleri ve taksit takvimi özetleri.
- **Analiz & net değer** — Net değer, servet ve nakit akışı trendleri; işlem geçmişi.
- **Veri sağlığı** — Tutarsızlıkları tespit eden ve güvenli düzeltme akışları sunan
  denetim yüzeyi (deterministik, sahiplik ve tür kontrollü onarımlar).
- **PWA** — Ana ekrana eklenebilir, çevrimdışı kabuk, ekle-git kısayolları
  (harcama ekle, planlı ödemeler, analiz), açık/koyu tema.

## Durum

- **Stabil (çekirdek):** hesaplar & varlıklar, kredi kartı borcu / ekstre / taksit,
  krediler, kişisel borç-alacak, ödeme takvimi, analiz & net değer, veri sağlığı.
- **Gelişmekte (cihaz-içi otomasyon):** SMS'ten provizyon/hareket okuma ve banka
  ekstresi import'u (DenizBank, YapıKredi) tarayıcıda çalışır; tüm-ekstre
  satır-toplamı doğrulaması henüz kalibre edilmemiştir (bkz. `docs/BACKLOG.md`).
  Web Push bildirim tercihleri.

## Ekran görüntüleri

> Aşağıdaki görseller yerel geliştirme ortamında **temsili demo veriyle** alınmıştır.

| Hesaplar & kartlar | Krediler & taksitler |
| --- | --- |
| ![Hesaplar](docs/screenshots/accounts.png) | ![Krediler](docs/screenshots/loans.png) |
| **Ödeme takvimi** | **Analiz & ay kapanışı** |
| ![Ödeme takvimi](docs/screenshots/payments.png) | ![Analiz](docs/screenshots/analysis.png) |

## Gizlilik & güvenlik

> - Veri **senin kendi Supabase projende** durur; üçüncü bir sunucuya gitmez.
> - Her tabloda satır seviyesi güvenlik (RLS): her satır `user_id = auth.uid()`
>   koşuluyla sınırlıdır.
> - İstemciye yalnızca **anon key** gider; **service role** anahtarı client'a
>   hiçbir zaman konmaz.
> - Frontend filtrelemesine güvenilmez — yetki veritabanında zorlanır.

## Para modeli (güven temeli)

Finans uygulamasında en kritik nokta paranın kesinliğidir. Denge parayı
veritabanında `numeric`, ledger tablolarında ise **işaretli integer kuruş** olarak
tutar; JS tarafındaki tüm yuvarlama/karşılaştırma tek bir çekirdekten
(`src/utils/money.ts`) geçer. Kart borcu, banka bakiyesi, kredi özeti ve kart borç
kırılımı gibi büyük para rakamları ya olaylardan türetilir ya da yazma anında
veritabanı trigger'ıyla korunur — böylece tutarsızlık matematiksel olarak
imkânsız hale gelir. Düzeltmeler geçmişi değiştirmez, **ters kayıt** olarak
eklenir (append-only).

## Mimari

Katmanlar arası sınırlar ESLint ile zorlanır; UI doğrudan Supabase'i göremez:

```
domain   → src/utils/*              Saf hesap/iş kuralı. Yoğun test edilir.
data     → src/data/repositories/*  Tek Supabase teması. Result<T> döndürür.
app      → src/app/*                TanStack Query use-case hook'ları.
ui       → src/pages, components    "Aptal" sunum katmanı.
services → src/services/*           RPC sarmalayıcıları.
lib      → src/lib/*                supabase client, sentry, harici istemciler.
```

**Teknoloji:** React 19 · TypeScript · Vite 7 · Tailwind CSS v4 · TanStack Query ·
Supabase (Postgres + Auth + Edge Functions) · Sentry (yalnız frontend) · Vercel · PWA.

## Kurulum

```bash
npm install

npm run dev          # Üretim Supabase'ine bağlanır (.env.local gerekir)
npm run dev:local    # Yerel Supabase (docker) + Vite — üretime dokunmaz
```

1. Bir Supabase projesi oluştur (ya da yerel geliştirme için `npm run dev:local`).
2. `supabase/migrations/*` migration'larını CLI ile uygula.
3. `.env.example` dosyasını `.env.local` olarak kopyalayıp değerleri doldur:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

Bir değişikliği "bitti" saymadan önce:

```bash
npm run lint && npm run test:unit && npm run build
```

## Deploy

`main` dalına push = üretim deploy (GitHub Actions → Vercel). Frontend tek artifact
olarak build edilip staged yüklenir, DB değiştiyse şifreli yedek alınıp migration
uygulanır, canlıya alım sonrası `/login` smoke testi başarısız olursa otomatik
rollback yapılır. Ayrıntı: [`docs/PIPELINE.md`](docs/PIPELINE.md).

## Katkı & AI ajanları

Bu depo AI ajanlarıyla (Claude Code, Codex) çalışacak şekilde belgelenmiştir. Bir
oturuma başlarken önce [`docs/AI_CONTEXT_INDEX.md`](docs/AI_CONTEXT_INDEX.md) —
görev bazlı en kısa okuma rotasını ve konu→dosya tablosunu verir. Kanonik kurallar
[`CLAUDE.md`](CLAUDE.md)'de, domain + tablo + route haritası
[`docs/PROJECT_CONTEXT.md`](docs/PROJECT_CONTEXT.md)'de tutulur.

## Lisans

[MIT](LICENSE) © Enes Garip
