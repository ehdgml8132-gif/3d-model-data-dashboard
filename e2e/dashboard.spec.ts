import { expect, test, type Page } from '@playwright/test'
import { OrthographicCamera, Vector3 } from 'three'

// Hand-sized data with known totals makes the upload checks independent of the
// implementation's aggregation functions. Every model ID is included.
const customCsv = [
  'product_id,product_name,category,unit_price,stock,date,quantity',
  'P001,테스트 원두 커피,커피,1000,30,2026-11-04,2',
  'P002,테스트 라테,커피,2000,25,2026-11-04,3',
  'P003,테스트 빵,베이커리,3000,10,2026-11-04,4',
  'P004,테스트 케이크,디저트,4000,5,2026-11-04,5',
].join('\r\n')

function metric(page: Page, label: string) {
  return page
    .getByRole('region', { name: '전체 매장 지표' })
    .locator('article')
    .filter({ has: page.getByText(label, { exact: true }) })
    .locator(':scope > strong')
}

async function uploadCsv(page: Page, content: string, name = 'my-cafe.csv') {
  await page.getByRole('button', { name: '데이터 업로드', exact: true }).click()
  await page
    .getByLabel('CSV 파일 선택', { exact: true })
    .setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(content) })
}

test('renders a real WebGL café and selecting a product updates its information', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '모노 카페 대시보드' })).toBeVisible()
  const canvas = page.locator('.scene-wrap canvas')
  await expect(canvas).toBeVisible()
  await expect(page.locator('.scene-fallback')).toHaveCount(0)
  expect(
    await canvas.evaluate((node) => {
      const canvas = node as HTMLCanvasElement
      const gl = canvas.getContext('webgl2')
      return gl !== null && !gl.isContextLost() && canvas.width > 0 && canvas.height > 0
    }),
  ).toBe(true)

  const detail = page.getByRole('article', { name: '선택한 상품 정보' })
  await expect(detail.getByRole('heading', { name: '아메리카노', exact: true })).toBeVisible()
  await page
    .locator('.product-chips')
    .getByRole('button', { name: '버터 크루아상', exact: true })
    .click()
  await expect(detail.getByRole('heading', { name: '버터 크루아상', exact: true })).toBeVisible()
  await expect(page.getByTestId('selected-revenue')).toHaveText('946,200원')
  await expect(detail.getByText('재고를 확인해주세요', { exact: true })).toBeVisible()
  expect(errors).toEqual([])
})

