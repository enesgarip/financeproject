# Yedekten Dönüş Tatbikatı (Restore Drill)

Last reviewed: 2026-07-27

Yedeğin **var olması** ile **çalıştığını bilmek** farklı şeylerdir. Bu runbook,
şifreli yedeği yerel docker'a geri yükleyip uygulamanın onunla ayağa kalktığını
doğrular. Üretime dokunmaz.

**Kadans:** yılda 1–2 kez, ayrıca yedek/şema akışına dokunan bir değişiklikten
sonra. ~15 dakika sürer.

## Neyi kanıtlar

1. Şifreli artifact gerçekten çözülüyor (parola doğru, dosya bozulmamış).
2. Dump temiz bir veritabanına yükleniyor (şema + veri tutarlı).
3. Uygulama o veriyle çalışıyor: giriş açılıyor, kartlar/bakiye görünüyor.
4. Veri sağlığı kontrolleri kritik bulgu üretmiyor.

## Ön koşullar

- Docker çalışıyor, repo kökündesin.
- `BACKUP_PASSPHRASE` elinde (GitHub secret olarak da duruyor; **kaybolursa
  hiçbir yedek açılamaz** — güvenli yerde bir kopyası olsun).
- `gh` CLI giriş yapılı.

## Adımlar

### 1. En son yedeği indir

```bash
gh run download --name "$(gh api repos/:owner/:repo/actions/artifacts --jq '[.artifacts[] | select(.name | startswith("db-backup-"))] | sort_by(.created_at) | reverse | .[0].name')" --dir ./restore-drill
```

Listeden seçmek istersen:

```bash
gh api repos/:owner/:repo/actions/artifacts --jq '[.artifacts[] | select(.name | startswith("db-backup-"))] | sort_by(.created_at) | reverse | .[] | "\(.name)\t\(.created_at)\t\(.size_in_bytes)"'
```

### 2. Çöz

```bash
gpg --batch --yes --decrypt --passphrase "$BACKUP_PASSPHRASE" -o ./restore-drill/backup.sql ./restore-drill/*.sql.gpg
```

Dosya boyutu makul mü (birkaç yüz KB+) ve başı SQL mi diye bak:

```bash
head -5 ./restore-drill/backup.sql
```

### 3. Temiz yerel veritabanı hazırla

```bash
npm run db:reset:local
```

> `--no-seed` ile sıfırlar; yedeğin kendi verisiyle çakışacak tohum kalmaz.

### 4. Yedeği yükle

```bash
docker exec -i supabase_db_financeproject psql -U postgres -d postgres -v ON_ERROR_STOP=0 -f - < ./restore-drill/backup.sql
```

`ON_ERROR_STOP=0` bilinçli: dump `auth`/`storage` şemalarındaki bazı Supabase
nesnelerini yeniden oluşturmaya çalışırken "already exists" uyarıları verir,
bunlar beklenen gürültüdür. **Beklenmeyen** hata sınıfı: `relation ... does not
exist` veya `permission denied` — bunlar gerçek sorundur.

### 5. Yetki ve politika denetimlerini koştur

```bash
npm run db:audit:rls:local
```

```bash
npm run db:audit:grants:local
```

İkisi de temiz olmalı. (Grant denetimi 2026-07-27'de eklendi: migration'lardan
kurulan ortamın üretimden sapmaması için — bkz. `docs/BACKLOG.md`.)

### 6. Uygulamayı yedek verisiyle aç

```bash
npm run dev:local
```

Kontrol listesi:

- [ ] Yedekteki kullanıcıyla giriş yapılıyor (üretim parolası geçerlidir; dump
      `auth.users` içerir).
- [ ] `/kartlar` kart ve bakiyeleri gösteriyor.
- [ ] `/` özet net değeri makul (yedek anındaki değere yakın).
- [ ] `/analiz` grafikleri render oluyor.

### 7. Veri sağlığını doğrula

`/veri-sagligi` sayfasını aç: **kritik bulgu 0** olmalı. Ledger projeksiyonu ile
saklanan borç arasında sapma çıkarsa yedek/geri-yükleme sırasında bir şey
kaybolmuş demektir — not al ve araştır.

### 8. Temizlik

```bash
rm -rf ./restore-drill
```

```bash
npm run db:seed:local
```

> Yerel ortamı normal test tohumuna geri döndürür.

## Bilinen sınırlar

- Ledger tabloları (`card_ledger`, `account_ledger`) yedekte **veri olarak**
  vardır; ancak uygulama içi JSON yedeğinden (DataHealth) geri yükleme yapılırsa
  ledger'lar opening olayıyla yeniden başlar. Bu runbook SQL dump yolunu test
  eder, JSON yolunu değil.
- Edge fonksiyonları, secret'lar ve Vercel ortam değişkenleri dump'ta yoktur;
  gerçek felaket kurtarmada bunlar ayrıca kurulur.
- Bu tatbikat **yerel** ortamda çalışır. Yeni bir Supabase projesine dönüş
  gerekirse ek olarak: proje oluştur → `supabase db push` (migration'lar) →
  dump'tan yalnız veri yükle → secret'ları ve deploy hook'unu ayarla.

## Sonuç kaydı

Her tatbikattan sonra bir satır ekle:

| Tarih | Yedek tarihi | Sonuç | Not |
| --- | --- | --- | --- |
| — | — | henüz koşulmadı | Runbook 2026-07-27'de yazıldı |
| 2026-08-25 | 2026-08-25 | ön-kontrol geçti | Ajan ön-kontrolü: aynı günün 2 şifreli artifact'ı mevcut (~285 KB, boyut makul). Tam koşu passphrase + üretim girişi istediğinden kullanıcıda; `savings_goal_snapshots` + `budgets` çıpa kolonları eklendiğinden tetikleyici sağlandı, ilk fırsatta koşulmalı. |
