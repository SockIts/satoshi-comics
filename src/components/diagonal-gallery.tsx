import { ComicBook } from './comic-book'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { AcmeGalleryAsset } from '../acmeMint'
import { Slider } from './ui/slider'

export type DiagonalGalleryProps = {
  assets: AcmeGalleryAsset[]
  loading: boolean
  coverFor: (asset: AcmeGalleryAsset) => string
  creatorFor: (asset: AcmeGalleryAsset) => string
  onOpen: (asset: AcmeGalleryAsset) => void
  renderLike: (asset: AcmeGalleryAsset) => ReactNode
}

export function DiagonalGallery({ assets, loading, coverFor, creatorFor, onOpen, renderLike }: DiagonalGalleryProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ x: number; position: number } | null>(null)
  const [size, setSize] = useState({ width: 1200, height: 600 })
  const [position, setPosition] = useState(0)
  useEffect(() => {
    const element = viewportRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const coverHeight = Math.round(Math.min(460, size.height * .44))
  // Even dimensions keep centered covers on whole CSS pixels.
  const coverWidth = Math.round(coverHeight * .67 / 2) * 2
  const slope = .30
  // Keep the cross-section centered, independent of the viewport aspect ratio.
  const diagonalStart = (size.height - size.width * slope) / 2
  const diagonalEnd = diagonalStart + size.width * slope
  // Consecutive issues alternate between independently clipped upper/lower rows.
  // Two steps make one cover plus a modest gutter within each row.
  const step = (coverWidth + (size.width < 600 ? 18 : 30)) / 2
  const currentIndex = Math.min(Math.round(position / 1000 * (assets.length - 1)), Math.max(0, assets.length - 1))
  const currentAsset = assets[currentIndex]
  const anchorX = size.width * (size.width < 600 ? .45 : .12)
  const endInset = size.width < 600 ? 16 : 24
  const endAnchorX = size.width - coverWidth / 2 - endInset
  // Stop when the final cover reaches the right edge, not the starting anchor.
  const totalDistance = Math.max(0, Math.max(0, assets.length - 1) * step + anchorX - endAnchorX)
  const travel = totalDistance * position / 1000
  const anchorY = diagonalStart + anchorX * slope
  const dividerWidth = size.width < 600 ? 16 : 22
  const boardStyle = {
    // Paint at native resolution rather than resampling a translated GPU texture.
    left: `${Math.round(anchorX - travel)}px`,
    top: `${Math.round(anchorY - travel * slope)}px`,
    '--gallery-cover-height': `${coverHeight}px`,
    '--gallery-cover-width': `${coverWidth}px`,
  } as CSSProperties
  const moveTo = (index: number) => setPosition(assets.length > 1 ? Math.max(0, Math.min(assets.length - 1, index)) / (assets.length - 1) * 1000 : 0)
  const renderMetadata = (asset: AcmeGalleryAsset) => (
    <div className="timeline-meta">
      <div className="timeline-caption"><h3 title={asset.displayName}>{asset.displayName}</h3>{renderLike(asset)}</div>
      <p className="timeline-byline">{creatorFor(asset)} <span>{asset.revealTimestamp ? new Date(asset.revealTimestamp * 1000).getUTCFullYear() : 'ON BITCOIN'}</span></p>
    </div>
  )

  return (
    <section className="diagonal-gallery" aria-label="Diagonal comic timeline">
      <div className="diagonal-viewport" ref={viewportRef} tabIndex={0} aria-label="Comic gallery. Drag the timeline slider or use left and right arrow keys."
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return
          if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); moveTo(currentIndex + (event.key === 'ArrowRight' ? 1 : -1)) }
          if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); moveTo(event.key === 'Home' ? 0 : assets.length - 1) }
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || (event.target instanceof Element && event.target.closest('button, a'))) return
          dragRef.current = { x: event.clientX, position }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current
          if (drag && totalDistance > 0) setPosition(Math.max(0, Math.min(1000, drag.position - (event.clientX - drag.x) / totalDistance * 1000)))
        }}
        onPointerUp={() => { dragRef.current = null }} onPointerCancel={() => { dragRef.current = null }}>
        {loading && assets.length === 0 && <div className="gallery-loading" role="status">Loading the archive<span /></div>}
        {!loading && assets.length === 0 && <div className="gallery-loading">No comics here yet.<small>Try another search or filter.</small></div>}
        {[
          { side: 'above', parity: 1, label: 'Upper comic gallery', clip: `polygon(0 0, 100% 0, 100% ${diagonalEnd}px, 0 ${diagonalStart}px)` },
          { side: 'below', parity: 0, label: 'Lower comic gallery', clip: `polygon(0 ${diagonalStart}px, 100% ${diagonalEnd}px, 100% 100%, 0 100%)` },
        ].map((section) => (
          <div className={`gallery-half gallery-half-${section.side}`} role="group" aria-label={section.label} key={section.side} style={{ clipPath: section.clip }}>
            <div className={`diagonal-scene diagonal-scene-${section.side}`} style={boardStyle}>
          {assets.map((asset, index) => index % 2 === section.parity && (
            <article className={`timeline-entry ${section.side} ${currentIndex === index ? 'is-current' : ''}`} key={asset.asset}
              style={{ left: `${Math.round(index * step)}px`, top: `${Math.round(index * step * slope)}px`, '--slice-overlap': `${-Math.round(coverWidth * slope / 2 + dividerWidth / 2 + 6)}px` } as CSSProperties}>
              <div className="timeline-artwork">
                <button className="timeline-cover" type="button" onClick={() => onOpen(asset)} onFocus={(event) => { if (event.currentTarget.matches(':focus-visible')) moveTo(index) }} aria-label={`View ${asset.displayName}`}>
                  <ComicBook src={coverFor(asset)} alt={asset.displayName} loading={Math.abs(index - currentIndex) < 4 ? 'eager' : 'lazy'} draggable={false} onError={(event) => { if (event.currentTarget.dataset.fallback !== 'true') { event.currentTarget.dataset.fallback = 'true'; event.currentTarget.src = asset.thumbnailUrl } }} />
                </button>
                {renderMetadata(asset)}
              </div>
            </article>
          ))}
            </div>
          </div>
        ))}
        <div className="gallery-diagonal-divider" aria-hidden="true" style={{
          width: `${Math.hypot(size.width, size.width * slope) * 3}px`,
          height: `${dividerWidth}px`,
          left: `${-size.width + Math.sin(Math.atan(slope)) * dividerWidth / 2}px`,
          top: `${diagonalStart - size.width * slope - Math.cos(Math.atan(slope)) * dividerWidth / 2}px`,
          transform: `rotate(${Math.atan(slope) * 180 / Math.PI}deg)`,
        }} />
        <div className="gallery-diagonal-caption" aria-hidden="true">A DIFFERENT POINT OF VIEW — SATOSHI COMICS</div>
      </div>
      <div className="gallery-transport">
        <div className="gallery-position"><span>EXPLORING THE ARCHIVE</span><strong aria-live="polite">{currentAsset ? `${String(currentIndex + 1).padStart(2, '0')} / ${String(assets.length).padStart(2, '0')}` : '— / —'}</strong></div>
        <div className="gallery-scrubber"><div className="gallery-slider-label"><span>BEGINNING</span><label htmlFor="gallery-timeline">DRAG TO EXPLORE ↔</label><span>END</span></div>
          <Slider id="gallery-timeline" aria-label="Explore comic timeline" aria-valuetext={currentAsset ? `Issue ${currentIndex + 1} of ${assets.length}: ${currentAsset.displayName}` : 'No comics'} min={0} max={1000} step={1} value={[position]} onValueChange={([value]) => setPosition(value)} disabled={assets.length < 2} />
        </div>
        <div className="gallery-arrows"><button type="button" onClick={() => moveTo(currentIndex - 1)} disabled={position === 0 || assets.length === 0} aria-label="Previous comic">←</button><button type="button" onClick={() => moveTo(currentIndex + 1)} disabled={position === 1000 || assets.length < 2} aria-label="Next comic">→</button></div>
      </div>
    </section>
  )
}