test('clicking a 3D mesh selects its linked product', async ({ page }) => {
  await page.goto('/')
  const canvas = page.locator('.scene-wrap canvas')
  await expect(canvas).toBeVisible()
  // The scene uses an orthographic camera. Project the croissant's world-space
  // hit-target center to screen coordinates, then use a real browser pointer.
  await page.getByRole('button', { name: '3D 시점 초기화' }).click()
  const bounds = (await canvas.boundingBox())!
  const camera = new OrthographicCamera(
    -bounds.width / 2,
    bounds.width / 2,
    bounds.height / 2,
    -bounds.height / 2,
    0.1,
    100,
  )
  camera.position.set(9, 8, 10)
  camera.lookAt(0, 0.9, 0)
  camera.zoom = Math.min(bounds.width / 11.4, bounds.height / 9.1)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld()
  const target = new Vector3(1.65, 1.39, -0.75).project(camera)
  await canvas.click({
    position: { x: ((target.x + 1) / 2) * bounds.width, y: ((1 - target.y) / 2) * bounds.height },
  })
  await expect(
    page
      .getByRole('article', { name: '선택한 상품 정보' })
      .getByRole('heading', { name: '버터 크루아상', exact: true }),
  ).toBeVisible()
  await expect(
    page.locator('.product-chips').getByRole('button', { name: '버터 크루아상', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
})

test('period and chart controls update the reported sales and accessible chart summary', async ({
  page,
}) => {
  await page.goto('/')
  await expect(metric(page, '총 매출')).toHaveText('6,091,300원')
  await page.getByRole('button', { name: '30일', exact: true }).click()
  await expect(metric(page, '총 매출')).toHaveText('24,000,600원')
  await expect(page.getByRole('button', { name: '30일', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(
    page.getByRole('img', { name: '최근 30일 매출 차트. 총 24,000,600원', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: '판매량', exact: true }).click()
  await expect(
    page.getByRole('img', { name: '최근 30일 판매량 차트. 총 4,905개', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: '7일', exact: true }).click()
  await expect(metric(page, '총 매출')).toHaveText('6,091,300원')
})

test('data view filters by name or ID and a row opens its product in the 3D view', async ({
  page,
}) => {
  await page.goto('/')
  await page
    .getByRole('navigation', { name: '주 메뉴' })
    .getByRole('button', { name: /상품 데이터/ })
    .click()
  await expect(page.getByRole('heading', { name: '상품 데이터', exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: '상품 검색' }).fill('없는 상품')
  await expect(page.getByText('검색 결과가 없습니다.', { exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: '상품 검색' }).fill('P004')
  await expect(page.locator('tbody tr')).toHaveCount(1)
  await page.getByRole('button', { name: /딸기 케이크 P004/ }).click()
  await expect(page.getByRole('heading', { name: '모노 카페 대시보드', exact: true })).toBeVisible()
  await expect(
    page
      .getByRole('article', { name: '선택한 상품 정보' })
      .getByRole('heading', { name: '딸기 케이크', exact: true }),
  ).toBeVisible()
  await expect(page.locator('tbody tr')).toHaveCount(4)
})

test('CSV upload updates totals and names, persists on reload, and restores the sample', async ({
  page,
}) => {
  await page.goto('/')
  await uploadCsv(page, customCsv)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(metric(page, '총 매출')).toHaveText('40,000원')
  await expect(metric(page, '판매 수량')).toHaveText('14개')
  await expect(metric(page, '현재 재고')).toHaveText('70개')
  await expect(
    page.locator('.product-chips').getByRole('button', { name: '테스트 원두 커피', exact: true }),
  ).toBeVisible()
  await expect(page.getByTestId('selected-revenue')).toHaveText('2,000원')
  await expect(page.getByText('my-cafe.csv', { exact: true })).toBeVisible()

  await page.reload()
  await expect(metric(page, '총 매출')).toHaveText('40,000원')
  await expect(
    page.locator('.product-chips').getByRole('button', { name: '테스트 원두 커피', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: '샘플로 초기화', exact: true }).click()
  await expect(metric(page, '총 매출')).toHaveText('6,091,300원')
  await expect(
    page.locator('.product-chips').getByRole('button', { name: '아메리카노', exact: true }),
  ).toBeVisible()
  await page.reload()
  await expect(metric(page, '총 매출')).toHaveText('6,091,300원')
  await expect(page.getByRole('button', { name: '샘플로 초기화' })).toHaveCount(0)
})

test('invalid CSV keeps the existing data and the upload dialog closes with Escape', async ({
  page,
}) => {
  await page.goto('/')
  await uploadCsv(
    page,
    customCsv.replace('P004,테스트 케이크', 'P999,테스트 케이크'),
    'invalid.csv',
  )
  await expect(page.getByRole('alert')).toContainText('상품 ID')
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(metric(page, '총 매출')).toHaveText('6,091,300원')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(
    page.locator('.product-chips').getByRole('button', { name: '아메리카노', exact: true }),
  ).toBeVisible()
})

test('CSV remains usable for the current visit when browser persistence is unavailable', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('Storage is unavailable', 'QuotaExceededError')
    }
  })
  await page.goto('/')
  await uploadCsv(page, customCsv)
  await expect(page.getByRole('status')).toContainText('이번 방문에만 유지됩니다')
  await expect(metric(page, '총 매출')).toHaveText('40,000원')
  await expect(page.locator('footer')).toContainText('이번 방문')
  await page.reload()
  await expect(metric(page, '총 매출')).toHaveText('6,091,300원')
})

test('help dialog connects to upload and sample CSV is downloadable', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '도움말', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '공간에서 데이터를 읽는 방법' })).toBeVisible()
  await page.getByRole('button', { name: '내 데이터 연결하기', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '우리 매장 데이터 연결' })).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('link', { name: /샘플 데이터 다운로드/ }).click()
  expect((await downloadPromise).suggestedFilename()).toBe('sample-products.csv')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('mobile layout has no horizontal page overflow and product selection works', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '모노 카페 대시보드' })).toBeVisible()
  await expect(page.locator('.scene-wrap canvas')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page
    .locator('.product-chips')
    .getByRole('button', { name: '카페라테', exact: true })
    .click()
  await expect(
    page
      .getByRole('article', { name: '선택한 상품 정보' })
      .getByRole('heading', { name: '카페라테', exact: true }),
  ).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
})
