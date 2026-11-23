import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { Box3, OrthographicCamera, Vector3 } from 'three'

test.describe.configure({ mode: 'default' })
test.setTimeout(90_000)

type Direction = { x: number; y: number }
type Bounds = { min: number[]; max: number[] }

const handle = (page: Page, axis: string, side: '최소' | '최대') =>
  page.getByRole('button', { name: `${axis} ${side} 단면 이동`, exact: true })
const rotationGrip = (page: Page) =>
  page.getByRole('button', { name: '단면상자 수평 회전', exact: true })
const details = (page: Page) => page.getByRole('article', { name: '선택한 부재 정보', exact: true })
const members = (page: Page) => page.getByRole('article', { name: '부재 목록', exact: true })

async function openBuilding(page: Page) {
  await page.goto('http://127.0.0.1:5173/')
  await expect(page.getByLabel('건물 모델 3D 뷰어', { exact: true })).toBeVisible()
}

async function boundsOf(page: Page): Promise<Bounds> {
  const canvas = page.locator('canvas')
  await expect(canvas).toHaveAttribute('data-section-box', 'true')
  return {
    min: JSON.parse((await canvas.getAttribute('data-section-min'))!),
    max: JSON.parse((await canvas.getAttribute('data-section-max'))!),
  }
}

function fitSectionCamera(base: Bounds, viewport: { width: number; height: number }) {
  const initial = new Box3(new Vector3().fromArray(base.min), new Vector3().fromArray(base.max))
  const camera = new OrthographicCamera(
    -viewport.width / 2,
    viewport.width / 2,
    viewport.height / 2,
    -viewport.height / 2,
    0.00001,
    10000,
  )
  const center = initial.getCenter(new Vector3())
  const diameter = initial.getSize(new Vector3()).length()
  camera.position.copy(center).addScaledVector(new Vector3(1, 0.85, 1).normalize(), diameter * 1.5)
  camera.lookAt(center)
  camera.updateMatrixWorld(true)
  const projected = new Box3()
  for (const x of [base.min[0], base.max[0]])
    for (const y of [base.min[1], base.max[1]])
      for (const z of [base.min[2], base.max[2]])
        projected.expandByPoint(new Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse))
  const extent = projected.getSize(new Vector3())
  camera.zoom = Math.min(
    viewport.width / (Math.max(extent.x, diameter * 0.01) * 1.22),
    viewport.height / (Math.max(extent.y, diameter * 0.01) * 1.22),
  )
  camera.updateProjectionMatrix()
  return { camera, center }
}

async function selectBox(page: Page, base: Bounds, touch = false) {
  const canvas = page.locator('canvas')
  const viewport = (await canvas.boundingBox())!
  const { camera, center } = fitSectionCamera(base, viewport)
  const current = await boundsOf(page)
  const rotation = (Number(await canvas.getAttribute('data-section-rotation-y')) * Math.PI) / 180
  const up = new Vector3(0, 1, 0)
  const points: { x: number; y: number }[] = []
  for (let axis = 0; axis < 3; axis++) {
    const other = [0, 1, 2].filter((value) => value !== axis)
    for (const first of [0, 1])
      for (const second of [0, 1]) {
        const coordinates = current.min.map((value, index) => (value + current.max[index]) / 2)
        coordinates[other[0]] = (first ? current.max : current.min)[other[0]]
        coordinates[other[1]] = (second ? current.max : current.min)[other[1]]
        const point = new Vector3()
          .fromArray(coordinates)
          .sub(center)
          .applyAxisAngle(up, rotation)
          .add(center)
          .project(camera)
        points.push({
          x: ((point.x + 1) * viewport.width) / 2,
          y: ((1 - point.y) * viewport.height) / 2,
        })
      }
  }
  const point = points
    .filter(
      (point) =>
        point.x > 12 &&
        point.y > 12 &&
        point.x < viewport.width - 12 &&
        point.y < viewport.height - 12,
    )
    .sort((a, b) => a.y - b.y)[0]
  expect(point).toBeDefined()
  if (touch) await canvas.tap({ position: point })
  else await canvas.click({ position: point })
  await expect(canvas).toHaveAttribute('data-section-selected', 'true')
  await expect(page.locator('.section-face-handle')).toHaveCount(6)
}

