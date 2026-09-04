import { Psbt } from 'bitcoinjs-lib'

export type AcmeStorageType = 'utxo' | 'opreturn' | 'witness' | 'arweave'
export type AcmeMintStatus = 'idle' | 'composing' | 'signing' | 'broadcasting' | 'success' | 'error'
export type AcmeMintProgressStep = 'utxos' | 'arweave' | 'compose' | 'finalize' | 'sign' | 'broadcast'
export type AcmeArweaveProgress = {
  percent: number
  label: string
}

export type AcmeGalleryAsset = {
  asset: string
  displayName: string
  description: string
  artistAsset: string | null
  ownerAddress: string | null
  sourceAddress: string | null
  destinationAddress: string | null
  collectionAsset: string | null
  collectionRelationshipStatus: 'pending' | 'synapsed'
  collectionRelationshipCreatedAt: number | null
  collectionRelationshipId: number | null
  collectionSynapseFormedBlock: number | null
  mimeType: string | null
  revealBlock: number | null
  revealTimestamp: number | null
  thumbnailUrl: string
  contentUrl: string
  artUrl: string
}

export type AcmeWalletState = {
  connected: boolean
  connecting: boolean
  address: string | null
  publicKey: string | null
  network: string | null
  balance: number | null
  error: string | null
}

export type AcmeMintForm = {
  assetName: string
  storageType: AcmeStorageType
  artistName: string
  collectionName: string
  additionalAxons: Array<{ id: string; rel: string; ref: string }>
  tags: string
  description: string
  feeRate: number
  locked: boolean
}

const ACME_EXPECTED_WALLET_NETWORK = 'mainnet'
const ACME_MAINNET_ADDRESS_PATTERN = /^(bc1|[13])/
const ACME_MINT_BASE_RESERVE_SATS = 25_000
const ACME_MINT_ESTIMATED_VBYTES = 750

export const validateAcmeWalletNetwork = (wallet: Pick<AcmeWalletState, 'address' | 'network'>): string | null => {
  if (!wallet.address) return 'Connect UniSat before minting.'
  if (wallet.network !== ACME_EXPECTED_WALLET_NETWORK || !ACME_MAINNET_ADDRESS_PATTERN.test(wallet.address)) {
    return 'Switch UniSat to Bitcoin mainnet before minting on ACME, then reconnect your wallet.'
  }
  return null
}

type UniSatBalance = {
  total: number
}

type UniSatApi = {
  requestAccounts: () => Promise<string[]>
  getPublicKey: () => Promise<string>
  getNetwork: () => Promise<string>
  getBalance: () => Promise<UniSatBalance>
  signPsbt: (
    psbtHex: string,
    options?: {
      autoFinalized?: boolean
      toSignInputs?: Array<{
        index: number
        address?: string
        publicKey?: string
        sighashTypes?: number[]
        disableTweakSigner?: boolean
      }>
    },
  ) => Promise<string>
  signMessage: (message: string, type?: 'ecdsa' | 'bip322-simple') => Promise<string>
}

declare global {
  interface Window {
    unisat?: UniSatApi
  }
}

type ApiResponse<T> = {
  result?: T
  data?: T
  error?: string
}

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '')

const ACME_PUBLIC_ORIGIN =
  (import.meta.env.VITE_ACME_PUBLIC_ORIGIN as string | undefined)?.trim() || 'https://acme.pics'

const ACME_API_BASE_URL =
  (import.meta.env.VITE_ACME_API_BASE_URL as string | undefined)?.trim() ||
  (import.meta.env.DEV ? '' : ACME_PUBLIC_ORIGIN)

const resolveAcmeUrl = (path: string) => {
  const baseUrl = trimTrailingSlash(ACME_API_BASE_URL)
  return baseUrl ? `${baseUrl}${path}` : path
}

const resolveAcmePublicUrl = (path: string) => `${trimTrailingSlash(ACME_PUBLIC_ORIGIN)}${path}`

type BackendUtxo = {
  txid?: string
  tx_hash?: string
  vout?: number
  tx_pos?: number
  value?: number | string
  amount?: number | string
  scriptPubKey?: string
  script_pubkey?: string
  address?: string
  confirmations?: number
  height?: number
}

type Utxo = {
  txid: string
  vout: number
  value: number
  scriptPubKey: string
}

type MintFundingPreflight = {
  balance: number
  requiredSats: number
  spendableSats: number
  utxos: Utxo[]
}

