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
const graphData = (page: Page) =>
  page.getByRole('table', { name: '층별 그래프 데이터', exact: true })

async function openBuilding(page: Page) {
  await page.goto('/?sample=building')
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
  await expect(page.locator('input[type="range"]')).toHaveCount(0)
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
  const points: { x: number; y: number }[] = []
  for (let axis = 0; axis < 3; axis++) {
    const other = [0, 1, 2].filter((value) => value !== axis)
    for (const first of [0, 1])
      for (const second of [0, 1]) {
        const coordinates = current.min.map((value, index) => (value + current.max[index]) / 2)
        coordinates[other[0]] = (first ? current.max : current.min)[other[0]]
        coordinates[other[1]] = (second ? current.max : current.min)[other[1]]
        const point = new Vector3().fromArray(coordinates).project(camera)
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
  await setFace(page, 'Y', '최대', 55)
  const clipped = await boundsOf(page.locator('canvas'))
  await page.keyboard.press('Escape')
  await expect(page.locator('.section-face-handle')).toHaveCount(0)
  expect(await boundsOf(page.locator('canvas'))).toEqual(clipped)
  await selectBox(page, base)
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
  await page.getByRole('button', { name: '선택 해제', exact: true }).click()
  await expect(page.locator('.section-face-handle')).toHaveCount(0)
  await expectNoObjectSelection(page)
  await page.getByRole('button', { name: '샘플로 돌아가기', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: '단면상자', exact: true })).not.toBeChecked()
  await expect(members(page).locator('tbody tr')).toHaveCount(72)
  await expectNoObjectSelection(page)
})

test('graphs remain visible and the slider-free box layout fits a mobile viewport', async ({
  page,
}) => {
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
