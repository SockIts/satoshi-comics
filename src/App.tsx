import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import bitcoinPizzaCover from '../Assets/BitcoinPizza.jpg'
import diamondHandsCover from '../Assets/DiamondHands.jpg'
import dogeKnightCover from '../Assets/DogeKnight.jpg'
import hodlManCover from '../Assets/HodlMan.jpg'
import pepeNoirCover from '../Assets/PepeNoir.jpg'
import toTheMoonCover from '../Assets/ToTheMoon.jpg'
import {
  connectUniSat,
  fetchAcmeCollectionAssets,
  mintStampOnAcme,
  normalizeAcmeAssetRef,
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

type Tab = 'rules' | 'upload' | 'submit' | 'pending' | 'approved'

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

const PROGRESS_LABELS: Record<AcmeMintProgressStep, string> = {
  utxos: 'Finding wallet UTXOs',
  arweave: 'Uploading comic to Arweave',
  compose: 'Composing ACME mint',
  finalize: 'Preparing reveal data',
  sign: 'Waiting for wallet signature',
  broadcast: 'Broadcasting transaction',
}

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
  description: 'Submitted to SatoshiComics on ACME testnet.',
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

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('rules')
  const [sourceImage, setSourceImage] = useState<string | null>(null)
  const [renderedComic, setRenderedComic] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
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
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const validationError = validateAcmeMintForm(form)
  const walletError = wallet.connected ? validateAcmeWalletNetwork(wallet) : 'Connect UniSat before minting.'
  const renderedBytes = useMemo(() => (renderedComic ? getDataUrlBytes(renderedComic) : 0), [renderedComic])
  const pendingAssetRows = useMemo(() => {
    const rows: AcmeGalleryAsset[][] = []
    for (let index = 0; index < pendingAssets.length; index += 6) {
      rows.push(pendingAssets.slice(index, index + 6))
    }
    return rows
  }, [pendingAssets])

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
      setFileName(file.name)
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
    } catch (error) {
      setWallet({ ...DEFAULT_WALLET, error: error instanceof Error ? error.message : 'Could not connect wallet.' })
    }
  }

  const submitMint = async () => {
    if (!renderedComic) return
    const nextError = validateAcmeMintForm(form) || validateAcmeWalletNetwork(wallet)
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
          description: form.description || 'Submitted to SatoshiComics on ACME testnet.',
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
      setActiveTab('pending')
    } catch (error) {
      setMintStatus('error')
      setMintError(error instanceof Error ? error.message : 'Mint failed.')
    }
  }

  const loadPending = useCallback(async () => {
    setPendingStatus('loading')
    setPendingError('')
    try {
      const assets = await fetchAcmeCollectionAssets('SATOSHICOMICS', 200)
      setPendingAssets(assets)
      setPendingStatus('loaded')
    } catch (error) {
      setPendingError(error instanceof Error ? error.message : 'Could not load pending comics.')
      setPendingStatus('error')
    }
  }, [])

  useEffect(() => {
    if (activeTab !== 'pending' || pendingStatus !== 'idle') return
    const timeoutId = window.setTimeout(() => {
      void loadPending()
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [activeTab, loadPending, pendingStatus])

  useEffect(() => {
    if (!selectedComic) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedComic(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedComic])

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">ACME testnet comic submissions</p>
          <h1>SatoshiComics</h1>
        </div>
        <button className="wallet-button" type="button" onClick={connectWallet} disabled={wallet.connecting}>
          {wallet.connected ? formatAddress(wallet.address) : wallet.connecting ? 'Connecting...' : 'Connect Wallet'}
        </button>
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
            href="https://fakefull.art/collection/SATOSHICOMICS"
            target="_blank"
            rel="noreferrer"
            aria-label="Open SatoshiComics collection on Fakefull"
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
              <li>Submit original comic-book artwork or work you have permission to mint.</li>
              <li>The rendered upload must look like a comic cover and include the SatoshiComics wrapper.</li>
              <li>Use a unique ACME asset name: 3-16 uppercase letters or numbers, starting with a letter.</li>
              <li>Keep images safe for a public gallery. No hateful, stolen, or deceptive submissions.</li>
              <li>Mint on ACME testnet with the `SATOSHICOMICS` collection and `SatoshiComics` tag.</li>
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
                  <p>{fileName || 'Drop a cover image here.'}</p>
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
              <input value={form.assetName} placeholder="SATCOMIC001" onChange={(event) => setForm((prev) => ({ ...prev, assetName: event.target.value.toUpperCase() }))} />
            </label>
            <label>
              Artist
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
            <div className="mint-actions">
              <button type="button" onClick={connectWallet} disabled={wallet.connecting}>{wallet.connected ? 'Reconnect Wallet' : 'Connect Wallet'}</button>
              <button type="button" className="primary" onClick={submitMint} disabled={!renderedComic || Boolean(validationError || walletError) || mintStatus === 'composing' || mintStatus === 'signing' || mintStatus === 'broadcasting'}>
                {mintStatus === 'idle' || mintStatus === 'error' ? 'Mint on ACME' : mintStatus === 'success' ? 'Minted' : 'Minting...'}
              </button>
            </div>
            {(validationError || walletError || mintError) && <p className="error-text">{mintError || validationError || walletError}</p>}
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
              <p>Assets minted with the `SATOSHICOMICS` collection on ACME testnet.</p>
            </div>
            <button type="button" onClick={loadPending} disabled={pendingStatus === 'loading'}>{pendingStatus === 'loading' ? 'Refreshing...' : 'Refresh'}</button>
          </div>
          {pendingError && <p className="error-text">{pendingError}</p>}
          <div className="bookshelf-grid">
            {pendingAssetRows.map((row, rowIndex) => (
              <div className="shelf-row" key={`shelf-row-${rowIndex}`}>
                <div className="book-grid">
                  {row.map((asset) => (
                    <article className="asset-card" key={asset.asset}>
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
                    </article>
                  ))}
                </div>
                <span className="shelf-shadow" aria-hidden="true" />
                <span className="shelf-board" aria-hidden="true" />
                <div className="asset-meta-row">
                  {row.map((asset) => (
                    <div className="asset-meta" key={`${asset.asset}-meta`}>
                      <strong>{asset.displayName}</strong>
                      <span>{asset.revealBlock ? `Reveal block ${asset.revealBlock}` : 'Pending reveal'}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {pendingStatus === 'loaded' && pendingAssets.length === 0 && <p className="empty-state">No SatoshiComics submissions found yet.</p>}
        </section>
      )}

      {activeTab === 'approved' && (
        <section className="page approved-page">
          <h2>Approved Comics</h2>
          <p className="empty-state">No comics have been approved yet. This space is ready for curated SatoshiComics approvals.</p>
        </section>
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
              <a href={selectedComic.artUrl} target="_blank" rel="noreferrer">Open original</a>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

const mergeComicTags = (tags: string) => {
  const values = tags.split(',').map((tag) => tag.trim()).filter(Boolean)
  for (const tag of ['SatoshiComics', 'comic', 'comic-book']) {
    if (!values.some((value) => value.toLowerCase() === tag.toLowerCase())) values.push(tag)
  }
  return values.join(', ')
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

  const spineX = coverX + 42
  const spineGradient = ctx.createLinearGradient(coverX, 0, coverX + 108, 0)
  spineGradient.addColorStop(0, 'rgba(0, 0, 0, 0.34)')
  spineGradient.addColorStop(0.38, 'rgba(255, 255, 255, 0.16)')
  spineGradient.addColorStop(0.52, 'rgba(0, 0, 0, 0.18)')
  spineGradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
  ctx.fillStyle = spineGradient
  ctx.fillRect(coverX, coverY, 112, coverH)

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

  const pageShadow = ctx.createLinearGradient(coverX + coverW - 54, 0, coverX + coverW, 0)
  pageShadow.addColorStop(0, 'rgba(0, 0, 0, 0)')
  pageShadow.addColorStop(1, 'rgba(0, 0, 0, 0.3)')
  ctx.fillStyle = pageShadow
  ctx.fillRect(coverX + coverW - 54, coverY, 54, coverH)
  ctx.restore()

  ctx.save()
  roundedRect(ctx, coverX, coverY, coverW, coverH, radius)
  ctx.strokeStyle = 'rgba(10, 11, 15, 0.56)'
  ctx.lineWidth = 8
  ctx.stroke()
  ctx.restore()
}

export default App
