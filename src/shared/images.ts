/** Image files the diff and file views draw as pictures instead of bytes or SVG source. */
const MIME: Record<string, string> = {
  png: 'image/png',
  svg: 'image/svg+xml'
}

/** Images larger than this show a note instead (the whole file crosses IPC as a data URL). */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024

const ext = (file: string) => file.slice(file.lastIndexOf('.') + 1).toLowerCase()

export const imageMime = (file: string): string | undefined => (file.includes('.') ? MIME[ext(file)] : undefined)
export const isImageFile = (file: string) => !!imageMime(file)
/** SVG is text too, so its diff can still be read as source. */
export const isSvgFile = (file: string) => imageMime(file) === 'image/svg+xml'

/** One side of an image diff: a data URL, or why there's none (absent on that side, too large). */
export interface ImageSide {
  url?: string
  bytes?: number
  reason?: string
}

export interface ImageDiff {
  before: ImageSide | null
  after: ImageSide | null
}
