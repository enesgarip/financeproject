import { useState } from 'react'
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
    <main className="flex min-h-dvh items-center justify-center overflow-x-hidden bg-background px-4 py-10 text-foreground">
      <Card className="mx-auto w-full max-w-[21rem] border-0 shadow-xl ring-1 ring-stone-200/80 dark:ring-stone-800 sm:max-w-[23rem]">
        <CardContent className="p-5">
          <div>
            <div className="mb-4 grid size-11 place-items-center rounded-xl bg-emerald-50 text-xl font-extrabold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              ₺
            </div>
            <h1 className="text-2xl font-extrabold tracking-normal text-foreground">Kişisel Finans</h1>
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
            <TabsList className="grid h-12 w-full grid-cols-2 rounded-2xl bg-stone-100 p-1 dark:bg-stone-900">
              <TabsTrigger
                value="login"
                className="h-full rounded-xl text-base font-semibold data-[state=active]:bg-emerald-700 data-[state=active]:text-white data-[state=active]:shadow-sm dark:data-[state=active]:bg-emerald-600"
              >
                Giriş Yap
              </TabsTrigger>
              <TabsTrigger
                value="register"
                className="h-full rounded-xl text-base font-semibold data-[state=active]:bg-emerald-700 data-[state=active]:text-white data-[state=active]:shadow-sm dark:data-[state=active]:bg-emerald-600"
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
            <Button type="submit" disabled={submitting} className="h-11 w-full">
              {submitting ? 'Bekle...' : mode === 'login' ? 'Giriş yap' : 'Kayıt ol'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