async function enableSection(page: Page, touch = false) {
  await page.getByRole('checkbox', { name: '단면상자', exact: true }).check()
  await expect(page.locator('.section-face-handle')).toHaveCount(0)
  await expect(rotationGrip(page)).toHaveCount(0)
  await expect(page.getByRole('slider', { name: /^(?!투명도$)/ })).toHaveCount(0)
  await expect(page.locator('canvas')).toHaveAttribute('data-section-selected', 'false')
  const base = await boundsOf(page)
  await selectBox(page, base, touch)
  return base
}

async function faceValue(page: Page, axis: string, side: '최소' | '최대') {
  return Number(
    (await handle(page, axis, side).locator('.section-face-value').textContent())!.replace('%', ''),
  )
}

async function arrowDirection(button: Locator): Promise<Direction> {
  const arrow = button.locator('svg')
  await expect(arrow).toBeVisible()
  await expect
    .poll(() => arrow.evaluate((node) => getComputedStyle(node).transform !== 'none'))
    .toBe(true)
  return arrow.evaluate((node) => {
    // The visible arrow points right before its camera-dependent rotation.
    // Use that rendered direction, so the test also works after orbiting.
    const matrix = new DOMMatrix(getComputedStyle(node).transform)
    const length = Math.hypot(matrix.a, matrix.b)
    return { x: matrix.a / length, y: matrix.b / length }
  })
}

async function directions(page: Page) {
  return Promise.all(['X', 'Y', 'Z'].map((axis) => arrowDirection(handle(page, axis, '최대'))))
}

async function dragInward(page: Page, button: Locator, pixels: number) {
  await button.scrollIntoViewIfNeeded()
  const direction = await arrowDirection(button)
  const bounds = (await button.boundingBox())!
  const x = bounds.x + bounds.width / 2
  const y = bounds.y + bounds.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x - direction.x * pixels, y - direction.y * pixels, { steps: 10 })
  await page.mouse.up()
}

async function rotationGesture(page: Page, base: Bounds, pixels: number) {
  const grip = rotationGrip(page)
  await grip.scrollIntoViewIfNeeded()
  const box = (await grip.boundingBox())!
  const viewport = (await page.locator('canvas').boundingBox())!
  const { camera, center } = fitSectionCamera(base, viewport)
  const top = center.setY((await boundsOf(page)).max[1]).project(camera)
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  const dx = x - (viewport.x + ((top.x + 1) * viewport.width) / 2)
  const dy = y - (viewport.y + ((1 - top.y) * viewport.height) / 2)
  const radius = Math.hypot(dx, dy)
  return { x, y, moveX: (-dy * pixels) / radius, moveY: (dx * pixels) / radius }
}

async function rotationAngle(page: Page) {
  return Number(await page.locator('canvas').getAttribute('data-section-rotation-y'))
}

async function expectOrbitWorks(page: Page) {
  const canvas = page.locator('canvas')
  await canvas.scrollIntoViewIfNeeded()
  const before = await directions(page)
  const start = await canvas.evaluate((node) => {
    const bounds = node.getBoundingClientRect()
    for (const [x, y] of [
      [25, 25],
      [bounds.width - 25, 25],
      [25, bounds.height - 25],
    ]) {
      const point = { x: bounds.x + x, y: bounds.y + y }
      if (document.elementFromPoint(point.x, point.y) === node) return point
    }
    throw new Error('No unobstructed canvas point for the orbit gesture')
  })
  const bounds = (await canvas.boundingBox())!
  const delta = start.x < bounds.x + bounds.width / 2 ? 55 : -55
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + delta, start.y + 30, { steps: 8 })
  await page.mouse.up()
  await expect
    .poll(async () => {
      const after = await directions(page)
      return after.some(
        (direction, index) =>
          Math.hypot(direction.x - before[index].x, direction.y - before[index].y) > 0.015,
      )
    })
    .toBe(true)
}

