import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test.describe.configure({ mode: 'default' })
test.setTimeout(90_000)

const members = (page: Page) => page.getByRole('article', { name: '부재 목록', exact: true })
const detail = (page: Page) => page.getByRole('article', { name: '선택한 부재 정보', exact: true })
const metric = (page: Page, name: string) =>
  page
    .getByRole('region', { name: '건물 집계 지표', exact: true })
    .locator('article')
    .filter({ has: page.getByText(name, { exact: true }) })
    .locator(':scope > strong')

async function openBuilding(page: Page) {
  await page.goto('/?sample=building')
  await expect(page.getByRole('heading', { name: '건물 모델 대시보드', exact: true })).toBeVisible()
  await expect(page.locator('canvas')).toBeVisible()
}

async function openFilter(page: Page, title: string) {
  const name = `${title} 필터`
  await page.getByRole('button', { name, exact: true }).click()
  const popup = page.getByRole('dialog', { name, exact: true })
  await expect(popup).toBeVisible()
  return popup
}

async function closeFilter(popup: Locator) {
  await popup.getByRole('button', { name: '완료', exact: true }).click()
  await expect(popup).toHaveCount(0)
}

async function chooseOnly(popup: Locator, labels: string[]) {
  await popup.getByRole('button', { name: '전체 해제', exact: true }).click()
  for (const label of labels)
    await popup.getByRole('checkbox', { name: label, exact: true }).check()
}

test('card filters combine across the live model, table and graphs and recover from empty results', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await openBuilding(page)
  await expect(members(page).locator('tbody tr')).toHaveCount(72)

  let popup = await openFilter(page, '표시 부재')
  await chooseOnly(popup, ['기둥', '벽체'])
  await closeFilter(popup)
  await expect(members(page).locator('tbody tr')).toHaveCount(33)
  await expect(metric(page, '표시 부재')).toHaveText('33개')

  popup = await openFilter(page, '표시 층')
  await chooseOnly(popup, ['2층'])
  await closeFilter(popup)
  await expect(members(page).locator('tbody tr')).toHaveCount(11)
  await expect(page.getByRole('group', { name: '건물 층 선택' })).toContainText('2층')

  popup = await openFilter(page, '재료 종류')
  await chooseOnly(popup, ['철근콘크리트'])
  await closeFilter(popup)
  await expect(members(page).locator('tbody tr')).toHaveCount(9)
  await expect(metric(page, '총 체적')).toHaveText('4.32 m³')
  await expect(metric(page, '표시 층')).toHaveText('1개 층')
  await expect(metric(page, '재료 종류')).toHaveText('1종')

  popup = await openFilter(page, '총 체적')
  await popup.getByLabel('최소 체적 (m³)', { exact: true }).fill('0.4')
  await popup.getByLabel('최대 체적 (m³)', { exact: true }).fill('0.5')
  await popup.getByRole('button', { name: '적용', exact: true }).click()
  await expect(popup).toHaveCount(0)
  await expect(members(page).locator('tbody tr')).toHaveCount(9)
  await expect(page.locator('canvas')).toBeVisible()
  const charts = page.getByRole('region', { name: '건물 데이터 그래프', exact: true })
  await charts.getByText('층별 수치 보기', { exact: true }).click()
  const graph = charts.getByRole('table', { name: '층별 그래프 데이터', exact: true })
  await expect(graph.locator('tbody tr')).toHaveCount(1)
  await expect(graph).toContainText('2층')
  await expect(graph).toContainText('4.32')
  await expect(graph).toContainText('9개')

  popup = await openFilter(page, '총 체적')
  await popup.getByLabel('최대 체적 (m³)', { exact: true }).fill('0.45')
  await popup.getByRole('button', { name: '적용', exact: true }).click()
  await expect(members(page).locator('tbody tr')).toHaveCount(0)
  await expect(metric(page, '표시 부재')).toHaveText('0개')
  await expect(page.locator('canvas')).toHaveCount(0)
  // Filter choices remain available even when their intersection is empty.
  popup = await openFilter(page, '표시 부재')
  await expect(popup.getByRole('checkbox', { name: '기둥', exact: true })).toBeVisible()
  await expect(popup.getByRole('checkbox', { name: '벽체', exact: true })).toBeVisible()
  await closeFilter(popup)
  await page.getByRole('button', { name: '전체 필터 초기화', exact: true }).click()
  await expect(members(page).locator('tbody tr')).toHaveCount(72)
  await expect(metric(page, '총 체적')).toHaveText('64.53 m³')
  await expect(page.locator('canvas')).toBeVisible()
  expect(errors).toEqual([])
})

