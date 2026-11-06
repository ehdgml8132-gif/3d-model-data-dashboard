import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import ExcelJS from 'exceljs'

const fixture = new URL('../public/examples/authored-building.ifc', import.meta.url)
const businessFixture = new URL('../public/examples/authored-building-data.csv', import.meta.url)
const columnGuid = '0nKbBzQJnGpBAXy9$4zESO'
const beamGuid = '3US19W0$vRUeNsBV7TCnlc'
const columnName = 'Round concrete column G'

// Keep software-WebGL imports sequential, while allowing independent cases to
// continue when an earlier case fails. Every case receives a fresh browser page.
test.describe.configure({ mode: 'default' })
test.setTimeout(90_000)

function members(page: Page) {
  return page.getByRole('article', { name: '부재 목록', exact: true })
}

function detail(page: Page) {
  return page.getByRole('article', { name: '선택한 부재 정보', exact: true })
}

async function openBuilding(page: Page) {
  await page.goto('/?sample=building')
  await expect(page.getByRole('heading', { name: '건물 모델 대시보드', exact: true })).toBeVisible()
}

async function importIfc(
  page: Page,
  name = 'authored-building.ifc',
  buffer?: Buffer,
  elementCount = 5,
) {
  await page.getByLabel('IFC 파일 선택', { exact: true }).setInputFiles({
    name,
    mimeType: 'application/octet-stream',
    buffer: buffer ?? (await readFile(fixture)),
  })
  await expect(members(page).locator('tbody tr')).toHaveCount(Math.min(elementCount, 200), {
    timeout: 45_000,
  })
  await expect(page.getByText(`업로드한 IFC 모델 · ${name}`, { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '업로드 취소', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '샘플로 돌아가기', exact: true })).toBeVisible()
}

async function selectColumn(page: Page) {
  await members(page)
    .getByRole('button', { name: new RegExp(`${columnName}.*선택$`) })
    .click()
  await expect(detail(page)).toContainText(columnGuid)
}