async function expectSeparatedHandles(page: Page) {
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const canvas = document.querySelector('canvas')!.getBoundingClientRect()
        const handles = [
          ...document.querySelectorAll('.section-face-handle, .section-rotation-handle'),
        ].map((node) => ({
          name: node.getAttribute('aria-label'),
          button: node.getBoundingClientRect(),
          label: node
            .querySelector('.section-face-label, .section-rotation-label')!
            .getBoundingClientRect(),
        }))
        const issues: string[] = []
        if (handles.length !== 7) issues.push(`Expected seven handles, found ${handles.length}`)
        const overlaps = (left: DOMRect, right: DOMRect) =>
          Math.min(left.right, right.right) - Math.max(left.left, right.left) > 0.5 &&
          Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) > 0.5
        for (const [index, current] of handles.entries()) {
          for (const [part, bounds] of Object.entries({
            button: current.button,
            label: current.label,
          })) {
            if (
              bounds.left < canvas.left - 0.5 ||
              bounds.top < canvas.top - 0.5 ||
              bounds.right > canvas.right + 0.5 ||
              bounds.bottom > canvas.bottom + 0.5
            )
              issues.push(`${current.name} ${part} extends outside the viewer`)
          }
          for (const other of handles.slice(index + 1)) {
            if (overlaps(current.button, other.button))
              issues.push(`${current.name} overlaps ${other.name}`)
            if (
              overlaps(current.label, other.button) ||
              overlaps(other.label, current.button) ||
              overlaps(current.label, other.label)
            )
              issues.push(`${current.name} and ${other.name} labels overlap`)
          }
        }
        return issues
      }),
    )
    .toEqual([])
}

test('selecting the box reveals face arrows that resize the live sample and release camera controls', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await openBuilding(page)
  const base = await enableSection(page)
  for (const axis of ['X', 'Y', 'Z']) {
    await expect(handle(page, axis, '최소')).toBeVisible()
    await expect(handle(page, axis, '최대')).toBeVisible()
  }
  const canvas = page.locator('canvas')
  await expect(canvas).toHaveAttribute('data-section-box', 'true')
  const beforeBounds = JSON.parse((await canvas.getAttribute('data-section-max'))!) as number[]
  const beforeDirections = await directions(page)
  await dragInward(page, handle(page, 'Y', '최대'), 70)
  await expect.poll(() => faceValue(page, 'Y', '최대')).toBeLessThan(95)
  expect(await faceValue(page, 'Y', '최대')).toBeGreaterThan(1)
  await expect.poll(() => faceValue(page, 'Y', '최소')).toBe(0)
  const afterBounds = JSON.parse((await canvas.getAttribute('data-section-max'))!) as number[]
  expect(afterBounds[1]).toBeLessThan(beforeBounds[1])
  expect(afterBounds[0]).toBeCloseTo(beforeBounds[0], 8)
  expect(afterBounds[2]).toBeCloseTo(beforeBounds[2], 8)
  const afterDirections = await directions(page)
  afterDirections.forEach((direction, index) => {
    expect(direction.x).toBeCloseTo(beforeDirections[index].x, 5)
    expect(direction.y).toBeCloseTo(beforeDirections[index].y, 5)
  })
  await expect(details(page)).toContainText('선택한 부재가 없습니다.')
  await expect(members(page).locator('tbody tr')).toHaveCount(72)
  await expect(page.getByRole('region', { name: '건물 집계 지표' })).toContainText('64.53 m³')
  await page.screenshot({ path: '/tmp/revit-section-desktop-selected.png', fullPage: true })
  // Escape must deselect the box even while a captured pointer is dragging a
  // face, and the partial edit must survive the selection change.
  const activeButton = handle(page, 'Y', '최대')
  await activeButton.scrollIntoViewIfNeeded()
  const activeDirection = await arrowDirection(activeButton)
  const activeBounds = (await activeButton.boundingBox())!
  const activeX = activeBounds.x + activeBounds.width / 2
  const activeY = activeBounds.y + activeBounds.height / 2
  await page.mouse.move(activeX, activeY)
  await page.mouse.down()
  await page.mouse.move(activeX - activeDirection.x * 12, activeY - activeDirection.y * 12, {
    steps: 3,
  })
  await expect.poll(async () => (await boundsOf(page)).max[1]).toBeLessThan(afterBounds[1])
  const clipped = await boundsOf(page)
  await page.keyboard.press('Escape')
  await expect(page.locator('.section-face-handle')).toHaveCount(0)
  expect(await boundsOf(page)).toEqual(clipped)
  await page.mouse.up()
  await page.screenshot({ path: '/tmp/revit-section-desktop-outline.png', fullPage: true })
  await selectBox(page, base)

  // Direct handles retain a keyboard path, and opposing faces cannot cross.
  await handle(page, 'Y', '최대').focus()
  await page.keyboard.press('Home')
  await expect.poll(() => faceValue(page, 'Y', '최대')).toBe(1)
  await page.keyboard.press('ArrowLeft')
  await expect.poll(() => faceValue(page, 'Y', '최대')).toBe(1)
  await page.keyboard.press('Shift+ArrowUp')
  await expect.poll(() => faceValue(page, 'Y', '최대')).toBe(11)
  await page.keyboard.press('End')
  await expect.poll(() => faceValue(page, 'Y', '최대')).toBe(100)
  await handle(page, 'Y', '최소').focus()
  await page.keyboard.press('End')
  await expect.poll(() => faceValue(page, 'Y', '최소')).toBe(99)
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => faceValue(page, 'Y', '최소')).toBe(99)
  await page.keyboard.press('Home')
  await expect.poll(() => faceValue(page, 'Y', '최소')).toBe(0)

  const beforeRotation = await boundsOf(page)
  const { x, y, moveX, moveY } = await rotationGesture(page, base, 46)
  await page.mouse.move(x, y)
  await page.mouse.down()
  try {
    await page.mouse.move(x + moveX, y + moveY, { steps: 8 })
    await expect.poll(async () => Math.abs(await rotationAngle(page))).toBeGreaterThan(2)
  } finally {
    await page.mouse.up()
  }
  const viewport = (await canvas.boundingBox())!
  const { camera, center } = fitSectionCamera(base, viewport)
  const angle = ((await rotationAngle(page)) * Math.PI) / 180
  const projectedX = new Vector3(1, 0, 0)
    .applyAxisAngle(new Vector3(0, 1, 0), angle)
    .add(center)
    .project(camera)
    .sub(center.clone().project(camera))
  const expectedArrow = new Vector3(
    projectedX.x * viewport.width,
    -projectedX.y * viewport.height,
    0,
  ).normalize()
  await expect
    .poll(async () => {
      const arrow = await arrowDirection(handle(page, 'X', '최대'))
      return Math.hypot(arrow.x - expectedArrow.x, arrow.y - expectedArrow.y)
    })
    .toBeLessThan(0.01)
  expect(await boundsOf(page)).toEqual(beforeRotation)
  await expectOrbitWorks(page)
  expect(errors).toEqual([])
})

