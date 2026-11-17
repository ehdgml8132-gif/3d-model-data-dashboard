import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import type { ProjectCamera, SavedProject } from '../src/projects/types'

const fixture = new URL('../public/examples/authored-building.ifc', import.meta.url)
const businessFixture = new URL('../public/examples/authored-building-data.csv', import.meta.url)
const columnName = 'Round concrete column G'
const columnGuid = '0nKbBzQJnGpBAXy9$4zESO'

test.describe.configure({ mode: 'default' })
test.setTimeout(120_000)

const members = (page: Page) => page.getByRole('article', { name: '부재 목록', exact: true })
const detail = (page: Page) => page.getByRole('article', { name: '선택한 부재 정보', exact: true })
const menu = (page: Page) => page.getByRole('navigation', { name: '건물 메뉴', exact: true })
const toolbar = (page: Page) => page.getByRole('region', { name: '프로젝트 작업공간', exact: true })

async function openBuilding(page: Page) {
  await page.goto('/?sample=building')
  await expect(page.getByRole('heading', { name: '건물 모델 대시보드', exact: true })).toBeVisible()
}

async function importIfc(page: Page) {
  await page.getByLabel('IFC 파일 선택', { exact: true }).setInputFiles({
    name: 'authored-building.ifc',
    mimeType: 'application/octet-stream',
    buffer: await readFile(fixture),
  })
  await expect(members(page).locator('tbody tr')).toHaveCount(5, { timeout: 45_000 })
  await expect(
    page.getByText('업로드한 IFC 모델 · authored-building.ifc', { exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: '업로드 취소', exact: true })).toHaveCount(0)
}

async function connectBusiness(page: Page, note?: string) {
  await page.getByRole('button', { name: '업무 데이터 연결', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '업무 데이터 연결', exact: true })
  await dialog.getByLabel('업무 데이터 파일 선택', { exact: true }).setInputFiles({
    name: 'authored-building-data.csv',
    mimeType: 'text/csv',
    buffer: note
      ? Buffer.from(
          (await readFile(businessFixture, 'utf8')).replace('Self-authored fixture', note),
        )
      : await readFile(businessFixture),
  })
  await dialog.getByLabel('모델 연결 키', { exact: true }).selectOption('globalId')
  await dialog.getByLabel('데이터 연결 열', { exact: true }).selectOption('GlobalId')
  await dialog.getByRole('button', { name: '데이터 연결', exact: true }).click()
  await expect(dialog).toHaveCount(0)
}

async function selectColumn(page: Page) {
  await members(page)
    .getByRole('button', { name: new RegExp(`${columnName}.*선택$`) })
    .click()
  await expect(detail(page)).toContainText(columnGuid)
}

async function showData(page: Page, query: string, kind = 'column') {
  await menu(page).getByRole('button', { name: '부재 데이터', exact: true }).click()
  await page.getByRole('textbox', { name: '부재 검색', exact: true }).fill(query)
  await page.getByLabel('부재 종류', { exact: true }).selectOption(kind)
}

