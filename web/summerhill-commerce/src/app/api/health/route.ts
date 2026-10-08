import { route } from '@/server/http'

export const GET = route('public', async () => ({ status: 'ok' }))