type UnifiedArtResult = {
  psbt?: string
  commit_txid?: string
  commit_vout?: number
  reveal_commit_value_sats: number
  reveal_commit_script_pubkey_hex: string
  reveal_witness_script_hex: string
  reveal_secret_key_hex: string
  reveal_internal_key_hex: string
  reveal_merkle_root_hex?: string
  reveal_destination_address: string
  reveal_postage_sats: number
  content_hash: string
  opreturn_script_hex?: string
}

type ArweaveUploadResult = {
  arweave_txid?: string
}

type AcmeCortexAsset = {
  asset?: string
  display_name?: string | null
  description?: string | null
  artist_asset?: string | null
  owner_address?: string | null
  source_address?: string | null
  destination_address?: string | null
  reveal_destination_address?: string | null
  collection_asset?: string | null
  collection_relationship_status?: 'pending' | 'synapsed' | null
  collection_relationship_created_at?: number | null
  collection_relationship_id?: number | null
  collection_synapse_formed_block?: number | null
  mime_type?: string | null
  reveal_block?: number | null
  reveal_timestamp?: number | null
}

type AcmeCortexDendrite = {
  id?: number | null
  source_asset?: string | null
  source_block?: number | null
  rel_type?: string | null
  target_ref?: string | null
  created_at?: number | null
  synapse?: {
    status?: string | null
    formed_block?: number | null
  } | null
}

const jsonFetch = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  const body = await response.text()
  const data = (body ? tryParseJson<ApiResponse<T> | T>(body) : {}) as ApiResponse<T> | T
  if (!response.ok) {
    const message = typeof data === 'object' && data && 'error' in data ? String(data.error) : ''
    const fallback = response.status === 502
      ? 'ACME gateway returned 502 Bad Gateway'
      : response.statusText
    throw new Error(message || fallback || `Request failed with ${response.status}`)
  }
  if (typeof data === 'object' && data && 'error' in data && data.error) {
    throw new Error(data.error)
  }
  if (typeof data === 'object' && data && 'result' in data && data.result !== undefined) return data.result as T
  if (typeof data === 'object' && data && 'data' in data && data.data !== undefined) return data.data as T
  return data as T
}

const tryParseJson = <T,>(body: string): T | Record<string, never> => {
  try {
    return JSON.parse(body) as T
  } catch {
    return {}
  }
}

const normalizeCollectionRelationshipStatus = (status?: string | null): AcmeGalleryAsset['collectionRelationshipStatus'] => {
  const normalizedStatus = status?.trim().toLowerCase()
  return normalizedStatus === 'confirmed' || normalizedStatus === 'synapsed' ? 'synapsed' : 'pending'
}

const normalizeGalleryAsset = (asset: AcmeCortexAsset): AcmeGalleryAsset | null => {
  const assetName = asset.asset?.trim()
  if (!assetName) return null

  return {
    asset: assetName,
    displayName: asset.display_name?.trim() || assetName,
    description: asset.description?.trim() || '',
    artistAsset: asset.artist_asset ?? null,
    ownerAddress: asset.owner_address ?? null,
    sourceAddress: asset.source_address ?? null,
    destinationAddress: asset.destination_address ?? asset.reveal_destination_address ?? null,
    collectionAsset: asset.collection_asset ?? null,
    collectionRelationshipStatus: normalizeCollectionRelationshipStatus(asset.collection_relationship_status),
    collectionRelationshipCreatedAt: asset.collection_relationship_created_at ?? null,
    collectionRelationshipId: asset.collection_relationship_id ?? null,
    collectionSynapseFormedBlock: asset.collection_synapse_formed_block ?? null,
    mimeType: asset.mime_type ?? null,
    revealBlock: asset.reveal_block ?? null,
    revealTimestamp: asset.reveal_timestamp ?? null,
    thumbnailUrl: resolveAcmeUrl(`/api/assets/${encodeURIComponent(assetName)}/thumbnail?size=512&format=webp&v=5`),
    contentUrl: resolveAcmeUrl(`/api/assets/${encodeURIComponent(assetName)}/content`),
    artUrl: resolveAcmePublicUrl(`/art/${encodeURIComponent(assetName)}`),
  }
}

