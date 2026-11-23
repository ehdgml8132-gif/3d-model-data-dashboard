import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { Box3, OrthographicCamera, Vector3 } from 'three'

test.describe.configure({ mode: 'default' })
test.setTimeout(90_000)

type Bounds = { min: number[]; max: number[] }
const detail = (page: Page) => page.getByRole('article', { name: '선택한 부재 정보', exact: true })
const members = (page: Page) => page.getByRole('article', { name: '부재 목록', exact: true })
const handle = (page: Page, axis: string, side: '최소' | '최대') =>
  page.getByRole('button', { name: `${axis} ${side} 단면 이동`, exact: true })
const rotationGrip = (page: Page) =>
  page.getByRole('button', { name: '단면상자 수평 회전', exact: true })
const rotationTrigger = (page: Page) =>
  page.getByRole('button', { name: '회전 각도 입력', exact: true })
const rotationInput = (page: Page) =>
  page.getByRole('spinbutton', { name: '단면상자 회전 각도', exact: true })
const viewCube = (page: Page) => page.getByRole('group', { name: '뷰 방향', exact: true })
const graphData = (page: Page) =>
  page.getByRole('table', { name: '층별 그래프 데이터', exact: true })

const cameraDirections = {
  정면: { id: 'front', vector: [0, 0, 1] },
  오른쪽: { id: 'right', vector: [1, 0, 0] },
  평면: { id: 'top', vector: [0, 1, 0] },
  배면: { id: 'back', vector: [0, 0, -1] },
  좌측면: { id: 'left', vector: [-1, 0, 0] },
  아랫면: { id: 'bottom', vector: [0, -1, 0] },
}

async function expectCameraView(page: Page, canvas: Locator, view: keyof typeof cameraDirections) {
  const cube = viewCube(page)
  const button = cube.getByRole('button', { name: view, exact: true })
  const expected = cameraDirections[view]
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  await expect(cube.getByRole('button', { pressed: true })).toHaveCount(1)
  await expect(canvas).toHaveAttribute('data-view-direction', expected.id)
  await expect
    .poll(async () => {
      const data = await canvas.getAttribute('data-camera-direction')
      if (!data) return Infinity
      const direction = JSON.parse(data) as number[]
      return Math.hypot(...expected.vector.map((value, index) => direction[index] - value))
    })
    .toBeLessThanOrEqual(1e-5)
}

async function chooseCameraView(page: Page, canvas: Locator, view: keyof typeof cameraDirections) {
  await viewCube(page).getByRole('button', { name: view, exact: true }).click()
  await expectCameraView(page, canvas, view)
}

async function openRotationEditor(page: Page) {
  await rotationTrigger(page).click()
  await expect(rotationInput(page)).toBeFocused()
}

async function openBuilding(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '건물 모델 대시보드', exact: true })).toBeVisible()
  await expect(page.locator('canvas')).toBeVisible()
}

async function selectSampleMember(page: Page, id: string) {
  await members(page)
    .getByRole('button', { name: new RegExp(`^${id}.*선택$`) })
    .click()
  await expect(detail(page)).toContainText(id)
}

async function expectNoObjectSelection(page: Page) {
  await expect(detail(page)).toContainText('선택한 부재가 없습니다.')
  await expect(members(page).locator('tbody .selected-row')).toHaveCount(0)
}

async function boundsOf(canvas: Locator): Promise<Bounds> {
  await expect(canvas).toHaveAttribute('data-section-box', 'true')
  return {
    min: JSON.parse((await canvas.getAttribute('data-section-min'))!),
    max: JSON.parse((await canvas.getAttribute('data-section-max'))!),
  }
}

async function enableSection(page: Page) {
  await page.getByRole('checkbox', { name: '단면상자', exact: true }).check()
  await expect(page.locator('canvas')).toHaveAttribute('data-section-selected', 'false')
  await expect(page.locator('.section-face-handle')).toHaveCount(0)
  await expect(rotationGrip(page)).toHaveCount(0)
  await expect(rotationTrigger(page)).toHaveCount(0)
  await expect(rotationInput(page)).toHaveCount(0)
  await expect(page.getByRole('slider', { name: /^(?!투명도$)/ })).toHaveCount(0)
  await expect(page.getByRole('region', { name: '단면상자 범위', exact: true })).toHaveCount(0)
  return boundsOf(page.locator('canvas'))
}

