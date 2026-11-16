import { useEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'

const ignoreRaycast = () => undefined
const viewDirection = new THREE.Vector3(1, 0.85, 1).normalize()

export function SectionBoxVisual({ bounds }: { bounds: THREE.Box3 | null }) {
  const { gl } = useThree()
  const helper = useMemo(() => {
    if (!bounds) return null
    const box = new THREE.Box3Helper(bounds, new THREE.Color('#2b8c79'))
    box.raycast = ignoreRaycast
    const material = box.material as THREE.LineBasicMaterial
    material.depthTest = false
    material.transparent = true
    material.opacity = 0.8
    box.renderOrder = 10
    return box
  }, [bounds])
  useEffect(() => {
    const canvas = gl.domElement
    canvas.dataset.sectionBox = bounds ? 'true' : 'false'
    if (bounds) {
      canvas.dataset.sectionMin = JSON.stringify(bounds.min.toArray())
      canvas.dataset.sectionMax = JSON.stringify(bounds.max.toArray())
    } else {
      delete canvas.dataset.sectionMin
      delete canvas.dataset.sectionMax
    }
    return () => {
      delete canvas.dataset.sectionBox
      delete canvas.dataset.sectionMin
      delete canvas.dataset.sectionMax
    }
  }, [bounds, gl])
  useEffect(
    () => () => {
      helper?.geometry.dispose()
      if (helper) (helper.material as THREE.Material).dispose()
    },
    [helper],
  )
  return helper ? <primitive object={helper} /> : null
}

/** Fit once when the target box changes, not whenever a user moves a cut face. */
export function FrameBoxCamera({ bounds, resetKey }: { bounds: THREE.Box3; resetKey: number }) {
  const { camera, controls, size } = useThree()
  useEffect(() => {
    if (!(camera instanceof THREE.OrthographicCamera) || !size.width || !size.height) return
    const center = bounds.getCenter(new THREE.Vector3())
    const diameter = Math.max(bounds.getSize(new THREE.Vector3()).length(), 0.01)
    const orbit =
      controls && 'target' in controls
        ? (controls as unknown as {
            target: THREE.Vector3
            enableDamping: boolean
            minZoom: number
            maxZoom: number
            update: () => void
          })
        : null
    const damping = orbit?.enableDamping
    if (orbit) {
      orbit.enableDamping = false
      orbit.update()
      orbit.target.copy(center)
    }
    camera.position.copy(center).addScaledVector(viewDirection, diameter * 1.5)
    camera.near = Math.max(diameter / 10000, 0.00001)
    camera.far = diameter * 20
    camera.lookAt(center)
    camera.updateMatrixWorld(true)
    const projected = new THREE.Box3()
    for (const x of [bounds.min.x, bounds.max.x])
      for (const y of [bounds.min.y, bounds.max.y])
        for (const z of [bounds.min.z, bounds.max.z])
          projected.expandByPoint(
            new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse),
          )
    const extent = projected.getSize(new THREE.Vector3())
    camera.zoom = Math.min(
      size.width / (Math.max(extent.x, diameter * 0.01) * 1.22),
      size.height / (Math.max(extent.y, diameter * 0.01) * 1.22),
    )
    camera.updateProjectionMatrix()
    if (orbit) {
      orbit.minZoom = camera.zoom / 30
      orbit.maxZoom = camera.zoom * 100
      orbit.update()
      orbit.enableDamping = damping ?? true
    }
  }, [camera, controls, bounds, resetKey, size.width, size.height])
  return null
}
