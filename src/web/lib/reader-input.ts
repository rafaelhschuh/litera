import {
  classifyReaderGesture,
  READER_GESTURE_LIMITS,
  type ReaderInteractionMode,
} from '../../shared/reader-interaction'

type Point = { x: number; y: number }
type PointerState = Point & { startX: number; startY: number; startedAt: number; pointerType: string; moved: boolean }

type ReaderInputOptions = {
  onEvent?: (name: string) => void
  width: () => number
  selectionText: () => string
  canPan: () => boolean
  canSwipe: () => boolean
  onTap: (x: number, width: number) => void
  onSwipe: (direction: 'previous' | 'next') => void
  onPinchStart?: (center: Point) => void
  onPinchChange?: (scale: number, center: Point) => void
  onPinchEnd?: (scale: number, center: Point) => void
  onMousePan?: (deltaX: number, deltaY: number) => void
  onModeChange?: (mode: ReaderInteractionMode) => void
}

const interactiveSelector = 'a,button,input,select,textarea,label,[role="button"],[role="link"],[contenteditable="true"],[data-reader-interactive],[data-highlight-id]'

function elementFromTarget(target: EventTarget | null): Element | null {
  const node = target as Node | null
  if (!node || typeof node.nodeType !== 'number') return null
  return node.nodeType === 1 ? node as Element : node.parentElement
}

function centerOf(points: PointerState[]): Point {
  return {
    x: points.reduce((total, point) => total + point.x, 0) / points.length,
    y: points.reduce((total, point) => total + point.y, 0) / points.length,
  }
}

function distanceOf(points: PointerState[]): number {
  if (points.length < 2) return 0
  const first = points[0]!
  const second = points[1]!
  return Math.hypot(second.x - first.x, second.y - first.y)
}

