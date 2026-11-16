import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

// IFC/WebGL cases run in one worker; each case still starts with a fresh page.
test.describe.configure({ mode: 'default' })
test.setTimeout(90_000)

function detail(page: Page) {
  return page.getByRole('article', { name: '선택한 부재 정보', exact: true })
}

function members(page: Page) {
  return page.getByRole('article', { name: '부재 목록', exact: true })
}

function sectionControls(page: Page) {
  return page.getByRole('region', { name: '단면상자 범위', exact: true })
}

function graphData(page: Page) {
  return page.getByRole('table', { name: '층별 그래프 데이터', exact: true })
}

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

async function setRange(input: Locator, value: number) {
  // Dispatch the browser's normal input event through the native value setter,
  // so React receives the same update as dragging the range thumb.
  await input.evaluate((node, next) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(node, String(next))
    node.dispatchEvent(new Event('input', { bubbles: true }))
    node.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
  await expect(input).toHaveValue(String(value))
}

async function expectNoSelection(page: Page) {
  await expect(
    detail(page).getByRole('heading', { name: '선택한 부재가 없습니다.', exact: true }),
  ).toBeVisible()
  await expect(members(page).locator('tbody .selected-row')).toHaveCount(0)
}

async function sectionBounds(canvas: Locator) {
  await expect(canvas).toHaveAttribute('data-section-box', 'true')
  return {
    min: JSON.parse((await canvas.getAttribute('data-section-min'))!) as number[],
    max: JSON.parse((await canvas.getAttribute('data-section-max'))!) as number[],
  }
}

test('deselection stays empty and a whole-building section survives floor and view switches', async ({
  page,
}) => {
  await openBuilding(page)
  await page.getByRole('button', { name: '선택 해제', exact: true }).click()
  await expectNoSelection(page)
  await page.getByRole('checkbox', { name: '단면상자', exact: true }).check()
  await expect(sectionControls(page)).toContainText('전체 건물 기준')
  const wholeBuilding = await sectionBounds(page.locator('canvas'))
  expect(wholeBuilding.max[1] - wholeBuilding.min[1]).toBeGreaterThan(9)
  await expect(sectionControls(page).getByRole('slider')).toHaveCount(6)
  await setRange(page.getByRole('slider', { name: 'Y 최대', exact: true }), 55)

  await page.getByRole('button', { name: '2층', exact: true }).click()
  await expectNoSelection(page)
  await expect(sectionControls(page)).toContainText('전체 건물 기준')
  await expect(page.getByRole('slider', { name: 'Y 최대', exact: true })).toHaveValue('55')
  await expect(members(page).locator('tbody tr')).toHaveCount(24)

  const menu = page.getByRole('navigation', { name: '건물 메뉴', exact: true })
  await menu.getByRole('button', { name: '부재 데이터', exact: true }).click()
  await expect(page.locator('canvas')).toHaveCount(0)
  await menu.getByRole('button', { name: '공간 데이터', exact: true }).click()
  await expect(page.locator('canvas')).toBeVisible()
  await expectNoSelection(page)
  await expect(page.getByRole('checkbox', { name: '단면상자', exact: true })).toBeChecked()
  await expect(page.getByRole('slider', { name: 'Y 최대', exact: true })).toHaveValue('55')

  await page.getByRole('button', { name: '단면 범위 초기화', exact: true }).click()
  for (const axis of ['X', 'Y', 'Z']) {
    await expect(page.getByRole('slider', { name: `${axis} 최소`, exact: true })).toHaveValue('0')
    await expect(page.getByRole('slider', { name: `${axis} 최대`, exact: true })).toHaveValue('100')
  }
  await page.getByRole('checkbox', { name: '단면상자', exact: true }).uncheck()
  await expect(sectionControls(page)).toHaveCount(0)
  await selectSampleMember(page, '2F-C09')
})

test('a member section captures its target and slider cuts change the live viewer without changing quantities', async ({
  page,
}, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await openBuilding(page)
  await selectSampleMember(page, '1F-C09')
  await page.getByRole('checkbox', { name: '단면상자', exact: true }).check()
  await expect(sectionControls(page)).toContainText('선택 부재 기준: 1F 기둥 9')
  await selectSampleMember(page, '1F-C01')
  await expect(sectionControls(page)).toContainText('선택 부재 기준: 1F 기둥 9')
  await page.getByRole('button', { name: '선택 해제', exact: true }).click()
  await expectNoSelection(page)
  await expect(sectionControls(page)).toContainText('선택 부재 기준: 1F 기둥 9')

  const canvas = page.locator('canvas')
  const target = await sectionBounds(canvas)
  expect(target.min[0]).toBeLessThan(3.8)
  expect(target.max[0]).toBeGreaterThan(4.2)
  expect(target.max[0] - target.min[0]).toBeLessThan(1)
  const viewport = (await canvas.boundingBox())!
  const upperMember = { x: viewport.width * 0.5, y: viewport.height * 0.2 }
  // The adjacent slab intersects the padded column box at its top. Establish
  // that the ray really hits it before cutting the entire upper section away.
  await canvas.click({ position: upperMember })
  await expect(detail(page)).toContainText('1F-S01')
  await page.getByRole('button', { name: '선택 해제', exact: true }).click()
  const before = await canvas.screenshot()
  await setRange(page.getByRole('slider', { name: 'Y 최대', exact: true }), 45)
  const after = await canvas.screenshot({ path: testInfo.outputPath('sample-section-cut.png') })
  expect(after.equals(before)).toBe(false)
  await canvas.click({ position: upperMember })
  await expectNoSelection(page)
  await expect(members(page).locator('tbody tr')).toHaveCount(72)
  const total = page
    .getByRole('region', { name: '건물 집계 지표' })
    .locator('article')
    .filter({
      has: page.getByText('총 체적', { exact: true }),
    })
  await expect(total).toContainText('64.53 m³')
  // Range endpoints must remain ordered even when a user presses Home on max.
  const maximum = page.getByRole('slider', { name: 'Y 최대', exact: true })
  await maximum.focus()
  await maximum.press('Home')
  expect(Number(await maximum.inputValue())).toBeGreaterThan(
    Number(await page.getByRole('slider', { name: 'Y 최소', exact: true }).inputValue()),
  )
  await page.getByRole('checkbox', { name: '단면상자', exact: true }).uncheck()
  await page.getByRole('checkbox', { name: '단면상자', exact: true }).check()
  await expect(sectionControls(page)).toContainText('전체 건물 기준')
  expect(errors).toEqual([])
})

test('real IFC section bounds use the selected placed geometry and restore on model replacement', async ({
  page,
}, testInfo) => {
  await openBuilding(page)
  const fixture = await readFile(
    new URL('../public/examples/authored-building.ifc', import.meta.url),
  )
  await page.getByLabel('IFC 파일 선택', { exact: true }).setInputFiles({
    name: 'section-building.ifc',
    mimeType: 'application/octet-stream',
    buffer: fixture,
  })
  await expect(members(page).locator('tbody tr')).toHaveCount(5, { timeout: 45_000 })
  await members(page)
    .getByRole('button', { name: /Round concrete column G.*선택$/ })
    .click()
  await page.getByRole('checkbox', { name: '단면상자', exact: true }).check()
  await expect(sectionControls(page)).toContainText('선택 부재 기준: Round concrete column G')
  const canvas = page.getByLabel('IFC 모델 3D 뷰어', { exact: true })
  const target = await sectionBounds(canvas)
  // The fixture column is 500 mm wide and 3000 mm tall. Bounds are in metres,
  // proving the actual placement scale is applied once before clipping.
  expect(target.max[0] - target.min[0]).toBeGreaterThan(0.49)
  expect(target.max[0] - target.min[0]).toBeLessThan(1)
  expect(target.max[1] - target.min[1]).toBeGreaterThan(3)
  expect(target.max[1] - target.min[1]).toBeLessThan(4)
  const before = await canvas.screenshot()
  await setRange(page.getByRole('slider', { name: 'X 최대', exact: true }), 45)
  await setRange(page.getByRole('slider', { name: 'Y 최대', exact: true }), 65)
  const after = await canvas.screenshot({ path: testInfo.outputPath('ifc-section-cut.png') })
  expect(after.equals(before)).toBe(false)
  await expect(page.getByTestId('building-selected-volume')).toContainText('0.59')
  await expect(members(page).locator('tbody tr')).toHaveCount(5)
  // Every fragment of the uploaded model can be restored by turning clipping off.
  await page.getByRole('checkbox', { name: '단면상자', exact: true }).uncheck()
  await expect(sectionControls(page)).toHaveCount(0)
  await page.getByRole('checkbox', { name: '단면상자', exact: true }).check()
  await page.getByRole('button', { name: '샘플로 돌아가기', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: '단면상자', exact: true })).not.toBeChecked()
  await expect(members(page).locator('tbody tr')).toHaveCount(72)
})

test('graphs follow floor data and section controls fit a mobile viewport', async ({
  page,
}, testInfo) => {
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
  await expect(graphData(page)).toContainText('2층')
  await expect(graphData(page)).toContainText('24')
  await charts.getByRole('button', { name: '부재 수', exact: true }).click()
  await expect(charts.getByRole('heading', { name: '층별 부재 수', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '선택 해제', exact: true }).click()
  await page.getByRole('checkbox', { name: '단면상자', exact: true }).check()
  await expect(sectionControls(page)).toBeVisible()
  await expect(sectionControls(page)).toContainText('전체 건물 기준')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.screenshot({
    path: testInfo.outputPath('mobile-building-controls.png'),
    fullPage: true,
  })
})