test('rotated IFC face arrows resize locally and the project restores the same cut', async ({
  page,
}) => {
  await openBuilding(page)
  await page.getByLabel('IFC 파일 선택', { exact: true }).setInputFiles({
    name: 'handle-building.ifc',
    mimeType: 'application/octet-stream',
    buffer: await readFile(new URL('../public/examples/authored-building.ifc', import.meta.url)),
  })
  await expect(members(page).locator('tbody tr')).toHaveCount(5, { timeout: 45_000 })
  await members(page)
    .getByRole('button', { name: /Round concrete column G.*선택$/ })
    .click()
  const base = await enableSection(page)
  const canvas = page.getByLabel('IFC 모델 3D 뷰어', { exact: true })
  await expect(canvas).toHaveAttribute('data-section-box', 'true')
  expect(base.max[1] - base.min[1]).toBeGreaterThan(3)
  expect(base.max[1] - base.min[1]).toBeLessThan(4)
  const rotation = rotationGrip(page)
  const xHandle = handle(page, 'X', '최대')
  const beforeDirection = await arrowDirection(xHandle)
  for (let step = 0; step < 3; step++) await rotation.press('Shift+ArrowUp')
  await expect(canvas).toHaveAttribute('data-section-rotation-y', '45')
  expect(await boundsOf(page)).toEqual(base)
  await expect
    .poll(async () => {
      const direction = await arrowDirection(xHandle)
      return Math.hypot(direction.x - beforeDirection.x, direction.y - beforeDirection.y)
    })
    .toBeGreaterThan(0.1)
  await dragInward(page, xHandle, 20)
  await expect.poll(() => faceValue(page, 'X', '최대')).toBeLessThan(95)
  const cutX = await boundsOf(page)
  expect(cutX.min).toEqual(base.min)
  expect(cutX.max[0]).toBeLessThan(base.max[0])
  expect(cutX.max.slice(1)).toEqual(base.max.slice(1))
  await dragInward(page, handle(page, 'Y', '최대'), 60)
  await expect.poll(() => faceValue(page, 'Y', '최대')).toBeLessThan(95)
  const clipped = await boundsOf(page)
  expect(clipped.max[1]).toBeLessThan(base.max[1])
  await expect(details(page)).toContainText('Round concrete column G')
  await expect(page.getByTestId('building-selected-volume')).toContainText('0.59')
  await expect(members(page).locator('tbody tr')).toHaveCount(5)
  await page.keyboard.press('Escape')
  await expect(rotation).toHaveCount(0)
  await selectBox(page, base)
  await expect(rotation).toBeVisible()
  await expect(canvas).toHaveAttribute('data-section-rotation-y', '45')
  await expectOrbitWorks(page)

  const toolbar = page.getByRole('region', { name: '프로젝트 작업공간', exact: true })
  const openProject = toolbar.getByRole('button', { name: '프로젝트 열기', exact: true })
  await toolbar.getByRole('button', { name: '프로젝트 저장', exact: true }).click()
  await expect(openProject).toBeEnabled()
  await page.getByRole('button', { name: '샘플로 돌아가기', exact: true }).click()
  await expect(members(page).locator('tbody tr')).toHaveCount(72)
  await openProject.click()
  const picker = page.getByRole('dialog', { name: '프로젝트 열기', exact: true })
  await picker.getByRole('button', { name: 'handle-building 열기', exact: true }).click()
  await expect(picker).toHaveCount(0, { timeout: 45_000 })
  await expect(canvas).toHaveAttribute('data-section-rotation-y', '45')
  await expect(canvas).toHaveAttribute('data-section-selected', 'false')
  expect(await boundsOf(page)).toEqual(clipped)
  await expect(rotation).toHaveCount(0)
  await canvas.press('Enter')
  await expect(rotation).toBeVisible()
})

