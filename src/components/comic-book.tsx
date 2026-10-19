import type { ImgHTMLAttributes } from 'react'

type ComicBookProps = ImgHTMLAttributes<HTMLImageElement> & { finished?: boolean }

/** Display-only book wrapper: artwork fills the cover without distortion. */
export function ComicBook({ className = '', finished = false, ...imageProps }: ComicBookProps) {
  return <span className={`comic-book ${finished ? 'comic-book-finished' : ''}`}>
    <span className="comic-book-surface">
      <img {...imageProps} className={`comic-book-art ${className}`} />
    </span>
  </span>
}
