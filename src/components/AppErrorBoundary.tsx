import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * Uygulama çökerse beyaz ekran yerine ErrorFallback gösterir.
 *
 * Önceden bu iş Sentry'nin ErrorBoundary'siyle yapılıyordu; Sentry kaldırılınca
 * (2026-08-19, DSN üretimde hiç tanımlı değildi ve hata raporu gitmiyordu) çökme
 * yakalama kaybolmasın diye yerine bu sınıf kondu. React'te hata sınırı yalnız
 * class bileşenle kurulabilir; hook karşılığı yoktur.
 */
type Props = { fallback: ReactNode; children: ReactNode }
type State = { hasError: boolean }

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Konsol ayıklama için kalır; kalıcı iz client_errors tablosuna düşer
    // (lib/errorReport — kendi Supabase'imiz, Sentry'siz). Dinamik import:
    // boundary entry'de yaşar, rapor zinciri giriş paketine binmesin.
    console.error('Uygulama hatası:', error, info.componentStack)
    void import('../lib/errorReport')
      .then((mod) => mod.reportBoundaryError(error, info.componentStack))
      .catch(() => undefined)
  }

  render(): ReactNode {
    return this.state.hasError ? this.props.fallback : this.props.children
  }
}
