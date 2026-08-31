export type SocialPreferenceKind = 'like'
export type SocialTargetType = 'asset'

export type SocialIndex = {
  assetLikes?: Record<string, number>
  likedAssets?: string[]
  generatedAt?: string
}

export type UnsignedSocialAction = {
  address: string
  publicKey?: string
  network: string
  targetType: SocialTargetType
  targetId: string
  action: SocialPreferenceKind
  active: boolean
  signedAt: string
}

export type SignedSocialAction = UnsignedSocialAction & {
  message: string
  signature: string
}

type SupabaseConfig = {
  url: string
  anonKey: string
  actionFunction: string
}

type CountRow = {
  target_id: string | null
  like_count?: number | string | null
}

type SocialActionRow = {
  target_id: string | null
  target_type: SocialTargetType | null
  action: SocialPreferenceKind | null
}

const DEFAULT_SOCIAL_ACTION_FUNCTION = 'social-action'
const DEFAULT_SOCIAL_LIMIT = 5000

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '')

const normalizeNetwork = (network: string | null | undefined) => network?.trim() || 'mainnet'

const normalizeAddressKey = (address: string) => address.trim().toLowerCase()

export const normalizeSocialTarget = (target: string) => target.trim()

const normalizeTargets = (targets: string[] | undefined) =>
  Array.from(new Set((targets ?? []).map(normalizeSocialTarget).filter(Boolean))).sort((a, b) => a.localeCompare(b))

const supabaseConfig = (): SupabaseConfig | null => {
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim()
  const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()
  const actionFunction =
    (import.meta.env.VITE_SUPABASE_SOCIAL_ACTION_FUNCTION as string | undefined)?.trim() ||
    DEFAULT_SOCIAL_ACTION_FUNCTION

  if (!url || !anonKey) return null

  return {
    url: trimTrailingSlash(url),
    anonKey,
    actionFunction,
  }
}

export const getSocialConfigMessage = () => {
  const missing = [
    ['VITE_SUPABASE_URL', import.meta.env.VITE_SUPABASE_URL],
    ['VITE_SUPABASE_ANON_KEY', import.meta.env.VITE_SUPABASE_ANON_KEY],
  ]
    .filter(([, value]) => typeof value !== 'string' || !value.trim())
    .map(([name]) => name)

  return missing.length ? `Missing ${missing.join(', ')}` : null
}

const requireSupabaseConfig = () => {
  const config = supabaseConfig()
  if (!config) throw new Error(getSocialConfigMessage() ?? 'Supabase social config is missing.')
  return config
}

const supabaseHeaders = (config: SupabaseConfig): HeadersInit => ({
  apikey: config.anonKey,
  Authorization: `Bearer ${config.anonKey}`,
  'Content-Type': 'application/json',
})

const supabaseRestUrl = (config: SupabaseConfig, path: string, params?: URLSearchParams) => {
  const query = params ? `?${params.toString()}` : ''
  return `${config.url}/rest/v1/${path.replace(/^\/+/, '')}${query}`
}

const supabaseFunctionUrl = (config: SupabaseConfig) => `${config.url}/functions/v1/${config.actionFunction}`

const readRows = async <T,>(path: string, params: URLSearchParams): Promise<T[]> => {
  const config = requireSupabaseConfig()
  const response = await fetch(supabaseRestUrl(config, path, params), {
    cache: 'no-store',
    headers: supabaseHeaders(config),
  })
  const data = await response.json().catch(() => null)

  if (!response.ok) {
    const message = typeof data?.message === 'string' ? data.message : `Failed to read ${path}`
    throw new Error(message)
  }

  return Array.isArray(data) ? (data as T[]) : []
}

const countValue = (row: CountRow) => {
  const count = typeof row.like_count === 'number' ? row.like_count : Number(row.like_count ?? 0)
  return Number.isFinite(count) ? count : 0
}