test('touch dragging does not scroll the page and touch cancellation restores orbiting', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  })
  try {
    const page = await context.newPage()
    await openBuilding(page)
    const base = await enableSection(page, true)
    const button = handle(page, 'Y', '최대')
    await button.scrollIntoViewIfNeeded()
    const client = await context.newCDPSession(page)
    async function touchGesture(
      x: number,
      y: number,
      moveX: number,
      moveY: number,
      cancel: boolean,
    ) {
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x, y, id: 1 }],
      })
      for (let step = 1; step <= 6; step++) {
        await client.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [
            {
              x: x + (moveX * step) / 6,
              y: y + (moveY * step) / 6,
              id: 1,
            },
          ],
        })
      }
      await client.send('Input.dispatchTouchEvent', {
        type: cancel ? 'touchCancel' : 'touchEnd',
        touchPoints: [],
      })
    }
    async function touchDrag(pixels: number, cancel: boolean) {
      const direction = await arrowDirection(button)
      const bounds = (await button.boundingBox())!
      await touchGesture(
        bounds.x + bounds.width / 2,
        bounds.y + bounds.height / 2,
        -direction.x * pixels,
        -direction.y * pixels,
        cancel,
      )
    }
    const scrollBefore = await page.evaluate(() => window.scrollY)
    await touchDrag(40, false)
    await expect.poll(() => faceValue(page, 'Y', '최대')).toBeLessThan(95)
    expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(scrollBefore, 0)
    await touchDrag(15, true)
    const { x, y, moveX, moveY } = await rotationGesture(page, base, 23)
    const scrollBeforeRotation = await page.evaluate(() => window.scrollY)
    await touchGesture(x, y, moveX, moveY, false)
    await expect.poll(async () => Math.abs(await rotationAngle(page))).toBeGreaterThan(2)
    expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(scrollBeforeRotation, 0)
    await expectOrbitWorks(page)
    await expectSeparatedHandles(page)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await page.screenshot({ path: '/tmp/revit-section-mobile-selected.png', fullPage: true })
    await client.detach()
  } finally {
    await context.close()
  }
})
