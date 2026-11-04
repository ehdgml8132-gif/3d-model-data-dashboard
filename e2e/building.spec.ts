import { expect, test, type Page } from '@playwright/test'
import { OrthographicCamera, Vector3 } from 'three'

async function openBuilding(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: '건물 샘플', exact: true }).click()
  await expect(page.getByRole('heading', { name: '건물 모델 대시보드', exact: true })).toBeVisible()
}

function buildingList(page: Page) {
  return page.getByRole('article', { name: '부재 목록', exact: true })
}

function buildingDetail(page: Page) {
  return page.getByRole('article', { name: '선택한 부재 정보', exact: true })
}

function buildingMetric(page: Page, label: string) {
  return page
    .getByRole('region', { name: '건물 집계 지표' })
    .locator('article')
    .filter({ has: page.getByText(label, { exact: true }) })
    .locator(':scope > strong')
}

function buildingMenu(page: Page) {
  return page.getByRole('navigation', { name: '건물 메뉴', exact: true })
}

async function openMemberData(page: Page) {
  await buildingMenu(page).getByRole('button', { name: '부재 데이터', exact: true }).click()
  await expect(page.getByRole('heading', { name: '부재 데이터', exact: true })).toBeVisible()
  await expect(
    buildingMenu(page).getByRole('button', { name: '부재 데이터', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    buildingMenu(page).getByRole('button', { name: '공간 데이터', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false')
}

test('building sample renders a live WebGL model and selected member information', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await openBuilding(page)
  await expect(
    buildingMenu(page).getByRole('button', { name: '공간 데이터', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    buildingMenu(page).getByRole('button', { name: '부재 데이터', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false')
  const canvas = page.locator('canvas')
  await expect(canvas).toBeVisible()
  expect(
    await canvas.evaluate((node) => {
      const canvas = node as HTMLCanvasElement
      const gl = canvas.getContext('webgl2')
      return !!gl && !gl.isContextLost() && canvas.width > 0 && canvas.height > 0
    }),
  ).toBe(true)
  await expect(buildingDetail(page)).toContainText('1F-C09')
  await expect(buildingList(page).locator('tbody tr')).toHaveCount(72)
  await expect(buildingMetric(page, '표시 부재')).toHaveText('72개')
  await expect(buildingMetric(page, '총 체적')).toHaveText('64.53 m³')
  await expect(page.getByRole('button', { name: '전체', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByRole('textbox', { name: '부재 검색', exact: true })).toHaveCount(0)
  await expect(page.getByLabel('부재 종류', { exact: true })).toHaveCount(0)
  expect(errors).toEqual([])
})

test('member data is a separate metadata view and can return to the spatial view', async ({
  page,
}) => {
  await openBuilding(page)
  await buildingList(page).getByRole('button', { name: '전체 보기', exact: true }).click()
  await expect(page.getByRole('heading', { name: '부재 데이터', exact: true })).toBeVisible()
  await expect(page.locator('canvas')).toHaveCount(0)
  await expect(buildingDetail(page)).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: '부재 검색', exact: true })).toBeVisible()
  await expect(page.getByLabel('부재 종류', { exact: true })).toBeVisible()
  await expect(buildingList(page).locator('tbody tr')).toHaveCount(72)
  for (const field of ['층', '종류', 'IFC 분류', '재료']) {
    await expect(
      buildingList(page).getByRole('columnheader', { name: field, exact: true }),
    ).toBeVisible()
  }
  const memberRow = buildingList(page)
    .locator('tbody tr')
    .filter({ has: page.getByRole('button', { name: /^1F-C09.*선택$/ }) })
  await expect(memberRow).toContainText('IfcColumn')
  await expect(memberRow).toContainText('철근콘크리트')
  await buildingMenu(page).getByRole('button', { name: '공간 데이터', exact: true }).click()
  await expect(page.getByRole('heading', { name: '건물 모델 대시보드', exact: true })).toBeVisible()
  await expect(page.locator('canvas')).toBeVisible()
  await expect(buildingDetail(page)).toContainText('1F-C09')
})

test('data filters and shared floor select a member without leaking hidden filters into the spatial view', async ({
  page,
}) => {
  await openBuilding(page)
  const initialCount = await buildingList(page).locator('tbody tr').count()
  await page.getByRole('button', { name: '2층', exact: true }).click()
  await expect(page.getByRole('button', { name: '2층', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(buildingList(page).locator('tbody tr').first()).toContainText('2층')
  const floorCount = await buildingList(page).locator('tbody tr').count()
  expect(floorCount).toBe(24)
  expect(floorCount).toBeLessThan(initialCount)
  await expect(buildingMetric(page, '표시 부재')).toHaveText('24개')
  await expect(buildingMetric(page, '총 체적')).toHaveText('21.51 m³')
  for (const row of await buildingList(page).locator('tbody tr').all()) {
    await expect(row).toContainText('2층')
  }

  await openMemberData(page)
  await expect(page.getByRole('button', { name: '2층', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(buildingList(page).locator('tbody tr')).toHaveCount(24)
  await page.getByLabel('부재 종류', { exact: true }).selectOption({ label: '기둥' })
  const columnRows = buildingList(page).locator('tbody tr')
  expect(await columnRows.count()).toBe(9)
  expect(await columnRows.count()).toBeLessThan(floorCount)
  await expect(buildingMetric(page, '표시 부재')).toHaveText('9개')
  await expect(buildingMetric(page, '총 체적')).toHaveText('4.32 m³')
  const columnVolume = await columnRows.evaluateAll((rows) =>
    rows.reduce(
      (sum, row) => sum + Number.parseFloat(row.querySelector('td:last-child')?.textContent ?? ''),
      0,
    ),
  )
  expect(columnVolume).toBeCloseTo(4.32, 2)
  for (const row of await columnRows.all()) {
    await expect(row).toContainText('기둥')
    await expect(row).toContainText('2층')
  }
  await page.getByRole('textbox', { name: '부재 검색', exact: true }).fill('2F-C09')
  await expect(buildingList(page).locator('tbody tr')).toHaveCount(1)
  await buildingList(page)
    .getByRole('button', { name: /2F-C09.*선택/ })
    .click()
  await expect(page.getByRole('heading', { name: '건물 모델 대시보드', exact: true })).toBeVisible()
  await expect(page.locator('canvas')).toBeVisible()
  await expect(buildingDetail(page)).toContainText('2F-C09')
  await expect(page.getByRole('textbox', { name: '부재 검색', exact: true })).toHaveCount(0)
  await expect(buildingList(page).locator('tbody tr')).toHaveCount(24)
  await expect(buildingMetric(page, '표시 부재')).toHaveText('24개')
  await expect(buildingMetric(page, '총 체적')).toHaveText('21.51 m³')

  await openMemberData(page)
  await expect(page.getByRole('textbox', { name: '부재 검색', exact: true })).toHaveValue('2F-C09')
  await expect(page.getByLabel('부재 종류', { exact: true })).toHaveValue('column')
  await expect(buildingList(page).locator('tbody tr')).toHaveCount(1)
  await page.getByRole('textbox', { name: '부재 검색', exact: true }).fill('존재하지 않는 부재')
  await expect(buildingList(page).locator('tbody tr')).toHaveCount(0)
  await expect(buildingDetail(page)).toHaveCount(0)
  await expect(page.locator('canvas')).toHaveCount(0)
  await expect(buildingMetric(page, '표시 부재')).toHaveText('0개')
  await expect(buildingMetric(page, '총 체적')).toHaveText('0.00 m³')

  await buildingMenu(page).getByRole('button', { name: '공간 데이터', exact: true }).click()
  await expect(page.locator('canvas')).toBeVisible()
  await expect(buildingDetail(page)).toContainText('2F-C09')
  await expect(buildingList(page).locator('tbody tr')).toHaveCount(24)
  await expect(buildingMetric(page, '표시 부재')).toHaveText('24개')
  await openMemberData(page)
  await expect(buildingList(page).locator('tbody tr')).toHaveCount(0)
  await buildingList(page).getByRole('button', { name: '조건 초기화', exact: true }).click()
  await expect(buildingList(page).locator('tbody tr')).toHaveCount(initialCount)
  await expect(page.getByRole('textbox', { name: '부재 검색', exact: true })).toHaveValue('')
  await expect(page.getByLabel('부재 종류', { exact: true })).toHaveValue('all')
  await expect(page.getByRole('button', { name: '전체', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test('a real 3D building member click selects its matching data', async ({ page }) => {
  await openBuilding(page)
  const canvas = page.locator('canvas')
  await expect(canvas).toBeVisible()
  await buildingList(page)
    .getByRole('button', { name: /^1F-C01.*선택$/ })
    .click()
  await expect(buildingDetail(page)).toContainText('1F-C01')
  const before = (await canvas.boundingBox())!
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2)
  await page.mouse.down()
  await page.mouse.move(before.x + before.width / 2 + 80, before.y + before.height / 2 - 30, {
    steps: 8,
  })
  await page.mouse.up()
  await page.getByRole('button', { name: '3D 건물 시점 초기화', exact: true }).click()
  const bounds = (await canvas.boundingBox())!
  // Project the front right first-floor column through the actual default camera.
  const camera = new OrthographicCamera(
    -bounds.width / 2,
    bounds.width / 2,
    bounds.height / 2,
    -bounds.height / 2,
    0.1,
    100,
  )
  camera.position.set(14, 16.4, 16)
  camera.lookAt(0, 4.4, 0)
  camera.zoom = Math.min(bounds.width / 15.2, bounds.height / 14.8)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld()
  const point = new Vector3(4, 1.5, 3).project(camera)
  await canvas.click({
    position: { x: ((point.x + 1) / 2) * bounds.width, y: ((1 - point.y) / 2) * bounds.height },
  })
  await expect(buildingDetail(page)).toContainText('1F-C09')
})

test('switching building and café samples preserves uploaded café data', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '데이터 업로드', exact: true }).click()
  const csv = [
    'product_id,product_name,category,unit_price,stock,date,quantity',
    'P001,내 매장 커피,커피,1000,30,2026-11-04,2',
    'P002,내 매장 라테,커피,2000,25,2026-11-04,3',
    'P003,내 매장 빵,베이커리,3000,10,2026-11-04,4',
    'P004,내 매장 케이크,디저트,4000,5,2026-11-04,5',
  ].join('\n')
  await page
    .getByLabel('CSV 파일 선택', { exact: true })
    .setInputFiles({ name: 'keep-cafe.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByTestId('selected-revenue')).toHaveText('2,000원')
  await page.getByRole('button', { name: '건물 샘플', exact: true }).click()
  await expect(page.getByRole('heading', { name: '건물 모델 대시보드', exact: true })).toBeVisible()
  await expect(buildingDetail(page)).toContainText('1F-C09')
  await page.getByRole('button', { name: '카페 샘플', exact: true }).click()
  await expect(page.getByRole('heading', { name: '모노 카페 대시보드', exact: true })).toBeVisible()
  await expect(
    page.locator('.product-chips').getByRole('button', { name: '내 매장 커피', exact: true }),
  ).toBeVisible()
  await expect(page.getByTestId('selected-revenue')).toHaveText('2,000원')
  await expect(page.getByText('keep-cafe.csv', { exact: true })).toBeVisible()
})

test('building sample remains usable on mobile without horizontal page overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openBuilding(page)
  await expect(page.locator('canvas')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.getByRole('button', { name: '3층', exact: true }).click()
  await expect(buildingList(page).locator('tbody tr').first()).toContainText('3층')
  await openMemberData(page)
  await expect(page.locator('canvas')).toHaveCount(0)
  await expect(buildingDetail(page)).toHaveCount(0)
  await expect(buildingList(page).locator('tbody tr')).toHaveCount(24)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.getByRole('textbox', { name: '부재 검색', exact: true }).fill('3F-C09')
  await expect(buildingList(page).locator('tbody tr')).toHaveCount(1)
  await buildingList(page)
    .getByRole('button', { name: /^3F-C09.*선택$/ })
    .click()
  await expect(page.getByRole('heading', { name: '건물 모델 대시보드', exact: true })).toBeVisible()
  await expect(buildingDetail(page)).toContainText('3F-C09')
  await expect(page.locator('canvas')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.getByRole('button', { name: '카페 샘플', exact: true }).click()
  await expect(page.getByRole('heading', { name: '모노 카페 대시보드', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
})
