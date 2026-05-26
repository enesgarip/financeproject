import { Banknote, HandCoins, Landmark, ShieldCheck, WalletCards } from 'lucide-react'
import { Link } from 'react-router-dom'

const links = [
  {
    to: '/varliklar',
    title: 'Varlıklar ve maaş',
    description: 'Nakit, altın, fon, hisse, BES ve maaş geçmişi.',
    icon: Banknote,
    tone: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300',
  },
  {
    to: '/krediler',
    title: 'Krediler',
    description: 'Kredi bakiyesi, taksit planı ve ödeme akışı.',
    icon: Landmark,
    tone: 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300',
  },
  {
    to: '/borclar',
    title: 'Borç / alacak',
    description: 'Kişi bazlı borçlar, alacaklar ve tahsilatlar.',
    icon: HandCoins,
    tone: 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300',
  },
  {
    to: '/kartlar',
    title: 'Hızlı harcama',
    description: 'Kart seçip peşin veya taksitli harcama gir.',
    icon: WalletCards,
    tone: 'bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300',
  },
  {
    to: '/veri-sagligi',
    title: 'Veri sağlığı',
    description: 'Tutarsızlıkları kontrol et, gerekirse tüm veriyi sıfırla.',
    icon: ShieldCheck,
    tone: 'bg-violet-50 text-violet-700 dark:bg-violet-950/30 dark:text-violet-300',
  },
]

export function MorePage() {
  return (
    <section className="space-y-4">
      <div className="rounded-3xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-950">
        <h1 className="text-lg font-semibold text-stone-950 dark:text-stone-50">Daha fazla işlem</h1>
        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">Daha seyrek kullanılan finans kayıtları ve hızlı giriş yüzeyleri.</p>
      </div>

      <div className="grid gap-3">
        {links.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="flex items-center gap-3 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-stone-800 dark:bg-stone-950"
          >
            <div className={`grid size-11 shrink-0 place-items-center rounded-xl ${item.tone}`}>
              <item.icon size={20} />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-base font-bold text-stone-950 dark:text-stone-50">{item.title}</h2>
              <p className="mt-0.5 text-sm text-stone-500 dark:text-stone-400">{item.description}</p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}
