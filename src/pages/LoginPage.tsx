import { useState } from 'react'
import { ArrowRight, ShieldCheck, TrendingUp, WalletCards } from 'lucide-react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { Button } from '../components/ui/button'
import { Card, CardContent } from '../components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs'

export function LoginPage() {
  const { signIn, signUp, user } = useAuth()
  const location = useLocation()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
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
      setMessage('Ad soyad alanı zorunlu.')
      return
    }

    setSubmitting(true)
    setMessage('')
    try {
      if (mode === 'login') {
        await signIn(trimmedEmail, password)
      } else {
        await signUp(trimmedEmail, password, trimmedFullName)
        setMessage('Kayıt başarılı. E-posta onayı açıksa gelen kutunu kontrol et.')
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'İşlem tamamlanamadı.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center overflow-x-hidden bg-background px-4 py-8 text-foreground">
      <div className="grid w-full max-w-5xl items-stretch gap-5 lg:grid-cols-[1.05fr_0.95fr]">
        <section className="relative hidden overflow-hidden rounded-2xl border border-border/60 bg-card p-5 shadow-[var(--shadow-lifted)] lg:flex lg:flex-col lg:justify-between">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-primary via-info to-warning opacity-80" />
          <div>
            <div className="flex items-center gap-3">
              <div className="grid size-11 place-items-center rounded-xl bg-primary text-xl font-black text-primary-foreground shadow-[0_4px_14px_color-mix(in_srgb,var(--primary)_40%,transparent)]">₺</div>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-foreground">Kişisel Finans</h1>
                <p className="text-sm text-muted-foreground">Günlük para kararlarını tek ekranda toparla.</p>
              </div>
            </div>

            {/* Demo cash-flow card — brand gradient */}
            <div
              className="relative mt-8 overflow-hidden rounded-2xl p-5 text-white shadow-[var(--shadow-floating)]"
              style={{ background: 'linear-gradient(135deg, var(--brand-900, #312e81), var(--brand-700, #4338ca))' }}
            >
              <div className="pointer-events-none absolute -right-12 -top-12 size-40 rounded-full bg-white/10 blur-2xl" />
              <div className="relative flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-white/65">Nakit akışı</p>
                  <p className="mt-2 font-mono text-3xl font-bold tabular-nums">₺10.860,00</p>
                  <p className="mt-1 text-sm text-white/65">Ay sonu projeksiyonu artıda.</p>
                </div>
                <div className="grid size-9 place-items-center rounded-xl bg-white/15">
                  <TrendingUp className="size-5 text-white" />
                </div>
              </div>
              <div className="relative mt-5 grid grid-cols-3 gap-2">
                {['Gelir', 'Gider', 'Net'].map((label, index) => (
                  <div key={label} className="rounded-xl bg-white/10 px-3 py-2 ring-1 ring-white/10">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-white/55">{label}</p>
                    <p className={`mt-1 font-mono text-sm font-bold tabular-nums ${index === 1 ? 'text-rose-200' : 'text-emerald-200'}`}>
                      {index === 0 ? '₺28.750' : index === 1 ? '₺17.890' : '₺10.860'}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-3">
            <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/30 p-3">
              <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/12 text-primary">
                <WalletCards className="size-5" />
              </div>
              <div>
                <p className="text-sm font-bold text-foreground">Kart, kredi ve ödemeler</p>
                <p className="text-xs text-muted-foreground">Vadeleri ve limitleri aynı ritimde izle.</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/30 p-3">
              <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-success/12 text-success">
                <ShieldCheck className="size-5" />
              </div>
              <div>
                <p className="text-sm font-bold text-foreground">Veri sağlığı</p>
                <p className="text-xs text-muted-foreground">Tutarsızlıkları büyümeden yakala.</p>
              </div>
            </div>
          </div>
        </section>

      <Card variant="elevated" className="mx-auto w-full max-w-[23rem] sm:max-w-[25rem] lg:max-w-none">
        <CardContent className="p-5 sm:p-6">
          <div>
            <div className="mb-4 grid size-11 place-items-center rounded-xl bg-primary/12 text-xl font-black text-primary">
              ₺
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Kişisel Finans</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Varlıklarını, borçlarını ve yaklaşan ödemelerini tek yerden takip et.
            </p>
          </div>

          <Tabs
            value={mode}
            onValueChange={(value) => {
              setMode(value as 'login' | 'register')
              setMessage('')
            }}
            className="mt-5"
          >
            <TabsList className="grid h-12 w-full grid-cols-2 rounded-lg bg-muted p-1">
              <TabsTrigger
                value="login"
                className="h-full rounded-lg text-base font-bold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
              >
                Giriş Yap
              </TabsTrigger>
              <TabsTrigger
                value="register"
                className="h-full rounded-lg text-base font-bold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
              >
                Kayıt Ol
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-4">
            {mode === 'register' ? (
              <label className="block text-sm font-semibold text-foreground">
              Ad soyad
                <input
                  required
                  type="text"
                  autoComplete="name"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  className="mt-1 h-11 w-full rounded-xl border border-input bg-card/80 px-3 text-sm text-foreground outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 dark:bg-card/50"
                />
              </label>
            ) : null}
            <label className="block text-sm font-semibold text-foreground">
            E-posta adresi
              <input
                required
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-1 h-11 w-full rounded-xl border border-input bg-card/80 px-3 text-sm text-foreground outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 dark:bg-card/50"
              />
            </label>
            <label className="block text-sm font-semibold text-foreground">
            Şifre
              <input
                required
                minLength={6}
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-1 h-11 w-full rounded-xl border border-input bg-card/80 px-3 text-sm text-foreground outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 dark:bg-card/50"
              />
            </label>
            {message ? <p className="rounded-xl border border-warning/25 bg-warning/8 p-3 text-sm font-medium text-warning">{message}</p> : null}
            <Button type="submit" disabled={submitting} className="h-11 w-full gap-2">
              {submitting ? 'Bekle...' : mode === 'login' ? 'Giriş yap' : 'Kayıt ol'}
              {!submitting ? <ArrowRight data-icon="inline-end" /> : null}
            </Button>
          </form>
        </CardContent>
      </Card>
      </div>
    </main>
  )
}
