# Denge

React, TypeScript, Vite, Tailwind CSS ve Supabase ile hazırlanmış kişisel finans denge uygulaması.

## Özellikler

- Supabase Auth ile e-posta / şifre kayıt ve giriş
- Korunan uygulama rotaları
- Varlıklar, kartlar, krediler, borç / alacak ve ödemeler için CRUD
- Mobil öncelikli Türkçe arayüz ve alt sekme navigasyonu
- TRY formatlı tutarlar
- PWA kurulumu için manifest ve service worker
- Tüm tablolarda `user_id`, RLS ve kullanıcıya özel CRUD politikaları

## Kurulum

1. Supabase projesi oluştur.
2. `supabase/migrations/20260503121500_initial_finance_schema.sql` dosyasını Supabase SQL Editor üzerinden çalıştır veya Supabase CLI ile migration olarak uygula.
3. `.env.example` dosyasını `.env.local` olarak kopyala ve değerleri doldur.
4. Uygulamayı çalıştır:

```bash
npm install
npm run dev
```

## Vercel

Vercel ortam değişkenleri:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Build command: `npm run build`

Output directory: `dist`

## Güvenlik

Frontend filtrelemesine güvenilmez. Her tablo için RLS aktiftir ve `SELECT`, `INSERT`, `UPDATE`, `DELETE` politikaları `user_id = auth.uid()` koşuluyla sınırlandırılmıştır.