// Click a real projected edge using the unchanged initial fit camera. The box
// may already be clipped, while its camera remains framed to the original bounds.
async function selectBox(page: Page, base: Bounds) {
  const canvas = page.locator('canvas')
  const viewport = (await canvas.boundingBox())!
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
  const current = await boundsOf(canvas)
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
  await canvas.click({ position: point })
  await expect(canvas).toHaveAttribute('data-section-selected', 'true')
  await expect(page.locator('.section-face-handle')).toHaveCount(6)
}

async function setFace(page: Page, axis: string, side: '최소' | '최대', target: number) {
  const button = handle(page, axis, side)
  const read = async () =>
    Number((await button.locator('.section-face-value').textContent())!.replace('%', ''))
  await button.focus()
  await button.press('Home')
  await expect.poll(read).toBe(side === '최소' ? 0 : 1)
  let remaining = target - (await read())
  while (remaining >= 10) {
    await button.press('Shift+ArrowUp')
    remaining -= 10
  }
  while (remaining-- > 0) await button.press('ArrowUp')
  await expect.poll(read).toBe(target)
}

test('box visibility, selection and clipping remain independent across floor and view changes', async ({
  page,
}) => {
  await openBuilding(page)
  await expectNoObjectSelection(page)
  await expect(page.getByRole('button', { name: '선택 해제', exact: true })).toBeDisabled()
  const base = await enableSection(page)
  expect(base.max[1] - base.min[1]).toBeGreaterThan(9)
  await selectBox(page, base)
  const canvas = page.locator('canvas')
  const rotation = rotationGrip(page)
  const rotationChip = rotationTrigger(page)
  const angle = rotationInput(page)
  await expect(rotation).toBeVisible()
  await expect(rotationChip).toHaveText('회전 0°')
  await expect(angle).toHaveCount(0)
  const gripBounds = (await rotation.boundingBox())!
  const chipBounds = (await rotationChip.boundingBox())!
  expect(chipBounds.y).toBeGreaterThanOrEqual(gripBounds.y + gripBounds.height)
  await expect(page.getByRole('slider')).toHaveCount(0)
  await expect(canvas).toHaveAttribute('data-section-rotation-y', '0')
  await rotation.press('ArrowRight')
  await expect(canvas).toHaveAttribute('data-section-rotation-y', '1')
  await rotation.press('Home')
  await expect(canvas).toHaveAttribute('data-section-rotation-y', '0')
  for (let step = 0; step < 3; step++) await rotation.press('Shift+ArrowRight')
  await expect(canvas).toHaveAttribute('data-section-rotation-y', '45')
  await expect(rotation).toHaveAttribute('aria-description', /^현재 45도\./)
  await expect(rotationChip).toHaveText('회전 45°')
  await expect(canvas).toHaveAttribute('data-camera-direction', /^\[/)
  const cameraDirection = (await canvas.getAttribute('data-camera-direction'))!

  await openRotationEditor(page)
  await expect(angle).toHaveAttribute('min', '-180')
  await expect(angle).toHaveAttribute('max', '180')
  await expect(angle).toHaveValue('45')
  await page.keyboard.type('-37.5')
  await expect(angle).toHaveValue('-37.5')
  await expect(canvas).toHaveAttribute('data-section-rotation-y', '45')
  await page.keyboard.press('Enter')
  await expect(angle).toHaveCount(0)
  await expect(rotationChip).toHaveText('회전 -37.5°')
  await expect(canvas).toHaveAttribute('data-section-rotation-y', '-37.5')
  await expect(rotation).toHaveAttribute('aria-description', /^현재 -37\.5도\./)

  await openRotationEditor(page)
  await page.keyboard.type('31')
  await expect(angle).toHaveValue('31')
  await page.keyboard.press('Escape')
  await expect(angle).toHaveCount(0)
  await expect(rotationChip).toHaveText('회전 -37.5°')
  await expect(canvas).toHaveAttribute('data-section-rotation-y', '-37.5')
  await expect(canvas).toHaveAttribute('data-section-selected', 'true')
  await expect(canvas).toHaveAttribute('data-camera-direction', cameraDirection)

  await openRotationEditor(page)
  await page.keyboard.type('181')
  await page.keyboard.press('Enter')
  await expect(angle).toHaveCount(0)
  await expect(rotationChip).toHaveText('회전 -37.5°')
  await expect(canvas).toHaveAttribute('data-section-rotation-y', '-37.5')
  expect(await boundsOf(canvas)).toEqual(base)
  await expect(members(page).locator('tbody tr')).toHaveCount(72)
  await expect(page.getByRole('region', { name: '건물 집계 지표' })).toContainText('64.53 m³')

  await setFace(page, 'Y', '최대', 55)
  const clipped = await boundsOf(page.locator('canvas'))
  await page.keyboard.press('Escape')
  await expect(page.locator('.section-face-handle')).toHaveCount(0)
  await expect(rotation).toHaveCount(0)
  await expect(rotationChip).toHaveCount(0)
  await expect(angle).toHaveCount(0)
  await expect(canvas).toHaveAttribute('data-section-rotation-y', '-37.5')
  expect(await boundsOf(page.locator('canvas'))).toEqual(clipped)
  await selectBox(page, base)
  await expect(rotation).toBeVisible()
  await expect(rotationChip).toHaveText('회전 -37.5°')
  for (const view of ['정면', '평면', '오른쪽'] as const) {
    await page.getByRole('button', { name: '3D 건물 시점 초기화', exact: true }).click()
    await chooseCameraView(page, canvas, view)
  }
  await expect(canvas).toHaveAttribute('data-section-rotation-y', '-37.5')
  await expect(rotationChip).toHaveText('회전 -37.5°')
  expect(await boundsOf(canvas)).toEqual(clipped)
  await page.getByRole('button', { name: '단면 회전 초기화', exact: true }).click()
  await expect(canvas).toHaveAttribute('data-section-rotation-y', '0')
  await expect(rotationChip).toHaveText('회전 0°')
  expect(await boundsOf(canvas)).toEqual(clipped)
  await page.locator('canvas').click({ position: { x: 12, y: 12 } })
  await expect(page.locator('.section-face-handle')).toHaveCount(0)
  expect(await boundsOf(page.locator('canvas'))).toEqual(clipped)

  await page.getByRole('button', { name: '2층', exact: true }).click()
  await expectNoObjectSelection(page)
  await expect(members(page).locator('tbody tr')).toHaveCount(24)
  expect(await boundsOf(page.locator('canvas'))).toEqual(clipped)
  const menu = page.getByRole('navigation', { name: '건물 메뉴', exact: true })
  await menu.getByRole('button', { name: '부재 데이터', exact: true }).click()
  await expect(page.locator('canvas')).toHaveCount(0)
  await menu.getByRole('button', { name: '공간 데이터', exact: true }).click()
  await expectNoObjectSelection(page)
  await expect(page.locator('.section-face-handle')).toHaveCount(0)
  expect(await boundsOf(page.locator('canvas'))).toEqual(clipped)
  await page.getByRole('button', { name: '단면 범위 초기화', exact: true }).click()
  expect(await boundsOf(page.locator('canvas'))).toEqual(base)
  await page.getByRole('checkbox', { name: '단면상자', exact: true }).uncheck()
  await expect(page.locator('canvas')).toHaveAttribute('data-section-box', 'false')
  await selectSampleMember(page, '2F-C09')
})

test('selecting the captured member box reveals arrows while clipping preserves model quantities', async ({
  page,
}, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await openBuilding(page)
  await selectSampleMember(page, '1F-C09')
  const base = await enableSection(page)
  expect(base.max[0] - base.min[0]).toBeLessThan(1)
  await selectSampleMember(page, '1F-C01')
  expect(await boundsOf(page.locator('canvas'))).toEqual(base)
  await page.getByRole('button', { name: '선택 해제', exact: true }).click()
  await expectNoObjectSelection(page)
  await selectBox(page, base)
  const before = await page.locator('canvas').screenshot()
  await setFace(page, 'Y', '최대', 45)
  const after = await page
    .locator('canvas')
    .screenshot({ path: testInfo.outputPath('sample-section-cut.png') })
  expect(after.equals(before)).toBe(false)
  const cut = await boundsOf(page.locator('canvas'))
  expect(cut.max[1]).toBeLessThan(base.max[1])
  await page.keyboard.press('Escape')
  await expect(page.locator('.section-face-handle')).toHaveCount(0)
  expect(await boundsOf(page.locator('canvas'))).toEqual(cut)
  await expect(members(page).locator('tbody tr')).toHaveCount(72)
  await expect(page.getByRole('region', { name: '건물 집계 지표' })).toContainText('64.53 m³')
  await selectBox(page, base)
  await handle(page, 'Y', '최대').press('Home')
  const narrow = await boundsOf(page.locator('canvas'))
  expect(narrow.max[1]).toBeGreaterThan(narrow.min[1])
  await page.getByRole('checkbox', { name: '단면상자', exact: true }).uncheck()
  const whole = await enableSection(page)
  expect(whole.max[0] - whole.min[0]).toBeGreaterThan(8)
  expect(errors).toEqual([])
})

test('IFC box selection uses placed geometry and resets after restoring the sample', async ({
  page,
}, testInfo) => {
  await openBuilding(page)
  await page.getByLabel('IFC 파일 선택', { exact: true }).setInputFiles({
    name: 'section-building.ifc',
    mimeType: 'application/octet-stream',
    buffer: await readFile(new URL('../public/examples/authored-building.ifc', import.meta.url)),
  })
  await expect(members(page).locator('tbody tr')).toHaveCount(5, { timeout: 45_000 })
  await expectNoObjectSelection(page)
  await members(page)
    .getByRole('button', { name: /Round concrete column G.*선택$/ })
    .click()
  const base = await enableSection(page)
  expect(base.max[0] - base.min[0]).toBeGreaterThan(0.49)
  expect(base.max[0] - base.min[0]).toBeLessThan(1)
  expect(base.max[1] - base.min[1]).toBeGreaterThan(3)
  expect(base.max[1] - base.min[1]).toBeLessThan(4)
  await selectBox(page, base)
  await setFace(page, 'X', '최대', 45)
  await setFace(page, 'Y', '최대', 65)
  await page.locator('canvas').screenshot({ path: testInfo.outputPath('ifc-section-cut.png') })
  await expect(page.getByTestId('building-selected-volume')).toContainText('0.59')
  await expect(members(page).locator('tbody tr')).toHaveCount(5)
  const clipped = await boundsOf(page.locator('canvas'))
  await page.keyboard.press('Escape')
  await expect(page.locator('.section-face-handle')).toHaveCount(0)
  await expectNoObjectSelection(page)
  await expect(page.getByRole('button', { name: '선택 해제', exact: true })).toBeDisabled()
  expect(await boundsOf(page.locator('canvas'))).toEqual(clipped)
  await members(page)
    .getByRole('button', { name: /Round concrete column G.*선택$/ })
    .click()
  await expect(detail(page)).toContainText('Round concrete column G')
  await selectBox(page, base)
  await page.locator('canvas').click({ position: { x: 12, y: 12 } })
  await expect(page.locator('.section-face-handle')).toHaveCount(0)
  await expectNoObjectSelection(page)
  await expect(page.getByRole('button', { name: '선택 해제', exact: true })).toBeDisabled()
  expect(await boundsOf(page.locator('canvas'))).toEqual(clipped)

  await page.setViewportSize({ width: 390, height: 844 })
  const canvas = page.getByLabel('IFC 모델 3D 뷰어', { exact: true })
  await canvas.press('Enter')
  const rotationChip = rotationTrigger(page)
  const angle = rotationInput(page)
  await expect(rotationChip).toHaveText('회전 0°')
  await openRotationEditor(page)
  await page.keyboard.type('28')
  await expect(angle).toHaveValue('28')
  await page.keyboard.press('Enter')
  await expect(angle).toHaveCount(0)
  await expect(rotationChip).toHaveText('회전 28°')
  await expect(canvas).toHaveAttribute('data-section-rotation-y', '28')
  const transparency = page.getByRole('slider', { name: '투명도', exact: true })
  await transparency.fill('35')
  await expect(transparency).toHaveValue('35')
  const opacityBounds = (await transparency.locator('..').boundingBox())!
  const cubeBounds = (await viewCube(page).boundingBox())!
  expect(
    cubeBounds.x + cubeBounds.width <= opacityBounds.x ||
      opacityBounds.x + opacityBounds.width <= cubeBounds.x ||
      cubeBounds.y + cubeBounds.height <= opacityBounds.y ||
      opacityBounds.y + opacityBounds.height <= cubeBounds.y,
  ).toBe(true)
  await chooseCameraView(page, canvas, '평면')
  await page.getByRole('button', { name: '3D 건물 시점 초기화', exact: true }).click()
  await chooseCameraView(page, canvas, '오른쪽')
  await page.getByRole('combobox', { name: '모든 뷰 방향' }).selectOption('bottom')
  await expectCameraView(page, canvas, '아랫면')
  await expect(canvas).toHaveAttribute('data-section-rotation-y', '28')
  await expect(rotationChip).toHaveText('회전 28°')
  await expect(transparency).toHaveValue('35')
  expect(await boundsOf(canvas)).toEqual(clipped)

  await page.getByRole('button', { name: '샘플로 돌아가기', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: '단면상자', exact: true })).not.toBeChecked()
  await expect(members(page).locator('tbody tr')).toHaveCount(72)
  await expectNoObjectSelection(page)
})

