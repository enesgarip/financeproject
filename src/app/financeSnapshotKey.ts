/**
 * TanStack cache anahtarı — bilerek bağımsız, sıfır bağımlılıklı modül.
 * `useFinanceSnapshot` repo katmanını (ve dolayısıyla tüm Supabase sorgularını)
 * statik import ettiği için, anahtarı oradan almak Layout gibi her sayfada
 * yüklenen dosyalarda tüm veri katmanını giriş paketine sokuyordu.
 */
export function financeSnapshotKey(userId: string | undefined) {
  return ['finance-snapshot', userId ?? 'anonymous'] as const
}
