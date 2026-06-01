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
        <section className="hidden rounded-lg border border-border/75 bg-card p-5 shadow-xl shadow-stone-950/5 dark:shadow-black/30 lg:flex lg:flex-col lg:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="grid size-11 place-items-center rounded-lg bg-primary text-xl font-black text-primary-foreground">₺</div>
              <div>
                <h1 className="text-xl font-black text-foreground">Kişisel Finans</h1>
                <p className="text-sm text-muted-foreground">Günlük para kararlarını tek ekranda toparla.</p>
              </div>
            </div>

            <div className="mt-8 rounded-lg bg-emerald-950 p-5 text-white ring-1 ring-emerald-500/20">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase text-emerald-100/75">Nakit akışı</p>
                  <p className="mt-2 text-3xl font-black tabular-nums">₺10.860,00</p>
                  <p className="mt-1 text-sm text-emerald-50/70">Ay sonu projeksiyonu artıda.</p>
                </div>
                <TrendingUp className="text-emerald-200" />
              </div>
              <div className="mt-5 grid grid-cols-3 gap-2">
                {['Gelir', 'Gider', 'Net'].map((label, index) => (
                  <div key={label} className="rounded-lg bg-white/10 px-3 py-2 ring-1 ring-white/10">
                    <p className="text-[11px] font-bold uppercase text-white/55">{label}</p>
                    <p className={`mt-1 text-sm font-black tabular-nums ${index === 1 ? 'text-rose-200' : 'text-emerald-100'}`}>
                      {index === 0 ? '₺28.750' : index === 1 ? '₺17.890' : '₺10.860'}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-3">
            <div className="flex items-center gap-3 rounded-lg border border-border bg-background/70 p-3">
              <WalletCards className="size-5 text-primary" />
              <div>
                <p className="text-sm font-black text-foreground">Kart, kredi ve ödemeler</p>
                <p className="text-xs text-muted-foreground">Vadeleri ve limitleri aynı ritimde izle.</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-lg border border-border bg-background/70 p-3">
              <ShieldCheck className="size-5 text-primary" />
              <div>
                <p className="text-sm font-black text-foreground">Veri sağlığı</p>
                <p className="text-xs text-muted-foreground">Tutarsızlıkları büyümeden yakala.</p>
              </div>
            </div>
          </div>
        </section>

      <Card className="mx-auto w-full max-w-[23rem] border-0 shadow-xl ring-1 ring-border/80 sm:max-w-[25rem] lg:max-w-none">
        <CardContent className="p-5 sm:p-6">
          <div>
            <div className="mb-4 grid size-11 place-items-center rounded-lg bg-primary/10 text-xl font-black text-primary">
              ₺
            </div>
            <h1 className="text-2xl font-black tracking-normal text-foreground">Kişisel Finans</h1>
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
                  className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-3 outline-none ring-ring/0 transition focus:border-ring focus:ring-3 focus:ring-ring/20"
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
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-3 outline-none ring-ring/0 transition focus:border-ring focus:ring-3 focus:ring-ring/20"
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
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-3 outline-none ring-ring/0 transition focus:border-ring focus:ring-3 focus:ring-ring/20"
              />
            </label>
            {message ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">{message}</p> : null}
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
