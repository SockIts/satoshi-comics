import { ComicBook } from './comic-book'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { DiagonalGalleryProps } from './diagonal-gallery'
import { Slider } from './ui/slider'

export function PerspectiveReel({ assets, loading, coverFor, creatorFor, onOpen, renderLike }: DiagonalGalleryProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ x: number; left: number } | null>(null)
  const suppressClickRef = useRef(false)
  const [size, setSize] = useState({ width: 1200, height: 700 })
  const [scrollLeft, setScrollLeft] = useState(0)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [perspectiveOverride, setPerspectiveOverride] = useState<boolean | null>(null)
  const perspectiveEnabled = perspectiveOverride ?? !reducedMotion

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
      setScrollLeft(viewport.scrollLeft)
    })
    observer.observe(viewport)
    const motion = matchMedia('(prefers-reduced-motion: reduce)')
    const updateMotion = () => setReducedMotion(motion.matches)
    updateMotion()
    motion.addEventListener('change', updateMotion)
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return
      const max = viewport.scrollWidth - viewport.clientWidth
      if (max <= 0 || (event.deltaY < 0 && viewport.scrollLeft <= 0) || (event.deltaY > 0 && viewport.scrollLeft >= max - 1)) return
      event.preventDefault()
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientWidth : 1
      viewport.scrollLeft += event.deltaY * unit
    }
    viewport.addEventListener('wheel', wheel, { passive: false })
    return () => {
      observer.disconnect()
      motion.removeEventListener('change', updateMotion)
      viewport.removeEventListener('wheel', wheel)
    }
  }, [])

  const coverHeight = Math.min(760, (size.height - 80) * .86, size.width < 600 ? size.width * .86 / .67 : Infinity) * .8
  const coverWidth = coverHeight * .67
  const gap = size.width < 600 ? 18 : 26
  const step = coverWidth + gap
  const inset = Math.max(24, size.width * .12)
  const contentWidth = assets.length ? inset + assets.length * coverWidth + (assets.length - 1) * gap + 24 : 0
  const maxScroll = Math.max(0, contentWidth - size.width)
  const progress = maxScroll > 0 ? Math.min(1000, scrollLeft / maxScroll * 1000) : 0
  const currentIndex = Math.min(Math.max(0, assets.length - 1), Math.round(progress / 1000 * (assets.length - 1)))
  const currentAsset = assets[currentIndex]
  const scrollTo = (left: number, smooth = false) => viewportRef.current?.scrollTo({ left: Math.max(0, Math.min(maxScroll, left)), behavior: smooth && !reducedMotion ? 'smooth' : 'instant' })
  const moveTo = (index: number) => scrollTo(inset + index * step + coverWidth / 2 - size.width / 2, true)

  return (
    <section className="perspective-reel diagonal-gallery" aria-label="Perspective comic reel">
      <button className="reel-depth-toggle" type="button" aria-label="3D perspective" aria-pressed={perspectiveEnabled}
        title={reducedMotion && perspectiveOverride === null ? 'Reduce Motion is enabled. Turn on to opt into perspective while scrolling.' : 'Toggle scroll-driven cover perspective'}
        onClick={() => setPerspectiveOverride(!perspectiveEnabled)}>3D {perspectiveEnabled ? 'on' : 'off'}</button>
      <div className="reel-viewport" ref={viewportRef} tabIndex={0} aria-label="Comic reel. Scroll, swipe, or use left and right arrow keys."
        onScroll={(event) => setScrollLeft(event.currentTarget.scrollLeft)}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return
          if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); scrollTo(scrollLeft + (event.key === 'ArrowRight' ? step : -step), true) }
          if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); scrollTo(event.key === 'Home' ? 0 : maxScroll) }
        }}
        onPointerDown={(event) => {
          if (event.pointerType !== 'mouse' || event.button !== 0 || (event.target as Element).closest('.reel-like')) return
          dragRef.current = { x: event.clientX, left: event.currentTarget.scrollLeft }
          suppressClickRef.current = false
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current
          if (!drag || Math.abs(event.clientX - drag.x) < 6) return
          suppressClickRef.current = true
          event.currentTarget.setPointerCapture(event.pointerId)
          event.currentTarget.scrollLeft = drag.left - (event.clientX - drag.x)
        }}
        onPointerUp={() => { dragRef.current = null }}
        onPointerCancel={() => { dragRef.current = null }}
        onPointerLeave={() => { dragRef.current = null }}
        onClickCapture={(event) => { if (suppressClickRef.current) { event.preventDefault(); event.stopPropagation(); suppressClickRef.current = false } }}>
        {assets.length === 0 && <div className="gallery-loading" role="status">{loading ? 'Loading the archive…' : 'No comics here. Try another search or filter.'}</div>}
        <div className="reel-track" style={{ paddingLeft: inset, paddingRight: 24, gap, '--reel-cover-height': `${coverHeight}px`, '--reel-cover-width': `${coverWidth}px` } as CSSProperties}>
          {assets.map((asset, index) => {
            // Base the turn on cover widths, not the whole screen: each cover
            // visibly turns as it crosses the center, even on wide displays.
            const distance = Math.max(-1, Math.min(1, (inset + index * step + coverWidth / 2 - scrollLeft - size.width / 2) / (coverWidth * 1.35)))
            return <article className="reel-card" key={asset.asset} style={{ transform: perspectiveEnabled ? `perspective(1100px) rotateY(${distance * 36}deg) translateZ(${(1 - Math.abs(distance)) * 18}px)` : 'none' }}>
              <button type="button" className="reel-cover" onClick={() => onOpen(asset)} onFocus={(event) => { if (event.currentTarget.matches(':focus-visible')) moveTo(index) }} aria-label={`View ${asset.displayName}`}>
                <ComicBook src={coverFor(asset)} alt={asset.displayName} draggable={false} loading={index < 5 ? 'eager' : 'lazy'} onError={(event) => { if (event.currentTarget.dataset.fallback !== 'true') { event.currentTarget.dataset.fallback = 'true'; event.currentTarget.src = asset.thumbnailUrl } }} />
              </button>
              <div className="reel-card-caption"><strong>{asset.displayName}</strong><span className="reel-card-creator">{creatorFor(asset)}</span><div className="reel-like">{renderLike(asset)}</div></div>
            </article>
          })}
        </div>
      </div>
      <div className="gallery-transport reel-transport">
        <div className="gallery-position"><span>EXPLORING THE REEL</span><strong aria-live="polite">{currentAsset ? `${String(currentIndex + 1).padStart(2, '0')} / ${String(assets.length).padStart(2, '0')}` : '— / —'}</strong></div>
        <div className="gallery-scrubber"><div className="gallery-slider-label"><span>BEGINNING</span><label htmlFor="reel-timeline">SCROLL TO EXPLORE ↔</label><span>END</span></div>
          <Slider id="reel-timeline" aria-label="Explore perspective reel" aria-valuetext={currentAsset?.displayName ?? 'No comics'} min={0} max={1000} step={1} value={[progress]} onValueChange={([value]) => scrollTo(value / 1000 * maxScroll)} disabled={maxScroll === 0} />
        </div>
        <div className="gallery-arrows"><button type="button" onClick={() => scrollTo(scrollLeft - step, true)} disabled={scrollLeft <= 1} aria-label="Previous comic">←</button><button type="button" onClick={() => scrollTo(scrollLeft + step, true)} disabled={scrollLeft >= maxScroll - 1} aria-label="Next comic">→</button></div>
      </div>
    </section>
  )
}