export const fetchAcmeCollectionAssets = async (collectionName = 'STAMPS', limit = 60) => {
  const normalizedCollection = normalizeAcmeAssetRef(collectionName)
  const [response, dendrites] = await Promise.all([
    jsonFetch<AcmeCortexAsset[]>(
      resolveAcmeUrl(`/api/cortex/collections/${encodeURIComponent(normalizedCollection)}/assets?limit=${limit}`),
    ),
    jsonFetch<AcmeCortexDendrite[]>(
      resolveAcmeUrl(`/api/cortex/assets/${encodeURIComponent(normalizedCollection)}/dendrites?limit=${limit}`),
    ).catch(() => []),
  ])
  const relationshipMetadata = new Map(
    dendrites
      .filter((dendrite) => dendrite.rel_type === 'collection' && normalizeAcmeAssetRef(dendrite.target_ref ?? '') === normalizedCollection)
      .map((dendrite) => [
        normalizeAcmeAssetRef(dendrite.source_asset ?? ''),
        {
          status: normalizeCollectionRelationshipStatus(dendrite.synapse?.status),
          createdAt: dendrite.created_at ?? null,
          id: dendrite.id ?? null,
          formedBlock: dendrite.synapse?.formed_block ?? null,
        },
      ] as const),
  )

  return response
    .map((asset) => {
      const metadata = relationshipMetadata.get(normalizeAcmeAssetRef(asset.asset ?? ''))
      return {
        ...asset,
        collection_relationship_status: metadata?.status ?? 'pending',
        collection_relationship_created_at: metadata?.createdAt ?? null,
        collection_relationship_id: metadata?.id ?? null,
        collection_synapse_formed_block: metadata?.formedBlock ?? null,
      }
    })
    .map(normalizeGalleryAsset)
    .filter((asset): asset is AcmeGalleryAsset => asset !== null)
}

export const checkAcmeAssetAvailability = async (assetName: string) => {
  const normalized = normalizeAcmeAssetRef(assetName)
  if (!validateAcmeAssetName(normalized)) {
    return {
      available: false,
      message: 'Asset name must be 3-16 uppercase letters and numbers, starting with a letter.',
    }
  }

  const response = await fetch(resolveAcmeUrl(`/api/assets/${encodeURIComponent(normalized)}`), {
    headers: { 'Content-Type': 'application/json' },
  })
  const body = await response.text()
  const data = (body ? tryParseJson<ApiResponse<unknown>>(body) : {}) as ApiResponse<unknown>

  if (response.status === 404) {
    return { available: true, message: `${normalized} is available.` }
  }

  if (!response.ok) {
    const message = data.error?.trim() || response.statusText || `Asset check failed with ${response.status}`
    throw new Error(message)
  }

  if (data.result) {
    return { available: false, message: `${normalized} has already been taken.` }
  }

  return { available: true, message: `${normalized} is available.` }
}

const base64ToHex = (base64: string) => {
  const binary = atob(base64)
  let hex = ''
  for (let i = 0; i < binary.length; i += 1) {
    hex += binary.charCodeAt(i).toString(16).padStart(2, '0')
  }
  return hex
}

const dataUrlToBlob = async (dataUrl: string) => {
  const response = await fetch(dataUrl)
  return response.blob()
}

