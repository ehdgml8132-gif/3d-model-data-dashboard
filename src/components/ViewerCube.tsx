import { useLayoutEffect, useRef, type MutableRefObject } from 'react'
import type { ViewerCubeOrientationHandler, ViewerDirection } from './ViewerDirectionCamera'
import './viewer-cube.css'

const faces = [
  { direction: 'front', name: '정면', label: '정면', axis: 'z', sign: 1 },
  { direction: 'top', name: '평면', label: '평면', axis: 'y', sign: 1 },
  { direction: 'right', name: '오른쪽', label: '우측', axis: 'x', sign: 1 },
  { direction: 'back', name: '배면', label: '배면', axis: 'z', sign: -1 },
  { direction: 'left', name: '좌측면', label: '좌측', axis: 'x', sign: -1 },
  { direction: 'bottom', name: '아랫면', label: '아래', axis: 'y', sign: -1 },
] satisfies {
  direction: ViewerDirection
  name: string
  label: string
  axis: 'x' | 'y' | 'z'
  sign: 1 | -1
}[]

export default function ViewerCube({
  direction,
  onSelect,
  orientationControl,
}: {
  direction: ViewerDirection | null
  onSelect: (direction: ViewerDirection) => void
  orientationControl: MutableRefObject<ViewerCubeOrientationHandler | null>
}) {
  const cube = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLSelectElement>(null)

  useLayoutEffect(() => {
    const body = cube.current
    if (!body) return
    const buttons = [...body.querySelectorAll('button')]
    const orient: ViewerCubeOrientationHandler = (transform, x, y, z) => {
      body.style.transform = transform
      const offset = { x, y, z }
      for (const [index, face] of faces.entries()) {
        const button = buttons[index]
        const visible = offset[face.axis] * face.sign > 0.001
        if (button.dataset.visible === String(visible)) continue
        if (!visible && document.activeElement === button)
          menu.current?.focus({ preventScroll: true })
        button.dataset.visible = String(visible)
        button.tabIndex = visible ? 0 : -1
        if (visible) button.removeAttribute('aria-hidden')
        else button.setAttribute('aria-hidden', 'true')
      }
    }
    orientationControl.current = orient
    return () => {
      if (orientationControl.current === orient) orientationControl.current = null
    }
  }, [orientationControl])

  useLayoutEffect(() => {
    if (menu.current) menu.current.value = direction ?? ''
  }, [direction])

  return (
    <div className="viewer-cube" role="group" aria-label="뷰 방향">
      <div className="viewer-cube-stage">
        <div ref={cube} className="viewer-cube-body">
          {faces.map((face) => (
            <button
              key={face.direction}
              type="button"
              className="viewer-cube-face"
              data-direction={face.direction}
              data-visible={face.sign === 1}
              aria-hidden={face.sign === -1 || undefined}
              tabIndex={face.sign === 1 ? 0 : -1}
              aria-label={face.name}
              title={face.name + ' 보기'}
              aria-pressed={direction === face.direction}
              onClick={() => onSelect(face.direction)}
            >
              {face.label}
            </button>
          ))}
        </div>
      </div>
      <div className="viewer-cube-menu">
        <select
          ref={menu}
          aria-label="모든 뷰 방향"
          onChange={(event) => {
            const face = faces.find((item) => item.direction === event.currentTarget.value)
            if (face) onSelect(face.direction)
          }}
        >
          {faces.map((face) => (
            <option key={face.direction} value={face.direction}>
              {face.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