test('individual member choices persist across views and hidden objects are deselected', async ({
  page,
}) => {
  await openBuilding(page)
  await members(page)
    .getByRole('button', { name: /^1F-C09.*선택$/ })
    .click()
  await expect(detail(page)).toContainText('1F-C09')
  const popup = await openFilter(page, '표시 부재')
  await popup.getByRole('tab', { name: '개별 부재', exact: true }).click()
  await popup.getByRole('button', { name: '전체 해제', exact: true }).click()
  await popup.getByLabel('개별 부재 검색', { exact: true }).fill('1F-C01')
  await popup.getByRole('checkbox', { name: '1F 기둥 1 (1F-C01)', exact: true }).check()
  await popup.getByLabel('개별 부재 검색', { exact: true }).fill('2F-C01')
  await popup.getByRole('checkbox', { name: '2F 기둥 1 (2F-C01)', exact: true }).check()
  await closeFilter(popup)
  await expect(members(page).locator('tbody tr')).toHaveCount(2)
  await expect(detail(page)).toContainText('선택한 부재가 없습니다.')
  const menu = page.getByRole('navigation', { name: '건물 메뉴', exact: true })
  await menu.getByRole('button', { name: '부재 데이터', exact: true }).click()
  await expect(members(page).locator('tbody tr')).toHaveCount(2)
  await expect(page.locator('canvas')).toHaveCount(0)
  await menu.getByRole('button', { name: '공간 데이터', exact: true }).click()
  await expect(members(page).locator('tbody tr')).toHaveCount(2)
  await expect(page.locator('canvas')).toBeVisible()
  const reopened = await openFilter(page, '표시 부재')
  await reopened.getByRole('tab', { name: '개별 부재', exact: true }).click()
  await reopened.getByLabel('개별 부재 검색', { exact: true }).fill('1F-C01')
  await expect(
    reopened.getByRole('checkbox', { name: '1F 기둥 1 (1F-C01)', exact: true }),
  ).toBeChecked()
  await reopened.getByRole('button', { name: '이 필터 초기화', exact: true }).click()
  await expect(members(page).locator('tbody tr')).toHaveCount(72)
})

test('IFC volume filters distinguish unknown from zero and reject reversed bounds', async ({
  page,
}) => {
  await openBuilding(page)
  const source = (
    await readFile(new URL('../public/examples/authored-building.ifc', import.meta.url), 'utf8')
  )
    .replace('(#109,#110,#204)', '(#109,#110)')
    .replace('IFCVOLUMEMEASURE(0.589048623)', 'IFCVOLUMEMEASURE(0.)')
  await page.getByLabel('IFC 파일 선택', { exact: true }).setInputFiles({
    name: 'unknown-and-zero.ifc',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(source),
  })
  await expect(members(page).locator('tbody tr')).toHaveCount(5, { timeout: 45_000 })
  let popup = await openFilter(page, '총 체적')
  await popup.getByLabel('최소 체적 (m³)', { exact: true }).fill('0')
  await popup.getByLabel('최대 체적 (m³)', { exact: true }).fill('0')
  await popup.getByRole('checkbox', { name: '체적 미확인 포함', exact: true }).uncheck()
  await popup.getByRole('button', { name: '적용', exact: true }).click()
  await expect(members(page).locator('tbody tr')).toHaveCount(1)
  await expect(members(page)).toContainText('Round concrete column G')
  await expect(metric(page, '총 체적')).toHaveText('0.00 m³')

  popup = await openFilter(page, '총 체적')
  await popup.getByRole('checkbox', { name: '체적 미확인 포함', exact: true }).check()
  await popup.getByRole('button', { name: '적용', exact: true }).click()
  await expect(members(page).locator('tbody tr')).toHaveCount(2)
  await expect(members(page)).toContainText('Steel beam 1')
  await expect(members(page).locator('tbody tr').filter({ hasText: 'Steel beam 1' })).toContainText(
    '—',
  )

  popup = await openFilter(page, '총 체적')
  await popup.getByLabel('최소 체적 (m³)', { exact: true }).fill('5')
  await popup.getByLabel('최대 체적 (m³)', { exact: true }).fill('1')
  await popup.getByRole('button', { name: '적용', exact: true }).click()
  await expect(popup.getByRole('alert')).toContainText('최소 체적은 최대 체적보다 클 수 없습니다.')
  await expect(members(page).locator('tbody tr')).toHaveCount(2)
  await page.keyboard.press('Escape')
  await expect(popup).toHaveCount(0)
  await page.getByRole('button', { name: '샘플로 돌아가기', exact: true }).click()
  await expect(members(page).locator('tbody tr')).toHaveCount(72)
})

test('mobile card popovers stay in the viewport and Escape preserves model selection', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openBuilding(page)
  await members(page)
    .getByRole('button', { name: /^1F-C09.*선택$/ })
    .click()
  await expect(detail(page)).toContainText('1F-C09')
  let popup = await openFilter(page, '표시 부재')
  const viewport = page.viewportSize()!
  const bounds = (await popup.boundingBox())!
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.y).toBeGreaterThanOrEqual(0)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width)
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height)
  await page.screenshot({ path: '/tmp/metric-filters-mobile.png', fullPage: true })
  await page.keyboard.press('Escape')
  await expect(popup).toHaveCount(0)
  await expect(detail(page)).toContainText('1F-C09')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

  await page.setViewportSize({ width: 1440, height: 1080 })
  popup = await openFilter(page, '표시 층')
  await chooseOnly(popup, ['1층', '3층'])
  await expect(metric(page, '표시 부재')).toHaveText('48개')
  await page.screenshot({ path: '/tmp/metric-filters-desktop.png', fullPage: true })
})
