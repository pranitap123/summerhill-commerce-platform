'use client'

export class ConsoleApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message)
  }
}

export async function consoleApi<T = unknown>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api/console/${path}`, {
      method,
      credentials: 'include',
      cache: 'no-store',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ConsoleApiError(0, 'OFFLINE', 'No connection. Check the network and try again.')
  }
  const data = await res.json().catch(() => null)
  if (!res.ok)
    throw new ConsoleApiError(
      res.status,
      data?.error?.code ?? 'UNKNOWN',
      data?.error?.message ?? 'Something went wrong',
      data?.error?.details,
    )
  return data as T
}

export function storeTime(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return ''
  return new Intl.DateTimeFormat('en-CA', { timeZone, hour: 'numeric', minute: '2-digit' }).format(
    new Date(iso),
  )
}

export const money = (cents: number | null | undefined) =>
  cents === null || cents === undefined
    ? '–'
    : new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100)
