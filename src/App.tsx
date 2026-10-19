import { ComicBook } from './components/comic-book'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import './Modern.css'
import './Shadcn.css'
import { ArtworkDialog } from './components/artwork-dialog'
import { DiagonalGallery } from './components/diagonal-gallery'
import { PerspectiveReel } from './components/perspective-reel'
import './Reel.css'
import './Timeline.css'
import './UnifiedTheme.css'
import './ComicBook.css'
import { Button } from './components/ui/button'
import { Field, FieldLabel, FieldDescription, FieldError, FieldGroup } from './components/ui/field'
import { Input } from './components/ui/input'
import { Textarea } from './components/ui/textarea'
import { Checkbox } from './components/ui/checkbox'
import { NativeSelect, NativeSelectOption } from './components/ui/native-select'
import { Slider } from './components/ui/slider'
import { ToggleGroup, ToggleGroupItem } from './components/ui/toggle-group'
import { Progress } from './components/ui/progress'
import {
  checkAcmeAssetAvailability,
  connectUniSat,
  fetchAcmeCollectionAssets,
  mintStampOnAcme,
  normalizeAcmeAssetRef,
  validateAcmeAssetName,
  validateAcmeMintForm,
  validateAcmeWalletNetwork,
  type AcmeArweaveProgress,
  type AcmeGalleryAsset,
  type AcmeMintForm,
  type AcmeMintProgressStep,
  type AcmeMintStatus,
  type AcmeStorageType,
  type AcmeWalletState,
} from './acmeMint'
import {
  applySocialLikeToIndex,
  createSocialActionMessage,
  readSocialIndex,
  setSocialPreference,
  type SocialIndex,
} from './social'

type Tab = 'submit' | 'pending' | 'portfolio'
type SubmissionSort = 'newest' | 'oldest' | 'name' | 'creator' | 'likes'
type AssetCheckStatus = 'idle' | 'invalid' | 'checking' | 'available' | 'taken' | 'error'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'pending', label: 'Collection' },
  { id: 'submit', label: 'Create a comic' },
]

const STORAGE_OPTIONS: Array<{ key: AcmeStorageType; label: string }> = [
  { key: 'arweave', label: 'Arweave' },
  { key: 'witness', label: 'Witness' },
  { key: 'opreturn', label: 'OP_RETURN' },
  { key: 'utxo', label: 'UTXO' },
]

const ORIGINAL_ARTWORK_TAG = 'Original-Artwork'

const SUBMISSION_SORT_OPTIONS: Array<{ key: SubmissionSort; label: string }> = [
  { key: 'newest', label: 'Newest' },
  { key: 'oldest', label: 'Oldest' },
  { key: 'name', label: 'Name' },
  { key: 'creator', label: 'Creator' },
  { key: 'likes', label: 'Most liked' },
]

const PROGRESS_LABELS: Record<AcmeMintProgressStep, string> = {
  utxos: 'Checking wallet funds and UTXOs',
  arweave: 'Uploading comic to Arweave',
  compose: 'Composing ACME mint',
  finalize: 'Preparing reveal data',
  sign: 'Waiting for wallet signature',
  broadcast: 'Broadcasting transaction',
}

const COLLECTION_ASSET_LIMIT = 1000

const DEFAULT_WALLET: AcmeWalletState = {
  connected: false,
  connecting: false,
  address: null,
  publicKey: null,
  network: null,
  balance: null,
  error: null,
}


