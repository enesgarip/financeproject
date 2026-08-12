# Parser fixture'ları (golden files)

Ekstre/hareket PDF'lerinden çıkarılmış **düz metin** örnekleri. Amaç: banka
formatı değiştiğinde ya da parser'a dokunulduğunda sessiz yanlış okumayı
`parserFixtures.test.ts` üzerinden yakalamak.

## Yeni fixture eklemek

1. PDF'i uygulamadaki import ekranında aç, `extractPdfText` çıktısını kopyala
   (veya konsolda `await extractPdfText(file)`).
2. **Tutarları ve kişisel bilgiyi maskele** — dosyalar repoda public.
   İsim/müşteri no değiştir, tutarları değiştirebilirsin; format bozulmasın.
3. Dosyayı bu dizine adlandırma kuralıyla bırak — **banka adı önekte**, çünkü
   parser seçimi dosya adından yapılır:
   - `statement.denizbank-<dönem>.txt` → `parseDenizBankStatement`
   - `statement.yapikredi-<dönem>.txt` → `parseYapiKrediStatement`
   - `movement.denizbank-<dönem>.txt` → `parseDenizBankMovementPdf`
4. Test kendiliğinden alır; ek kod gerekmez.

Önek/banka tanınmazsa test hata verir (yanlış adlandırma sessizce atlanmasın ya da
metin yanlış bankanın parser'ına düşmesin diye).

## Yeni BANKA eklemek

`parserFixtures.test.ts` içindeki `STATEMENT_BANKS` / `MOVEMENT_BANKS` listesine
bir satır ekle: `{ id: '<önek>', parse: <parserFonksiyonu>, allowZeroTotalDebt }`.
`allowZeroTotalDebt` yalnız bankanın tamamı ödenmiş dönemde "0,00" dönem borcu
basması durumunda `true` olmalı (YapıKredi böyle; DenizBank'ta 0 borç parse
hatası demektir).

## Fixture'lar eksik olabilir

Örnekler elle maskelenir ve bir sayfa atlanmış olabilir (mevcut
`statement.denizbank-2026-06.txt` 2. sayfayı içermez). Bu yüzden golden test
`checkStatementParseTotals` **tutarlılığını** iddia etmez, yalnız kimliğin
ÇALIŞTIĞINI (checked=true) doğrular. Tam bir ekstre eklersen tutarlılığı ilgili
banka parser'ının kendi testinde kilitle.
