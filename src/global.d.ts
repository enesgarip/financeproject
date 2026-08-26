/**
 * Vite `define` ile build anında enjekte edilen sabitler.
 * __APP_COMMIT__: deploy'un GITHUB_SHA'sı (yerelde 'dev') — client_errors
 * kayıtlarını deploy'a eşler.
 */
declare const __APP_COMMIT__: string
