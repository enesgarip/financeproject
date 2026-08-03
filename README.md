# Denge

**Aylık finansal yükünü, vade kaçmadan görünür kılan kişisel finans uygulaması.**

Denge; nakit, kart, kredi, borç ve planlı ödemeleri tek yerde toplayan Türkçe bir
kişisel finans PWA'sıdır. Amaç basit bir "gelir–gider listesi" tutmak değil,
**bu ay ve önümüzdeki aylarda cebinden ne çıkacağını önceden göstermek** —
ekstre kesilmeden, taksit sırası gelmeden, ödeme günü geçmeden.

> Tek kullanıcılık, kişisel kullanım için geliştirilen bir üründür. Para birimi TL,
> arayüz ve tüm etkileşim Türkçedir.

**Stack:** React 19 · TypeScript · Vite 7 · Tailwind CSS v4 · Supabase (Postgres + Auth + Edge Functions) · TanStack Query · Vercel · PWA

![Denge — Finans Özeti](docs/screenshots/dashboard.png)

## Ne işe yarar?

Kişisel finansta asıl zorluk tek tek harcamalar değil, **birbirine binen
yükümlülükleri zamanında görebilmektir**: kredi kartı ekstresi, kart taksitleri,
kredi taksitleri, kişilere olan borçlar ve tekrar eden ödemeler aynı ayda üst
üste gelir. Denge bunların hepsini tek modelde toplar ve şu soruya cevap verir:

> _"Bu ay ve sonraki aylarda dengede miyim; nereye, ne zaman, ne kadar ödemem gerekiyor?"_

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
- **Güvenlik** — Her tabloda satır seviyesi güvenlik (RLS) ve `user_id = auth.uid()`
  ile sınırlandırılmış CRUD politikaları. Frontend filtrelemesine güvenilmez.

## Ekran görüntüleri

> Aşağıdaki görseller yerel geliştirme ortamında **temsili demo veriyle** alınmıştır.

| Hesaplar & kartlar | Krediler & taksitler |
| --- | --- |
| ![Hesaplar](docs/screenshots/accounts.png) | ![Krediler](docs/screenshots/loans.png) |
| **Ödeme takvimi** | **Analiz & ay kapanışı** |
| ![Ödeme takvimi](docs/screenshots/payments.png) | ![Analiz](docs/screenshots/analysis.png) |

## Para modeli (güven temeli)

Finans uygulamasında en kritik nokta paranın kesinliğidir. Denge parayı veritabanında
`numeric` ve ledger tablolarında **işaretli integer kuruş** olarak tutar; JS
tarafındaki tüm yuvarlama/karşılaştırma tek bir çekirdekten (`src/utils/money.ts`)
geçer. Kart borcu, banka bakiyesi, kredi özeti ve kart borç kırılımı gibi büyük
para rakamları ya olaylardan türetilir ya da yazma anında veritabanı trigger'ıyla
korunur — böylece tutarsızlık matematiksel olarak imkânsız hale gelir. Düzeltmeler
geçmişi değiştirmez, **ters kayıt** olarak eklenir (append-only).

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

## Kurulum

```bash
npm install
npm run dev          # Üretim Supabase'ine bağlanır (.env.local gerekir)
# veya tamamen yerel:
npm run dev:local    # Yerel Supabase (docker) + Vite — üretime dokunmaz
```

1. Bir Supabase projesi oluştur (veya yerel geliştirme için `npm run dev:local`).
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
rollback yapılır. Ayrıntı: `docs/PIPELINE.md`.

## Katkı & AI ajanları

Bu depo AI ajanlarıyla (Claude Code, Codex) çalışacak şekilde belgelenmiştir.
Bir oturuma başlarken önce **`docs/AI_CONTEXT_INDEX.md`** — görev bazlı en kısa
okuma rotasını ve konu→dosya tablosunu verir. Kanonik kurallar `CLAUDE.md`'de,
domain + tablo + route haritası `docs/PROJECT_CONTEXT.md`'de tutulur.

## Lisans

[MIT](LICENSE) © Enes Garip
