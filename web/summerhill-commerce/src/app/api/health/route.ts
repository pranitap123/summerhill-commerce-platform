import { route } from '@/server/http'

/** Liveness: the process is up and serving requests. No dependencies are checked. */
export const GET = route('public', async () => ({ status: 'ok' }))
