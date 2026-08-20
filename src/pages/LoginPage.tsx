import { useState } from 'react'
import { ArrowRight, ShieldCheck, TrendingUp, WalletCards } from 'lucide-react'
import { Navigate, useLocation } from 'react-router'
import { useAuth } from '../auth/useAuth'
import { Button } from '../components/ui/button'
import { Card, CardContent } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { AppMark } from '../components/AppMark'

export function LoginPage() {
  const { signIn, signUp, user } = useAuth()
  const location = useLocation()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  // `tone` mesajın stilini belirler: kayıt başarısı hata/uyarı kutusuyla
  // basılıyordu, yani iyi haber kötü haber gibi görünüyordu (denetim §10).
  const [message, setMessage] = useState<{ text: string; tone: 'error' | 'success' } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (user) {
    const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? '/'
    return <Navigate to={from} replace />
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedEmail = email.trim()
    const trimmedFullName = fullName.trim()

    if (mode === 'register' && !trimmedFullName) {
      setMessage({ text: 'Ad soyad alanı zorunlu.', tone: 'error' })
      return
    }

    setSubmitting(true)
    setMessage(null)
    try {
      if (mode === 'login') {
        await signIn(trimmedEmail, password)
      } else {
        await signUp(trimmedEmail, password, trimmedFullName)
        setMessage({ text: 'Kayıt başarılı. E-posta onayı açıksa gelen kutunu kontrol et.', tone: 'success' })
      }
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : 'İşlem tamamlanamadı.', tone: 'error' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center overflow-x-hidden bg-page px-4 py-8 text-ink">
      <div className="grid w-full max-w-5xl items-stretch gap-5 lg:grid-cols-[1.05fr_0.95fr]">
        <section className="login-signature-panel relative hidden overflow-hidden rounded-2xl border p-5 shadow-[var(--shadow-lifted)] lg:flex lg:flex-col lg:justify-between">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-primary via-info to-warning opacity-80" />
          <div>
            <div className="flex items-center gap-3">
              <AppMark className="size-11 shadow-[0_4px_14px_color-mix(in_srgb,var(--primary)_40%,transparent)]" />
              <div>
                <h1 className="text-xl font-bold tracking-tight text-ink">Denge</h1>
                <p className="text-sm text-ink-muted">Günlük para kararlarını dengede tut.</p>
              </div>
            </div>

            {/* Demo cash-flow card — brand gradient */}
            <div
              className="login-cash-preview relative mt-8 overflow-hidden rounded-2xl p-5 text-white shadow-[var(--shadow-floating)]"
            >
              <div className="pointer-events-none absolute -right-12 -top-12 size-40 rounded-full bg-white/10 blur-2xl" />
              <div className="relative flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-white/65">Nakit akışı</p>
                  <p className="mt-2 font-mono text-3xl font-bold tabular-nums">10.860,00 ₺</p>
                  <p className="mt-1 text-sm text-white/65">Ay sonu projeksiyonu artıda.</p>
                </div>
                <div className="grid size-9 place-items-center rounded-xl bg-white/15">
                  <TrendingUp className="size-5 text-white" />
                </div>
              </div>
              <div className="relative mt-5 grid grid-cols-3 gap-2">
                {['Gelir', 'Nakit çıkışı', 'Net'].map((label, index) => (
                  <div key={label} className="rounded-xl bg-white/10 px-3 py-2 ring-1 ring-white/10">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-white/55">{label}</p>
                    <p className="mt-1 font-mono text-sm font-bold tabular-nums text-white">
                      {index === 0 ? '28.750 ₺' : index === 1 ? '17.890 ₺' : '10.860 ₺'}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-3">
            <div className="flex items-center gap-3 rounded-xl border border-line-strong bg-page p-3">
              <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/12 text-primary">
                <WalletCards className="size-5" />
              </div>
              <div>
                <p className="text-sm font-bold text-ink">Kart, kredi ve ödemeler</p>
                <p className="text-xs text-ink-muted">Vadeleri ve limitleri aynı ritimde izle.</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-line-strong bg-page p-3">
              <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-success/12 text-success">
                <ShieldCheck className="size-5" />
              </div>
              <div>
                <p className="text-sm font-bold text-ink">Veri sağlığı</p>
                <p className="text-xs text-ink-muted">Tutarsızlıkları büyümeden yakala.</p>
              </div>
            </div>
          </div>
        </section>

      <Card variant="elevated" className="mx-auto w-full max-w-[23rem] sm:max-w-[25rem] lg:max-w-none">
        <CardContent className="p-5 sm:p-6">
          <div>
            <AppMark className="mb-4 size-11 shadow-[0_4px_14px_color-mix(in_srgb,var(--primary)_24%,transparent)]" />
            <h1 className="text-2xl font-bold tracking-tight text-ink">Denge</h1>
            <p className="mt-2 text-sm leading-6 text-ink-muted">
            Varlıklarını, borçlarını ve yaklaşan ödemelerini tek yerden takip et.
            </p>
          </div>

          {/* Tek kullanıcılı bir ürün: "Kayıt Ol" birinci sınıf sekme olarak durunca
              ekranın yarısını hiç kullanılmayacak bir yola ayırıyordu (denetim §10).
              Artık varsayılan Giriş; kayıt formun altında ikincil bir bağlantı. */}
          <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
            <h2 className="text-sm font-black uppercase tracking-wider text-ink-muted">
              {mode === 'login' ? 'Giriş yap' : 'Yeni hesap'}
            </h2>
            {mode === 'register' ? (
              <label className="block text-sm font-semibold text-ink">
              Ad soyad
                <Input
                  required
                  type="text"
                  autoComplete="name"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  className="mt-1 h-11"
                />
              </label>
            ) : null}
            <label className="block text-sm font-semibold text-ink">
            E-posta adresi
              <Input
                required
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-1 h-11"
              />
            </label>
            <label className="block text-sm font-semibold text-ink">
            Şifre
              <Input
                required
                minLength={6}
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-1 h-11"
              />
            </label>
            {message ? (
              <p
                role={message.tone === 'error' ? 'alert' : 'status'}
                className={
                  message.tone === 'error'
                    ? 'rounded-xl border border-destructive/25 bg-destructive/8 p-3 text-sm font-medium text-destructive'
                    : 'rounded-xl border border-success/25 bg-success/8 p-3 text-sm font-medium text-success'
                }
              >
                {message.text}
              </p>
            ) : null}
            <Button type="submit" disabled={submitting} className="h-11 w-full gap-2">
              {submitting ? 'Bekle…' : mode === 'login' ? 'Giriş yap' : 'Kayıt ol'}
              {!submitting ? <ArrowRight data-icon="inline-end" /> : null}
            </Button>

            <button
              type="button"
              onClick={() => {
                setMode((current) => (current === 'login' ? 'register' : 'login'))
                setMessage(null)
              }}
              className="mx-auto text-xs font-semibold text-ink-muted underline decoration-dotted underline-offset-4 transition hover:text-ink"
            >
              {mode === 'login' ? 'Yeni hesap oluştur' : 'Zaten hesabım var, giriş yap'}
            </button>
          </form>
        </CardContent>
      </Card>
      </div>
    </main>
  )
}
