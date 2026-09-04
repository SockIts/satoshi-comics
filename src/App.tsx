import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import acmeLogo from '../ACME-colorlogo.svg'
import satoshiComicsLogo from '../SatoshiConmics Transparent.png'
import bitcoinPizzaCover from '../Assets/BitcoinPizza.jpg'
import diamondHandsCover from '../Assets/DiamondHands.jpg'
import dogeKnightCover from '../Assets/DogeKnight.jpg'
import hodlManCover from '../Assets/HodlMan.jpg'
import pepeNoirCover from '../Assets/PepeNoirS01.png'
import toTheMoonCover from '../Assets/ToTheMoon.jpg'
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

type Tab = 'rules' | 'upload' | 'submit' | 'pending' | 'approved' | 'portfolio'
type SubmissionSort = 'newest' | 'oldest' | 'name' | 'creator' | 'likes'
type AssetCheckStatus = 'idle' | 'invalid' | 'checking' | 'available' | 'taken' | 'error'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'rules', label: 'Rules' },
  { id: 'upload', label: 'Upload' },
  { id: 'submit', label: 'Submit' },
  { id: 'pending', label: 'Submission' },
  { id: 'approved', label: 'Approved' },
]

const RULE_EXAMPLES = [
  { src: bitcoinPizzaCover, alt: 'Bitcoin Pizza comic cover example' },
  { src: dogeKnightCover, alt: 'Doge Knight comic cover example' },
  { src: hodlManCover, alt: 'Hodl Man comic cover example' },
  { src: pepeNoirCover, alt: 'Pepe Noir comic cover example' },
  { src: toTheMoonCover, alt: 'To The Moon comic cover example' },
  { src: diamondHandsCover, alt: 'Diamond Hands comic cover example' },
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

const RACK_ROW_COUNT = 5
const RACK_COMICS_PER_ROW = 5
const RACK_PAGE_SIZE = RACK_ROW_COUNT * RACK_COMICS_PER_ROW

const groupAssetRows = (assets: AcmeGalleryAsset[]) => {
  const rows: AcmeGalleryAsset[][] = []
  const rackAssets = assets.slice(0, RACK_PAGE_SIZE)
  for (let rowIndex = 0; rowIndex < RACK_ROW_COUNT; rowIndex += 1) {
    const startIndex = rowIndex * RACK_COMICS_PER_ROW
    rows.push(rackAssets.slice(startIndex, startIndex + RACK_COMICS_PER_ROW))
  }
  return rows
}

const getApprovalOrderValue = (asset: AcmeGalleryAsset) =>
  asset.collectionSynapseFormedBlock ?? asset.collectionRelationshipCreatedAt ?? asset.collectionRelationshipId ?? asset.revealTimestamp ?? asset.revealBlock ?? 0

const formatGradingNumber = (index: number) => `#${String(index + 1).padStart(3, '0')}`

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
  const [activeTab, setActiveTab] = useState<Tab>('rules')
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
  const [selectedGradedComic, setSelectedGradedComic] = useState<{ asset: AcmeGalleryAsset; gradingNumber: string } | null>(null)
  const [socialIndex, setSocialIndex] = useState<SocialIndex | null>(null)
  const [socialStatus, setSocialStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle')
  const [socialError, setSocialError] = useState('')
  const [likePendingAsset, setLikePendingAsset] = useState<string | null>(null)
  const [submissionSearch, setSubmissionSearch] = useState('')
  const [submissionSort, setSubmissionSort] = useState<SubmissionSort>('newest')
  const [submissionPage, setSubmissionPage] = useState(0)
  const [approvedSearch, setApprovedSearch] = useState('')
  const [approvedSort, setApprovedSort] = useState<SubmissionSort>('oldest')
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
  const approvedAssets = useMemo(
    () =>
      pendingAssets
        .filter((asset) => asset.collectionRelationshipStatus === 'synapsed')
        .sort((a, b) => {
          const approvalDelta = getApprovalOrderValue(a) - getApprovalOrderValue(b)
          if (approvalDelta !== 0) return approvalDelta
          return a.asset.localeCompare(b.asset)
        }),
    [pendingAssets],
  )
  const approvedGradingNumbers = useMemo(
    () => new Map(approvedAssets.map((asset, index) => [asset.asset, formatGradingNumber(index)])),
    [approvedAssets],
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
      if (submissionSort === 'likes') return getAssetLikeCount(b.asset) - getAssetLikeCount(a.asset) || a.displayName.localeCompare(b.displayName)

      const aTime = a.revealTimestamp ?? a.revealBlock ?? 0
      const bTime = b.revealTimestamp ?? b.revealBlock ?? 0
      return submissionSort === 'oldest'
        ? aTime - bTime || a.displayName.localeCompare(b.displayName)
        : bTime - aTime || a.displayName.localeCompare(b.displayName)
    })
  }, [getAssetCreator, getAssetLikeCount, submittedAssets, submissionSearch, submissionSort])
  const submissionPageCount = Math.max(1, Math.ceil(visiblePendingAssets.length / RACK_PAGE_SIZE))
  const pagedPendingAssets = useMemo(() => {
    const startIndex = submissionPage * RACK_PAGE_SIZE
    return visiblePendingAssets.slice(startIndex, startIndex + RACK_PAGE_SIZE)
  }, [submissionPage, visiblePendingAssets])
  const pendingAssetRows = useMemo(() => groupAssetRows(pagedPendingAssets), [pagedPendingAssets])
  const visibleApprovedAssets = useMemo(() => {
    const query = approvedSearch.trim().toLowerCase()
    const filtered = approvedAssets.filter((asset) => {
      if (!query) return true
      return (
        asset.asset.toLowerCase().includes(query) ||
        asset.displayName.toLowerCase().includes(query) ||
        asset.description.toLowerCase().includes(query) ||
        getAssetCreator(asset).toLowerCase().includes(query)
      )
    })

    return filtered.sort((a, b) => {
      if (approvedSort === 'name') return a.displayName.localeCompare(b.displayName)
      if (approvedSort === 'creator') return getAssetCreator(a).localeCompare(getAssetCreator(b)) || a.displayName.localeCompare(b.displayName)
      if (approvedSort === 'likes') return getAssetLikeCount(b.asset) - getAssetLikeCount(a.asset) || a.displayName.localeCompare(b.displayName)

      const aOrder = getApprovalOrderValue(a)
      const bOrder = getApprovalOrderValue(b)
      return approvedSort === 'newest'
        ? bOrder - aOrder || a.displayName.localeCompare(b.displayName)
        : aOrder - bOrder || a.displayName.localeCompare(b.displayName)
    })
  }, [approvedAssets, approvedSearch, approvedSort, getAssetCreator, getAssetLikeCount])
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

    const coverW = 1048
    const coverH = 1564
    canvas.width = coverW
    canvas.height = coverH

    const coverX = 0
    const coverY = 0
    const radius = 4
    ctx.clearRect(0, 0, coverW, coverH)

    if (sourceImage) {
      const image = new Image()
      image.onload = () => {
        ctx.save()
        roundedRect(ctx, coverX, coverY, coverW, coverH, radius)
        ctx.clip()

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
    if (activeTab !== 'upload') return
    renderComic()
  }, [activeTab, renderComic])

  useEffect(() => {
    setSubmissionPage(0)
  }, [submissionSearch, submissionSort])

  useEffect(() => {
    if (submissionPage < submissionPageCount) return
    setSubmissionPage(submissionPageCount - 1)
  }, [submissionPage, submissionPageCount])

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
      setActiveTab('upload')
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
    if ((activeTab !== 'pending' && activeTab !== 'approved' && activeTab !== 'portfolio') || pendingStatus !== 'idle') return
    if (activeTab === 'portfolio' && !wallet.connected) return
    const timeoutId = window.setTimeout(() => {
      void loadPending()
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [activeTab, loadPending, pendingStatus, wallet.connected])

  useEffect(() => {
    if ((activeTab !== 'pending' && activeTab !== 'approved' && activeTab !== 'portfolio') || socialStatus !== 'idle') return
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

  useEffect(() => {
    if (!selectedComic && !selectedGradedComic) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedComic(null)
        setSelectedGradedComic(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedComic, selectedGradedComic])

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="header-cover-strip" aria-hidden="true">
          {RULE_EXAMPLES.map((cover) => (
            <img key={cover.alt} src={cover.src} alt="" />
          ))}
        </div>
        <div className="header-brand">
          <img className="site-logo" src={satoshiComicsLogo} alt="SatoshiComics" />
        </div>
        <div className="wallet-actions">
          <button
            className={activeTab === 'portfolio' ? 'portfolio-button active' : 'portfolio-button'}
            type="button"
            onClick={() => {
              if (!wallet.connected) {
                void connectWallet().then((connected) => {
                  if (connected) setActiveTab('portfolio')
                })
                return
              }
              setActiveTab('portfolio')
            }}
            disabled={wallet.connecting}
          >
            My Portfolio
          </button>
          <button className="wallet-button" type="button" onClick={connectWallet} disabled={wallet.connecting}>
            {wallet.connected ? formatAddress(wallet.address) : wallet.connecting ? 'Connecting...' : 'Connect Wallet'}
          </button>
        </div>
      </header>

      <nav className="tabbar" aria-label="SatoshiComics workflow">
        {TABS.map((tab) => (
          <button key={tab.id} className={activeTab === tab.id ? 'active' : ''} type="button" onClick={() => setActiveTab(tab.id)}>
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === 'rules' && (
        <section className="page rules-page">
          <a
            className="rules-hero"
            href="https://acme.pics/collection/SATOSHICOMICS"
            target="_blank"
            rel="noreferrer"
            aria-label="Open SatoshiComics collection on ACME"
          >
            <div className="rules-hero-strip" aria-hidden="true">
              {RULE_EXAMPLES.map((example) => (
                <img key={`hero-${example.src}`} src={example.src} alt="" />
              ))}
            </div>
            <div className="rules-hero-copy">
              <span>SatoshiComics</span>
              <strong>Cover submission guide</strong>
            </div>
          </a>
          <div className="rules-copy">
            <h2>Submission Rules</h2>
            <ol>
              <li>Only submitted artwork or work you have permission to mint.</li>
              <li>The rendered upload must look like a comic cover and include the SatoshiComics wrapper.</li>
              <li>Use a unique ACME asset name: 3-16 uppercase letters or numbers, starting with a letter.</li>
              <li>Keep images safe for a public gallery. No hateful, stolen, or deceptive submissions.</li>
              <li>Mint on ACME mainnet with the `SATOSHICOMICS` collection and `SatoshiComics` tag. If you want to add creator information, create a profile on ACME first. Once a profile is created, you can use it in the Creator section. Profiles only need to be created once.</li>
              <li>Once approved, Asset will be shown in the Approved tab in the order that get approved.</li>
              <li>All submissions are Free atm.</li>
              <li>Marketplace, trading, auction, offers are coming soon.</li>
            </ol>
            <div className="rules-notes" aria-label="Submission tips">
              <section>
                <h3>Cover Checklist</h3>
                <p>Use a vertical cover crop, bold readable title art, and enough contrast for the artwork to stand out at bookshelf size.</p>
              </section>
              <section>
                <h3>Mint Details</h3>
                <p>Choose a short asset name, keep the collection locked to SATOSHICOMICS, and leave the default tags unless the comic needs extra context.</p>
              </section>
              <section>
                <h3>Gallery Fit</h3>
                <p>Submissions should feel like finished comic covers: no raw screenshots, blank borders, placeholder text, or unfinished mockups.</p>
              </section>
            </div>
          </div>
          <div className="rules-examples" aria-label="SatoshiComics cover examples">
            {RULE_EXAMPLES.map((example) => (
              <img key={example.src} src={example.src} alt={example.alt} />
            ))}
          </div>
        </section>
      )}

      {activeTab === 'upload' && (
        <section className="page upload-page">
          <div className="studio-layout">
            <div
              className="comic-preview-card large"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault()
                const file = event.dataTransfer.files[0]
                if (file) loadFile(file)
              }}
            >
              <canvas ref={activeTab === 'upload' ? canvasRef : null} className="comic-canvas" aria-label="Comic editor preview" />
              {!sourceImage && (
                <div className="upload-drop">
                  <input ref={fileInputRef} type="file" accept="image/*" onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) loadFile(file)
                    event.currentTarget.value = ''
                  }} />
                  <button type="button" onClick={() => fileInputRef.current?.click()}>Choose Image</button>
                  {uploadError && <span className="error-text">{uploadError}</span>}
                </div>
              )}
              {sourceImage && uploadError && <span className="preview-error error-text">{uploadError}</span>}
            </div>
            <div className="editor-panel">
              <label>
                Zoom
                <input type="range" min="0.7" max="2.2" step="0.01" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
              </label>
              <label>
                Pan X
                <input type="range" min="-260" max="260" value={panX} onChange={(event) => setPanX(Number(event.target.value))} />
              </label>
              <label>
                Pan Y
                <input type="range" min="-320" max="320" value={panY} onChange={(event) => setPanY(Number(event.target.value))} />
              </label>
              <label>
                Contrast
                <input type="range" min="80" max="150" value={contrast} onChange={(event) => setContrast(Number(event.target.value))} />
              </label>
              <label>
                Brightness
                <input type="range" min="72" max="132" value={brightness} onChange={(event) => setBrightness(Number(event.target.value))} />
              </label>
              <label>
                Saturation
                <input type="range" min="0" max="180" value={saturation} onChange={(event) => setSaturation(Number(event.target.value))} />
              </label>
              <label>
                Clarity
                <input type="range" min="0" max="44" value={clarity} onChange={(event) => setClarity(Number(event.target.value))} />
              </label>
              <label>
                Hue
                <input type="range" min="-45" max="45" value={hue} onChange={(event) => setHue(Number(event.target.value))} />
              </label>
              <label>
                Grain
                <input type="range" min="0" max="32" value={grain} onChange={(event) => setGrain(Number(event.target.value))} />
              </label>
              <label>
                Texture
                <input type="range" min="0" max="34" value={texture} onChange={(event) => setTexture(Number(event.target.value))} />
              </label>
              <div className="editor-actions">
                <button type="button" onClick={() => {
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
                }}>Reset</button>
                <button type="button" className="primary" onClick={() => setActiveTab('submit')}>Use for Submit</button>
              </div>
            </div>
          </div>
        </section>
      )}

      {activeTab === 'submit' && (
        <section className="page submit-page">
          <div className="mint-form">
            <h2>Submit Comic</h2>
            <label>
              ACME asset name
              <input
                value={form.assetName}
                placeholder="SATCOMIC001"
                onChange={(event) => {
                  setForm((prev) => ({ ...prev, assetName: event.target.value.toUpperCase() }))
                  setAssetCheckStatus('idle')
                  setAssetCheckMessage('')
                }}
              />
              {assetCheckMessage && (
                <span className={`asset-check-text ${assetCheckStatus}`}>{assetCheckMessage}</span>
              )}
            </label>
            <label>
              Creator
              <input value={form.artistName} placeholder="OPTIONAL" onChange={(event) => setForm((prev) => ({ ...prev, artistName: event.target.value.toUpperCase() }))} />
            </label>
            <label>
              Collection
              <input value={form.collectionName} readOnly />
            </label>
            <label>
              Description
              <textarea value={form.description} onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))} />
            </label>
            <div className="form-row">
              <label>
                Storage
                <select value={form.storageType} onChange={(event) => setForm((prev) => ({ ...prev, storageType: event.target.value as AcmeStorageType }))}>
                  {STORAGE_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                </select>
              </label>
              <label>
                Fee rate
                <input type="number" min="1" value={form.feeRate} onChange={(event) => setForm((prev) => ({ ...prev, feeRate: clamp(Number(event.target.value), 1, 500) }))} />
              </label>
            </div>
            <label>
              Tags
              <input value={form.tags} onChange={(event) => setForm((prev) => ({ ...prev, tags: event.target.value }))} />
            </label>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={originalArtworkSelected}
                onChange={(event) => {
                  setForm((prev) => ({
                    ...prev,
                    tags: setTagEnabled(prev.tags, ORIGINAL_ARTWORK_TAG, event.target.checked),
                  }))
                }}
              />
              <span>Original Artwork</span>
            </label>
            <div className="mint-actions">
              <button type="button" onClick={connectWallet} disabled={wallet.connecting}>{wallet.connected ? 'Reconnect Wallet' : 'Connect Wallet'}</button>
              <button type="button" className="primary" onClick={submitMint} disabled={!renderedComic || Boolean(validationError || assetAvailabilityError || walletError) || mintStatus === 'composing' || mintStatus === 'signing' || mintStatus === 'broadcasting'}>
                {mintStatus === 'idle' || mintStatus === 'error' ? 'Mint on ACME' : mintStatus === 'success' ? 'Minted' : 'Minting...'}
              </button>
            </div>
            {(validationError || assetAvailabilityError || walletError || mintError) && <p className="error-text">{mintError || validationError || assetAvailabilityError || walletError}</p>}
            {mintStep && <p className="status-text">{PROGRESS_LABELS[mintStep]}{arweaveProgress ? `: ${arweaveProgress.percent}%` : ''}</p>}
            {txid && <p className="status-text">Broadcast transaction: {txid}</p>}
          </div>
          <div className="submit-preview">
            {renderedComic ? <img src={renderedComic} alt="Rendered SatoshiComics submission" /> : <p>Upload an image first.</p>}
            <span>{formatBytes(renderedBytes)}</span>
          </div>
        </section>
      )}

      {activeTab === 'pending' && (
        <section className="page pending-page">
          <div className="section-head">
            <div>
              <h2>Submission</h2>
              <p>Pending assets referencing the `SATOSHICOMICS` collection on ACME mainnet.</p>
            </div>
            <div className="submission-actions">
              <label className="submission-search">
                <span>Search</span>
                <input
                  value={submissionSearch}
                  placeholder="Name or creator"
                  onChange={(event) => setSubmissionSearch(event.target.value)}
                />
              </label>
              <label className="submission-sort">
                <span>Sort</span>
                <select value={submissionSort} onChange={(event) => setSubmissionSort(event.target.value as SubmissionSort)}>
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
          <div className="bookshelf-grid">
            {pendingAssetRows.map((row, rowIndex) => (
              <div className="shelf-row" key={`shelf-row-${rowIndex}`}>
                <div className="book-grid">
                  {Array.from({ length: RACK_COMICS_PER_ROW }, (_, slotIndex) => {
                    const asset = row[slotIndex]
                    if (!asset) return <article className="asset-card empty-slot" key={`empty-${rowIndex}-${slotIndex}`} aria-hidden="true" />

                    return (
                      <article className="asset-card" key={asset.asset}>
                        <div className="display-slot">
                          <button className="book-frame" type="button" onClick={() => setSelectedComic(asset)} aria-label={`View ${asset.displayName}`}>
                            <img
                              src={asset.contentUrl || asset.thumbnailUrl}
                              alt={asset.displayName}
                              onError={(event) => {
                                if (event.currentTarget.dataset.fallback !== 'true') {
                                  event.currentTarget.dataset.fallback = 'true'
                                  event.currentTarget.src = asset.thumbnailUrl
                                }
                              }}
                            />
                          </button>
                        </div>
                      </article>
                    )
                  })}
                </div>
                <div className="rack-panel-row">
                  {Array.from({ length: RACK_COMICS_PER_ROW }, (_, slotIndex) => {
                    const asset = row[slotIndex]
                    if (!asset) return <div className="asset-meta rack-panel empty-slot" key={`empty-panel-${rowIndex}-${slotIndex}`} aria-hidden="true" />

                    return (
                      <div className="asset-meta rack-panel" key={`${asset.asset}-rack-panel`}>
                        <div className="rack-title-row">
                          <strong>{asset.displayName}</strong>
                          <LikeButton
                            active={isAssetLiked(asset.asset)}
                            count={getAssetLikeCount(asset.asset)}
                            pending={likePendingAsset === asset.asset}
                            onClick={() => void toggleAssetLike(asset)}
                          />
                        </div>
                        <span>Creator: {getAssetCreator(asset)}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
          {visiblePendingAssets.length > RACK_PAGE_SIZE && (
            <div className="submission-pagination" aria-label="Submission pages">
              <button
                type="button"
                onClick={() => setSubmissionPage((page) => Math.max(0, page - 1))}
                disabled={submissionPage === 0}
              >
                Prev
              </button>
              <span>Page {submissionPage + 1} of {submissionPageCount}</span>
              <button
                type="button"
                onClick={() => setSubmissionPage((page) => Math.min(submissionPageCount - 1, page + 1))}
                disabled={submissionPage >= submissionPageCount - 1}
              >
                Next
              </button>
            </div>
          )}
          {pendingStatus === 'loaded' && submittedAssets.length === 0 && <p className="empty-state">No pending SatoshiComics submissions found yet.</p>}
          {pendingStatus === 'loaded' && submittedAssets.length > 0 && visiblePendingAssets.length === 0 && <p className="empty-state">No submissions match that search.</p>}
        </section>
      )}

      {activeTab === 'approved' && (
        <section className="page approved-page">
          <div className="section-head">
            <div>
              <h2>Approved Comics</h2>
              <p>Synapsed assets in the `SATOSHICOMICS` collection on ACME mainnet.</p>
            </div>
            <div className="submission-actions">
              <label className="submission-search">
                <span>Search</span>
                <input
                  value={approvedSearch}
                  placeholder="Name or creator"
                  onChange={(event) => setApprovedSearch(event.target.value)}
                />
              </label>
              <label className="submission-sort">
                <span>Sort</span>
                <select value={approvedSort} onChange={(event) => setApprovedSort(event.target.value as SubmissionSort)}>
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
          <div className="graded-grid">
            {visibleApprovedAssets.map((asset) => {
              const gradingNumber = approvedGradingNumbers.get(asset.asset) ?? '#000'
              return (
              <article
                className="graded-slab"
                key={`${asset.asset}-graded`}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedGradedComic({ asset, gradingNumber })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    setSelectedGradedComic({ asset, gradingNumber })
                  }
                }}
                aria-label={`View graded card for ${asset.displayName}`}
              >
                <div className="graded-label">
                  <div className="graded-brand">
                    <span>ACME</span>
                    <strong>Approved</strong>
                  </div>
                  <div className="graded-title">
                    <strong>{asset.displayName}</strong>
                    <span>{asset.asset}</span>
                  </div>
                  <dl className="graded-details">
                    <div>
                      <dt>Creator</dt>
                      <dd>{getAssetCreator(asset)}</dd>
                    </div>
                    <div>
                      <dt>Collection</dt>
                      <dd>{asset.collectionAsset ?? 'SATOSHICOMICS'}</dd>
                    </div>
                    <div>
                      <dt>Block</dt>
                      <dd>{asset.revealBlock ?? 'Pending'}</dd>
                    </div>
                    <div>
                      <dt>Date</dt>
                      <dd>{formatAssetDate(asset.revealTimestamp)}</dd>
                    </div>
                  </dl>
                  <div className="graded-sticker" aria-label="Satoshi Comics sticker">
                    <span>Satoshi</span>
                    <strong>Comics</strong>
                  </div>
                </div>
                <div className="graded-case-body">
                  <div className="graded-comic-frame" aria-hidden="true">
                    <img
                      src={asset.contentUrl || asset.thumbnailUrl}
                      alt={asset.displayName}
                      onError={(event) => {
                        if (event.currentTarget.dataset.fallback !== 'true') {
                          event.currentTarget.dataset.fallback = 'true'
                          event.currentTarget.src = asset.thumbnailUrl
                        }
                      }}
                    />
                  </div>
                </div>
                <div className="graded-footer">
                  <span className="graded-issue-number">{gradingNumber}</span>
                  <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                    <LikeButton
                      active={isAssetLiked(asset.asset)}
                      count={getAssetLikeCount(asset.asset)}
                      pending={likePendingAsset === asset.asset}
                      onClick={() => void toggleAssetLike(asset)}
                    />
                  </div>
                </div>
              </article>
              )
            })}
          </div>
          {pendingStatus === 'loaded' && approvedAssets.length === 0 && <p className="empty-state">No approved SatoshiComics assets found yet.</p>}
          {pendingStatus === 'loaded' && approvedAssets.length > 0 && visibleApprovedAssets.length === 0 && <p className="empty-state">No approved comics match that search.</p>}
        </section>
      )}

      {activeTab === 'portfolio' && (
        <section className="page portfolio-page">
          <div className="section-head">
            <div>
              <h2>My Portfolio</h2>
              <p>{wallet.connected ? `Connected wallet ${formatAddress(wallet.address)}.` : 'Connect your wallet to view your SatoshiComics submissions.'}</p>
            </div>
            <div className="submission-actions">
              <button type="button" onClick={connectWallet} disabled={wallet.connecting}>
                {wallet.connected ? 'Reconnect Wallet' : wallet.connecting ? 'Connecting...' : 'Connect Wallet'}
              </button>
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
          {!wallet.connected && <p className="empty-state">Connect UniSat to load comics linked to your wallet.</p>}
          {wallet.connected && pendingStatus === 'loading' && <p className="status-text">Loading portfolio...</p>}
          {wallet.connected && pendingStatus === 'loaded' && portfolioAssets.length === 0 && (
            <p className="empty-state">No wallet-matched submissions found yet. Portfolio matching uses owner/source/destination metadata from ACME when available.</p>
          )}
          {wallet.connected && portfolioAssets.length > 0 && (
            <div className="portfolio-grid">
              {portfolioAssets.map((asset) => (
                <article className="portfolio-card" key={`${asset.asset}-portfolio`}>
                  <button className="portfolio-cover" type="button" onClick={() => setSelectedComic(asset)} aria-label={`View ${asset.displayName}`}>
                    <img
                      src={asset.contentUrl || asset.thumbnailUrl}
                      alt={asset.displayName}
                      onError={(event) => {
                        if (event.currentTarget.dataset.fallback !== 'true') {
                          event.currentTarget.dataset.fallback = 'true'
                          event.currentTarget.src = asset.thumbnailUrl
                        }
                      }}
                    />
                  </button>
                  <div className="portfolio-card-body">
                    <div className="portfolio-card-title">
                      <strong>{asset.displayName}</strong>
                      <span className={asset.collectionRelationshipStatus === 'synapsed' ? 'status-pill approved' : 'status-pill pending'}>{formatStatusLabel(asset)}</span>
                    </div>
                    <dl>
                      <div>
                        <dt>Asset</dt>
                        <dd>{asset.asset}</dd>
                      </div>
                      <div>
                        <dt>Creator</dt>
                        <dd>{getAssetCreator(asset)}</dd>
                      </div>
                      <div>
                        <dt>Submitted</dt>
                        <dd>{formatAssetDate(asset.revealTimestamp)}</dd>
                      </div>
                      <div>
                        <dt>Block</dt>
                        <dd>{asset.revealBlock ?? 'Pending'}</dd>
                      </div>
                      <div>
                        <dt>Likes</dt>
                        <dd>{getAssetLikeCount(asset.asset)}</dd>
                      </div>
                    </dl>
                    <a href={asset.artUrl} target="_blank" rel="noreferrer">Open original</a>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      <footer className="app-footer">
        <a
          className="acme-footer-link"
          href="https://acme.pics/mainnets"
          target="_blank"
          rel="noreferrer"
          aria-label="Open ACME mainnets"
        >
          <img src={acmeLogo} alt="" />
          <span>Power by the ACME Protocol</span>
        </a>
      </footer>

      {selectedGradedComic && (
        <div className="comic-lightbox" role="dialog" aria-modal="true" aria-label={`Graded card for ${selectedGradedComic.asset.displayName}`} onClick={() => setSelectedGradedComic(null)}>
          <div className="comic-lightbox-panel graded-lightbox-panel" onClick={(event) => event.stopPropagation()}>
            <button className="lightbox-close" type="button" onClick={() => setSelectedGradedComic(null)} aria-label="Close preview">Close</button>
            <article className="graded-slab graded-slab-modal">
              <div className="graded-label">
                <div className="graded-brand">
                  <span>ACME</span>
                  <strong>Approved</strong>
                </div>
                <div className="graded-title">
                  <strong>{selectedGradedComic.asset.displayName}</strong>
                  <span>{selectedGradedComic.asset.asset}</span>
                </div>
                <dl className="graded-details">
                  <div>
                    <dt>Creator</dt>
                    <dd>{getAssetCreator(selectedGradedComic.asset)}</dd>
                  </div>
                  <div>
                    <dt>Collection</dt>
                    <dd>{selectedGradedComic.asset.collectionAsset ?? 'SATOSHICOMICS'}</dd>
                  </div>
                  <div>
                    <dt>Block</dt>
                    <dd>{selectedGradedComic.asset.revealBlock ?? 'Pending'}</dd>
                  </div>
                  <div>
                    <dt>Date</dt>
                    <dd>{formatAssetDate(selectedGradedComic.asset.revealTimestamp)}</dd>
                  </div>
                </dl>
                <div className="graded-sticker" aria-label="Satoshi Comics sticker">
                  <span>Satoshi</span>
                  <strong>Comics</strong>
                </div>
              </div>
              <div className="graded-case-body">
                <div className="graded-comic-frame">
                  <img
                    src={selectedGradedComic.asset.contentUrl || selectedGradedComic.asset.thumbnailUrl}
                    alt={selectedGradedComic.asset.displayName}
                    onError={(event) => {
                      if (event.currentTarget.dataset.fallback !== 'true') {
                        event.currentTarget.dataset.fallback = 'true'
                        event.currentTarget.src = selectedGradedComic.asset.thumbnailUrl
                      }
                    }}
                  />
                </div>
              </div>
              <div className="graded-footer">
                <span className="graded-issue-number">{selectedGradedComic.gradingNumber}</span>
                <LikeButton
                  active={isAssetLiked(selectedGradedComic.asset.asset)}
                  count={getAssetLikeCount(selectedGradedComic.asset.asset)}
                  pending={likePendingAsset === selectedGradedComic.asset.asset}
                  onClick={() => void toggleAssetLike(selectedGradedComic.asset)}
                />
              </div>
            </article>
            <div className="lightbox-meta">
              <a href={selectedGradedComic.asset.artUrl} target="_blank" rel="noreferrer">Open original</a>
            </div>
          </div>
        </div>
      )}

      {selectedComic && (
        <div className="comic-lightbox" role="dialog" aria-modal="true" aria-label={selectedComic.displayName} onClick={() => setSelectedComic(null)}>
          <div className="comic-lightbox-panel" onClick={(event) => event.stopPropagation()}>
            <button className="lightbox-close" type="button" onClick={() => setSelectedComic(null)} aria-label="Close preview">Close</button>
            <img
              src={selectedComic.contentUrl || selectedComic.thumbnailUrl}
              alt={selectedComic.displayName}
              onError={(event) => {
                if (event.currentTarget.dataset.fallback !== 'true') {
                  event.currentTarget.dataset.fallback = 'true'
                  event.currentTarget.src = selectedComic.thumbnailUrl
                }
              }}
            />
            <div className="lightbox-meta">
              <strong>{selectedComic.displayName}</strong>
              <LikeButton
                active={isAssetLiked(selectedComic.asset)}
                count={getAssetLikeCount(selectedComic.asset)}
                pending={likePendingAsset === selectedComic.asset}
                onClick={() => void toggleAssetLike(selectedComic)}
              />
              <a href={selectedComic.artUrl} target="_blank" rel="noreferrer">Open original</a>
            </div>
          </div>
        </div>
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
