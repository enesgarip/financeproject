# Yedekten Dönüş Tatbikatı (Restore Drill)

Last reviewed: 2026-08-25 (ilk gerçek koşu — üç runbook kusuru bulundu ve düzeltildi)

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
(echo "set session_replication_role = replica;"; cat ./restore-drill/backup.sql) | docker exec -i -e PGPASSWORD=postgres supabase_db_financeproject psql -U supabase_admin -d postgres -v ON_ERROR_STOP=0
```

Bu komutun üç parçası da 2026-08-25'teki ilk gerçek koşunun dersleridir —
hiçbirini "sadeleştirme":

- **`-U supabase_admin` + `-e PGPASSWORD=postgres`:** yerel stack'te `postgres`
  rolü superuser DEĞİL ve `auth` şemasının sahibi değil — `-U postgres` ile
  yükleme `permission denied for schema auth` yağdırır. `supabase_admin`
  parola ister; `PGPASSWORD` verilmezse psql parolayı **stdin'den okur ve
  dump'ın ilk satırını parola sanıp sessizce çöker** (aşağıdaki üçüncü derse
  bak).
- **`set session_replication_role = replica;` öneki:** adım 3'ün migration'lı
  şemasında FK'lar baştan aktiftir; pg_dump ise FK'ları kendi akışında
  post-data'da kurar ve COPY bloklarını buna güvenerek sıralar (`card_expenses`
  dosyada `cards`'tan ÖNCE gelir). Önek olmadan çocuk tabloların COPY'leri FK
  ihlaliyle reddedilir ve **kartlar dolu ama harcamalar boş** yarım-restore
  oluşur. Replica modu FK + trigger'ları oturum boyunca kapatır — trigger'ların
  kapalı olması da doğrudur: ledger olayları dump'ta VERİ olarak zaten var,
  trigger'lar yeniden üretirse çift sayılırdı.
- **Hata okuma tuzağı:** psql'in bağlantı hataları `psql: error:` (küçük harf)
  basar; çıktıyı yalnız `ERROR` ile grep'lemek bağlantı çökmesini görmez.
  Başarıyı hatasızlıktan değil, akan `COPY <n>` satırlarından ve adım 5-7'nin
  sayımlarından doğrula.

Beklenen gürültü: `already exists` (şema nesneleri migration'dan zaten var).
**Beklenmeyen** sınıf: `relation ... does not exist`, `invalid input`, ya da
hiç `COPY <n>` satırı akmaması.

### 5. Yetki ve politika denetimlerini koştur

```bash
npm run db:audit:rls:local
```

```bash
npm run db:audit:grants:local
```

İkisi de temiz olmalı. (Grant denetimi 2026-07-27'de eklendi: migration'lardan
kurulan ortamın üretimden sapmaması için — bkz. `docs/BACKLOG.md`.)

### 5b. UI'siz sağlık kanıtı (ajan koşusu / hızlı yol)

Adım 6'daki UI girişi üretim parolası ister; parolasız da çekirdek kanıt
SQL'le alınır — kart borcu ↔ ledger projeksiyonu ve hesap bakiyesi ↔
account_ledger birebir olmalı (DataHealth'in ana invariant'ı):

```bash
docker exec -i supabase_db_financeproject psql -U postgres -d postgres -c "select c.card_name, c.debt_amount, round(coalesce(sum(l.amount_kurus),0)/100.0,2) proj, c.debt_amount - round(coalesce(sum(l.amount_kurus),0)/100.0,2) drift from public.cards c left join public.card_ledger l on l.card_id=c.id where c.card_type='kredi_karti' group by c.id order by 1;"
```

Tüm satırlarda `drift = 0.00` → yedek bütünlüğü kanıtlı.

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

## Uygulama içi JSON yolu (transactional RPC)

SQL dump yolundan bağımsız ikinci kurtarma yolu: DataHealth'teki JSON yedeği,
2026-08-26'dan beri **tek sunucu işleminde** geri yüklenir
(`restore_user_finance_data_tx`, migration `20260826090000`). Sözleşme:

- Reset + parent-first replay + doğrulama TEK transaction — herhangi bir adım
  patlarsa hiçbir satır değişmez ("hiçbir veri değişmedi" mesajı buna güvenir).
- Bilinmeyen tablo/kolon baştan reddedilir; payload 32 MB üstünde reddedilir.
- Satırlar yalnız payload'da MEVCUT kolonlarla insert edilir → şema
  değişikliğinden önce alınmış eski yedeklerde yeni kolonlar DEFAULT alır
  (`jsonb_populate_recordset`'in NULL ezmesi bilinçli devre dışı).
- `current_settlement_id` işaretleri sıyrılır (immutable parent export-only).
- Kapanışta çapraz-parent sahiplik doğrulaması: başka kullanıcının satırına
  işaret eden herhangi bir çocuk tüm restore'u geri aldırır.
- İstemci (`restoreBackup`) önce RPC'yi dener; RPC henüz deploy edilmemişse
  (migration drift) eski REST replay'ine düşer — güvenlik yedeği o yol için
  duruyor.
- Docker kanıtı: `supabase/tests/transactional_restore.sql` (round-trip sayım
  eşitliği, rollback, sıyırma, eski-yedek DEFAULT'u, çapraz-parent reddi).

## Bilinen sınırlar

- Ledger tabloları (`card_ledger`, `account_ledger`) yedekte **veri olarak**
  vardır; ancak uygulama içi JSON yedeğinden (DataHealth) geri yükleme yapılırsa
  ledger'lar opening olayıyla yeniden başlar (borç/bakiye = projeksiyon değişmez).
  Bu runbook'un adımları SQL dump yolunu test eder; JSON yolunun kanıtı yukarıdaki
  docker testidir.
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
| 2026-08-25 | 2026-08-25 09:38 | **BAŞARILI** (ilk gerçek koşu) | Kullanıcı passphrase'i buldu, ajan koştu. Çözme ✓ (291 KB→1,5 MB), yükleme ✓ (66 COPY bloğu; 12 kart, 335 harcama, 1.492 card_ledger, 2 auth kullanıcısı), RLS+grant denetimleri ✓, bütünlük ✓ (4 kredi kartında borç↔ledger drift 0,00; 8 hesapta bakiye↔account_ledger birebir). UI girişi yerine 5b SQL kanıtı kullanıldı. ÜÇ runbook kusuru bulunup düzeltildi: postgres rolü auth'a yetmiyor (supabase_admin+PGPASSWORD), FK-aktif şemada replica-mode şart, psql küçük-harf "error:" sessiz çökme tuzağı. |
