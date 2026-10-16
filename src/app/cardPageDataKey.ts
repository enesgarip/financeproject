/** Kullanıcı kapsamı bütün kart detay sorgularının ortak invalidation prefix'idir. */
export function cardPageDataKey(userId: string | undefined) {
  return ['card-page-data', userId ?? 'anon'] as const
}