async function saveNamed(page: Page, name: string, saveAs = false) {
  const action = saveAs ? '다른 이름으로 저장' : '프로젝트 저장'
  await toolbar(page).getByRole('button', { name: action, exact: true }).click()
  const dialog = page.getByRole('dialog', { name: action, exact: true })
  await dialog.getByRole('textbox', { name: '프로젝트 이름', exact: true }).fill(name)
  await dialog.getByRole('button', { name: '저장', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByTestId('current-project-name')).toHaveText(name)
}

async function projectList(page: Page) {
  await toolbar(page).getByRole('button', { name: '프로젝트 열기', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '프로젝트 열기', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

async function openSaved(page: Page, name: string) {
  const dialog = await projectList(page)
  await dialog.getByRole('button', { name: `${name} 열기`, exact: true }).click()
  await expect(dialog).toHaveCount(0, { timeout: 45_000 })
  await expect(page.getByTestId('current-project-name')).toHaveText(name)
  await expect(
    page.getByText('업로드한 IFC 모델 · authored-building.ifc', { exact: true }),
  ).toBeVisible()
}

async function expectColumnBusiness(page: Page) {
  await expect(detail(page)).toContainText(columnGuid)
  await expect(detail(page)).toContainText('Installed')
  await expect(detail(page)).toContainText('125000')
  await expect(page.getByTestId('building-selected-volume')).toContainText('0.59')
}

async function savedCamera(page: Page, name: string): Promise<ProjectCamera> {
  const pose = await page.evaluate(
    (projectName) =>
      new Promise<ProjectCamera | null>((resolve, reject) => {
        const open = indexedDB.open('monospace:projects:v1', 1)
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const database = open.result
          const request = database
            .transaction('projects', 'readonly')
            .objectStore('projects')
            .getAll()
          request.onerror = () => {
            database.close()
            reject(request.error)
          }
          request.onsuccess = () => {
            database.close()
            const record = (request.result as SavedProject[]).find(
              (item) => item.name === projectName,
            )
            resolve(record?.snapshot.workspace.camera ?? null)
          }
        }
      }),
    name,
  )
  expect(pose).not.toBeNull()
  return pose!
}

function exportedBinary(html: Buffer): Buffer {
  const payload = html
    .toString('utf8')
    .match(/<script\b[^>]*\bid="monospace-project"[^>]*>([A-Za-z0-9+/=\r\n]+)<\/script>/)
  expect(payload, 'HTML includes its portable project payload').not.toBeNull()
  const binary = Buffer.from(payload![1], 'base64')
  expect(binary.subarray(0, 8).toString('ascii')).toBe('MONOPRJ1')
  return binary
}

function exportedWorkspace(html: Buffer): SavedProject['snapshot']['workspace'] {
  const binary = exportedBinary(html)
  const metadataLength = binary.readUInt32LE(8)
  return (JSON.parse(binary.subarray(12, 12 + metadataLength).toString('utf8')) as SavedProject)
    .snapshot.workspace
}

async function expectNoProjectManagement(page: Page) {
  await expect(toolbar(page)).toHaveCount(0)
  await expect(page.getByTestId('current-project-name')).toHaveCount(0)
  for (const name of ['프로젝트 저장', '다른 이름으로 저장', '프로젝트 열기', '파일로 내보내기']) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0)
  }
}

async function openDownloadedHtml(page: Page, path: string, testInfo: TestInfo) {
  try {
    await page.goto(pathToFileURL(path).href)
    return page
  } catch (cause) {
    if (!(cause instanceof Error) || !cause.message.includes('ERR_BLOCKED_BY_ADMINISTRATOR'))
      throw cause
    // Managed Chromium can prohibit every file:// navigation. An offline Blob
    // document still executes the exact downloaded bytes with an opaque origin;
    // no browser policies or launch restrictions are changed for this fallback.
    if (!testInfo.annotations.some((item) => item.type === 'managed-file-policy'))
      testInfo.annotations.push({
        type: 'managed-file-policy',
        description:
          'file:// prohibited; downloaded HTML rendered offline with an opaque Blob origin.',
      })
    const blank = await page.context().newPage()
    await page.close()
    const url = await blank.evaluate(
      (html) => URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' })),
      await readFile(path, 'utf8'),
    )
    await blank.goto(url)
    expect(await blank.evaluate(() => location.origin)).toBe('null')
    return blank
  }
}

test('named browser projects survive reload and Save As keeps independent workspace copies', async ({
  page,
}) => {
  await openBuilding(page)
  await importIfc(page)
  await connectBusiness(page)
  await selectColumn(page)
  await page.getByRole('checkbox', { name: '단면상자', exact: true }).check()
  const canvas = page.getByLabel('IFC 모델 3D 뷰어', { exact: true })
  // Use the accessible outline-selection action; pointer dragging is covered by
  // the section-box suite. Here the adjusted clipping bounds must survive save.
  await canvas.focus()
  await canvas.press('Enter')
  const topFace = page.getByRole('button', { name: 'Y 최대 단면 이동', exact: true })
  await expect(topFace).toBeVisible()
  await topFace.press('End')
  for (let index = 0; index < 3; index++) await topFace.press('Shift+ArrowDown')
  await expect(topFace.locator('.section-face-value')).toHaveText('70%')
  await page
    .getByRole('group', { name: '건물 층 선택' })
    .getByRole('button', { name: 'Ground floor', exact: true })
    .click()
  const savedMin = await canvas.getAttribute('data-section-min')
  const savedMax = await canvas.getAttribute('data-section-max')
  await showData(page, 'Round concrete')
  await expect(members(page).locator('tbody tr')).toHaveCount(1)
  await saveNamed(page, '현장 A')
  await showData(page, 'Concrete wall', 'wall')
  await saveNamed(page, '현장 B', true)

  await page.reload()
  await expect(members(page).locator('tbody tr')).toHaveCount(72)
  const list = await projectList(page)
  await expect(list.getByRole('article')).toHaveCount(2)
  await expect(list.getByRole('article', { name: '현장 A 프로젝트', exact: true })).toContainText(
    'authored-building.ifc',
  )
  await page.screenshot({ path: '/tmp/monospace-projects-desktop.png', fullPage: false })
  await list.getByRole('button', { name: '현장 A 열기', exact: true }).click()
  await expect(list).toHaveCount(0, { timeout: 45_000 })
  await expect(page.getByRole('heading', { name: '부재 데이터', exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: '부재 검색', exact: true })).toHaveValue(
    'Round concrete',
  )
  await expect(page.getByLabel('부재 종류', { exact: true })).toHaveValue('column')
  await expect(members(page).locator('tbody tr')).toHaveCount(1)
  await expect(
    page
      .getByRole('group', { name: '건물 층 선택' })
      .getByRole('button', { name: 'Ground floor', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')

  await menu(page).getByRole('button', { name: '공간 데이터', exact: true }).click()
  await expectColumnBusiness(page)
  await expect(page.getByRole('checkbox', { name: '단면상자', exact: true })).toBeChecked()
  await expect(canvas).toHaveAttribute('data-section-min', savedMin!)
  await expect(canvas).toHaveAttribute('data-section-max', savedMax!)
  await expect(canvas).toHaveAttribute('data-section-selected', 'false')

  await showData(page, columnName)
  await toolbar(page).getByRole('button', { name: '프로젝트 저장', exact: true }).click()
  await expect(page.getByTestId('current-project-name')).toHaveText('현장 A')
  // Opening the list waits for the preceding save and must still contain two IDs.
  const updatedList = await projectList(page)
  await expect(updatedList.getByRole('article')).toHaveCount(2)
  await updatedList.getByRole('button', { name: '현장 B 열기', exact: true }).click()
  await expect(updatedList).toHaveCount(0, { timeout: 45_000 })
  await expect(page.getByRole('textbox', { name: '부재 검색', exact: true })).toHaveValue(
    'Concrete wall',
  )
  await expect(page.getByLabel('부재 종류', { exact: true })).toHaveValue('wall')
  await openSaved(page, '현장 A')
  await expect(page.getByRole('textbox', { name: '부재 검색', exact: true })).toHaveValue(
    columnName,
  )
})

test('HTML project files restore IFC and linked data in a fresh mobile browser and reject corrupt files', async ({
  page,
  browser,
}) => {
  await openBuilding(page)
  await importIfc(page)
  await connectBusiness(page)
  await selectColumn(page)
  await showData(page, columnName)
  const downloadPromise = page.waitForEvent('download', { timeout: 60_000 })
  await toolbar(page).getByRole('button', { name: '파일로 내보내기', exact: true }).click()
  const exportDialog = page.getByRole('dialog', { name: '프로젝트 파일 내보내기', exact: true })
  await exportDialog.getByRole('textbox', { name: '프로젝트 이름', exact: true }).fill('이동 현장')
  await exportDialog.getByRole('button', { name: '내보내기', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/\.html$/)
  const portableFile = await readFile((await download.path())!)
  expect(portableFile.toString('utf8')).toMatch(/<!doctype html>/i)

  // This context has no IndexedDB records from the original browser.
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } })
  try {
    const restored = await mobile.newPage()
    await openBuilding(restored)
    let list = await projectList(restored)
    await expect(list.getByRole('article')).toHaveCount(0)
    await expect(list.getByText('저장한 프로젝트가 없습니다.', { exact: true })).toBeVisible()
    await restored.getByLabel('프로젝트 파일 선택', { exact: true }).setInputFiles({
      name: download.suggestedFilename(),
      mimeType: 'text/html',
      buffer: Buffer.from(
        portableFile
          .toString('utf8')
          .replace('</head>', '<script>window.__projectScriptRan=3</script></head>'),
      ),
    })
    await expect(list).toHaveCount(0, { timeout: 45_000 })
    await expect(restored.getByRole('textbox', { name: '부재 검색', exact: true })).toHaveValue(
      columnName,
    )
    await expect(members(restored).locator('tbody tr')).toHaveCount(1)
    await menu(restored).getByRole('button', { name: '공간 데이터', exact: true }).click()
    await expectColumnBusiness(restored)
    await expect(restored.getByLabel('IFC 모델 3D 뷰어', { exact: true })).toBeVisible()
    expect(
      await restored.evaluate(
        () => (window as Window & { __projectScriptRan?: number }).__projectScriptRan,
      ),
    ).toBeUndefined()

    list = await projectList(restored)
    // Importing a portable file does not claim a browser save has occurred.
    await expect(list.getByRole('article')).toHaveCount(0)
    await expect(list.getByText('저장한 프로젝트가 없습니다.', { exact: true })).toBeVisible()
    const bounds = (await list.boundingBox())!
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(391)
    expect(await restored.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    )
    await restored.screenshot({ path: '/tmp/monospace-projects-mobile.png', fullPage: false })
    await restored.getByLabel('프로젝트 파일 선택', { exact: true }).setInputFiles({
      name: 'broken.monospace',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('not a project'),
    })
    await expect(list.getByRole('alert')).toBeVisible()
    await list.getByRole('button', { name: '닫기', exact: true }).click()
    await expectColumnBusiness(restored)
    await expect(
      restored.getByText('업로드한 IFC 모델 · authored-building.ifc', { exact: true }),
    ).toBeVisible()
    // A subsequent first Save still asks for a browser project name.
    await toolbar(restored).getByRole('button', { name: '프로젝트 저장', exact: true }).click()
    const nameDialog = restored.getByRole('dialog', { name: '프로젝트 저장', exact: true })
    const nameBounds = (await nameDialog.boundingBox())!
    expect(nameBounds.x).toBeGreaterThanOrEqual(0)
    expect(nameBounds.x + nameBounds.width).toBeLessThanOrEqual(391)
    await nameDialog
      .getByRole('textbox', { name: '프로젝트 이름', exact: true })
      .fill('가져온 현장')
    await restored.screenshot({ path: '/tmp/monospace-project-save-mobile.png', fullPage: false })
    await nameDialog.getByRole('button', { name: '저장', exact: true }).click()
    await expect(nameDialog).toHaveCount(0)
    await expect(restored.getByTestId('current-project-name')).toHaveText('가져온 현장')

    // HTML replaces the download format; existing binary project files still
    // import through the same picker without being interpreted as executable HTML.
    list = await projectList(restored)
    await restored.getByLabel('프로젝트 파일 선택', { exact: true }).setInputFiles({
      name: 'legacy.monospace',
      mimeType: 'application/octet-stream',
      buffer: exportedBinary(portableFile),
    })
    await expect(list).toHaveCount(0, { timeout: 45_000 })
    await expect(restored.getByTestId('current-project-name')).toHaveText('이동 현장')
    await menu(restored).getByRole('button', { name: '공간 데이터', exact: true }).click()
    await expectColumnBusiness(restored)
  } finally {
    await mobile.close()
  }
})

test('downloaded HTML restores the offline workspace without project management controls', async ({
  page,
  browser,
}, testInfo) => {
  const projectName = '현장 </title><script>window.__projectScriptRan=1</script>'
  const note =
    '</script><script>window.__projectScriptRan=2</script><!-- 한글 & <b>값</b> \u2028\u2029'
  await openBuilding(page)
  await expect(toolbar(page)).toBeVisible()
  await importIfc(page)
  await connectBusiness(page, note)
  await selectColumn(page)
  await page.getByRole('checkbox', { name: '단면상자', exact: true }).check()
  const canvas = page.getByLabel('IFC 모델 3D 뷰어', { exact: true })
  await canvas.focus()
  await canvas.press('Enter')
  const topFace = page.getByRole('button', { name: 'Y 최대 단면 이동', exact: true })
  await topFace.press('End')
  await topFace.press('Shift+ArrowDown')
  await expect(topFace.locator('.section-face-value')).toHaveText('90%')
  await page
    .getByRole('group', { name: '건물 층 선택' })
    .getByRole('button', { name: 'Ground floor', exact: true })
    .click()
  const bounds = (await canvas.boundingBox())!
  await page.mouse.move(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.5)
  await page.mouse.down({ button: 'right' })
  await page.mouse.move(bounds.x + bounds.width * 0.57, bounds.y + bounds.height * 0.53, {
    steps: 8,
  })
  await page.mouse.up({ button: 'right' })
  await page.mouse.wheel(0, -200)
  const savedMin = await canvas.getAttribute('data-section-min')
  const savedMax = await canvas.getAttribute('data-section-max')
  await showData(page, columnName)

  const downloadPromise = page.waitForEvent('download', { timeout: 60_000 })
  await toolbar(page).getByRole('button', { name: '파일로 내보내기', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '프로젝트 파일 내보내기', exact: true })
  await dialog.getByRole('textbox', { name: '프로젝트 이름', exact: true }).fill(projectName)
  await dialog.getByRole('button', { name: '내보내기', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/\.html$/)
  const path = testInfo.outputPath('exported-project.html')
  await download.saveAs(path)
  const originalWorkspace = exportedWorkspace(await readFile(path))
  expect(originalWorkspace.camera).not.toBeNull()

  const offline = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
    offline: true,
  })
  try {
    const networkRequests: string[] = []
    const errors: string[] = []
    offline.on('request', (request) => {
      if (/^https?:/i.test(request.url())) networkRequests.push(request.url())
    })
    offline.on('page', (opened) => opened.on('pageerror', (error) => errors.push(error.message)))
    let local = await openDownloadedHtml(await offline.newPage(), path, testInfo)
    await expect(
      local.getByText('업로드한 IFC 모델 · authored-building.ifc', { exact: true }),
    ).toBeVisible({
      timeout: 45_000,
    })
    await expect(local.locator('html')).toHaveAttribute('data-monospace-project', '1')
    await expectNoProjectManagement(local)
    await expect(local.getByRole('textbox', { name: '부재 검색', exact: true })).toHaveValue(
      columnName,
    )
    await expect(local.getByLabel('부재 종류', { exact: true })).toHaveValue('column')
    await expect(members(local).locator('tbody tr')).toHaveCount(1)
    await expect(
      local
        .getByRole('group', { name: '건물 층 선택' })
        .getByRole('button', { name: 'Ground floor', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true')
    await menu(local).getByRole('button', { name: '공간 데이터', exact: true }).click()
    await expectColumnBusiness(local)
    await expect(detail(local)).toContainText(note)
    await expect(local.getByRole('checkbox', { name: '단면상자', exact: true })).toBeChecked()
    const localCanvas = local.getByLabel('IFC 모델 3D 뷰어', { exact: true })
    await expect(localCanvas).toHaveAttribute('data-section-min', savedMin!)
    await expect(localCanvas).toHaveAttribute('data-section-max', savedMax!)
    // The large startup payload is removed after opening. The exported-page
    // mode must survive that cleanup and keep management controls unmounted.
    await expect(local.locator('#monospace-project')).toHaveCount(0)
    await expectNoProjectManagement(local)
    expect(
      await local.evaluate(
        () => (window as Window & { __projectScriptRan?: number }).__projectScriptRan,
      ),
    ).toBeUndefined()
    await local.screenshot({ path: '/tmp/monospace-project-html-no-toolbar.png', fullPage: false })

    await menu(local).getByRole('button', { name: '부재 데이터', exact: true }).click()
    await expect(local.getByRole('textbox', { name: '부재 검색', exact: true })).toHaveValue(
      columnName,
    )
    await expect(members(local).locator('tbody tr')).toHaveCount(1)
    await expectNoProjectManagement(local)
    await menu(local).getByRole('button', { name: '공간 데이터', exact: true }).click()
    await local.getByRole('button', { name: '카페 샘플', exact: true }).click()
    await expect(
      local.getByRole('heading', { name: '모노 카페 대시보드', exact: true }),
    ).toBeVisible()
    await local.getByRole('button', { name: '건물 샘플', exact: true }).click()
    await expectColumnBusiness(local)
    await expect(detail(local)).toContainText(note)
    await expect(local.getByLabel('IFC 모델 3D 뷰어', { exact: true })).toBeVisible()
    await expectNoProjectManagement(local)
    await expect(local.getByRole('checkbox', { name: '단면상자', exact: true })).toBeChecked()

    // Keep the HTML and metadata valid while corrupting just the IFC bytes.
    // Startup must surface the model error rather than silently show the sample.
    const html = await readFile(path, 'utf8')
    const invalidBinary = exportedBinary(Buffer.from(html))
    invalidBinary.fill(0x21, 12 + invalidBinary.readUInt32LE(8))
    const invalidPath = testInfo.outputPath('invalid-model-project.html')
    await writeFile(
      invalidPath,
      html.replace(
        /(<script\b[^>]*\bid="monospace-project"[^>]*>)[A-Za-z0-9+/=\r\n]+(<\/script>)/,
        (_, start: string, end: string) => `${start}${invalidBinary.toString('base64')}${end}`,
      ),
    )
    local = await openDownloadedHtml(local, invalidPath, testInfo)
    await expect(local.getByRole('alert')).toContainText('유효한 IFC STEP 파일이 아닙니다.', {
      timeout: 45_000,
    })
    await expect(members(local).locator('tbody tr')).toHaveCount(72)
    await expectNoProjectManagement(local)
    expect(networkRequests).toEqual([])
    expect(errors).toEqual([])
  } finally {
    await offline.close()
  }
})

test('a quota error aborts the whole overwrite and leaves the previous browser project usable', async ({
  page,
}) => {
  await openBuilding(page)
  await importIfc(page)
  await showData(page, 'Round concrete')
  await saveNamed(page, '저장 공간 검증')
  await page.getByRole('textbox', { name: '부재 검색', exact: true }).fill('unsaved revision')
  await page.evaluate(() => {
    const originalPut = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
      // The model record has already been queued when writing the summary fails.
      // The transaction must roll both stores back rather than partially save.
      if (this.name === 'summaries') throw new DOMException('simulated quota', 'QuotaExceededError')
      return originalPut.apply(this, args)
    }
  })
  await toolbar(page).getByRole('button', { name: '프로젝트 저장', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('브라우저 저장 공간이 부족합니다')
  await expect(page.getByRole('textbox', { name: '부재 검색', exact: true })).toHaveValue(
    'unsaved revision',
  )
  // A storage failure still allows a portable backup of the current revision.
  const downloadPromise = page.waitForEvent('download', { timeout: 60_000 })
  await toolbar(page).getByRole('button', { name: '파일로 내보내기', exact: true }).click()
  expect((await downloadPromise).suggestedFilename()).toMatch(/\.html$/)
  // Reload also removes the injected failure. The saved IFC must still parse.
  await page.reload()
  await openSaved(page, '저장 공간 검증')
  await expect(page.getByRole('textbox', { name: '부재 검색', exact: true })).toHaveValue(
    'Round concrete',
  )
  await expect(members(page).locator('tbody tr')).toHaveCount(2)

  // Hold delivery of a committed save, then replace the model before the save
  // promise resolves. The old completion must not attach its ID to the sample.
  await page.evaluate(() => {
    const originalTransaction = IDBDatabase.prototype.transaction
    IDBDatabase.prototype.transaction = function (...args) {
      const transaction = originalTransaction.apply(this, args)
      if (transaction.mode === 'readwrite' && transaction.objectStoreNames.contains('projects')) {
        transaction.addEventListener(
          'complete',
          (event) => {
            event.stopImmediatePropagation()
            ;(window as Window & { releaseProjectSave?: () => void }).releaseProjectSave = () =>
              transaction.oncomplete?.call(transaction, event)
          },
          { once: true },
        )
      }
      return transaction
    }
  })
  await page.getByRole('textbox', { name: '부재 검색', exact: true }).fill('delayed save')
  await toolbar(page).getByRole('button', { name: '프로젝트 저장', exact: true }).click()
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean((window as Window & { releaseProjectSave?: () => void }).releaseProjectSave),
      ),
    )
    .toBe(true)
  await page.getByRole('button', { name: '샘플로 돌아가기', exact: true }).click()
  await page.evaluate(() =>
    (window as Window & { releaseProjectSave?: () => void }).releaseProjectSave?.(),
  )
  await expect(
    toolbar(page).getByRole('button', { name: '프로젝트 열기', exact: true }),
  ).toBeEnabled()
  await expect(page.getByTestId('current-project-name')).toHaveText('저장되지 않은 프로젝트')
  await expect(members(page).locator('tbody tr')).toHaveCount(72)
  await expect(
    page.getByText('업로드한 IFC 모델 · authored-building.ifc', { exact: true }),
  ).toHaveCount(0)
})

test('Save As retains an adjusted camera and cancelling a project parse preserves the current workspace', async ({
  page,
}) => {
  await openBuilding(page)
  await importIfc(page)
  await connectBusiness(page)
  await selectColumn(page)
  await saveNamed(page, '시점 기준')
  const original = await savedCamera(page, '시점 기준')
  const canvas = page.getByLabel('IFC 모델 3D 뷰어', { exact: true })
  const bounds = (await canvas.boundingBox())!
  await page.mouse.move(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.5)
  await page.mouse.down({ button: 'right' })
  await page.mouse.move(bounds.x + bounds.width * 0.6, bounds.y + bounds.height * 0.56, {
    steps: 10,
  })
  await page.mouse.up({ button: 'right' })
  await page.mouse.wheel(0, -300)
  await saveNamed(page, '시점 변경', true)
  const moved = await savedCamera(page, '시점 변경')
  // Opening the name modal must not refit the viewer back to its initial camera.
  expect(moved.target.some((value, index) => Math.abs(value - original.target[index]) > 0.01)).toBe(
    true,
  )
  expect(moved.zoom).toBeGreaterThan(original.zoom)

  await openSaved(page, '시점 기준')
  await openSaved(page, '시점 변경')
  await expectColumnBusiness(page)
  await saveNamed(page, '복원 시점', true)
  const restored = await savedCamera(page, '복원 시점')
  restored.position.forEach((value, index) => expect(value).toBeCloseTo(moved.position[index], 5))
  restored.target.forEach((value, index) => expect(value).toBeCloseTo(moved.target[index], 5))
  const viewportScale = Math.min(
    restored.viewport[0] / moved.viewport[0],
    restored.viewport[1] / moved.viewport[1],
  )
  expect(restored.zoom).toBeCloseTo(moved.zoom * viewportScale, 5)

  let wasmRequestSeen = false
  let release: (() => void) | undefined
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/*.wasm', async (route) => {
    wasmRequestSeen = true
    await pending
    await route.continue().catch(() => {})
  })
  try {
    const dialog = await projectList(page)
    await dialog.getByRole('button', { name: '시점 기준 열기', exact: true }).click()
    await expect.poll(() => wasmRequestSeen).toBe(true)
    await dialog.getByRole('button', { name: '불러오기 취소', exact: true }).last().click()
    await expect(dialog.getByRole('alert')).toContainText('프로젝트 열기를 취소했습니다')
    await dialog.getByRole('button', { name: '닫기', exact: true }).click()
    await expect(page.getByTestId('current-project-name')).toHaveText('복원 시점')
    await expectColumnBusiness(page)
    await expect(members(page).locator('tbody tr')).toHaveCount(5)
    await expect(canvas).toBeVisible()
  } finally {
    release?.()
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  }
})
