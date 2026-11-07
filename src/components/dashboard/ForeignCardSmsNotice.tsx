import { Link } from 'react-router'
import { useForeignCardSms } from '../../app/useForeignCardSms'

export function ForeignCardSmsNotice() {
  const query = useForeignCardSms()
  const count = query.data?.rows.length ?? 0
  if (!count && !query.isError && !query.data?.recoveryWarning) return null
  return <div className="rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-sm lg:col-span-12">
    <p className="text-ink">{query.isError ? 'Dövizli SMS durumu doğrulanamadı.' : count ? `${count} dövizli işlemin kesin TL tutarı bekleniyor. Finansal toplamlar bu işlemleri içermiyor.` : 'Eski dövizli SMS kayıtlarının tamamı doğrulanamadı.'}</p>
    <Link className="inline-flex min-h-11 items-center font-semibold text-primary" to="/kartlar?section=kartlar#doviz-sms">Dövizli işlemleri incele →</Link>
  </div>
}
