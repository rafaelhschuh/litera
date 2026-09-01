import { describe, expect, it, vi } from 'vitest'
import { attachReaderInput } from '../src/web/lib/reader-input.js'

function input(pointerEvents = true) {
  const target = Object.assign(new EventTarget(), { nodeType: 9, defaultView: { PointerEvent: pointerEvents ? Event : undefined } })
  const tap = vi.fn(), swipe = vi.fn()
  const cleanup = attachReaderInput(target as unknown as Document, { width: () => 390, selectionText: () => '', canPan: () => false, canSwipe: () => true, onTap: tap, onSwipe: swipe })
  const send = (name: string, x: number, y: number, extras = {}) => target.dispatchEvent(Object.assign(new Event(name), { pointerId: 1, button: 0, pointerType: 'touch', clientX: x, clientY: y, ...extras }))
  return { target, tap, swipe, cleanup, send }
}
describe('actual reader input listeners', () => {
  it('fires one tap, ignores right click, cancellation and return-to-origin drags', () => {
    const controls = input()
    controls.send('pointerdown', 350, 300); controls.send('pointerup', 350, 300)
    expect(controls.tap).toHaveBeenCalledOnce()
    controls.send('pointerdown', 350, 300, { button: 2 }); controls.send('pointerup', 350, 300)
    controls.send('pointerdown', 350, 300); controls.send('pointercancel', 350, 300)
    controls.send('pointerdown', 350, 300); controls.send('pointermove', 350, 390); controls.send('pointerup', 350, 300)
    expect(controls.tap).toHaveBeenCalledOnce()
    controls.cleanup(); controls.send('pointerdown', 350, 300); controls.send('pointerup', 350, 300)
    expect(controls.tap).toHaveBeenCalledOnce()
  })
  it('navigates on horizontal swipe and rejects diagonal and pinch', () => {
    const controls = input()
    controls.send('pointerdown', 300, 300); controls.send('pointermove', 200, 310); controls.send('pointerup', 200, 310)
    expect(controls.swipe).toHaveBeenCalledWith('next')
    controls.send('pointerdown', 300, 300); controls.send('pointermove', 240, 355); controls.send('pointerup', 240, 355)
    controls.send('pointerdown', 300, 300); controls.send('pointerdown', 200, 300, { pointerId: 2 }); controls.send('pointerup', 190, 300, { pointerId: 2 }); controls.send('pointerup', 300, 300)
    expect(controls.swipe).toHaveBeenCalledOnce(); expect(controls.tap).not.toHaveBeenCalled()
    controls.cleanup()
  })
  it('suppresses synthetic mouse events after fallback touch', () => {
    const controls = input(false)
    const changedTouches = [{ identifier: 1, clientX: 350, clientY: 300 }]
    controls.target.dispatchEvent(Object.assign(new Event('touchstart'), { changedTouches }))
    controls.target.dispatchEvent(Object.assign(new Event('touchend'), { changedTouches }))
    controls.send('mousedown', 350, 300); controls.send('mouseup', 350, 300)
    expect(controls.tap).toHaveBeenCalledOnce(); controls.cleanup()
  })
})
