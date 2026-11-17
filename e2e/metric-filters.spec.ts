import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test.describe.configure({ mode: 'default' })
test.setTimeout(90_000)

const members = (page: Page) => page.getByRole('article', { name: '부재 목록', exact: true })
const detail = (page: Page) => page.getByRole('article', { name: '선택한 부재 정보', exact: true })
const diagnostics = (popup: Locator) =>
  popup.getByRole('region', { name: '체적 미확인 사유', exact: true })
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
  await expect(diagnostics(popup)).toContainText('현재 표시 부재 중 1개')
  await expect(
    diagnostics(popup)
      .locator('.volume-diagnostics-groups')
      .getByText('체적 속성 없음', { exact: true }),
  ).toBeVisible()
  await diagnostics(popup).getByText('미확인 부재 보기', { exact: true }).click()
  const unknownMembers = diagnostics(popup).getByRole('list', { name: '미확인 부재 목록' })
  await expect(unknownMembers.getByRole('listitem')).toHaveCount(1)
  await expect(unknownMembers).toContainText('Steel beam 1')
  await expect(unknownMembers).not.toContainText('Round concrete column G')
  await popup.getByLabel('최소 체적 (m³)', { exact: true }).fill('0')
  await popup.getByLabel('최대 체적 (m³)', { exact: true }).fill('0')
  await popup.getByRole('checkbox', { name: '체적 미확인 포함', exact: true }).uncheck()
  // Diagnostics describe the currently applied card, not an unapplied draft.
  await expect(diagnostics(popup)).toContainText('현재 표시 부재 중 1개')
  await popup.getByRole('button', { name: '적용', exact: true }).click()
  await expect(members(page).locator('tbody tr')).toHaveCount(1)
  await expect(members(page)).toContainText('Round concrete column G')
  await expect(metric(page, '총 체적')).toHaveText('0.00 m³')

  popup = await openFilter(page, '총 체적')
  await expect(diagnostics(popup)).toContainText('현재 표시 부재 중 0개')
  await expect(diagnostics(popup)).toContainText('현재 표시된 부재에는 체적 미확인이 없습니다.')
  await popup.getByRole('checkbox', { name: '체적 미확인 포함', exact: true }).check()
  await popup.getByRole('button', { name: '적용', exact: true }).click()
  await expect(members(page).locator('tbody tr')).toHaveCount(2)
  await expect(members(page)).toContainText('Steel beam 1')
  await expect(members(page).locator('tbody tr').filter({ hasText: 'Steel beam 1' })).toContainText(
    '—',
  )

  popup = await openFilter(page, '총 체적')
  await expect(diagnostics(popup)).toContainText('현재 표시 부재 중 1개')
  await expect(
    diagnostics(popup)
      .locator('.volume-diagnostics-groups')
      .getByText('체적 속성 없음', { exact: true }),
  ).toBeVisible()
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

