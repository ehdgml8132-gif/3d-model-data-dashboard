import { expect, test, type Locator, type Page } from '@playwright/test'
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
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '건물 모델 대시보드', exact: true })).toBeVisible()
}

async function openFloorFilter(page: Page) {
  await page.getByRole('button', { name: '표시 층 필터', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '표시 층 필터', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
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
  await expect(page.getByRole('group', { name: '건물 층 선택', exact: true })).toHaveCount(0)
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

async function expectTransparencyRendering(page: Page, canvas: Locator, slider: Locator) {
  async function capture(value: string) {
    await slider.fill(value)
    await expect(slider).toHaveValue(value)
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    )
    return (await canvas.screenshot()).toString('base64')
  }

  const opaque = await capture('0')
  const transparent = await capture('75')
  const reset = await capture('0')
  const difference = await page.evaluate(
    async (captures) => {
      const images = await Promise.all(
        captures.map(async (capture) => {
          const image = new Image()
          image.src = `data:image/png;base64,${capture}`
          await image.decode()
          return image
        }),
      )
      const scratch = document.createElement('canvas')
      scratch.width = images[0].width
      scratch.height = images[0].height
      const context = scratch.getContext('2d')!
      // Compare the middle of the viewer away from its overlaid labels and controls.
      const x = Math.floor(scratch.width / 5)
      const y = Math.floor(scratch.height / 5)
      const width = scratch.width - 2 * x
      const height = scratch.height - 2 * y
      const pixels = images.map((image) => {
        context.drawImage(image, 0, 0)
        return context.getImageData(x, y, width, height).data
      })
      function changedFraction(comparison: Uint8ClampedArray) {
        let changed = 0
        for (let index = 0; index < comparison.length; index += 4) {
          const difference =
            Math.abs(pixels[0][index] - comparison[index]) +
            Math.abs(pixels[0][index + 1] - comparison[index + 1]) +
            Math.abs(pixels[0][index + 2] - comparison[index + 2])
          if (difference > 24) changed++
        }
        return changed / (width * height)
      }
      return { transparent: changedFraction(pixels[1]), reset: changedFraction(pixels[2]) }
    },
    [opaque, transparent, reset],
  )

  expect(difference.transparent, 'fading changes the rendered IFC pixels').toBeGreaterThan(0.01)
  expect(difference.reset, 'returning to 0% restores the rendering').toBeLessThan(
    difference.transparent / 10,
  )
}

test('official IFC geometry uses Revit-style Pset volumes for member cards, tables and totals', async ({
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
  const transparency = page.getByRole('slider', { name: '투명도', exact: true })
  await expect(transparency).toHaveCount(0)
  const source = await readFile(fixture, 'utf8')
  // Deliberately disagree with the column's Pset value: Qto must not supply the volume.
  const conflictingQto = source.replace(
    "#49=IFCQUANTITYVOLUME('NetVolume','Declared volume in cubic metres',#15,0.589048623,$);",
    "#49=IFCQUANTITYVOLUME('NetVolume','Declared volume in cubic metres',#15,99.,$);",
  )
  expect(conflictingQto).not.toBe(source)
  await importIfc(page, 'pset-volume.ifc', Buffer.from(conflictingQto))
  const canvas = page.getByLabel('IFC 모델 3D 뷰어', { exact: true })
  await expect(canvas).toBeVisible()
  await expect(transparency).toHaveValue('0')
  await expect(transparency).toHaveAttribute('min', '0')
  await expect(transparency).toHaveAttribute('max', '100')
  await expect(transparency).toHaveAttribute('step', '5')
  expect(
    await canvas.evaluate((node) => {
      const gl = (node as HTMLCanvasElement).getContext('webgl2')
      return !!gl && !gl.isContextLost()
    }),
  ).toBe(true)
  await expectTransparencyRendering(page, canvas, transparency)
  await selectColumn(page)
  await expect(detail(page)).toContainText('Concrete C30/37')
  await expect(detail(page)).toContainText('Ground floor')
  await expect(detail(page)).toContainText('R120')
  // The round column's bounding box is 0.75 m³ and Qto now says 99 m³.
  // Its Pset 체적 is 0.589048623 m³; the project length unit remains millimetres.
  await expect(page.getByTestId('building-selected-volume')).toContainText('0.59')
  await expect(detail(page)).not.toContainText('0.75')
  await expect(
    members(page).locator('tbody tr').filter({ hasText: columnName }).locator('td').last(),
  ).toHaveText('0.59')
  await expect(
    page
      .getByRole('region', { name: '건물 집계 지표' })
      .locator('article')
      .filter({ has: page.getByText('총 체적', { exact: true }) })
      .locator(':scope > strong'),
  ).toHaveText('10.83 m³')
  await transparency.press('ArrowRight')
  await expect(transparency).toHaveValue('5')
  await transparency.fill('50')
  await expect(transparency).toHaveAttribute('aria-valuetext', '50%')
  await expect(page.getByText('50%', { exact: true })).toBeVisible()
  // Unmount and remount the viewer twice under the app's React StrictMode.
  // The subsequent real pointer pick also verifies selection through transparency.
  const menu = page.getByRole('navigation', { name: '건물 메뉴', exact: true })
  for (let index = 0; index < 2; index++) {
    await menu.getByRole('button', { name: '부재 데이터', exact: true }).click()
    await expect(page.locator('canvas')).toHaveCount(0)
    await expect(transparency).toHaveCount(0)
    await menu.getByRole('button', { name: '공간 데이터', exact: true }).click()
    await expect(canvas).toBeVisible()
    await expect(transparency).toHaveValue('50')
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
  const sectionBox = page.getByRole('checkbox', { name: '단면상자', exact: true })
  await sectionBox.check()
  await expect(canvas).toHaveAttribute('data-section-box', 'true')
  await expect(transparency).toHaveValue('50')
  await sectionBox.uncheck()
  const floors = await openFloorFilter(page)
  await expect(floors.getByRole('checkbox', { name: 'Ground floor', exact: true })).toBeVisible()
  await expect(floors.getByRole('checkbox', { name: 'First floor', exact: true })).toBeVisible()
  await floors.getByRole('checkbox', { name: 'First floor', exact: true }).check()
  await floors.getByRole('checkbox', { name: 'Ground floor', exact: true }).uncheck()
  await floors.getByRole('button', { name: '완료', exact: true }).click()
  await expect(members(page).locator('tbody tr')).toHaveCount(3)
  await page.getByRole('button', { name: '샘플로 돌아가기', exact: true }).click()
  await expect(members(page).locator('tbody tr')).toHaveCount(72)
  await expect(page.getByRole('group', { name: '건물 층 선택', exact: true })).toBeVisible()
  await expect(transparency).toHaveCount(0)
  await importIfc(page, 'reopened.ifc')
  await selectColumn(page)
  await expect(canvas).toBeVisible()
  await expect(transparency).toHaveValue('0')
  await expect(page.getByTestId('building-selected-volume')).toContainText('0.59')
  expect(wasm.length).toBeGreaterThan(0)
  expect(uploads).toEqual([])
  expect(external).toEqual([])
  expect(errors).toEqual([])
})

test('building and IFC views stop rotating when the mouse stops', async ({ page }) => {
  async function verifyRotation(viewerName: string) {
    const canvas = page.getByLabel(viewerName, { exact: true })
    await canvas.scrollIntoViewIfNeeded()
    const initial = await canvas.screenshot()
    const bounds = (await canvas.boundingBox())!

    async function captureAfterFrames() {
      // Give any remaining orbit motion time to render while the mouse is still.
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            let remaining = 6
            function nextFrame() {
              if (--remaining === 0) resolve()
              else requestAnimationFrame(nextFrame)
            }
            requestAnimationFrame(nextFrame)
          }),
      )
      return canvas.screenshot()
    }

    await page.mouse.move(bounds.x + bounds.width * 0.45, bounds.y + bounds.height * 0.5)
    await page.mouse.down()
    let stopped: Buffer
    try {
      await page.mouse.move(bounds.x + bounds.width * 0.6, bounds.y + bounds.height * 0.43, {
        steps: 8,
      })
      stopped = await canvas.screenshot()
      expect(stopped.equals(initial), `${viewerName} rotates during the drag`).toBe(false)
      expect((await captureAfterFrames()).equals(stopped), `${viewerName} stops while held`).toBe(
        true,
      )
    } finally {
      await page.mouse.up()
    }
    expect(
      (await captureAfterFrames()).equals(stopped),
      `${viewerName} stays still on release`,
    ).toBe(true)
  }

  await openBuilding(page)
  await verifyRotation('건물 모델 3D 뷰어')
  await importIfc(page)
  await verifyRotation('IFC 모델 3D 뷰어')
})

test('transparent IFC lowers rendering resolution during camera motion and restores it at rest', async ({
  page,
}) => {
  await openBuilding(page)
  await importIfc(page)
  const canvas = page.getByLabel('IFC 모델 3D 뷰어', { exact: true })
  const transparency = page.getByRole('slider', { name: '투명도', exact: true })
  await canvas.scrollIntoViewIfNeeded()
  const bounds = (await canvas.boundingBox())!
  const centerX = bounds.x + bounds.width / 2
  const centerY = bounds.y + bounds.height / 2

  const monitor = await canvas.evaluateHandle((node) => {
    const element = node as HTMLCanvasElement
    const size = () => ({
      renderWidth: element.width,
      renderHeight: element.height,
      displayWidth: element.clientWidth,
      displayHeight: element.clientHeight,
    })
    const changes: ReturnType<typeof size>[] = []
    // Preserve brief resolution changes even if a test polling interval misses them.
    const observer = new MutationObserver(() => changes.push(size()))
    observer.observe(element, { attributes: true, attributeFilter: ['width', 'height'] })
    return { size, changes, observer }
  })

  const size = () => monitor.evaluate(({ size }) => size())
  const takeChanges = () => monitor.evaluate(({ changes }) => changes.splice(0))
  const original = await size()
  const expectReducedResolution = async () => {
    await expect
      .poll(() =>
        monitor.evaluate(({ changes }) =>
          Math.min(
            1,
            ...changes.map(({ renderWidth, displayWidth }) => renderWidth / displayWidth),
          ),
        ),
      )
      .toBeCloseTo(0.7, 2)
  }
  const rotate = async (duringDrag: () => Promise<void>) => {
    await page.mouse.move(centerX, centerY)
    await page.mouse.down()
    try {
      await page.mouse.move(centerX + bounds.width * 0.13, centerY - bounds.height * 0.08, {
        steps: 8,
      })
      await duringDrag()
    } finally {
      await page.mouse.up()
    }
  }

  try {
    expect(original.renderWidth / original.displayWidth).toBeCloseTo(1, 2)
    await transparency.fill('50')
    await expect(transparency).toHaveValue('50')
    await rotate(expectReducedResolution)
    await expect.poll(size).toEqual(original)
    const rotated = await takeChanges()

    await page.mouse.wheel(0, -120)
    await expectReducedResolution()
    await expect.poll(size).toEqual(original)
    const zoomed = await takeChanges()
    for (const change of [...rotated, ...zoomed]) {
      expect(change.displayWidth).toBe(original.displayWidth)
      expect(change.displayHeight).toBe(original.displayHeight)
    }
    await expect(transparency).toHaveValue('50')

    await transparency.fill('0')
    await rotate(async () => expect(await size()).toEqual(original))
    await page.mouse.wheel(0, 120)
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    )
    await expect.poll(size).toEqual(original)
    const opaque = await takeChanges()
    expect(
      opaque.every(
        (change) =>
          change.renderWidth === original.renderWidth &&
          change.renderHeight === original.renderHeight,
      ),
    ).toBe(true)
  } finally {
    await monitor.evaluate(({ observer }) => observer.disconnect())
    await monitor.dispose()
  }
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
  const memberData = page
    .getByRole('navigation', { name: '건물 메뉴', exact: true })
    .getByRole('button', { name: '부재 데이터', exact: true })
  await memberData.click()
  await expect(page.getByRole('heading', { name: '부재 데이터', exact: true })).toBeVisible()
  await expect(page.locator('canvas')).toHaveCount(0)
  await page.getByRole('textbox', { name: '부재 검색', exact: true }).fill(columnName)
  await expect(members(page).locator('tbody tr')).toHaveCount(1)
  await selectColumn(page)
  await expect(detail(page)).toContainText('Installed')
  await memberData.click()
  await page.getByRole('button', { name: '공간·부재 정보', exact: true }).click()
  await expect(page.getByRole('heading', { name: '건물 모델 대시보드', exact: true })).toBeVisible()
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
  const transparency = page.getByRole('slider', { name: '투명도', exact: true })
  await transparency.fill('75')
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
  await expect(transparency).toHaveValue('75')
  const replacement = (await readFile(fixture, 'utf8')).replaceAll(
    columnName,
    'Replacement round column',
  )
  await importIfc(page, 'replacement.ifc', Buffer.from(replacement))
  await expect(transparency).toHaveValue('0')
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

test('an IFC member without Pset volume stays unknown even when Qto volume exists', async ({
  page,
}) => {
  const source = await readFile(fixture, 'utf8')
  // Remove only the beam's 체적 property reference; its Qto, geometry and other
  // Pset values stay intact. Neither Qto nor a bounding box may fill the gap.
  const withoutBeamVolume = source.replace('(#109,#110,#204)', '(#109,#110)')
  expect(withoutBeamVolume).not.toBe(source)
  await openBuilding(page)
  await importIfc(page, 'missing-volume.ifc', Buffer.from(withoutBeamVolume))
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
  const floors = await openFloorFilter(page)
  await floors.getByRole('checkbox', { name: 'First floor', exact: true }).check()
  await floors.getByRole('checkbox', { name: 'Ground floor', exact: true }).uncheck()
  await floors.getByRole('button', { name: '완료', exact: true }).click()
  await expect(members(page).locator('tbody tr')).toHaveCount(3)
  await expect(summary).toHaveText('3개')
  await expect(pager).toHaveCount(0)
})
