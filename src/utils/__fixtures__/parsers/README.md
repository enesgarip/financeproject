# Parser fixture'ları (golden files)

Ekstre/hareket PDF'lerinden çıkarılmış **düz metin** örnekleri. Amaç: banka
formatı değiştiğinde ya da parser'a dokunulduğunda sessiz yanlış okumayı
`parserFixtures.test.ts` üzerinden yakalamak.

## Yeni fixture eklemek

1. PDF'i uygulamadaki import ekranında aç, `extractPdfText` çıktısını kopyala
   (veya konsolda `await extractPdfText(file)`).
2. **Tutarları ve kişisel bilgiyi maskele** — dosyalar repoda public.
   İsim/müşteri no değiştir, tutarları değiştirebilirsin; format bozulmasın.
3. Dosyayı bu dizine adlandırma kuralıyla bırak:
   - `statement.<banka>-<dönem>.txt` → `parseDenizBankStatement` ile okunur
   - `movement.<banka>-<dönem>.txt` → `parseDenizBankMovementPdf` ile okunur
4. Test kendiliğinden alır; ek kod gerekmez.

Prefix tanınmazsa test hata verir (yanlış adlandırma sessizce atlanmasın diye).