test('graphs and the unselected section box fit a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openBuilding(page)
  const charts = page.getByRole('region', { name: '건물 데이터 그래프', exact: true })
  await expect(charts.getByRole('heading', { name: '층별 체적', exact: true })).toBeVisible()
  await expect(charts.getByRole('heading', { name: '부재 종류 구성', exact: true })).toBeVisible()
  await charts.getByText('층별 수치 보기', { exact: true }).click()
  await expect(graphData(page).locator('tbody tr')).toHaveCount(3)
  await expect(graphData(page).locator('tbody tr').first()).toContainText('21.51')
  await page.getByRole('button', { name: '2층', exact: true }).click()
  await expect(graphData(page).locator('tbody tr')).toHaveCount(1)
  await expect(graphData(page)).toContainText('24')
  await charts.getByRole('button', { name: '부재 수', exact: true }).click()
  await expect(charts.getByRole('heading', { name: '층별 부재 수', exact: true })).toBeVisible()
  await enableSection(page)
  await expect(page.locator('input[type="range"]')).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.screenshot({ path: '/tmp/revit-section-mobile-outline.png', fullPage: true })
})

test('the view cube follows manual orbit and selects the back, left and bottom views', async ({
  page,
}) => {
  await openBuilding(page)
  const canvas = page.getByLabel('건물 모델 3D 뷰어', { exact: true })
  const cube = viewCube(page)
  const body = cube.locator('.viewer-cube-body')
  await chooseCameraView(page, canvas, '정면')
  await expect(body).toHaveCSS('transform', /^matrix3d\(/)
  const frontTransform = await body.evaluate((element) => getComputedStyle(element).transform)

  await canvas.scrollIntoViewIfNeeded()
  const bounds = (await canvas.boundingBox())!
  const x = bounds.x + bounds.width * 0.3
  const y = bounds.y + bounds.height * 0.6
  await page.mouse.move(x, y)
  await page.mouse.down()
  try {
    await page.mouse.move(x + bounds.height * 0.375, y - bounds.height / 12, { steps: 8 })
  } finally {
    await page.mouse.up()
  }
  await expect
    .poll(async () => {
      const data = await canvas.getAttribute('data-camera-direction')
      if (!data) return false
      return (JSON.parse(data) as number[]).every((coordinate) => coordinate < -0.25)
    })
    .toBe(true)
  await expect(body).not.toHaveCSS('transform', frontTransform)
  await expect(cube.getByRole('button', { pressed: true })).toHaveCount(0)
  for (const name of ['배면', '좌측면', '아랫면']) {
    await expect(cube.getByRole('button', { name, exact: true })).toBeEnabled()
  }
  await chooseCameraView(page, canvas, '배면')

  const allViews = page.getByRole('combobox', { name: '모든 뷰 방향', exact: true })
  await expect(allViews.getByRole('option', { name: '평면', exact: true })).toHaveAttribute(
    'value',
    'top',
  )
  for (const view of ['좌측면', '아랫면'] as const) {
    await allViews.selectOption(cameraDirections[view].id)
    await expectCameraView(page, canvas, view)
  }
})

test('donut tooltip follows the hovered slice without covering the ring or total', async ({
  page,
}) => {
  await openBuilding(page)
  const card = page.getByRole('article', { name: '부재 종류 구성', exact: true })
  const chart = card.getByRole('img', { name: '부재 종류별 개수 차트', exact: true })
  const sectors = chart.locator('path.recharts-sector')
  const total = chart.getByText('72', { exact: true })
  const tooltip = card.getByRole('tooltip')

  async function sliceGeometry(index: number) {
    const sector = sectors.nth(index)
    await expect(sector).toBeVisible()
    return sector.evaluate((node) => {
      const path = node as SVGPathElement
      const cx = Number(path.getAttribute('cx'))
      const cy = Number(path.getAttribute('cy'))
      // Recharts draws the outer arc first, then connects to the inner arc.
      const points = path
        .getAttribute('d')!
        .match(/-?[\d.]+/g)!
        .map(Number)
      const [startX, startY, outerRadius, , , largeArc, sweep, endX, endY, innerX, innerY] = points
      const angle = Math.atan2(startY + endY - 2 * cy, startX + endX - 2 * cx) + largeArc * Math.PI
      const gapAngle = Math.atan2(endY - cy, endX - cx) + (sweep ? 1 : -1) * (Math.PI / 120)
      const midRadius = (outerRadius + Math.hypot(innerX - cx, innerY - cy)) / 2
      const transform = path.getScreenCTM()!
      const screen = (x: number, y: number) => {
        const point = new DOMPoint(x, y).matrixTransform(transform)
        return { x: point.x, y: point.y }
      }
      const atAngle = (radians: number) =>
        screen(cx + Math.cos(radians) * midRadius, cy + Math.sin(radians) * midRadius)
      const center = screen(cx, cy)
      const edge = screen(cx + outerRadius, cy)
      return {
        center,
        point: atAngle(angle),
        gap: atAngle(gapAngle),
        radius: Math.hypot(edge.x - center.x, edge.y - center.y),
      }
    })
  }

  for (const { width, reducedMotion } of [
    { width: 1440, reducedMotion: 'no-preference' },
    { width: 360, reducedMotion: 'no-preference' },
    { width: 1440, reducedMotion: 'reduce' },
  ] as const) {
    await test.step(`${width}px, ${reducedMotion}`, async () => {
      await page.setViewportSize({ width, height: 844 })
      await page.emulateMedia({ reducedMotion })
      await expect
        .poll(() =>
          chart.evaluate((element) => {
            const svg = element.querySelector('svg')
            return svg ? Math.abs(svg.viewBox.baseVal.width - element.clientWidth) : Infinity
          }),
        )
        .toBeLessThanOrEqual(1)
      await card.scrollIntoViewIfNeeded()
      const cardBounds = (await card.boundingBox())!
      const first = await sliceGeometry(0)
      const second = await sliceGeometry(1)

      async function expectPlacement(
        { center, point, radius }: typeof first,
        name: string,
        count: string,
      ) {
        await expect(tooltip).toBeVisible()
        await expect(tooltip).toContainText(name)
        await expect(tooltip).toContainText(count)
        await expect(total).toBeVisible()
        const tip = (await tooltip.boundingBox())!
        const nearestX = Math.max(tip.x, Math.min(center.x, tip.x + tip.width))
        const nearestY = Math.max(tip.y, Math.min(center.y, tip.y + tip.height))
        const clearance = Math.hypot(nearestX - center.x, nearestY - center.y) - radius
        expect(clearance).toBeGreaterThan(1)
        if (width === 1440) {
          expect(clearance).toBeLessThan(35)
          const tipX = tip.x + tip.width / 2 - center.x
          const tipY = tip.y + tip.height / 2 - center.y
          const sliceX = point.x - center.x
          const sliceY = point.y - center.y
          const alignment =
            (tipX * sliceX + tipY * sliceY) / (Math.hypot(tipX, tipY) * Math.hypot(sliceX, sliceY))
          expect(alignment).toBeGreaterThan(0.9)
        }
        const bounds = (await total.boundingBox())!
        expect(
          tip.x + tip.width <= bounds.x ||
            bounds.x + bounds.width <= tip.x ||
            tip.y + tip.height <= bounds.y ||
            bounds.y + bounds.height <= tip.y,
        ).toBe(true)
        expect(tip.x).toBeGreaterThanOrEqual(Math.max(0, cardBounds.x))
        expect(tip.x + tip.width).toBeLessThanOrEqual(
          Math.min(width, cardBounds.x + cardBounds.width),
        )
        expect(tip.y).toBeGreaterThanOrEqual(Math.max(0, cardBounds.y))
        expect(tip.y + tip.height).toBeLessThanOrEqual(
          Math.min(844, cardBounds.y + cardBounds.height),
        )
      }

      await page.mouse.move(first.point.x, first.point.y)
      await expectPlacement(first, '기둥', '27개')
      const movement = await tooltip.evaluateHandle((element) => {
        const positions: {
          x: number
          y: number
          width: number
          height: number
          opacity: number
        }[] = []
        let frame = 0
        function sample() {
          const { x, y, width, height } = element.getBoundingClientRect()
          positions.push({
            x: x + width / 2,
            y: y + height / 2,
            width,
            height,
            opacity: Number(getComputedStyle(element).opacity),
          })
          frame = requestAnimationFrame(sample)
        }
        sample()
        return { element, positions, stop: () => cancelAnimationFrame(frame) }
      })
      try {
        await page.mouse.move(first.gap.x, first.gap.y)
        await expect(card.getByRole('tooltip', { includeHidden: true })).toContainText('기둥')
        await page.mouse.move(second.point.x, second.point.y)
        await expect(tooltip).toContainText('36개')
        expect(
          await tooltip.evaluate((node, original) => node === original.element, movement),
        ).toBe(true)
        await tooltip.evaluate(async (element) => {
          await Promise.all(element.getAnimations().map((animation) => animation.finished))
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        })
        await expectPlacement(second, '보', '36개')
        const positions = await movement.evaluate(({ positions }) => positions)
        expect(
          positions.every(
            ({ x, y, width, height, opacity }) =>
              opacity < 0.01 ||
              Math.hypot(
                Math.max(0, Math.abs(x - first.center.x) - width / 2),
                Math.max(0, Math.abs(y - first.center.y) - height / 2),
              ) >=
                first.radius - 1,
          ),
        ).toBe(true)
        if (width === 1440) {
          const start = positions[0]
          const end = positions.at(-1)!
          const traveled = positions.some(
            (point) =>
              Math.hypot(point.x - start.x, point.y - start.y) > 5 &&
              Math.hypot(point.x - end.x, point.y - end.y) > 5,
          )
          expect(traveled).toBe(reducedMotion === 'no-preference')
        }
      } finally {
        await movement.evaluate(({ stop }) => stop())
        await movement.dispose()
      }
      await page.mouse.move(0, 0)
      await expect(tooltip).toHaveCount(0)
    })
  }
})