const uploadStampToArweave = async ({
  form,
  imageDataUrl,
  walletAddress,
  onProgress,
}: {
  form: AcmeMintForm
  imageDataUrl: string
  walletAddress: string
  onProgress?: (progress: AcmeArweaveProgress) => void
}) => {
  onProgress?.({ percent: 4, label: 'Preparing Arweave upload...' })
  const blob = await dataUrlToBlob(imageDataUrl)
  if (!blob.size) throw new Error('Rendered stamp image is empty.')

  const file = new File([blob], `${form.assetName.trim().toUpperCase() || 'stamp'}.png`, { type: 'image/png' })
  const formData = new FormData()
  formData.append('file', file)
  formData.append(
    'metadata',
    JSON.stringify({
      source: walletAddress,
      asset: form.assetName.trim().toUpperCase(),
      quantity: 1,
      divisible: false,
      description: '',
      lock: form.locked,
    }),
  )

  const data = await new Promise<ApiResponse<ArweaveUploadResult> | ArweaveUploadResult>((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', resolveAcmeUrl('/api/compose/arweave-art-multipart'))
    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) {
        onProgress?.({ percent: 18, label: 'Uploading image to Arweave...' })
        return
      }
      const uploadPercent = Math.round((event.loaded / event.total) * 78)
      onProgress?.({
        percent: Math.min(82, Math.max(8, uploadPercent)),
        label: `Uploading image to Arweave (${Math.round((event.loaded / event.total) * 100)}%)...`,
      })
    }
    request.onload = () => {
      const parsed = (request.responseText ? tryParseJson<ApiResponse<ArweaveUploadResult> | ArweaveUploadResult>(request.responseText) : {}) as
        | ApiResponse<ArweaveUploadResult>
        | ArweaveUploadResult
      if (request.status < 200 || request.status >= 300) {
        const message = typeof parsed === 'object' && parsed && 'error' in parsed ? String(parsed.error) : ''
        reject(new Error(message || request.statusText || `Arweave upload failed with ${request.status}`))
        return
      }
      if (typeof parsed === 'object' && parsed && 'error' in parsed && parsed.error) {
        reject(new Error(parsed.error))
        return
      }
      onProgress?.({ percent: 90, label: 'Confirming Arweave transaction...' })
      resolve(parsed)
    }
    request.onerror = () => reject(new Error('Arweave upload failed.'))
    request.onabort = () => reject(new Error('Arweave upload was canceled.'))
    request.send(formData)
  })

  const result =
    typeof data === 'object' && data && 'result' in data && data.result !== undefined
      ? data.result
      : data
  const txid = result && 'arweave_txid' in result ? result.arweave_txid?.trim() : ''
  if (!txid) throw new Error('Arweave upload did not return a transaction ID.')
  onProgress?.({ percent: 100, label: 'Arweave upload complete.' })
  return txid
}

const normalizeNetwork = (network: string) => {
  if (network === 'livenet') return 'mainnet'
  if (network === 'testnet4') return 'testnet'
  return network || 'mainnet'
}

const normalizeValue = (utxo: BackendUtxo) => {
  if (utxo.value !== undefined) return Number(utxo.value)
  if (utxo.amount !== undefined) return Math.round(Number(utxo.amount) * 100_000_000)
  return 0
}

const normalizeUtxo = (utxo: BackendUtxo): Utxo | null => {
  const txid = utxo.txid ?? utxo.tx_hash
  const vout = utxo.vout ?? utxo.tx_pos
  const value = normalizeValue(utxo)
  const scriptPubKey = utxo.scriptPubKey ?? utxo.script_pubkey ?? ''

  if (!txid || vout === undefined || !Number.isFinite(value) || value <= 0 || !scriptPubKey) {
    return null
  }

  return { txid, vout, value, scriptPubKey }
}

const formatSats = (sats: number) => `${Math.ceil(sats).toLocaleString()} sats`

const estimateAcmeMintRequiredSats = (feeRate: number) => {
  const normalizedFeeRate = Number.isFinite(feeRate) && feeRate > 0 ? feeRate : 1
  return Math.ceil(ACME_MINT_BASE_RESERVE_SATS + normalizedFeeRate * ACME_MINT_ESTIMATED_VBYTES)
}

const fetchSpendableUtxos = async (address: string) => {
  const utxos = await jsonFetch<BackendUtxo[]>(
    resolveAcmeUrl(`/admin/bitcoin/addresses/${encodeURIComponent(address)}/utxos`),
  )
  return utxos.map(normalizeUtxo).filter((utxo): utxo is Utxo => utxo !== null)
}

const preflightMintFunding = async ({
  wallet,
  feeRate,
}: {
  wallet: AcmeWalletState
  feeRate: number
}): Promise<MintFundingPreflight> => {
  if (!wallet.address) throw new Error('Connect UniSat before minting.')
  if (!window.unisat) throw new Error('UniSat wallet is not available.')

  const [balanceResult, utxos] = await Promise.all([
    window.unisat.getBalance().catch(() => ({ total: wallet.balance ?? 0 })),
    fetchSpendableUtxos(wallet.address),
  ])
  const balance = Number(balanceResult.total ?? wallet.balance ?? 0)
  const spendableSats = utxos.reduce((total, utxo) => total + utxo.value, 0)
  const requiredSats = estimateAcmeMintRequiredSats(feeRate)

  if (!utxos.length) {
    throw new Error('No spendable UTXOs found for this wallet. Add confirmed BTC to the connected wallet before uploading to Arweave.')
  }

  if (!Number.isFinite(balance) || balance < requiredSats) {
    throw new Error(`Insufficient wallet balance before Arweave upload. Estimated minimum: ${formatSats(requiredSats)}. Connected wallet balance: ${formatSats(balance || 0)}.`)
  }

  if (spendableSats < requiredSats) {
    throw new Error(`Insufficient spendable UTXOs before Arweave upload. Estimated minimum: ${formatSats(requiredSats)}. Available spendable UTXOs: ${formatSats(spendableSats)}.`)
  }

  return {
    balance,
    requiredSats,
    spendableSats,
    utxos,
  }
}