export function attachReaderInput(target: Document | HTMLElement, options: ReaderInputOptions): () => void {
  const ownerWindow = target.nodeType === 9 ? (target as Document).defaultView : (target as HTMLElement).ownerDocument.defaultView
  const pointers = new Map<number, PointerState>()
  const cleanups: Array<() => void> = []
  let mode: ReaderInteractionMode = 'idle'
  let pinchStartDistance = 0
  let pinchScale = 1
  let suppressNavigationUntil = 0
  let lastTouch = -Infinity

  const setMode = (next: ReaderInteractionMode) => {
    if (mode === next) return
    mode = next
    options.onModeChange?.(next)
  }

  const add = <K extends keyof DocumentEventMap>(name: K, listener: (event: any) => void, eventOptions?: AddEventListenerOptions) => {
    target.addEventListener(name, listener as EventListener, eventOptions)
    cleanups.push(() => target.removeEventListener(name, listener as EventListener, eventOptions))
  }

  const down = (id: number, point: Point, eventTarget: EventTarget | null, pointerType: string) => {
    const now = performance.now()
    if (pointerType === 'touch') lastTouch = now
    else if (pointerType === 'mouse' && now - lastTouch < 800) return
    pointers.set(id, { ...point, startX: point.x, startY: point.y, startedAt: now, pointerType, moved: false })
    if (pointers.size >= 2) {
      const active = [...pointers.values()].slice(0, 2)
      pinchStartDistance = distanceOf(active)
      pinchScale = 1
      setMode('pinching')
      options.onPinchStart?.(centerOf(active))
      return
    }
    if (elementFromTarget(eventTarget)?.closest(interactiveSelector)) setMode('ui-interaction')
    else if (options.selectionText().trim()) setMode('selecting')
    else setMode('tap-candidate')
  }

  const move = (id: number, point: Point) => {
    const current = pointers.get(id)
    if (!current) return
    const previous = { x: current.x, y: current.y }
    current.x = point.x
    current.y = point.y
    if (pointers.size >= 2 || mode === 'pinching') {
      const active = [...pointers.values()].slice(0, 2)
      if (active.length === 2 && pinchStartDistance > 0) {
        pinchScale = distanceOf(active) / pinchStartDistance
        setMode('pinching')
        options.onPinchChange?.(pinchScale, centerOf(active))
      }
      return
    }
    if (mode === 'panning') {
      if (current.pointerType === 'mouse') options.onMousePan?.(previous.x - point.x, previous.y - point.y)
      return
    }
    if (mode !== 'tap-candidate') return
    const deltaX = current.x - current.startX
    const deltaY = current.y - current.startY
    if (Math.hypot(deltaX, deltaY) <= READER_GESTURE_LIMITS.tapDistance) return
    current.moved = true
    if (options.selectionText().trim()) setMode('selecting')
    else if (options.canPan()) setMode('panning')
    else if (Math.abs(deltaY) > Math.abs(deltaX) * READER_GESTURE_LIMITS.directionDominance) setMode('scrolling')
    else if (Math.abs(deltaX) > Math.abs(deltaY) * READER_GESTURE_LIMITS.directionDominance) setMode('swiping')
  }

  const up = (id: number, point: Point, cancelled = false) => {
    const current = pointers.get(id)
    if (!current) return
    current.x = point.x
    current.y = point.y
    if (mode === 'pinching') {
      pointers.delete(id)
      if (pointers.size < 2) {
        options.onPinchEnd?.(pinchScale, point)
        suppressNavigationUntil = performance.now() + 450
        pointers.clear()
        setMode('idle')
      }
      return
    }

    const gesture = classifyReaderGesture({
      deltaX: current.x - current.startX,
      deltaY: current.y - current.startY,
      durationMs: performance.now() - current.startedAt,
      cancelled,
      selecting: mode === 'selecting' || Boolean(options.selectionText().trim()),
      panning: mode === 'panning',
    })
    pointers.delete(id)

    if (performance.now() < suppressNavigationUntil) { if (!pointers.size) setMode('idle'); return }
    if (mode !== 'ui-interaction' && options.canSwipe() && gesture === 'swipe-next') options.onSwipe('next')
    else if (mode !== 'ui-interaction' && options.canSwipe() && gesture === 'swipe-previous') options.onSwipe('previous')
    else if (mode === 'tap-candidate' && !current.moved && gesture === 'tap') {
      options.onTap(point.x, options.width())
    }
    if (!pointers.size) setMode('idle')
  }

  add('selectionchange', () => { if (pointers.size && options.selectionText().trim()) setMode('selecting') })
  if (options.onEvent) for (const name of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart', 'touchend', 'click', 'selectionchange'] as const) add(name, () => options.onEvent?.(name), { passive: true })

  if (ownerWindow?.PointerEvent) {
    add('pointerdown', (event: PointerEvent) => { if (event.button === 0) down(event.pointerId, { x: event.clientX, y: event.clientY }, event.composedPath()[0] ?? event.target, event.pointerType) }, { passive: true })
    add('pointermove', (event: PointerEvent) => move(event.pointerId, { x: event.clientX, y: event.clientY }), { passive: true })
    add('pointerup', (event: PointerEvent) => up(event.pointerId, { x: event.clientX, y: event.clientY }), { passive: true })
    add('pointercancel', (event: PointerEvent) => up(event.pointerId, { x: event.clientX, y: event.clientY }, true), { passive: true })
  } else {
    add('touchstart', (event: TouchEvent) => {
      for (const touch of event.changedTouches) down(touch.identifier, { x: touch.clientX, y: touch.clientY }, event.target, 'touch')
    }, { passive: true })
    add('touchmove', (event: TouchEvent) => {
      for (const touch of event.changedTouches) move(touch.identifier, { x: touch.clientX, y: touch.clientY })
    }, { passive: true })
    add('touchend', (event: TouchEvent) => {
      for (const touch of event.changedTouches) up(touch.identifier, { x: touch.clientX, y: touch.clientY })
    }, { passive: true })
    add('touchcancel', (event: TouchEvent) => {
      for (const touch of event.changedTouches) up(touch.identifier, { x: touch.clientX, y: touch.clientY }, true)
    }, { passive: true })
    add('mousedown', (event: MouseEvent) => { if (event.button === 0) down(1, { x: event.clientX, y: event.clientY }, event.target, 'mouse') }, { passive: true })
    add('mousemove', (event: MouseEvent) => move(1, { x: event.clientX, y: event.clientY }), { passive: true })
    add('mouseup', (event: MouseEvent) => up(1, { x: event.clientX, y: event.clientY }), { passive: true })
  }

  return () => {
    for (const cleanup of cleanups) cleanup()
    pointers.clear()
    setMode('idle')
  }
}
