import { useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'

export function LoginPage() {
  const { signIn, signUp, user } = useAuth()
  const location = useLocation()
  const [mode, setMode] = useState<'login' | 'register'>('login')
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
    setSubmitting(true)
    setMessage('')
    try {
      if (mode === 'login') {
        await signIn(email, password)
      } else {
        await signUp(email, password)
        setMessage('Kayıt başarılı. E-posta onayı açıksa gelen kutunu kontrol et.')
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'İşlem tamamlanamadı.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-start bg-[#f7f8f4] px-4 py-10 text-stone-900 dark:bg-stone-950 dark:text-stone-100 sm:justify-center">
      <section className="w-full max-w-[22rem] rounded-lg border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
        <div>
          <h1 className="text-2xl font-semibold text-stone-950 dark:text-stone-50">Kişisel Finans</h1>
          <p className="mt-2 text-sm leading-6 text-stone-500 dark:text-stone-400">
            Varlıklarını, borçlarını ve yaklaşan ödemelerini tek yerden takip et.
          </p>
        </div>

        <div className="mt-5 grid grid-cols-2 rounded-lg bg-stone-100 p-1 text-sm font-medium dark:bg-stone-800">
          <button
            type="button"
            onClick={() => setMode('login')}
            className={`rounded-md px-3 py-2 ${mode === 'login' ? 'bg-white shadow-sm dark:bg-stone-950' : 'text-stone-500 dark:text-stone-400'}`}
          >
            Giriş Yap
          </button>
          <button
            type="button"
            onClick={() => setMode('register')}
            className={`rounded-md px-3 py-2 ${mode === 'register' ? 'bg-white shadow-sm dark:bg-stone-950' : 'text-stone-500 dark:text-stone-400'}`}
          >
            Kayıt Ol
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <label className="block text-sm font-medium text-stone-700 dark:text-stone-200">
            E-posta adresi
            <input
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-3 outline-none focus:border-emerald-600 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100"
            />
          </label>
          <label className="block text-sm font-medium text-stone-700 dark:text-stone-200">
            Şifre
            <input
              required
              minLength={6}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-3 outline-none focus:border-emerald-600 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100"
            />
          </label>
          {message ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{message}</p> : null}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-emerald-700 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {submitting ? 'Bekle...' : mode === 'login' ? 'Giriş yap' : 'Kayıt ol'}
          </button>
        </form>
      </section>
    </main>
  )
}