export const connectUniSat = async (): Promise<AcmeWalletState> => {
  if (!window.unisat) {
    throw new Error('UniSat wallet is not installed.')
  }

  const accounts = await window.unisat.requestAccounts()
  const address = accounts[0]
  if (!address) throw new Error('No UniSat account selected.')

  const [publicKey, network, balance] = await Promise.all([
    window.unisat.getPublicKey(),
    window.unisat.getNetwork(),
    window.unisat.getBalance().catch(() => ({ total: 0 })),
  ])

  return {
    connected: true,
    connecting: false,
    address,
    publicKey,
    network: normalizeNetwork(network),
    balance: balance.total,
    error: null,
  }
}

export const dataUrlToBase64 = (dataUrl: string) => {
  const commaIndex = dataUrl.indexOf(',')
  return commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl
}

export const validateAcmeAssetName = (name: string) => /^[A-Z][A-Z0-9]{2,15}$/.test(name)

export const normalizeAcmeAssetRef = (ref: string) => ref.trim().toUpperCase()

export const validateAcmeAssetRef = (ref: string) => {
  const normalized = normalizeAcmeAssetRef(ref)
  if (!normalized) return true
  if (normalized.startsWith('/')) return true
  return /^[A-Z][A-Z0-9.]*$/.test(normalized) && normalized.length >= 4
}

export const normalizeAcmeAssetRefList = (refs: string) =>
  refs
    .split(',')
    .map(normalizeAcmeAssetRef)
    .filter(Boolean)

export const validateAcmeMintForm = (form: AcmeMintForm): string | null => {
  const assetName = normalizeAcmeAssetRef(form.assetName)
  const artistName = normalizeAcmeAssetRef(form.artistName)
  const collectionNames = normalizeAcmeAssetRefList(form.collectionName)
  const invalidAxon = form.additionalAxons.find((axon) => axon.ref.trim() && (!axon.rel.trim() || !validateAcmeAssetRef(axon.ref)))
  const errors: string[] = []

  if (!validateAcmeAssetName(assetName)) {
    errors.push('Asset name must be 3-16 uppercase letters and numbers, starting with a letter.')
  }

  if (artistName && !validateAcmeAssetRef(artistName)) {
    errors.push('Creator must be a valid ACME asset reference.')
  }

  if (collectionNames.some((collectionName) => !validateAcmeAssetRef(collectionName))) {
    errors.push('Collections must be valid ACME asset references separated by commas.')
  }

  if (invalidAxon) {
    errors.push('Additional relationships need a relationship type and valid ACME asset reference.')
  }

  if (!Number.isFinite(form.feeRate) || form.feeRate < 1) {
    errors.push('Fee rate must be at least 1 sat/vB.')
  }

  return errors.length ? errors.join(' ') : null
}

export const buildStampMetadata = (form: AcmeMintForm) => {
  const artistName = normalizeAcmeAssetRef(form.artistName)
  const collectionNames = normalizeAcmeAssetRefList(form.collectionName)
  const additionalAxons = form.additionalAxons
    .map((axon) => ({ rel: axon.rel.trim().toLowerCase(), ref: normalizeAcmeAssetRef(axon.ref) }))
    .filter((axon) => axon.rel && axon.ref)

  const axons = [
    artistName ? { ref: artistName, rel: 'artist' } : null,
    ...collectionNames.map((collectionName) => ({ ref: collectionName, rel: 'collection' })),
    ...additionalAxons,
  ].filter((item): item is { ref: string; rel: string } => Boolean(item))
  const tags = form.tags
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((tag) => ({ tag }))

  const metadata: {
    name: string
    description: string
    cortex?: {
      v: number
      type: string
      axons?: Array<{ ref: string; rel: string }>
      tags?: Array<{ tag: string }>
    }
  } = {
    name: normalizeAcmeAssetRef(form.assetName),
    description: form.description.trim() || 'Created with Stamp Maker.',
  }

  if (axons.length || tags.length) {
    metadata.cortex = {
      v: 1,
      type: 'artwork',
      ...(axons.length ? { axons } : {}),
      ...(tags.length ? { tags } : {}),
    }
  }

  return metadata
}

