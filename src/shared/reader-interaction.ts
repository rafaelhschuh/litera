export type ReaderInteractionMode =
  | 'idle'
  | 'tap-candidate'
  | 'scrolling'
  | 'swiping'
  | 'selecting'
  | 'pinching'
  | 'panning'
  | 'ui-interaction'

export type ReaderGesture = 'tap' | 'swipe-previous' | 'swipe-next' | 'scroll' | 'pan' | 'none'

export type GestureSample = {
  deltaX: number
  deltaY: number
  durationMs: number
  cancelled?: boolean
  selecting?: boolean
  pinching?: boolean
  panning?: boolean
}

export const READER_GESTURE_LIMITS = {
  tapDistance: 12,
  tapDurationMs: 350,
  swipeDistance: 48,
  swipeVelocity: 0.18,
  directionDominance: 1.35,
} as const

export function classifyReaderGesture(sample: GestureSample): ReaderGesture {
  if (sample.cancelled || sample.selecting || sample.pinching) return 'none'
  const distance = Math.hypot(sample.deltaX, sample.deltaY)
  if (sample.panning && distance > READER_GESTURE_LIMITS.tapDistance) return 'pan'
  if (distance <= READER_GESTURE_LIMITS.tapDistance && sample.durationMs <= READER_GESTURE_LIMITS.tapDurationMs) return 'tap'

  const horizontal = Math.abs(sample.deltaX)
  const vertical = Math.abs(sample.deltaY)
  const horizontalVelocity = horizontal / Math.max(1, sample.durationMs)
  const isHorizontal = horizontal >= READER_GESTURE_LIMITS.swipeDistance
    && horizontal >= vertical * READER_GESTURE_LIMITS.directionDominance
    && horizontalVelocity >= READER_GESTURE_LIMITS.swipeVelocity

  if (isHorizontal) return sample.deltaX < 0 ? 'swipe-next' : 'swipe-previous'
  return vertical > READER_GESTURE_LIMITS.tapDistance ? 'scroll' : 'none'
}

export function readerTapZone(x: number, width: number): 'previous' | 'center' | 'next' {
  if (width <= 0) return 'center'
  if (x < width * 0.14) return 'previous'
  if (x > width * 0.86) return 'next'
  return 'center'
}