test('IFC unknown-volume reasons follow the visible card, survive reopening and page member details', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const rawInvalidValue = 'not-a-number <img src=x onerror=window.__volumeIssueExecuted=1>'
  const source = (
    await readFile(new URL('../public/examples/authored-building.ifc', import.meta.url), 'utf8')
  )
    // Qto remains available for this column but must not replace its missing Pset.
    .replace('(#45,#46,#200)', '(#45,#46)')
    .replace('IFCVOLUMEMEASURE(3.6)', '$')
    .replace(/#202=[^\n]+/, (line) =>
      line.replace('IFCVOLUMEMEASURE(0.589048623)', `IFCLABEL('${rawInvalidValue}')`),
    )
    .replace(/#203=[^\n]+/, (line) => line.replace(',$);', ',#205);'))
    .replace('(#109,#110,#204)', '(#109,#110,#204,#206)')
    .replace(
      'ENDSEC;\nEND-ISO',
      "#205=IFCCONTEXTDEPENDENTUNIT($,.VOLUMEUNIT.,'Fixture unknown cubic unit');\n" +
        "#206=IFCPROPERTYSINGLEVALUE('Volume',$,IFCVOLUMEMEASURE(2.5),#15);\n" +
        'ENDSEC;\nEND-ISO',
    )
  await openBuilding(page)
  await page.getByLabel('IFC 파일 선택', { exact: true }).setInputFiles({
    name: 'volume-reasons.ifc',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(source),
  })
  await expect(members(page).locator('tbody tr')).toHaveCount(5, { timeout: 45_000 })
  await expect(metric(page, '총 체적')).toHaveText('—')
  let popup = await openFilter(page, '총 체적')
  let reasons = diagnostics(popup)
  await expect(reasons).toContainText('현재 표시 부재 중 5개')
  for (const label of [
    '체적 속성 없음',
    '체적 값 비어 있음',
    '체적 값 해석 불가',
    '체적 단위 확인 불가',
    '체적 값 충돌',
  ]) {
    const group = reasons.locator('.volume-diagnostics-groups > li').filter({
      has: page.getByText(label, { exact: true }),
    })
    await expect(group).toHaveCount(1)
    await expect(group.getByText('1개', { exact: true })).toBeVisible()
  }
  await reasons.getByText('미확인 부재 보기', { exact: true }).click()
  let unknownMembers = reasons.getByRole('list', { name: '미확인 부재 목록' })
  await expect(unknownMembers.getByRole('listitem')).toHaveCount(5)
  await expect(unknownMembers).toContainText(rawInvalidValue)
  await expect(unknownMembers).toContainText('Fixture unknown cubic unit')
  await expect(unknownMembers.locator('img')).toHaveCount(0)
  expect(
    await page.evaluate(
      () => (window as Window & { __volumeIssueExecuted?: number }).__volumeIssueExecuted,
    ),
  ).toBeUndefined()
  await page.screenshot({ path: '/tmp/volume-diagnostics-desktop.png', fullPage: false })
  await page.setViewportSize({ width: 390, height: 844 })
  const bounds = (await popup.boundingBox())!
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.y).toBeGreaterThanOrEqual(0)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(391)
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(845)
  await expect(popup.getByRole('button', { name: '적용', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: '/tmp/volume-diagnostics-mobile.png', fullPage: false })
  await popup.getByRole('button', { name: '적용', exact: true }).click()
  await page.setViewportSize({ width: 1440, height: 1080 })

  const projectName = '체적 미확인 검토'
  const projectToolbar = page.getByRole('region', { name: '프로젝트 작업공간', exact: true })
  await projectToolbar.getByRole('button', { name: '프로젝트 저장', exact: true }).click()
  const save = page.getByRole('dialog', { name: '프로젝트 저장', exact: true })
  await save.getByRole('textbox', { name: '프로젝트 이름', exact: true }).fill(projectName)
  await save.getByRole('button', { name: '저장', exact: true }).click()
  await expect(save).toHaveCount(0)

  popup = await openFilter(page, '표시 층')
  await popup.getByRole('checkbox', { name: 'First floor', exact: true }).check()
  await popup.getByRole('checkbox', { name: 'Ground floor', exact: true }).uncheck()
  await closeFilter(popup)
  await expect(members(page).locator('tbody tr')).toHaveCount(3)
  popup = await openFilter(page, '총 체적')
  reasons = diagnostics(popup)
  await expect(reasons).toContainText('현재 표시 부재 중 3개')
  await expect(
    reasons.locator('.volume-diagnostics-groups').getByText('체적 속성 없음', { exact: true }),
  ).toHaveCount(0)
  await expect(reasons.getByText('체적 값 비어 있음', { exact: true })).toHaveCount(0)
  await popup.getByRole('button', { name: '적용', exact: true }).click()
  const menu = page.getByRole('navigation', { name: '건물 메뉴', exact: true })
  await menu.getByRole('button', { name: '부재 데이터', exact: true }).click()
  await page.getByRole('textbox', { name: '부재 검색', exact: true }).fill('Steel beam')
  await expect(members(page).locator('tbody tr')).toHaveCount(1)
  popup = await openFilter(page, '총 체적')
  reasons = diagnostics(popup)
  await expect(reasons).toContainText('현재 표시 부재 중 1개')
  await expect(
    reasons.locator('.volume-diagnostics-groups').getByText('체적 값 충돌', { exact: true }),
  ).toBeVisible()
  await popup.getByRole('checkbox', { name: '체적 미확인 포함', exact: true }).uncheck()
  await popup.getByRole('button', { name: '적용', exact: true }).click()
  await expect(members(page).locator('tbody tr')).toHaveCount(0)
  popup = await openFilter(page, '총 체적')
  await expect(diagnostics(popup)).toContainText('현재 표시 부재 중 0개')
  await expect(diagnostics(popup)).toContainText('현재 표시된 부재에는 체적 미확인이 없습니다.')
  await page.keyboard.press('Escape')

  // Projects store the original IFC: reopening must recompute, rather than lose,
  // the observed reasons even after different filters and a full page reload.
  await page.reload()
  await projectToolbar.getByRole('button', { name: '프로젝트 열기', exact: true }).click()
  const library = page.getByRole('dialog', { name: '프로젝트 열기', exact: true })
  await library.getByRole('button', { name: `${projectName} 열기`, exact: true }).click()
  await expect(library).toHaveCount(0, { timeout: 45_000 })
  await expect(members(page).locator('tbody tr')).toHaveCount(5)
  popup = await openFilter(page, '총 체적')
  await expect(diagnostics(popup)).toContainText('현재 표시 부재 중 5개')
  await expect(
    diagnostics(popup)
      .locator('.volume-diagnostics-groups')
      .getByText('체적 값 해석 불가', { exact: true }),
  ).toBeVisible()
  await popup.getByRole('button', { name: '적용', exact: true }).click()

  // A model with only Qto volume data can have hundreds of unknowns. The popup
  // renders one bounded page, while still making every affected member reachable.
  await page.getByLabel('IFC 파일 선택', { exact: true }).setInputFiles({
    name: 'qto-only-206.ifc',
    mimeType: 'application/octet-stream',
    buffer: await readFile(new URL('./fixtures/pagination-building.ifc', import.meta.url)),
  })
  await expect(metric(page, '표시 부재')).toHaveText('206개', { timeout: 45_000 })
  popup = await openFilter(page, '총 체적')
  reasons = diagnostics(popup)
  await expect(reasons).toContainText('현재 표시 부재 중 206개')
  await expect(
    reasons.locator('.volume-diagnostics-groups').getByText('체적 속성 없음', { exact: true }),
  ).toBeVisible()
  await reasons.getByText('미확인 부재 보기', { exact: true }).click()
  unknownMembers = reasons.getByRole('list', { name: '미확인 부재 목록' })
  await expect(unknownMembers.getByRole('listitem')).toHaveCount(20)
  const pager = reasons.getByRole('navigation', { name: '미확인 부재 페이지', exact: true })
  await expect(pager.getByRole('button', { name: '이전 미확인 부재 페이지' })).toBeDisabled()
  await pager.getByRole('button', { name: '다음 미확인 부재 페이지' }).click()
  await expect(pager).toContainText('21–40 / 206개')
  await expect(unknownMembers.getByRole('listitem')).toHaveCount(20)
  expect(errors).toEqual([])
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
