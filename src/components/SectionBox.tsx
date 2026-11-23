import { useEffect, useMemo, useState } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { createSectionBoxRaycast } from '../lib/sectionBoxPicking'

const ignoreRaycast = () => undefined
const viewDirection = new THREE.Vector3(1, 0.85, 1).normalize()

export function SectionBoxVisual({
  bounds,
  transform,
  rotationY = 0,
  selected = false,
  onSelect,
}: {
  bounds: THREE.Box3 | null
  transform?: THREE.Matrix4
  rotationY?: number
  selected?: boolean
  onSelect?: () => void
}) {
  const { gl, camera, size } = useThree()
  const [hovered, setHovered] = useState(false)
  const selectable = Boolean(onSelect)
  const helper = useMemo(() => {
    if (!bounds) return null
    const box = new THREE.Box3Helper(bounds, new THREE.Color('#2b8c79'))
    const material = box.material as THREE.LineBasicMaterial
    material.depthTest = false
    material.transparent = true
    material.opacity = 0.8
    box.renderOrder = 10
    return box
  }, [bounds])
  const raycast = useMemo(
    () =>
      bounds && selectable
        ? createSectionBoxRaycast(bounds, camera, size.width, size.height, undefined, transform)
        : ignoreRaycast,
    [bounds, camera, selectable, size.width, size.height, transform],
  )
  useEffect(() => setHovered(false), [bounds])
  useEffect(() => {
    if (!helper) return
    const material = helper.material as THREE.LineBasicMaterial
    material.color.set(selected ? '#357dcc' : hovered ? '#296f61' : '#2b8c79')
    material.opacity = selected || hovered ? 1 : 0.75
    material.linewidth = selected ? 2 : 1
  }, [helper, selected, hovered])
  useEffect(() => {
    if (!hovered || !selectable) return
    document.body.style.cursor = 'pointer'
    return () => {
      document.body.style.cursor = ''
    }
  }, [hovered, selectable])
  useEffect(() => {
    const canvas = gl.domElement
    canvas.dataset.sectionBox = bounds ? 'true' : 'false'
    canvas.dataset.sectionSelected = bounds && selected ? 'true' : 'false'
    if (bounds) {
      canvas.dataset.sectionMin = JSON.stringify(bounds.min.toArray())
      canvas.dataset.sectionMax = JSON.stringify(bounds.max.toArray())
      canvas.dataset.sectionRotationY = String(rotationY)
    } else {
      delete canvas.dataset.sectionMin
      delete canvas.dataset.sectionMax
      delete canvas.dataset.sectionRotationY
    }
    return () => {
      delete canvas.dataset.sectionBox
      delete canvas.dataset.sectionSelected
      delete canvas.dataset.sectionMin
      delete canvas.dataset.sectionMax
      delete canvas.dataset.sectionRotationY
    }
  }, [bounds, gl, rotationY, selected])
  useEffect(() => {
    if (!bounds || !onSelect) return
    const canvas = gl.domElement
    const previousTabIndex = canvas.getAttribute('tabindex')
    const previousDescription = canvas.getAttribute('aria-description')
    canvas.tabIndex = 0
    canvas.setAttribute('aria-description', '단면상자 윤곽선을 클릭하거나 Enter 키로 선택하세요.')
    const selectFromKeyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      event.stopPropagation()
      onSelect()
    }
    canvas.addEventListener('keydown', selectFromKeyboard)
    return () => {
      canvas.removeEventListener('keydown', selectFromKeyboard)
      if (previousTabIndex === null) canvas.removeAttribute('tabindex')
      else canvas.setAttribute('tabindex', previousTabIndex)
      if (previousDescription === null) canvas.removeAttribute('aria-description')
      else canvas.setAttribute('aria-description', previousDescription)
    }
  }, [bounds, gl, onSelect])
  useEffect(
    () => () => {
      helper?.geometry.dispose()
      if (helper) (helper.material as THREE.Material).dispose()
    },
    [helper],
  )
  return helper ? (
    <group matrix={transform} matrixAutoUpdate={false}>
      <primitive
        object={helper}
        raycast={raycast}
        onClick={(event: ThreeEvent<MouseEvent>) => {
          if (!onSelect) return
          event.stopPropagation()
          onSelect()
        }}
        onPointerOver={(event: ThreeEvent<PointerEvent>) => {
          if (!onSelect) return
          event.stopPropagation()
          setHovered(true)
        }}
        onPointerOut={() => setHovered(false)}
      />
    </group>
  ) : null
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
            minZoom: number
            maxZoom: number
            update: () => void
          })
        : null
    orbit?.target.copy(center)
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
    }
  }, [camera, controls, bounds, resetKey, size.width, size.height])
  return null
}