async function openBusinessFile(page: Page, name: string, buffer: Buffer) {
  await page.getByRole('button', { name: '업무 데이터 연결', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '업무 데이터 연결', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('업무 데이터 파일 선택', { exact: true }).setInputFiles({
    name,
    mimeType: name.endsWith('.xlsx')
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'text/csv',
    buffer,
  })
  return dialog
}

async function connectCsv(page: Page) {
  const dialog = await openBusinessFile(
    page,
    'authored-building-data.csv',
    await readFile(businessFixture),
  )
  await dialog.getByLabel('모델 연결 키', { exact: true }).selectOption('globalId')
  await dialog.getByLabel('데이터 연결 열', { exact: true }).selectOption('GlobalId')
  await dialog.getByRole('button', { name: '데이터 연결', exact: true }).click()
  await expect(dialog).toHaveCount(0)
}

test('official IFC geometry imports with real storeys, materials, properties and cubic-metre quantities', async ({
  page,
}) => {
  const errors: string[] = []
  const uploads: string[] = []
  const external: string[] = []
  const wasm: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => {
    if (request.method() !== 'GET') uploads.push(`${request.method()} ${request.url()}`)
    if (/\.wasm(?:\?|$)/.test(request.url())) wasm.push(request.url())
    if (!request.url().startsWith('http://127.0.0.1:5173') && !/^(data|blob):/.test(request.url()))
      external.push(request.url())
  })
  await openBuilding(page)
  await importIfc(page)
  const canvas = page.getByLabel('IFC 모델 3D 뷰어', { exact: true })
  await expect(canvas).toBeVisible()
  expect(
    await canvas.evaluate((node) => {
      const gl = (node as HTMLCanvasElement).getContext('webgl2')
      return !!gl && !gl.isContextLost()
    }),
  ).toBe(true)
  await selectColumn(page)
  await expect(detail(page)).toContainText('Concrete C30/37')
  await expect(detail(page)).toContainText('Ground floor')
  await expect(detail(page)).toContainText('R120')
  // The round column's bounding box is 0.75 m³; its IFC NetVolume is 0.589048623 m³.
  // Its project length unit is millimetres, while this quantity explicitly uses m³.
  await expect(page.getByTestId('building-selected-volume')).toContainText('0.59')
  await expect(detail(page)).not.toContainText('0.75')
  // Unmount and remount the viewer twice under the app's React StrictMode.
  // The subsequent real pointer pick proves disposed GPU state is rebuilt.
  const menu = page.getByRole('navigation', { name: '건물 메뉴', exact: true })
  for (let index = 0; index < 2; index++) {
    await menu.getByRole('button', { name: '부재 데이터', exact: true }).click()
    await expect(page.locator('canvas')).toHaveCount(0)
    await menu.getByRole('button', { name: '공간 데이터', exact: true }).click()
    await expect(canvas).toBeVisible()
    await expect(detail(page)).toContainText(columnGuid)
  }
  // Exercise the imported triangle geometry's actual pointer path. Several
  // interior viewport points avoid depending on any one mesh's tessellation.
  const bounds = (await canvas.boundingBox())!
  let clickedName = columnName
  for (const [x, y] of [
    [0.5, 0.5],
    [0.5, 0.65],
    [0.6, 0.55],
    [0.4, 0.55],
    [0.5, 0.35],
    [0.6, 0.4],
    [0.4, 0.4],
  ]) {
    await canvas.click({ position: { x: bounds.width * x, y: bounds.height * y } })
    clickedName = await detail(page).getByRole('heading', { level: 2 }).innerText()
    if (clickedName !== columnName) break
  }
  expect([
    'Concrete wall G',
    'Round concrete column 1',
    'First floor concrete slab',
    'Steel beam 1',
  ]).toContain(clickedName)
  await expect(page.getByRole('group', { name: '건물 층 선택' })).toContainText('Ground floor')
  await expect(page.getByRole('group', { name: '건물 층 선택' })).toContainText('First floor')
  await page
    .getByRole('group', { name: '건물 층 선택' })
    .getByRole('button', { name: 'First floor', exact: true })
    .click()
  await expect(members(page).locator('tbody tr')).toHaveCount(3)
  await page.getByRole('button', { name: '샘플로 돌아가기', exact: true }).click()
  await expect(members(page).locator('tbody tr')).toHaveCount(72)
  await importIfc(page, 'reopened.ifc')
  await selectColumn(page)
  await expect(canvas).toBeVisible()
  await expect(page.getByTestId('building-selected-volume')).toContainText('0.59')
  expect(wasm.length).toBeGreaterThan(0)
  expect(uploads).toEqual([])
  expect(external).toEqual([])
  expect(errors).toEqual([])
})

test('GlobalId CSV mapping appears on the selected real IFC member in both views', async ({
  page,
}) => {
  await openBuilding(page)
  await importIfc(page)
  await selectColumn(page)
  await connectCsv(page)
  await expect(detail(page)).toContainText('연결된 업무 데이터')
  await expect(detail(page)).toContainText('Installed')
  await expect(detail(page)).toContainText('125000')
  await page
    .getByRole('navigation', { name: '건물 메뉴', exact: true })
    .getByRole('button', { name: '부재 데이터', exact: true })
    .click()
  await expect(page.getByRole('heading', { name: '부재 데이터', exact: true })).toBeVisible()
  await expect(page.locator('canvas')).toHaveCount(0)
  await page.getByRole('textbox', { name: '부재 검색', exact: true }).fill(columnName)
  await expect(members(page).locator('tbody tr')).toHaveCount(1)
  await selectColumn(page)
  await expect(detail(page)).toContainText('Installed')
  await page.getByRole('button', { name: '카페 샘플', exact: true }).click()
  await expect(page.getByRole('heading', { name: '모노 카페 대시보드', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '건물 샘플', exact: true }).click()
  await expect(members(page).locator('tbody tr')).toHaveCount(5)
  await expect(detail(page)).toContainText('Installed')
})

test('XLSX sheet and Tag column selection preserve leading-zero identifiers', async ({ page }) => {
  const workbook = new ExcelJS.Workbook()
  workbook.addWorksheet('설명').addRows([['메모'], ['연결할 데이터는 업무목록 시트에 있습니다.']])
  workbook.addWorksheet('업무목록').addRows([
    ['자산번호', '검수상태', '담당자'],
    ['0001', 'XLSX 검수 완료', '현장 A'],
    ['0005', 'XLSX 검수 대기', '현장 B'],
  ])
  await openBuilding(page)
  await importIfc(page)
  await selectColumn(page)
  const dialog = await openBusinessFile(
    page,
    '업무목록.xlsx',
    Buffer.from(await workbook.xlsx.writeBuffer()),
  )
  await dialog.getByLabel('업무 데이터 시트', { exact: true }).selectOption({ label: '업무목록' })
  await dialog.getByLabel('모델 연결 키', { exact: true }).selectOption('tag')
  await dialog.getByLabel('데이터 연결 열', { exact: true }).selectOption('자산번호')
  await dialog.getByRole('button', { name: '데이터 연결', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(detail(page)).toContainText('XLSX 검수 완료')
  await expect(detail(page)).toContainText('0001')
  await expect(detail(page)).not.toContainText('XLSX 검수 대기')
})

test('duplicate and unmatched keys are diagnosed without silently joining a conflicting business row', async ({
  page,
}) => {
  const csv = [
    'object_id,검수상태',
    `${columnGuid},잘못 선택되면 안 되는 첫 번째 값`,
    `${columnGuid},잘못 선택되면 안 되는 두 번째 값`,
    `${beamGuid},유일한 보 연결`,
    'not-an-ifc-global-id,연결 대상 없음',
    ',빈 키 행',
  ].join('\r\n')
  await openBuilding(page)
  await importIfc(page)
  await selectColumn(page)
  const dialog = await openBusinessFile(page, 'diagnostics.csv', Buffer.from(csv))
  await dialog.getByLabel('모델 연결 키', { exact: true }).selectOption('globalId')
  await dialog.getByLabel('데이터 연결 열', { exact: true }).selectOption('object_id')
  await expect(dialog.getByText('중복 데이터 키', { exact: true }).locator('..')).toContainText('1')
  await expect(dialog.getByText('빈 데이터 키', { exact: true }).locator('..')).toContainText('1')
  await expect(
    dialog.getByText('연결되지 않은 데이터 행', { exact: true }).locator('..'),
  ).toContainText('1')
  await dialog.getByRole('button', { name: '데이터 연결', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const linked = detail(page).getByRole('region', { name: '연결된 업무 데이터', exact: true })
  await expect(linked).toContainText(/중복|모호/)
  await expect(linked.locator(':scope > dl')).toHaveCount(0)
  await expect(linked.getByLabel('중복 업무 데이터 후보').locator('tbody tr')).toHaveCount(2)
  await expect(linked).toContainText('자동 선택하지 않음')
  await members(page)
    .getByRole('button', { name: /Steel beam 1.*선택$/ })
    .click()
  await expect(detail(page)).toContainText('유일한 보 연결')
})

test('invalid IFC preserves the active model and linked rows, while a successful replacement clears them', async ({
  page,
}) => {
  await openBuilding(page)
  await importIfc(page)
  await selectColumn(page)
  await connectCsv(page)
  await page.getByLabel('IFC 파일 선택', { exact: true }).setInputFiles({
    name: 'invalid.ifc',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('This is not an IFC STEP model.'),
  })
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(members(page).locator('tbody tr')).toHaveCount(5)
  await expect(detail(page)).toContainText('Installed')
  const replacement = (await readFile(fixture, 'utf8')).replaceAll(
    columnName,
    'Replacement round column',
  )
  await importIfc(page, 'replacement.ifc', Buffer.from(replacement))
  await expect(detail(page)).not.toContainText('Installed')
  await expect(
    page.getByRole('button', { name: '업무 데이터 연결 해제', exact: true }),
  ).toHaveCount(0)
  await members(page)
    .getByRole('button', { name: /Replacement round column.*선택$/ })
    .click()
  await expect(detail(page)).toContainText(columnGuid)
  await expect(detail(page)).not.toContainText('Installed')
})

test('an IFC member without exported volume remains unknown rather than receiving its bounding-box volume', async ({
  page,
}) => {
  const source = await readFile(fixture, 'utf8')
  // Disconnect only the beam's quantity relationship. Geometry and ordinary Pset
  // relationships remain intact; the official web-ifc fixture check covers it.
  const withoutBeamQuantity = source.replace(/^#115=IFCRELDEFINESBYPROPERTIES[^\n]*\n/m, '')
  expect(withoutBeamQuantity).not.toBe(source)
  await openBuilding(page)
  await importIfc(page, 'missing-volume.ifc', Buffer.from(withoutBeamQuantity))
  await members(page)
    .getByRole('button', { name: /Steel beam 1.*선택$/ })
    .click()
  await expect(detail(page)).toContainText(beamGuid)
  await expect(page.getByTestId('building-selected-volume')).toContainText('—')
  await expect(page.getByTestId('building-selected-volume')).not.toContainText('1.25')
  await expect(detail(page)).toContainText('Structural Steel S355')
  await expect(detail(page)).toContainText('R60')
})

test('cancelling a pending official WASM load preserves the previous model and mapping', async ({
  page,
}) => {
  await openBuilding(page)
  await importIfc(page)
  await selectColumn(page)
  await connectCsv(page)
  let wasmRequestSeen = false
  let release: (() => void) | undefined
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/*.wasm', async (route) => {
    wasmRequestSeen = true
    // Cancellation terminates the importer worker before this request is fulfilled.
    await pending
    await route.continue().catch(() => {})
  })
  try {
    await page.getByLabel('IFC 파일 선택', { exact: true }).setInputFiles({
      name: 'cancelled.ifc',
      mimeType: 'application/octet-stream',
      buffer: await readFile(fixture),
    })
    await expect
      .poll(() => wasmRequestSeen, { message: 'the replacement import requests official WASM' })
      .toBe(true)
    await page.getByRole('button', { name: '업로드 취소', exact: true }).click()
    await expect(page.getByRole('button', { name: '업로드 취소', exact: true })).toHaveCount(0)
    await expect(members(page).locator('tbody tr')).toHaveCount(5)
    await expect(detail(page)).toContainText(columnGuid)
    await expect(detail(page)).toContainText('Installed')
  } finally {
    release?.()
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  }
})

test('a real 206-element IFC bounds table rows while keeping paging, off-page selection and filtering usable', async ({
  page,
}) => {
  await openBuilding(page)
  await importIfc(
    page,
    'pagination-building.ifc',
    await readFile(new URL('./fixtures/pagination-building.ifc', import.meta.url)),
    206,
  )
  const summary = page
    .getByRole('region', { name: '건물 집계 지표' })
    .locator('article')
    .filter({ has: page.getByText('표시 부재', { exact: true }) })
    .locator(':scope > strong')
  await expect(summary).toHaveText('206개')
  await expect(members(page).locator('tbody tr')).toHaveCount(200)
  const menu = page.getByRole('navigation', { name: '건물 메뉴', exact: true })
  await menu.getByRole('button', { name: '부재 데이터', exact: true }).click()
  const pager = page.getByRole('navigation', { name: '부재 목록 페이지', exact: true })
  await expect(pager).toContainText('1–200 / 206개')
  await expect(pager.getByRole('button', { name: '이전 부재 페이지', exact: true })).toBeDisabled()
  await pager.getByRole('button', { name: '다음 부재 페이지', exact: true }).click()
  await expect(members(page).locator('tbody tr')).toHaveCount(6)
  await expect(pager).toContainText('201–206 / 206개')
  await expect(pager.getByRole('button', { name: '다음 부재 페이지', exact: true })).toBeDisabled()
  await members(page)
    .getByRole('button', { name: /Pagination column 201.*선택$/ })
    .click()
  await expect(page.getByRole('heading', { name: '건물 모델 대시보드', exact: true })).toBeVisible()
  await expect(detail(page)).toContainText('2GP1wMeInMCOWhjr6TxgfD')
  await expect(detail(page)).toContainText('P201')
  await expect(summary).toHaveText('206개')
  await expect(members(page).locator('tbody tr')).toHaveCount(200)
  await menu.getByRole('button', { name: '부재 데이터', exact: true }).click()
  await page.getByRole('textbox', { name: '부재 검색', exact: true }).fill('P201')
  await expect(members(page).locator('tbody tr')).toHaveCount(1)
  await expect(members(page)).toContainText('Pagination column 201')
  await expect(pager).toHaveCount(0)
  await page.getByRole('textbox', { name: '부재 검색', exact: true }).fill('')
  await page
    .getByRole('group', { name: '건물 층 선택' })
    .getByRole('button', { name: 'First floor', exact: true })
    .click()
  await expect(members(page).locator('tbody tr')).toHaveCount(3)
  await expect(summary).toHaveText('3개')
  await expect(pager).toHaveCount(0)
})
