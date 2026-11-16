import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test.describe.configure({ mode: 'default' })
test.setTimeout(90_000)

type Direction = { x: number; y: number }

const handle = (page: Page, axis: string, side: '최소' | '최대') =>
  page.getByRole('button', { name: `${axis} ${side} 단면 이동`, exact: true })
const slider = (page: Page, axis: string, side: '최소' | '최대') =>
  page.getByRole('slider', { name: `${axis} ${side}`, exact: true })
const details = (page: Page) => page.getByRole('article', { name: '선택한 부재 정보', exact: true })
const members = (page: Page) => page.getByRole('article', { name: '부재 목록', exact: true })

async function openBuilding(page: Page) {
  await page.goto('http://127.0.0.1:5173/?sample=building')
  await expect(page.getByLabel('건물 모델 3D 뷰어', { exact: true })).toBeVisible()
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
        const handles = [...document.querySelectorAll('.section-face-handle')].map((node) => ({
          name: node.getAttribute('aria-label'),
          button: node.getBoundingClientRect(),
          label: node.querySelector('.section-face-label')!.getBoundingClientRect(),
        }))
        const issues: string[] = []
        if (handles.length !== 6) issues.push(`Expected six handles, found ${handles.length}`)
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

test('face arrows resize the live sample, synchronize sliders and release camera controls', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await openBuilding(page)
  await page.getByRole('checkbox', { name: '단면상자', exact: true }).check()
  for (const axis of ['X', 'Y', 'Z']) {
    await expect(handle(page, axis, '최소')).toBeVisible()
    await expect(handle(page, axis, '최대')).toBeVisible()
  }
  const canvas = page.locator('canvas')
  await expect(canvas).toHaveAttribute('data-section-box', 'true')
  const beforeBounds = JSON.parse((await canvas.getAttribute('data-section-max'))!) as number[]
  const beforeDirections = await directions(page)
  await dragInward(page, handle(page, 'Y', '최대'), 70)
  await expect
    .poll(async () => Number(await slider(page, 'Y', '최대').inputValue()))
    .toBeLessThan(95)
  expect(Number(await slider(page, 'Y', '최대').inputValue())).toBeGreaterThan(1)
  await expect(slider(page, 'Y', '최소')).toHaveValue('0')
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
  await page.screenshot({ path: '/tmp/section-handles-desktop.png', fullPage: true })

  // Direct handles retain a keyboard path, and opposing faces cannot cross.
  await handle(page, 'Y', '최대').focus()
  await page.keyboard.press('Home')
  await expect(slider(page, 'Y', '최대')).toHaveValue('1')
  await page.keyboard.press('ArrowLeft')
  await expect(slider(page, 'Y', '최대')).toHaveValue('1')
  await page.keyboard.press('Shift+ArrowUp')
  await expect(slider(page, 'Y', '최대')).toHaveValue('11')
  await page.keyboard.press('End')
  await expect(slider(page, 'Y', '최대')).toHaveValue('100')
  await handle(page, 'Y', '최소').focus()
  await page.keyboard.press('End')
  await expect(slider(page, 'Y', '최소')).toHaveValue('99')
  await page.keyboard.press('ArrowRight')
  await expect(slider(page, 'Y', '최소')).toHaveValue('99')
  await page.keyboard.press('Home')
  await expect(slider(page, 'Y', '최소')).toHaveValue('0')
  await expectOrbitWorks(page)
  expect(errors).toEqual([])
})

test('direct arrows resize a selected real IFC member without changing its quantity or target', async ({
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
  await page.getByRole('checkbox', { name: '단면상자', exact: true }).check()
  const canvas = page.getByLabel('IFC 모델 3D 뷰어', { exact: true })
  await expect(canvas).toHaveAttribute('data-section-box', 'true')
  const beforeMin = JSON.parse((await canvas.getAttribute('data-section-min'))!) as number[]
  const beforeMax = JSON.parse((await canvas.getAttribute('data-section-max'))!) as number[]
  expect(beforeMax[1] - beforeMin[1]).toBeGreaterThan(3)
  expect(beforeMax[1] - beforeMin[1]).toBeLessThan(4)
  await dragInward(page, handle(page, 'Y', '최대'), 60)
  await expect
    .poll(async () => Number(await slider(page, 'Y', '최대').inputValue()))
    .toBeLessThan(95)
  const afterMax = JSON.parse((await canvas.getAttribute('data-section-max'))!) as number[]
  expect(afterMax[1]).toBeLessThan(beforeMax[1])
  await expect(page.getByRole('region', { name: '단면상자 범위', exact: true })).toContainText(
    '선택 부재 기준: Round concrete column G',
  )
  await expect(page.getByTestId('building-selected-volume')).toContainText('0.59')
  await expect(members(page).locator('tbody tr')).toHaveCount(5)
  await expectOrbitWorks(page)
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
    await page.getByRole('checkbox', { name: '단면상자', exact: true }).check()
    const button = handle(page, 'Y', '최대')
    await button.scrollIntoViewIfNeeded()
    const client = await context.newCDPSession(page)
    async function touchDrag(pixels: number, cancel: boolean) {
      const direction = await arrowDirection(button)
      const bounds = (await button.boundingBox())!
      const x = bounds.x + bounds.width / 2
      const y = bounds.y + bounds.height / 2
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x, y, id: 1 }],
      })
      for (let step = 1; step <= 6; step++) {
        await client.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [
            {
              x: x - (direction.x * pixels * step) / 6,
              y: y - (direction.y * pixels * step) / 6,
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
    const scrollBefore = await page.evaluate(() => window.scrollY)
    await touchDrag(40, false)
    await expect
      .poll(async () => Number(await slider(page, 'Y', '최대').inputValue()))
      .toBeLessThan(95)
    expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(scrollBefore, 0)
    await touchDrag(15, true)
    await expectOrbitWorks(page)
    await expectSeparatedHandles(page)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await page.screenshot({ path: '/tmp/section-handles-mobile.png', fullPage: true })
    await client.detach()
  } finally {
    await context.close()
  }
})