const updateCountMap = (counts: Record<string, number> | undefined, target: string, delta: number) => {
  const next = { ...(counts ?? {}) }
  const updated = Math.max(0, (next[target] ?? 0) + delta)
  if (updated > 0) {
    next[target] = updated
  } else {
    delete next[target]
  }
  return next
}

export const readSocialIndex = async (
  address: string | null | undefined,
  network?: string | null,
): Promise<SocialIndex | null> => {
  if (!supabaseConfig()) return null

  const normalizedNetwork = normalizeNetwork(network)
  const assetParams = new URLSearchParams({
    select: 'target_id,like_count',
    network: `eq.${normalizedNetwork}`,
    order: 'like_count.desc,target_id.asc',
    limit: String(DEFAULT_SOCIAL_LIMIT),
  })
  const walletParams = new URLSearchParams({
    select: 'target_id,target_type,action',
    network: `eq.${normalizedNetwork}`,
    active: 'eq.true',
    limit: String(DEFAULT_SOCIAL_LIMIT),
  })

  if (address?.trim()) {
    walletParams.set('address_key', `eq.${normalizeAddressKey(address)}`)
  }

  const [assetRows, walletRows] = await Promise.all([
    readRows<CountRow>('asset_like_counts', assetParams),
    address?.trim() ? readRows<SocialActionRow>('social_actions', walletParams) : Promise.resolve([]),
  ])

  const assetLikes: Record<string, number> = {}
  for (const row of assetRows) {
    const target = normalizeSocialTarget(row.target_id ?? '')
    const count = countValue(row)
    if (target && count > 0) assetLikes[target] = count
  }

  const likedAssets = normalizeTargets(
    walletRows
      .filter((row) => row.target_type === 'asset' && row.action === 'like')
      .map((row) => row.target_id ?? ''),
  )

  return {
    assetLikes,
    likedAssets,
    generatedAt: new Date().toISOString(),
  }
}

export const applySocialLikeToIndex = (
  index: SocialIndex | null,
  target: string,
  enabled: boolean,
): SocialIndex => {
  const normalizedTarget = normalizeSocialTarget(target)
  const current = index ?? { assetLikes: {}, likedAssets: [] }
  if (!normalizedTarget) return current

  const likedAssets = normalizeTargets(current.likedAssets)
  const alreadyActive = likedAssets.includes(normalizedTarget)
  const delta = enabled === alreadyActive ? 0 : enabled ? 1 : -1

  return {
    ...current,
    assetLikes: updateCountMap(current.assetLikes, normalizedTarget, delta),
    likedAssets: enabled
      ? normalizeTargets([...likedAssets, normalizedTarget])
      : likedAssets.filter((asset) => asset !== normalizedTarget),
    generatedAt: new Date().toISOString(),
  }
}

export const createSocialActionMessage = (action: UnsignedSocialAction) =>
  [
    'ACME Social Action',
    `address=${action.address}`,
    `network=${action.network}`,
    `targetType=${action.targetType}`,
    `targetId=${action.targetId}`,
    `action=${action.action}`,
    `active=${action.active ? 'true' : 'false'}`,
    `signedAt=${action.signedAt}`,
  ].join('\n')

export const setSocialPreference = async (action: SignedSocialAction) => {
  const config = requireSupabaseConfig()
  const normalizedTarget = normalizeSocialTarget(action.targetId)
  if (!normalizedTarget) throw new Error('Social target is required.')

  const response = await fetch(supabaseFunctionUrl(config), {
    method: 'POST',
    headers: supabaseHeaders(config),
    body: JSON.stringify({
      ...action,
      targetId: normalizedTarget,
      targetType: 'asset',
      network: normalizeNetwork(action.network),
    }),
  })
  const data = await response.json().catch(() => null)

  if (!response.ok) {
    const message = typeof data?.error === 'string' ? data.error : 'Failed to save like.'
    throw new Error(message)
  }
}
