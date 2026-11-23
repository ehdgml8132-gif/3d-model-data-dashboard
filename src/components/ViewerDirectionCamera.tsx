import { useEffect, useRef, type MutableRefObject } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'

export type ViewerDirection = 'front' | 'top' | 'right'

export type ViewerDirectionProps = {
  directionControl?: MutableRefObject<((direction: ViewerDirection) => void) | null>
  onDirectionChange?: (direction: ViewerDirection | null) => void
}

type Orbit = {
  target: THREE.Vector3
  update: () => void
  addEventListener: (type: 'change', callback: () => void) => void
  removeEventListener: (type: 'change', callback: () => void) => void
}

const directions: Record<ViewerDirection, THREE.Vector3> = {
  front: new THREE.Vector3(0, 0, 1),
  // The small southward offset keeps screen-up at −Z at the upper orbit pole.
  top: new THREE.Vector3(0, 1, 0.000001).normalize(),
  right: new THREE.Vector3(1, 0, 0),
}
const presets = Object.keys(directions) as ViewerDirection[]

export default function ViewerDirectionCamera({
  directionControl,
  onDirectionChange,
}: ViewerDirectionProps) {
  const camera = useThree((state) => state.camera)
  const controls = useThree((state) => state.controls)
  const canvas = useThree((state) => state.gl.domElement)
  const invalidate = useThree((state) => state.invalidate)
  const latest = useRef(onDirectionChange)
  latest.current = onDirectionChange

  useEffect(() => {
    if (!(camera instanceof THREE.OrthographicCamera) || !controls || !('target' in controls))
      return

    const orbit = controls as unknown as Orbit
    const offset = new THREE.Vector3()
    const lastOffset = new THREE.Vector3()
    let lastDirection: ViewerDirection | null | undefined
    const publish = () => {
      offset.subVectors(camera.position, orbit.target).normalize()
      if (lastDirection === undefined || offset.distanceToSquared(lastOffset) > 1e-12) {
        lastOffset.copy(offset)
        canvas.dataset.cameraDirection = JSON.stringify(
          offset.toArray().map((value) => Math.round(value * 1e6) / 1e6),
        )
      }
      const direction =
        presets.find((preset) => offset.distanceToSquared(directions[preset]) < 1e-8) ?? null
      if (direction === lastDirection) return
      lastDirection = direction
      if (direction) canvas.dataset.viewDirection = direction
      else delete canvas.dataset.viewDirection
      latest.current?.(direction)
    }

    const setDirection = (direction: ViewerDirection) => {
      const distance = camera.position.distanceTo(orbit.target)
      camera.position.copy(orbit.target).addScaledVector(directions[direction], distance)
      orbit.update()
      camera.updateMatrixWorld(true)
      publish()
      invalidate()
    }

    if (directionControl) directionControl.current = setDirection
    orbit.addEventListener('change', publish)
    publish()
    return () => {
      orbit.removeEventListener('change', publish)
      if (directionControl?.current === setDirection) directionControl.current = null
      delete canvas.dataset.cameraDirection
      delete canvas.dataset.viewDirection
    }
  }, [camera, canvas, controls, directionControl, invalidate])

  return null
}
