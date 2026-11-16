import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { ProjectCamera } from '../projects/types'

type Props = {
  restore: ProjectCamera | null
  restoreKey: number
  onChange: (pose: ProjectCamera) => void
  captureRef: MutableRefObject<(() => ProjectCamera) | null>
}

type Orbit = {
  target: THREE.Vector3
  enableDamping: boolean
  minZoom: number
  maxZoom: number
  update: () => void
  addEventListener: (type: 'change' | 'end', callback: () => void) => void
  removeEventListener: (type: 'change' | 'end', callback: () => void) => void
}

function validPose(pose: ProjectCamera | null): pose is ProjectCamera {
  return Boolean(
    pose &&
      [...pose.position, ...pose.target, pose.zoom, ...pose.viewport].every(Number.isFinite) &&
      pose.zoom > 0 &&
      pose.viewport[0] > 0 &&
      pose.viewport[1] > 0,
  )
}

function samePose(previous: ProjectCamera | null, next: ProjectCamera) {
  if (!previous) return false
  const before = [...previous.position, ...previous.target, previous.zoom, ...previous.viewport]
  const after = [...next.position, ...next.target, next.zoom, ...next.viewport]
  return before.every(
    (value, index) => Math.abs(value - after[index]) <= Math.max(1e-8, Math.abs(value) * 1e-8),
  )
}

/** Mount after the viewer's fit camera. A project pose is restored once, while
 * later orbiting, filtering and view resets remain controlled by the viewer.
 */
export default function ProjectCameraSync({ restore, restoreKey, onChange, captureRef }: Props) {
  const { camera, controls, size } = useThree()
  const orbit = controls && 'target' in controls ? (controls as unknown as Orbit) : null
  const latest = useRef({ restore, onChange })
  latest.current = { restore, onChange }
  const viewportReady = size.width > 0 && size.height > 0
  const viewport = useRef<[number, number]>([size.width, size.height])
  if (viewportReady) viewport.current = [size.width, size.height]
  const applied = useRef<{ camera: THREE.Camera; orbit: Orbit; key: number } | null>(null)
  const restoring = useRef(false)
  const reported = useRef<ProjectCamera | null>(null)

  const capture = useCallback((): ProjectCamera => {
    const target =
      orbit?.target ?? camera.position.clone().add(camera.getWorldDirection(new THREE.Vector3()))
    return {
      position: camera.position.toArray() as [number, number, number],
      target: target.toArray() as [number, number, number],
      zoom: camera instanceof THREE.OrthographicCamera ? camera.zoom : 1,
      viewport: [Math.max(viewport.current[0], 1), Math.max(viewport.current[1], 1)],
    }
  }, [camera, orbit])

  const publish = useCallback(() => {
    if (!applied.current || restoring.current) return
    const pose = capture()
    if (!validPose(pose) || samePose(reported.current, pose)) return
    reported.current = pose
    latest.current.onChange(pose)
  }, [capture])

  useEffect(() => {
    if (!(camera instanceof THREE.OrthographicCamera) || !orbit || !size.width || !size.height)
      return
    if (
      applied.current?.camera === camera &&
      applied.current.orbit === orbit &&
      applied.current.key === restoreKey
    )
      return

    const pose = latest.current.restore
    restoring.current = true
    const damping = orbit.enableDamping
    try {
      if (validPose(pose)) {
        // Consume previous drag inertia before installing the saved target.
        orbit.enableDamping = false
        orbit.update()
        orbit.target.fromArray(pose.target)
        camera.position.fromArray(pose.position)
        camera.zoom =
          pose.zoom * Math.min(size.width / pose.viewport[0], size.height / pose.viewport[1])
        camera.lookAt(orbit.target)
        camera.updateProjectionMatrix()
        camera.updateMatrixWorld(true)
        orbit.minZoom = camera.zoom / 30
        orbit.maxZoom = camera.zoom * 100
        orbit.update()
      }
      applied.current = { camera, orbit, key: restoreKey }
    } finally {
      orbit.enableDamping = damping
      restoring.current = false
    }
    publish()
  }, [camera, orbit, publish, restoreKey, size.width, size.height])

  useEffect(() => {
    if (!(camera instanceof THREE.OrthographicCamera) || !orbit || !viewportReady) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const changed = () => {
      if (restoring.current) return
      if (timer !== undefined) clearTimeout(timer)
      // Orbit damping emits changes on each frame. Persist only a settled
      // snapshot; Save can still read the exact current pose through captureRef.
      timer = setTimeout(() => {
        timer = undefined
        publish()
      }, 140)
    }
    captureRef.current = capture
    orbit.addEventListener('change', changed)
    orbit.addEventListener('end', changed)
    return () => {
      if (timer !== undefined) clearTimeout(timer)
      orbit.removeEventListener('change', changed)
      orbit.removeEventListener('end', changed)
      publish()
      if (captureRef.current === capture) captureRef.current = null
    }
  }, [camera, orbit, capture, captureRef, publish, viewportReady])

  useEffect(
    () => () => {
      // StrictMode replays effect setup after the fit camera replays its own
      // reset. Clearing here allows the saved pose to be applied again then,
      // without reapplying it during ordinary viewport-size updates.
      applied.current = null
    },
    [],
  )

  return null
}