const DEFAULT_FORM: AcmeMintForm = {
  assetName: '',
  storageType: 'arweave',
  artistName: '',
  collectionName: 'SATOSHICOMICS',
  additionalAxons: [],
  tags: 'SatoshiComics, comic, comic-book, ACME',
  description: 'Submitted to SatoshiComics on ACME mainnet.',
  feeRate: 5,
  locked: false,
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const formatAddress = (address: string | null) => {
  if (!address) return ''
  if (address.length <= 14) return address
  return `${address.slice(0, 7)}...${address.slice(-5)}`
}

const getDataUrlBytes = (dataUrl: string) => {
  const base64 = dataUrl.split(',')[1] ?? ''
  return Math.floor((base64.length * 3) / 4)
}

const formatBytes = (bytes: number) => {
  if (!bytes) return 'No comic rendered'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}


const localCovers = import.meta.glob('../Assets/*.{png,jpg}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const normalizeCoverRef = (value: string) => value.toUpperCase().replace(/\d+$/, (issue) => String(Number(issue)))
const coverFor = (asset: AcmeGalleryAsset) => {
  const localRef = normalizeCoverRef(asset.asset)
  const entries = Object.entries(localCovers)
  const stemFor = (path: string) => path.split('/').pop()?.replace(/\.[^.]+$/, '') ?? ''
  const local = entries.find(([path]) => normalizeCoverRef(stemFor(path)) === localRef)
    ?? (Number(asset.asset.match(/\d+$/)?.[0]) === 1
      ? entries.find(([path]) => stemFor(path).toUpperCase() === asset.asset.replace(/\d+$/, '').toUpperCase())
      : undefined)
  return local?.[1] || asset.contentUrl || asset.thumbnailUrl
}

const formatStatusLabel = (asset: AcmeGalleryAsset) =>
  asset.collectionRelationshipStatus === 'synapsed' ? 'Approved' : 'Pending'

const matchesPortfolioOwner = (asset: AcmeGalleryAsset, walletAddress: string | null) => {
  const address = walletAddress?.trim().toLowerCase()
  if (!address) return false
  return [
    asset.ownerAddress,
    asset.sourceAddress,
    asset.destinationAddress,
    asset.artistAsset,
  ].some((value) => value?.trim().toLowerCase() === address)
}

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('pending')
  const [sourceImage, setSourceImage] = useState<string | null>(null)
  const [renderedComic, setRenderedComic] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState('')
  const [zoom, setZoom] = useState(1)
  const [panX, setPanX] = useState(0)
  const [panY, setPanY] = useState(0)
  const [contrast, setContrast] = useState(108)
  const [brightness, setBrightness] = useState(102)
  const [saturation, setSaturation] = useState(116)
  const [clarity, setClarity] = useState(14)
  const [hue, setHue] = useState(0)
  const [grain, setGrain] = useState(8)
  const [texture, setTexture] = useState(10)
  const [form, setForm] = useState<AcmeMintForm>(DEFAULT_FORM)
  const [wallet, setWallet] = useState<AcmeWalletState>(DEFAULT_WALLET)
  const [mintStatus, setMintStatus] = useState<AcmeMintStatus>('idle')
  const [mintStep, setMintStep] = useState<AcmeMintProgressStep | null>(null)
  const [arweaveProgress, setArweaveProgress] = useState<AcmeArweaveProgress | null>(null)
  const [mintError, setMintError] = useState('')
  const [txid, setTxid] = useState('')
  const [pendingAssets, setPendingAssets] = useState<AcmeGalleryAsset[]>([])
  const [pendingStatus, setPendingStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle')
  const [pendingError, setPendingError] = useState('')
  const [selectedComic, setSelectedComic] = useState<AcmeGalleryAsset | null>(null)
  const [selectedEditedComic, setSelectedEditedComic] = useState<string | null>(null)
  const [socialIndex, setSocialIndex] = useState<SocialIndex | null>(null)
  const [socialStatus, setSocialStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle')
  const [socialError, setSocialError] = useState('')
  const [likePendingAsset, setLikePendingAsset] = useState<string | null>(null)
  const [submissionSearch, setSubmissionSearch] = useState('')
  const [submissionSort, setSubmissionSort] = useState<SubmissionSort>('oldest')
  const [collectionView, setCollectionView] = useState<'all' | 'popular' | 'new'>('all')
  const [galleryLayout, setGalleryLayout] = useState<'diagonal' | 'reel'>('diagonal')
  const [assetCheckStatus, setAssetCheckStatus] = useState<AssetCheckStatus>('idle')
  const [assetCheckMessage, setAssetCheckMessage] = useState('')
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const normalizedAssetName = normalizeAcmeAssetRef(form.assetName)
  const validationError = validateAcmeMintForm(form)
  const assetNameIsValid = validateAcmeAssetName(normalizedAssetName)
  const assetAvailabilityError = assetCheckStatus === 'taken'
    ? assetCheckMessage
    : assetCheckStatus === 'checking'
      ? 'Checking whether this ACME asset name is available.'
      : assetCheckStatus === 'error'
        ? assetCheckMessage
        : assetNameIsValid && assetCheckStatus !== 'available'
          ? 'Check ACME asset name availability before minting.'
          : null
  const walletError = wallet.connected ? validateAcmeWalletNetwork(wallet) : 'Connect UniSat before minting.'
  const renderedBytes = useMemo(() => (renderedComic ? getDataUrlBytes(renderedComic) : 0), [renderedComic])
  const originalArtworkSelected = useMemo(() => hasTag(form.tags, ORIGINAL_ARTWORK_TAG), [form.tags])
  const likedAssets = useMemo(() => new Set(socialIndex?.likedAssets ?? []), [socialIndex])
  const getAssetLikeCount = useCallback((asset: string) => socialIndex?.assetLikes?.[asset] ?? 0, [socialIndex])
  const getAssetCreator = useCallback((asset: AcmeGalleryAsset) => asset.artistAsset?.trim() || 'anonymous', [])
  const submittedAssets = useMemo(
    () => pendingAssets.filter((asset) => asset.collectionRelationshipStatus === 'pending'),
    [pendingAssets],
  )
  const visiblePendingAssets = useMemo(() => {
    const query = submissionSearch.trim().toLowerCase()
    const filtered = submittedAssets.filter((asset) => {
      if (!query) return true
      return (
        asset.asset.toLowerCase().includes(query) ||
        asset.displayName.toLowerCase().includes(query) ||
        asset.description.toLowerCase().includes(query) ||
        getAssetCreator(asset).toLowerCase().includes(query)
      )
    })

    return filtered.sort((a, b) => {
      if (submissionSort === 'name') return a.displayName.localeCompare(b.displayName)
      if (submissionSort === 'creator') return getAssetCreator(a).localeCompare(getAssetCreator(b)) || a.displayName.localeCompare(b.displayName)
      if (collectionView === 'popular' || submissionSort === 'likes') return getAssetLikeCount(b.asset) - getAssetLikeCount(a.asset) || a.displayName.localeCompare(b.displayName)

      const aTime = a.revealTimestamp ?? a.revealBlock ?? 0
      const bTime = b.revealTimestamp ?? b.revealBlock ?? 0
      return collectionView !== 'new' && submissionSort === 'oldest'
        ? aTime - bTime || a.displayName.localeCompare(b.displayName)
        : bTime - aTime || a.displayName.localeCompare(b.displayName)
    })
  }, [getAssetCreator, getAssetLikeCount, submittedAssets, submissionSearch, submissionSort, collectionView])
  const portfolioAssets = useMemo(
    () =>
      pendingAssets
        .filter((asset) => matchesPortfolioOwner(asset, wallet.address))
        .sort((a, b) => {
          const aTime = a.revealTimestamp ?? a.revealBlock ?? a.collectionRelationshipCreatedAt ?? 0
          const bTime = b.revealTimestamp ?? b.revealBlock ?? b.collectionRelationshipCreatedAt ?? 0
          return bTime - aTime || a.displayName.localeCompare(b.displayName)
        }),
    [pendingAssets, wallet.address],
  )
  const portfolioStats = useMemo(() => {
    const approved = portfolioAssets.filter((asset) => asset.collectionRelationshipStatus === 'synapsed').length
    const pending = portfolioAssets.length - approved
    const likes = portfolioAssets.reduce((total, asset) => total + getAssetLikeCount(asset.asset), 0)
    return { approved, pending, likes }
  }, [getAssetLikeCount, portfolioAssets])
  const renderComic = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const mintedCoverWidth = 1048
    const mintedCoverHeight = 1564
    canvas.width = mintedCoverWidth
    canvas.height = mintedCoverHeight

    const coverX = 0
    const coverY = 0
    const coverW = mintedCoverWidth
    const coverH = mintedCoverHeight
    const radius = 4
    ctx.clearRect(0, 0, mintedCoverWidth, mintedCoverHeight)

    if (sourceImage) {
      const image = new Image()
      image.onload = () => {
        ctx.save()
        roundedRect(ctx, coverX, coverY, coverW, coverH, radius)
        ctx.clip()

        ctx.fillStyle = '#fbf7ec'
        ctx.fillRect(coverX, coverY, coverW, coverH)
        const scale = Math.max(coverW / image.width, coverH / image.height) * zoom
        const drawW = image.width * scale
        const drawH = image.height * scale
        const dx = coverX + (coverW - drawW) / 2 + panX
        const dy = coverY + (coverH - drawH) / 2 + panY

        ctx.filter = `contrast(${contrast}%) saturate(${saturation}%) brightness(${brightness}%) hue-rotate(${hue}deg)`
        ctx.drawImage(image, dx, dy, drawW, drawH)
        ctx.filter = 'none'
        drawComicFinish(ctx, coverX, coverY, coverW, coverH, clarity, grain, texture)
        ctx.restore()
        drawBookCoverOverlay(ctx, coverX, coverY, coverW, coverH, radius)
        setRenderedComic(canvas.toDataURL('image/png'))
      }
      image.src = sourceImage
      return
    }

    roundedRect(ctx, coverX, coverY, coverW, coverH, radius)
    ctx.fillStyle = '#fbf7ec'
    ctx.fill()
    drawBookCoverOverlay(ctx, coverX, coverY, coverW, coverH, radius)
    setRenderedComic(canvas.toDataURL('image/png'))
  }, [brightness, clarity, contrast, grain, hue, panX, panY, saturation, sourceImage, texture, zoom])

  useEffect(() => {
    if (activeTab !== 'submit') return
    renderComic()
  }, [activeTab, renderComic])

  const loadFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setUploadError('Choose an image file for the comic cover.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        setUploadError('Could not read that image.')
        return
      }
      setSourceImage(result)
      setUploadError('')
      setActiveTab('submit')
    }
    reader.onerror = () => setUploadError('Could not read that image.')
    reader.readAsDataURL(file)
  }

  const connectWallet = async () => {
    setWallet((prev) => ({ ...prev, connecting: true, error: null }))
    try {
      setWallet(await connectUniSat())
      setSocialStatus('idle')
      return true
    } catch (error) {
      setWallet({ ...DEFAULT_WALLET, error: error instanceof Error ? error.message : 'Could not connect wallet.' })
      return false
    }
  }

  const disconnectWallet = () => {
    setWallet(DEFAULT_WALLET)
    setSocialIndex(null)
    setSocialStatus('idle')
    setSocialError('')
    setMintError('')
  }

  const submitMint = async () => {
    if (!renderedComic) return
    const nextError = validateAcmeMintForm(form) || assetAvailabilityError || validateAcmeWalletNetwork(wallet)
    if (nextError) {
      setMintError(nextError)
      return
    }

    setMintStatus('composing')
    setMintError('')
    setTxid('')
    setMintStep(null)
    setArweaveProgress(null)

    try {
      const result = await mintStampOnAcme({
        form: {
          ...form,
          assetName: normalizeAcmeAssetRef(form.assetName),
          collectionName: 'SATOSHICOMICS',
          tags: mergeComicTags(form.tags),
          description: form.description || 'Submitted to SatoshiComics on ACME mainnet.',
        },
        imageDataUrl: renderedComic,
        wallet,
        onProgress: (step) => {
          setMintStep(step)
          if (step === 'sign') setMintStatus('signing')
          if (step === 'broadcast') setMintStatus('broadcasting')
        },
        onArweaveProgress: setArweaveProgress,
      })
      setTxid(result)
      setMintStatus('success')
      setPendingStatus('idle')
    } catch (error) {
      setMintStatus('error')
      setMintError(error instanceof Error ? error.message : 'Mint failed.')
    }
  }

  const loadPending = useCallback(async () => {
    setPendingStatus('loading')
    setPendingError('')
    try {
      const assets = await fetchAcmeCollectionAssets('SATOSHICOMICS', COLLECTION_ASSET_LIMIT)
      setPendingAssets(assets)
      setPendingStatus('loaded')
    } catch (error) {
      setPendingError(error instanceof Error ? error.message : 'Could not load pending comics.')
      setPendingStatus('error')
    }
  }, [])

  const loadSocial = useCallback(async () => {
    setSocialStatus('loading')
    setSocialError('')
    try {
      const index = await readSocialIndex(wallet.address, wallet.network)
      setSocialIndex(index)
      setSocialStatus('loaded')
    } catch (error) {
      setSocialError(error instanceof Error ? error.message : 'Could not load likes.')
      setSocialStatus('error')
    }
  }, [wallet.address, wallet.network])

  const isAssetLiked = useCallback((asset: string) => likedAssets.has(asset), [likedAssets])

  const toggleAssetLike = async (asset: AcmeGalleryAsset) => {
    setSocialError('')
    setLikePendingAsset(asset.asset)
    try {
      let activeWallet = wallet
      if (!activeWallet.connected || !activeWallet.address || !activeWallet.publicKey) {
        activeWallet = await connectUniSat()
        setWallet(activeWallet)
      }
      if (!window.unisat) throw new Error('UniSat wallet is not available.')
      if (!activeWallet.address) throw new Error('Connect UniSat before liking comics.')

      const active = !isAssetLiked(asset.asset)
      const signedAt = new Date().toISOString()
      const unsignedAction = {
        address: activeWallet.address,
        publicKey: activeWallet.publicKey ?? undefined,
        network: activeWallet.network ?? 'mainnet',
        targetType: 'asset' as const,
        targetId: asset.asset,
        action: 'like' as const,
        active,
        signedAt,
      }
      const message = createSocialActionMessage(unsignedAction)
      const signature = await window.unisat.signMessage(message, 'ecdsa')
      await setSocialPreference({ ...unsignedAction, message, signature })
      const refreshedIndex = await readSocialIndex(activeWallet.address, activeWallet.network)
      setSocialIndex(refreshedIndex ?? applySocialLikeToIndex(socialIndex, asset.asset, active))
      setSocialStatus('loaded')
    } catch (error) {
      setSocialError(error instanceof Error ? error.message : 'Could not save like.')
      setSocialStatus('error')
    } finally {
      setLikePendingAsset(null)
    }
  }

  useEffect(() => {
    if ((activeTab !== 'pending' && activeTab !== 'portfolio') || pendingStatus !== 'idle') return
    if (activeTab === 'portfolio' && !wallet.connected) return
    const timeoutId = window.setTimeout(() => {
      void loadPending()
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [activeTab, loadPending, pendingStatus, wallet.connected])

  useEffect(() => {
    if ((activeTab !== 'pending' && activeTab !== 'portfolio') || socialStatus !== 'idle') return
    if (activeTab === 'portfolio' && !wallet.connected) return
    const timeoutId = window.setTimeout(() => {
      void loadSocial()
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [activeTab, loadSocial, socialStatus, wallet.connected])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      if (!normalizedAssetName) {
        setAssetCheckStatus('idle')
        setAssetCheckMessage('')
        return
      }

      if (!assetNameIsValid) {
        setAssetCheckStatus('invalid')
        setAssetCheckMessage('Asset name must be 3-16 uppercase letters and numbers, starting with a letter.')
        return
      }

      setAssetCheckStatus('checking')
      setAssetCheckMessage('Checking ACME asset name...')
      void checkAcmeAssetAvailability(normalizedAssetName)
        .then((result) => {
          setAssetCheckStatus(result.available ? 'available' : 'taken')
          setAssetCheckMessage(result.message)
        })
        .catch((error) => {
          setAssetCheckStatus('error')
          setAssetCheckMessage(error instanceof Error ? error.message : 'Could not check ACME asset name.')
        })
    }, 420)

    return () => window.clearTimeout(timeoutId)
  }, [assetNameIsValid, normalizedAssetName])

  const editorControls = (
    <div className="editor-panel">
      <h3 className="editor-panel-title">Fine-tune your artwork</h3>
      {[
        { label: 'Zoom', value: zoom, set: setZoom, min: 0.7, max: 2.2, step: 0.01 },
        { label: 'Pan X', value: panX, set: setPanX, min: -260, max: 260 },
        { label: 'Pan Y', value: panY, set: setPanY, min: -320, max: 320 },
        { label: 'Contrast', value: contrast, set: setContrast, min: 80, max: 150 },
        { label: 'Brightness', value: brightness, set: setBrightness, min: 72, max: 132 },
        { label: 'Saturation', value: saturation, set: setSaturation, min: 0, max: 180 },
        { label: 'Clarity', value: clarity, set: setClarity, min: 0, max: 44 },
        { label: 'Hue', value: hue, set: setHue, min: -45, max: 45 },
        { label: 'Grain', value: grain, set: setGrain, min: 0, max: 32 },
        { label: 'Texture', value: texture, set: setTexture, min: 0, max: 34 },
      ].map((control) => (
        <Field key={control.label} className="editor-slider-field">
          <div className="editor-slider-label"><FieldLabel>{control.label}</FieldLabel><output aria-live="off">{control.value}</output></div>
          <Slider aria-label={control.label} value={[control.value]} min={control.min} max={control.max} step={control.step ?? 1} onValueChange={([value]) => control.set(value)} />
        </Field>
      ))}
      <div className="editor-actions">
        <Button type="button" onClick={() => {
          setZoom(1)
          setPanX(0)
          setPanY(0)
          setContrast(108)
          setBrightness(102)
          setSaturation(116)
          setClarity(14)
          setHue(0)
          setGrain(8)
          setTexture(10)
        }}>Reset</Button>
      </div>
    </div>
  )

  const CollectionGallery = galleryLayout === 'reel' ? PerspectiveReel : DiagonalGallery

  return (
    <main className="app-shell modern-app timeline-app">
      <div className="comic-page-shell">
        <header className="site-topbar">
          <button className="topbar-brand" type="button" onClick={() => setActiveTab('pending')} aria-label="Go to Collection homepage">
            <span className="modern-monogram">SC</span><span className="modern-wordmark">Satoshi<br />Comics<span>.</span></span>
          </button>
          <nav className="tabbar" aria-label="SatoshiComics workflow">
            {TABS.map((tab) => (
              <button key={tab.id} className={activeTab === tab.id ? 'active' : ''} type="button" onClick={() => setActiveTab(tab.id)}>
                <span className="nav-icon" aria-hidden="true">{tab.id === 'pending' ? '▦' : '+'}</span>{tab.label}
              </button>
            ))}
          </nav>
          <div className="wallet-actions">
            <button
              className={activeTab === 'portfolio' ? 'portfolio-button active' : 'portfolio-button'}
              type="button"
              onClick={() => setActiveTab('portfolio')}
              disabled={wallet.connecting}
            >
              <span className="nav-icon" aria-hidden="true">◇</span>My portfolio
            </button>
            <button className={wallet.connected ? 'wallet-button connected' : 'wallet-button'} type="button" onClick={wallet.connected ? disconnectWallet : connectWallet} disabled={wallet.connecting}>
              {wallet.connected ? (
                <>
                  <span className="wallet-address-label">{formatAddress(wallet.address)}</span>
                  <span className="wallet-disconnect-label">Disconnect</span>
                </>
              ) : wallet.connecting ? 'Connecting...' : 'Connect Wallet'}
            </button>
          </div>
          <div className="sidebar-note"><p><i /> Built on Bitcoin<br /><a href="https://acme.pics" target="_blank" rel="noreferrer">Powered by ACME ↗</a></p><p>Independent art.<br />Unstoppable stories.</p><small>© {new Date().getFullYear()} Satoshi Comics</small></div>
        </header>

        <div className="content-panel">
      {activeTab === 'submit' && (
        <section className="page submit-page">
          <div className="mint-form">
            <h2 className="studio-section-title">01 / Issue details</h2>
            <FieldGroup>
              <Field data-invalid={['invalid', 'taken', 'error'].includes(assetCheckStatus)}>
                <FieldLabel htmlFor="comic-asset-name">ACME asset name</FieldLabel>
                <Input id="comic-asset-name" value={form.assetName} placeholder="SATCOMIC001" aria-describedby="asset-name-help asset-name-status" aria-invalid={['invalid', 'taken', 'error'].includes(assetCheckStatus)} onChange={(event) => {
                  setForm((prev) => ({ ...prev, assetName: event.target.value.toUpperCase() }))
                  setAssetCheckStatus('idle')
                  setAssetCheckMessage('')
                }} />
                <FieldDescription id="asset-name-help">3–16 uppercase letters or numbers, starting with a letter.</FieldDescription>
                {['invalid', 'taken', 'error'].includes(assetCheckStatus)
                  ? <FieldError id="asset-name-status">{assetCheckMessage}</FieldError>
                  : <FieldDescription id="asset-name-status" role="status">{assetCheckMessage}</FieldDescription>}
              </Field>
              <Field>
                <FieldLabel htmlFor="comic-creator">Creator</FieldLabel>
                <Input id="comic-creator" value={form.artistName} placeholder="OPTIONAL" onChange={(event) => setForm((prev) => ({ ...prev, artistName: event.target.value.toUpperCase() }))} />
                <FieldDescription>Your ACME creator profile asset, if you have one.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="comic-collection">Collection</FieldLabel>
                <Input id="comic-collection" value={form.collectionName} readOnly />
              </Field>
              <Field>
                <FieldLabel htmlFor="comic-description">Description</FieldLabel>
                <Textarea id="comic-description" value={form.description} onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))} />
              </Field>
              <div className="form-row">
                <Field>
                  <FieldLabel htmlFor="comic-storage">Storage</FieldLabel>
                  <NativeSelect id="comic-storage" value={form.storageType} onChange={(event) => setForm((prev) => ({ ...prev, storageType: event.target.value as AcmeStorageType }))}>
                    {STORAGE_OPTIONS.map((option) => <NativeSelectOption key={option.key} value={option.key}>{option.label}</NativeSelectOption>)}
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel htmlFor="comic-fee">Fee rate · sat/vB</FieldLabel>
                  <Input id="comic-fee" type="number" min={1} max={500} value={form.feeRate} onChange={(event) => setForm((prev) => ({ ...prev, feeRate: clamp(Number(event.target.value), 1, 500) }))} />
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="comic-tags">Tags</FieldLabel>
                <Input id="comic-tags" value={form.tags} onChange={(event) => setForm((prev) => ({ ...prev, tags: event.target.value }))} />
              </Field>
              <Field orientation="horizontal" className="artwork-checkbox-field">
                <Checkbox id="original-artwork" checked={originalArtworkSelected} onCheckedChange={(checked) => setForm((prev) => ({ ...prev, tags: setTagEnabled(prev.tags, ORIGINAL_ARTWORK_TAG, checked === true) }))} />
                <FieldLabel htmlFor="original-artwork">Original artwork</FieldLabel>
              </Field>
            </FieldGroup>
            <div className="mint-actions">
              <Button type="button" onClick={wallet.connected ? disconnectWallet : connectWallet} disabled={wallet.connecting}>{wallet.connected ? 'Disconnect Wallet' : 'Connect Wallet'}</Button>
              <Button type="button" className="primary" onClick={submitMint} disabled={!renderedComic || Boolean(validationError || assetAvailabilityError || walletError) || mintStatus === 'composing' || mintStatus === 'signing' || mintStatus === 'broadcasting'}>
                {mintStatus === 'idle' || mintStatus === 'error' ? 'Mint on ACME' : mintStatus === 'success' ? 'Minted' : 'Minting...'}
              </Button>
            </div>
            {(validationError || assetAvailabilityError || walletError || mintError) && <p className="error-text">{mintError || validationError || assetAvailabilityError || walletError}</p>}
            {mintStep && <div className="mint-progress"><p role="status">{PROGRESS_LABELS[mintStep]}{arweaveProgress ? `: ${arweaveProgress.percent}%` : ''}</p>{mintStep === 'arweave' && arweaveProgress && <Progress value={arweaveProgress.percent} aria-label="Artwork upload progress" />}</div>}
            {txid && <p className="status-text">Broadcast transaction: {txid}</p>}
          </div>
          <div className="submit-preview submit-workspace">
            <h2 className="studio-section-title">02 / Cover studio</h2>
            <div className="studio-edit-layout">
            <div className="studio-cover-column">
            <div
              className="submit-preview-stage"
              role="button"
              tabIndex={sourceImage && renderedComic ? 0 : -1}
              aria-label="Open edited comic preview"
              onClick={() => {
                if (sourceImage && renderedComic) setSelectedEditedComic(renderedComic)
              }}
              onKeyDown={(event) => {
                if (!sourceImage || !renderedComic) return
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setSelectedEditedComic(renderedComic)
                }
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault()
                const file = event.dataTransfer.files[0]
                if (file) loadFile(file)
              }}
            >
              <canvas ref={activeTab === 'submit' ? canvasRef : null} className="comic-canvas" aria-label="Comic editor preview" />
              {!sourceImage && (
                <div className="upload-drop">
                  <input ref={fileInputRef} type="file" accept="image/*" onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) loadFile(file)
                    event.currentTarget.value = ''
                  }} />
                  <Button type="button" onClick={() => fileInputRef.current?.click()}>Choose Image</Button>
                  {uploadError && <span className="error-text">{uploadError}</span>}
                </div>
              )}
              {sourceImage && uploadError && <span className="preview-error error-text">{uploadError}</span>}
            </div>
            <div className="submit-preview-meta">
              <span>{formatBytes(renderedBytes)}</span>
            </div>
            </div>
            {editorControls}
            </div>
          </div>
        </section>
      )}

      {activeTab === 'pending' && (
        <section className="page pending-page">
          <div className="section-head collection-toolbar" id="collection-controls">
            <ToggleGroup type="single" value={collectionView} onValueChange={(value) => { if (value) { setCollectionView(value as typeof collectionView); if (value === 'popular') setSubmissionSort('likes'); if (value === 'new') setSubmissionSort('newest') } }} className="collection-filters" aria-label="Filter collection">
              {([{ id: 'all', label: 'All comics' }, { id: 'popular', label: 'Popular' }, { id: 'new', label: 'New releases' }] as const).map((filter) => <ToggleGroupItem type="button" key={filter.id} value={filter.id} className={collectionView === filter.id ? 'selected' : ''}>{filter.label}</ToggleGroupItem>)}
            </ToggleGroup>
            <div className="submission-actions">
              <ToggleGroup type="single" value={galleryLayout} onValueChange={(value) => { if (value === 'diagonal' || value === 'reel') setGalleryLayout(value) }} className="collection-layout-toggle" aria-label="Gallery layout">
                <ToggleGroupItem value="diagonal">Diagonal</ToggleGroupItem>
                <ToggleGroupItem value="reel">Reel</ToggleGroupItem>
              </ToggleGroup>
              <label className="submission-search">
                <span>Search</span>
                <input
                  value={submissionSearch}
                  placeholder="Search comics or creators"
                  onChange={(event) => { setSubmissionSearch(event.target.value) }}
                />
              </label>
              <label className="submission-sort">
                <span>Sort</span>
                <select value={submissionSort} onChange={(event) => { setSubmissionSort(event.target.value as SubmissionSort) }}>
                  {SUBMISSION_SORT_OPTIONS.map((option) => (
                    <option key={option.key} value={option.key}>{option.label}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => {
                  void loadPending()
                  void loadSocial()
                }}
                disabled={pendingStatus === 'loading' || socialStatus === 'loading'}
              >
                {pendingStatus === 'loading' || socialStatus === 'loading' ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
          </div>
          {pendingError && <p className="error-text">{pendingError}</p>}
          {socialError && <p className="error-text">{socialError}</p>}
          {socialStatus === 'loading' && <p className="status-text">Loading likes...</p>}
          <CollectionGallery key={`${submissionSearch}:${submissionSort}:${collectionView}`} assets={visiblePendingAssets} loading={pendingStatus === 'loading'} coverFor={coverFor} creatorFor={getAssetCreator} onOpen={setSelectedComic} renderLike={(asset) => <LikeButton active={isAssetLiked(asset.asset)} count={getAssetLikeCount(asset.asset)} pending={likePendingAsset === asset.asset} onClick={() => void toggleAssetLike(asset)} />} />
          {pendingStatus === 'loaded' && submittedAssets.length === 0 && <p className="empty-state">No SatoshiComics found in the collection yet.</p>}
          {pendingStatus === 'loaded' && submittedAssets.length > 0 && visiblePendingAssets.length === 0 && <p className="empty-state">No comics match that search.</p>}
        </section>
      )}

      {activeTab === 'portfolio' && (
        <section className="page portfolio-page">
          <div className="section-head portfolio-toolbar">
            <div className="submission-actions">
              <button
                type="button"
                onClick={() => {
                  void loadPending()
                  void loadSocial()
                }}
                disabled={!wallet.connected || pendingStatus === 'loading' || socialStatus === 'loading'}
              >
                {pendingStatus === 'loading' || socialStatus === 'loading' ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
          </div>
          {wallet.error && <p className="error-text">{wallet.error}</p>}
          {pendingError && <p className="error-text">{pendingError}</p>}
          {socialError && <p className="error-text">{socialError}</p>}
          {wallet.connected && (
            <div className="portfolio-stats" aria-label="Portfolio summary">
              <div>
                <span>Total comics</span>
                <strong>{portfolioAssets.length}</strong>
              </div>
              <div>
                <span>Pending</span>
                <strong>{portfolioStats.pending}</strong>
              </div>
              <div>
                <span>Approved</span>
                <strong>{portfolioStats.approved}</strong>
              </div>
              <div>
                <span>Total likes</span>
                <strong>{portfolioStats.likes}</strong>
              </div>
            </div>
          )}
          {!wallet.connected && <div className="portfolio-empty">
            <span className="portfolio-empty-mark" aria-hidden="true">↗</span>
            <p className="eyebrow">Your personal archive</p>
            <h2>Your collection starts here.</h2>
            <p>Connect your UniSat wallet to see the comics linked to you.</p>
            <Button type="button" onClick={connectWallet} disabled={wallet.connecting}>{wallet.connecting ? 'Connecting…' : 'Connect wallet ↗'}</Button>
          </div>}
          {wallet.connected && pendingStatus === 'loading' && <p className="status-text">Loading portfolio...</p>}
          {wallet.connected && pendingStatus === 'loaded' && portfolioAssets.length === 0 && (
            <p className="empty-state">No wallet-matched submissions found yet. Portfolio matching uses owner/source/destination metadata from ACME when available.</p>
          )}
          {wallet.connected && portfolioAssets.length > 0 && (
            <div className="portfolio-table-wrap">
              <table className="portfolio-table">
                <thead>
                  <tr>
                    <th scope="col">Comic</th>
                    <th scope="col">Asset</th>
                    <th scope="col">Status</th>
                    <th scope="col">Creator</th>
                    <th scope="col">Submitted</th>
                    <th scope="col">Block</th>
                    <th scope="col">Likes</th>
                    <th scope="col">Create Open Edition</th>
                    <th scope="col">Locked Asset</th>
                    <th scope="col">Original</th>
                  </tr>
                </thead>
                <tbody>
                  {portfolioAssets.map((asset) => (
                    <tr key={`${asset.asset}-portfolio`}>
                      <td>
                        <button className="portfolio-table-cover" type="button" onClick={() => setSelectedComic(asset)} aria-label={`View ${asset.displayName}`}>
                          <ComicBook
                            src={coverFor(asset)}
                            alt={asset.displayName}
                            onError={(event) => {
                              if (event.currentTarget.dataset.fallback !== 'true') {
                                event.currentTarget.dataset.fallback = 'true'
                                event.currentTarget.src = asset.thumbnailUrl
                              }
                            }}
                          />
                        </button>
                      </td>
                      <td>
                        <strong>{asset.displayName}</strong>
                        <span>{asset.asset}</span>
                      </td>
                      <td>
                        <span className={asset.collectionRelationshipStatus === 'synapsed' ? 'status-pill approved' : 'status-pill pending'}>{formatStatusLabel(asset)}</span>
                      </td>
                      <td>{getAssetCreator(asset)}</td>
                      <td>{formatAssetDate(asset.revealTimestamp)}</td>
                      <td>{asset.revealBlock ?? 'Pending'}</td>
                      <td>{getAssetLikeCount(asset.asset)}</td>
                      <td><button type="button" disabled>Create Open Edition</button></td>
                      <td><button type="button" disabled>Locked Asset</button></td>
                      <td><a href={asset.artUrl} target="_blank" rel="noreferrer">Open</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
        </div>
      </div>

      {selectedEditedComic && <ArtworkDialog finished title={normalizeAcmeAssetRef(form.assetName) || 'Edited comic preview'} description="Preview your artwork before minting. Close to continue editing." image={selectedEditedComic} onClose={() => setSelectedEditedComic(null)} />}
      {selectedComic && (
        <ArtworkDialog title={selectedComic.displayName} description={`By ${getAssetCreator(selectedComic)} · SatoshiComics collection`} image={coverFor(selectedComic)} fallbackImage={selectedComic.thumbnailUrl} onClose={() => setSelectedComic(null)}>
          <LikeButton active={isAssetLiked(selectedComic.asset)} count={getAssetLikeCount(selectedComic.asset)} pending={likePendingAsset === selectedComic.asset} onClick={() => void toggleAssetLike(selectedComic)} />
          <Button asChild variant="outline" size="sm"><a href={selectedComic.artUrl} target="_blank" rel="noreferrer">Open original ↗</a></Button>
        </ArtworkDialog>
      )}
    </main>
  )
}

const mergeComicTags = (tags: string) => {
  const values = parseTags(tags)
  for (const tag of ['SatoshiComics', 'comic', 'comic-book']) {
    if (!values.some((value) => value.toLowerCase() === tag.toLowerCase())) values.push(tag)
  }
  return values.join(', ')
}

const parseTags = (tags: string) => tags.split(',').map((tag) => tag.trim()).filter(Boolean)

const hasTag = (tags: string, targetTag: string) =>
  parseTags(tags).some((tag) => tag.toLowerCase() === targetTag.toLowerCase())

const setTagEnabled = (tags: string, targetTag: string, enabled: boolean) => {
  const values = parseTags(tags)
  const filteredValues = values.filter((tag) => tag.toLowerCase() !== targetTag.toLowerCase())
  if (enabled) filteredValues.push(targetTag)
  return filteredValues.join(', ')
}

const formatSocialCount = (count: number) =>
  Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(count)

const formatAssetDate = (timestamp: number | null) => {
  if (!timestamp) return 'Pending'
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(timestamp * 1000))
}

function LikeButton({
  active,
  count,
  pending,
  onClick,
}: {
  active: boolean
  count: number
  pending: boolean
  onClick: () => void
}) {
  return (
    <button
      className={`like-button${active ? ' active' : ''}`}
      type="button"
      onClick={onClick}
      disabled={pending}
      title={active ? 'Unlike' : 'Like'}
      aria-pressed={active}
    >
      <span className="like-icon" aria-hidden="true">{pending ? '...' : active ? '♥' : '♡'}</span>
      <span className="like-count">{formatSocialCount(count)}</span>
    </button>
  )
}

const roundedRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) => {
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + width - radius, y)
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius)
  ctx.lineTo(x + width, y + height - radius)
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height)
  ctx.lineTo(x + radius, y + height)
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius)
  ctx.lineTo(x, y + radius)
  ctx.quadraticCurveTo(x, y, x + radius, y)
  ctx.closePath()
}

const drawComicFinish = (
  ctx: CanvasRenderingContext2D,
  coverX: number,
  coverY: number,
  coverW: number,
  coverH: number,
  clarity: number,
  grain: number,
  texture: number,
) => {
  if (clarity > 0) {
    ctx.globalCompositeOperation = 'overlay'
    ctx.globalAlpha = clarity / 180
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(coverX, coverY, coverW, coverH)
    ctx.globalCompositeOperation = 'multiply'
    ctx.globalAlpha = clarity / 240
    ctx.fillStyle = '#111111'
    ctx.fillRect(coverX, coverY, coverW, coverH)
  }

  if (texture > 0) {
    ctx.globalCompositeOperation = 'multiply'
    ctx.globalAlpha = texture / 120
    ctx.strokeStyle = '#1d1b17'
    ctx.lineWidth = 1
    for (let x = coverX + 10; x < coverX + coverW; x += 18) {
      ctx.beginPath()
      ctx.moveTo(x, coverY)
      ctx.lineTo(x - 20, coverY + coverH)
      ctx.stroke()
    }
    ctx.globalCompositeOperation = 'screen'
    ctx.globalAlpha = texture / 180
    ctx.strokeStyle = '#fff6df'
    for (let y = coverY + 8; y < coverY + coverH; y += 14) {
      ctx.beginPath()
      ctx.moveTo(coverX, y)
      ctx.lineTo(coverX + coverW, y + 10)
      ctx.stroke()
    }
  }

  if (grain > 0) {
    ctx.globalCompositeOperation = 'overlay'
    ctx.globalAlpha = grain / 100
    for (let i = 0; i < 1800; i += 1) {
      const x = coverX + ((i * 47) % coverW)
      const y = coverY + ((i * 83) % coverH)
      const tone = (i * 29) % 255
      ctx.fillStyle = `rgb(${tone}, ${tone}, ${tone})`
      ctx.fillRect(x, y, 1.4, 1.4)
    }
  }

  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
}

const drawBookCoverOverlay = (
  ctx: CanvasRenderingContext2D,
  coverX: number,
  coverY: number,
  coverW: number,
  coverH: number,
  radius: number,
) => {
  ctx.save()
  roundedRect(ctx, coverX, coverY, coverW, coverH, radius)
  ctx.clip()

  const spineX = coverX + 32
  const spineGradient = ctx.createLinearGradient(coverX, 0, coverX + 88, 0)
  spineGradient.addColorStop(0, 'rgba(0, 0, 0, 0.34)')
  spineGradient.addColorStop(0.38, 'rgba(255, 255, 255, 0.16)')
  spineGradient.addColorStop(0.52, 'rgba(0, 0, 0, 0.18)')
  spineGradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
  ctx.fillStyle = spineGradient
  ctx.fillRect(coverX, coverY, 92, coverH)

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.44)'
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.moveTo(spineX, coverY + 18)
  ctx.lineTo(spineX, coverY + coverH - 18)
  ctx.stroke()

  ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(spineX + 12, coverY + 22)
  ctx.lineTo(spineX + 12, coverY + coverH - 22)
  ctx.stroke()

  ctx.restore()

  ctx.save()
  roundedRect(ctx, coverX, coverY, coverW, coverH, radius)
  ctx.strokeStyle = 'rgba(10, 11, 15, 0.56)'
  ctx.lineWidth = 8
  ctx.stroke()
  ctx.restore()
}

export default App
