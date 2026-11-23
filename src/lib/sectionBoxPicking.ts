import * as THREE from 'three'

type EndPoint = { world: THREE.Vector3; clip: THREE.Vector4 }

// Clip against the near/far planes before dividing by W. A box edge behind the
// camera must never project across the viewport and become an invisible target.
function visibleSegment(a: EndPoint, b: EndPoint): [EndPoint, EndPoint] | undefined {
  let minimum = 0
  let maximum = 1
  for (const sign of [1, -1]) {
    const from = a.clip.w + sign * a.clip.z
    const to = b.clip.w + sign * b.clip.z
    if (from < 0 && to < 0) return undefined
    if (from < 0) minimum = Math.max(minimum, from / (from - to))
    else if (to < 0) maximum = Math.min(maximum, from / (from - to))
  }
  if (minimum > maximum) return undefined
  const interpolate = (amount: number): EndPoint => ({
    world: a.world.clone().lerp(b.world, amount),
    clip: a.clip.clone().lerp(b.clip, amount),
  })
  const start = minimum === 0 ? a : interpolate(minimum)
  const end = maximum === 1 ? b : interpolate(maximum)
  return start.clip.w > 0 && end.clip.w > 0 ? [start, end] : undefined
}

/** Pick the actual box edges with a CSS-pixel tolerance, independent of model
 * units and zoom. Bounds use the viewer's unrotated coordinates. Apply the
 * section rotation alone because Box3Helper already accounts for size and position.
 */
export function createSectionBoxRaycast(
  bounds: THREE.Box3,
  camera: THREE.Camera,
  width: number,
  height: number,
  tolerance = 9,
  transform?: THREE.Matrix4,
): THREE.LineSegments['raycast'] {
  const corners = Array.from({ length: 8 }, (_, index) => {
    const corner = new THREE.Vector3(
      index & 1 ? bounds.max.x : bounds.min.x,
      index & 2 ? bounds.max.y : bounds.min.y,
      index & 4 ? bounds.max.z : bounds.min.z,
    )
    return transform ? corner.applyMatrix4(transform) : corner
  })
  const edges = corners.flatMap((_, index) =>
    [1, 2, 4].filter((bit) => !(index & bit)).map((bit) => [index, index | bit]),
  )
  const valid =
    !bounds.isEmpty() &&
    corners.every((corner) => corner.toArray().every(Number.isFinite)) &&
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0 &&
    Number.isFinite(tolerance) &&
    tolerance >= 0

  return function (this: THREE.LineSegments, raycaster, intersections) {
    if (!valid) return
    const pointer = raycaster.ray.at(1, new THREE.Vector3()).project(camera)
    if (
      !Number.isFinite(pointer.x) ||
      !Number.isFinite(pointer.y) ||
      Math.abs(pointer.x) > 1 ||
      Math.abs(pointer.y) > 1
    )
      return
    const px = ((pointer.x + 1) * width) / 2
    const py = ((1 - pointer.y) * height) / 2
    const projection = new THREE.Matrix4().multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    )
    const projected = corners.map((world) => ({
      world,
      clip: new THREE.Vector4(world.x, world.y, world.z, 1).applyMatrix4(projection),
    }))
    let bestDistance = tolerance ** 2
    let bestPoint: THREE.Vector3 | undefined
    let bestIndex = 0
    edges.forEach(([from, to], index) => {
      const segment = visibleSegment(projected[from], projected[to])
      if (!segment) return
      const [a, b] = segment
      const ax = ((a.clip.x / a.clip.w + 1) * width) / 2
      const ay = ((1 - a.clip.y / a.clip.w) * height) / 2
      const bx = ((b.clip.x / b.clip.w + 1) * width) / 2
      const by = ((1 - b.clip.y / b.clip.w) * height) / 2
      const dx = bx - ax
      const dy = by - ay
      const lengthSquared = dx ** 2 + dy ** 2
      const amount = lengthSquared
        ? THREE.MathUtils.clamp(((px - ax) * dx + (py - ay) * dy) / lengthSquared, 0, 1)
        : 0
      const distance = (px - ax - amount * dx) ** 2 + (py - ay - amount * dy) ** 2
      if (!Number.isFinite(distance) || distance > bestDistance) return
      // Perspective-correct interpolation retains a point on the true world
      // edge rather than applying screen-space interpolation to world vertices.
      const worldAmount = (amount * a.clip.w) / ((1 - amount) * b.clip.w + amount * a.clip.w)
      bestDistance = distance
      bestPoint = a.world.clone().lerp(b.world, worldAmount)
      bestIndex = index
    })
    if (bestPoint)
      intersections.push({
        // The outline is drawn on top of the model. Give only actual edge hits
        // the same event priority so an occluding surface cannot swallow them.
        distance: 0,
        point: bestPoint,
        object: this,
        index: bestIndex,
      })
  }
}
