import { ComicBook } from './comic-book'
import { useRef, type ReactNode } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'

type ArtworkDialogProps = {
  title: string
  description: string
  image: string
  finished?: boolean
  fallbackImage?: string
  onClose: () => void
  children?: ReactNode
}

export function ArtworkDialog({ title, description, image, fallbackImage, finished, onClose, children }: ArtworkDialogProps) {
  const returnFocus = useRef<HTMLElement | null>(null)
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="artwork-dialog"
        onOpenAutoFocus={() => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null }}
        onCloseAutoFocus={(event) => { event.preventDefault(); returnFocus.current?.focus({ preventScroll: true }) }}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <ComicBook finished={finished} className="artwork-dialog-image" src={image} alt={title} onError={(event) => {
          if (fallbackImage && event.currentTarget.dataset.fallback !== 'true') {
            event.currentTarget.dataset.fallback = 'true'
            event.currentTarget.src = fallbackImage
          }
        }} />
        {children && <div className="artwork-dialog-actions">{children}</div>}
      </DialogContent>
    </Dialog>
  )
}