export const mintStampOnAcme = async ({
  form,
  imageDataUrl,
  wallet,
  onProgress,
  onArweaveProgress,
}: {
  form: AcmeMintForm
  imageDataUrl: string
  wallet: AcmeWalletState
  onProgress?: (step: AcmeMintProgressStep) => void
  onArweaveProgress?: (progress: AcmeArweaveProgress) => void
}) => {
  if (!wallet.address) throw new Error('Connect UniSat before minting.')
  if (!window.unisat) throw new Error('UniSat wallet is not available.')
  const walletNetworkError = validateAcmeWalletNetwork(wallet)
  if (walletNetworkError) throw new Error(walletNetworkError)

  onProgress?.('utxos')
  const fundingPreflight = await preflightMintFunding({ wallet, feeRate: form.feeRate })

  const arweaveTxid =
    form.storageType === 'arweave'
      ? (onProgress?.('arweave'), await uploadStampToArweave({ form, imageDataUrl, walletAddress: wallet.address, onProgress: onArweaveProgress }))
      : undefined

  onProgress?.('compose')
  const composeResult = await jsonFetch<UnifiedArtResult>(resolveAcmeUrl('/api/compose'), {
    method: 'POST',
    body: JSON.stringify({
      type: 'unified_art',
      source: wallet.address,
      asset: form.assetName.trim().toUpperCase(),
      quantity: 1,
      divisible: false,
      lock: form.locked,
      storage_type: form.storageType,
      art_base64: dataUrlToBase64(imageDataUrl),
      art_mime_type: 'image/png',
      arweave_txid: arweaveTxid,
      metadata: buildStampMetadata(form),
      fee_rate_sat_vb: form.feeRate,
      destination: wallet.address,
      build_transaction: true,
      utxos: fundingPreflight.utxos.map((utxo) => ({
        txid: utxo.txid,
        vout: utxo.vout,
        value: utxo.value,
        script_pubkey: utxo.scriptPubKey,
      })),
      fee_rate: form.feeRate,
    }),
  })

  if (!composeResult.psbt || !composeResult.commit_txid || composeResult.commit_vout === undefined) {
    throw new Error('ACME did not return a signable PSBT.')
  }

  onProgress?.('finalize')
  await jsonFetch(resolveAcmeUrl('/api/compose'), {
    method: 'POST',
    body: JSON.stringify({
      type: 'witness_art_finalize',
      commit_txid: composeResult.commit_txid,
      commit_vout: composeResult.commit_vout,
      commit_value_sats: composeResult.reveal_commit_value_sats,
      commit_output_script_hex: composeResult.reveal_commit_script_pubkey_hex,
      witness_script_hex: composeResult.reveal_witness_script_hex,
      reveal_secret_key_hex: composeResult.reveal_secret_key_hex,
      internal_key_hex: composeResult.reveal_internal_key_hex,
      merkle_root_hex: composeResult.reveal_merkle_root_hex,
      destination: composeResult.reveal_destination_address,
      postage_sats: composeResult.reveal_postage_sats,
      content_hash: composeResult.content_hash,
      asset_name: form.assetName.trim().toUpperCase(),
      source_address: wallet.address,
      opreturn_script_hex: composeResult.opreturn_script_hex,
    }),
  })

  let signedPsbt: string
  try {
    onProgress?.('sign')
    signedPsbt = await window.unisat.signPsbt(base64ToHex(composeResult.psbt), { autoFinalized: true })
  } catch (error) {
    await jsonFetch(resolveAcmeUrl('/api/compose'), {
      method: 'POST',
      body: JSON.stringify({
        type: 'witness_art_cancel',
        commit_txid: composeResult.commit_txid,
      }),
    }).catch(() => undefined)
    throw error
  }

  const parsed = Psbt.fromHex(signedPsbt)
  try {
    parsed.finalizeAllInputs()
  } catch {
    // UniSat often returns an already finalized PSBT.
  }

  const rawHex = parsed.extractTransaction().toHex()
  onProgress?.('broadcast')
  const broadcastResult = await jsonFetch<{ txid?: string }>(resolveAcmeUrl('/admin/bitcoin/transactions'), {
    method: 'POST',
    body: JSON.stringify({ hex: rawHex }),
  })

  const txid = broadcastResult.txid?.trim()
  if (!txid) throw new Error('Broadcast failed: backend returned no txid.')
  return txid
}
