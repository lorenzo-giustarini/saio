/**
 * V15.0 WS26 — Safe JSON parse di Response.
 *
 * Quando il backend è offline o un endpoint è cached/stale, il browser può
 * ricevere HTML (es. index.html fallback Vite, 502 Bad Gateway, 404 page).
 * `await r.json()` crasha con "Unexpected token '<'..." inutile per l'utente.
 *
 * Questo helper:
 * - Legge response come text
 * - Tenta JSON.parse
 * - Se fallisce → ritorna SafeJsonError typato (con httpStatus + bodyPreview)
 * - I caller usano `isJsonError(data)` per distinguere e mostrare toast adeguato.
 */

export interface SafeJsonError {
  ok: false
  error: 'non_json_response'
  httpStatus: number
  contentType: string | null
  bodyPreview: string
}

export async function safeJsonResponse<T>(r: Response): Promise<T | SafeJsonError> {
  const text = await r.text()
  try {
    return JSON.parse(text) as T
  } catch {
    return {
      ok: false,
      error: 'non_json_response',
      httpStatus: r.status,
      contentType: r.headers.get('content-type'),
      bodyPreview: text.slice(0, 200),
    }
  }
}

export function isJsonError(x: unknown): x is SafeJsonError {
  return (
    typeof x === 'object' &&
    x !== null &&
    (x as { error?: string }).error === 'non_json_response'
  )
}
