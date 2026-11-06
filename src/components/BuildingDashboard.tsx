import {
  Component,
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  ArrowLeft,
  Box,
  Building2,
  Check,
  ChevronRight,
  Coffee,
  Cuboid,
  Database,
  Link2,
  Layers3,
  LoaderCircle,
  MousePointer2,
  RotateCcw,
  Search,
  Shapes,
  SlidersHorizontal,
  Upload,
  X,
} from 'lucide-react'
import {
  BUILDING_ELEMENTS,
  type BuildingElement,
  type ElementKind,
  type FloorFilter,
} from '../data/building'
import { ELEMENT_KIND_LABELS, formatVolume } from '../lib/building'
import { loadIfcFile } from '../ifc/client'
import { MAX_IFC_FILE_BYTES } from '../ifc/limits'
import type { IfcModel } from '../ifc/types'
import BusinessDataPanel, { type BusinessConnection } from './BusinessDataPanel'
import { useSessionState } from '../lib/useSessionState'
import './building.css'

const BuildingScene = lazy(() => import('./BuildingScene'))
const IfcScene = lazy(() => import('./IfcScene'))
const IFC_TABLE_PAGE_SIZE = 200
type DisplayKind = ElementKind | 'other'
type DisplayElement = {
  id: string
  globalId: string
  name: string
  tag?: string
  ifcClass: string
  kind: DisplayKind
  floor: string
  material: string
  volume: number | null
  dimensions?: [number, number, number]
  properties: { group: string; name: string; value: string }[]
}
const SAMPLE_ELEMENTS: DisplayElement[] = BUILDING_ELEMENTS.map((element) => ({
  ...element,
  properties: [],
}))
const KIND_LABEL: Record<DisplayKind, string> = { ...ELEMENT_KIND_LABELS, other: '기타' }
const KIND_COLOR: Record<DisplayKind, string> = {
  column: '#e2d9c7',
  beam: '#bc9f78',
  slab: '#95b5bd',
  wall: '#d2d6ca',
  other: '#b7b3c7',
}
const floorLabel = (floor: string) => (/^[123]F$/.test(floor) ? `${floor.slice(0, 1)}층` : floor)
const number = (value: number) =>
  new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 }).format(value)
const volumeNumber = (value: number) =>
  new Intl.NumberFormat('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    value,
  )
function summarize(elements: DisplayElement[]) {
  const known = elements.filter((element) => element.volume !== null)
  const total = (items: DisplayElement[]) =>
    Number(items.reduce((sum, item) => sum + (item.volume ?? 0), 0).toFixed(6))
  return {
    elementCount: elements.length,
    totalVolume: total(elements),
    knownVolumeCount: known.length,
    missingVolumeCount: elements.length - known.length,
    floorCount: new Set(elements.map((element) => element.floor)).size,
    byMaterial: [
      ...new Set(
        elements.map((element) => element.material).filter((material) => material !== '미지정'),
      ),
    ],
    byKind: (Object.keys(KIND_LABEL) as DisplayKind[]).map((kind) => {
      const items = elements.filter((element) => element.kind === kind)
      return {
        kind,
        label: KIND_LABEL[kind],
        count: items.length,
        volume: total(items),
        knownVolumeCount: items.filter((element) => element.volume !== null).length,
      }
    }),
  }
}

class BuildingSceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? (
      <div className="scene-fallback">
        <Building2 size={35} />
        <strong>이 브라우저에서 3D 모델을 표시할 수 없습니다.</strong>
        <p>
          WebGL 지원을 확인해주세요.
          <br />
          아래 부재 목록에서 속성은 계속 확인할 수 있습니다.
        </p>
      </div>
    ) : (
      this.props.children
    )
  }
}

export default function BuildingDashboard({ onBackToCafe }: { onBackToCafe: () => void }) {
  const [floor, setFloor] = useSessionState('building:floor', 'all')
  const [activeView, setActiveView] = useSessionState<'space' | 'data'>('building:view', 'space')
  const [kind, setKind] = useSessionState<DisplayKind | 'all'>('building:kind', 'all')
  const [query, setQuery] = useSessionState('building:query', '')
  const [selectedId, setSelectedId] = useSessionState('building:selected', '1F-C09')
  const [resetKey, setResetKey] = useState(0)
  const [ifcModel, setIfcModel] = useSessionState<IfcModel | null>('building:model', null)
  const [modelVersion, setModelVersion] = useState(0)
  const [progress, setProgress] = useState<{ percent: number; message: string } | null>(null)
  const [importError, setImportError] = useState('')
  const [importNotice, setImportNotice] = useState('')
  const [business, setBusiness] = useSessionState<BusinessConnection | null>(
    'building:business',
    null,
  )
  const [businessOpen, setBusinessOpen] = useState(false)
  const [tablePage, setTablePage] = useState(0)
  const ifcInput = useRef<HTMLInputElement>(null)
  const importRequest = useRef<{ controller: AbortController; token: number } | null>(null)
  const importToken = useRef(0)
  const elements: DisplayElement[] = useMemo(
    () => ifcModel?.elements ?? SAMPLE_ELEMENTS,
    [ifcModel],
  )
  const floors = useMemo(() => [...new Set(elements.map((element) => element.floor))], [elements])
  const floorElements = useMemo(
    () => elements.filter((element) => floor === 'all' || element.floor === floor),
    [elements, floor],
  )
  const dataElements = useMemo(
    () =>
      floorElements.filter(
        (element) =>
          (kind === 'all' || element.kind === kind) &&
          `${element.id} ${element.name} ${element.ifcClass} ${element.material} ${element.globalId} ${element.tag ?? ''}`
            .toLocaleLowerCase()
            .includes(query.toLocaleLowerCase().trim()),
      ),
    [floorElements, kind, query],
  )
  const visible = activeView === 'data' ? dataElements : floorElements
  const pageCount = ifcModel ? Math.max(1, Math.ceil(visible.length / IFC_TABLE_PAGE_SIZE)) : 1
  const currentPage = Math.min(tablePage, pageCount - 1)
  const tableElements = ifcModel
    ? visible.slice(currentPage * IFC_TABLE_PAGE_SIZE, (currentPage + 1) * IFC_TABLE_PAGE_SIZE)
    : visible
  const selected = floorElements.find((element) => element.id === selectedId) ?? floorElements[0]
  const summary = useMemo(() => summarize(visible), [visible])
  const fullSummary = useMemo(() => summarize(elements), [elements])
  const maxKindVolume = Math.max(1, ...summary.byKind.map((row) => row.volume))
  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id)
  }, [selected, selectedId])
  useEffect(() => setTablePage(0), [ifcModel, floor, activeView, kind, query])
  useEffect(
    () => () => {
      importRequest.current?.controller.abort()
      importRequest.current = null
    },
    [],
  )

  async function importIfc(file?: File) {
    if (!file) return
    importRequest.current?.controller.abort()
    importRequest.current = null
    setProgress(null)
    setImportError('')
    setImportNotice('')
    if (!/\.ifc$/i.test(file.name)) {
      setImportError('IFC 파일을 선택해주세요.')
      return
    }
    if (file.size > MAX_IFC_FILE_BYTES) {
      setImportError('150MB 이하의 IFC 파일을 선택해주세요.')
      return
    }
    const controller = new AbortController()
    const token = ++importToken.current
    importRequest.current = { controller, token }
    setProgress({ percent: 0, message: 'IFC 모델을 준비하고 있습니다.' })
    try {
      const model = await loadIfcFile(file, {
        signal: controller.signal,
        onProgress: (next) => {
          if (importRequest.current?.token === token) setProgress(next)
        },
      })
      if (controller.signal.aborted || importRequest.current?.token !== token) return
      setIfcModel(model)
      setModelVersion((value) => value + 1)
      setBusiness(null)
      setBusinessOpen(false)
      clearFilters()
      setSelectedId(model.elements[0]?.id ?? '')
      setResetKey((value) => value + 1)
      setImportNotice(
        `${model.name} 모델을 불러왔습니다. 업무 데이터 연결은 새 모델에 맞게 다시 설정해주세요.`,
      )
    } catch (cause) {
      if (importRequest.current?.token === token && !controller.signal.aborted)
        setImportError(
          cause instanceof Error
            ? cause.message
            : 'IFC 파일을 읽지 못했습니다. 기존 모델은 유지됩니다.',
        )
    } finally {
      if (importRequest.current?.token === token) {
        importRequest.current = null
        setProgress(null)
      }
      if (ifcInput.current) ifcInput.current.value = ''
    }
  }
  function cancelImport() {
    importRequest.current?.controller.abort()
    importRequest.current = null
    setProgress(null)
    setImportNotice('업로드를 취소했습니다. 기존 모델을 유지합니다.')
  }
  function restoreSample() {
    cancelImport()
    setIfcModel(null)
    setModelVersion((value) => value + 1)
    setBusiness(null)
    setBusinessOpen(false)
    clearFilters()
    setSelectedId('1F-C09')
    setResetKey((value) => value + 1)
    setImportError('')
    setImportNotice('건물 샘플로 돌아왔습니다.')
  }
  const sampleVisible: BuildingElement[] = useMemo(
    () =>
      ifcModel
        ? []
        : BUILDING_ELEMENTS.filter((element) => visible.some((item) => item.id === element.id)),
    [ifcModel, visible],
  )
  const sampleFloor: FloorFilter =
    floor === '1F' || floor === '2F' || floor === '3F' ? floor : 'all'
  const selectedBusiness = selected ? business?.result.byElementId.get(selected.id) : undefined
  const propertyGroups = selected
    ? [...new Set(selected.properties.map((property) => property.group))]
    : []
  const visibleIfcIds = useMemo(() => visible.map((element) => element.id), [visible])

  function clearFilters() {
    setFloor('all')
    setKind('all')
    setQuery('')
  }
  function showHome() {
    clearFilters()
    setActiveView('space')
  }
  function selectElement(id: string) {
    setSelectedId(id)
    setActiveView('space')
  }

  return (
    <div className={`app-shell building-app ${ifcModel ? 'has-ifc' : ''}`}>
      <aside className="sidebar">
        <a
          className="brand"
          href="#building"
          aria-label="건물 샘플 홈"
          onClick={(e) => {
            e.preventDefault()
            showHome()
          }}
        >
          <span className="brand-mark">
            <Layers3 size={23} strokeWidth={1.6} />
          </span>
          <span>
            mono<span className="brand-light">space</span>
            <small>SPATIAL ANALYTICS</small>
          </span>
        </a>
        <div className="workspace">
          <div className="workspace-icon">
            <Building2 size={20} />
          </div>
          <div>
            <strong>{ifcModel ? '나의 건물 모델' : '모노 오피스'}</strong>
            <span>{ifcModel ? 'IFC 모델 워크스페이스' : '건물 모델 워크스페이스'}</span>
          </div>
          <span className="workspace-dot" />
        </div>
        <span className="nav-caption">SAMPLE SPACES</span>
        <nav aria-label="샘플 선택" className="building-sample-nav">
          <button className="nav-item" onClick={onBackToCafe} aria-label="카페 샘플">
            <Coffee size={19} />
            카페 샘플
          </button>
          <button
            className="nav-item active"
            aria-pressed="true"
            aria-label="건물 샘플"
            onClick={showHome}
          >
            <Building2 size={19} />
            건물 샘플
            <span className="nav-active-dot" />
          </button>
        </nav>
        <span className="nav-caption building-section-caption">BUILDING</span>
        <nav aria-label="건물 메뉴" className="building-view-nav">
          <button
            className={`nav-item ${activeView === 'space' ? 'active' : ''}`}
            aria-label="공간 데이터"
            aria-pressed={activeView === 'space'}
            onClick={() => setActiveView('space')}
          >
            <Box size={19} />
            공간 데이터
            <span className="nav-active-dot" />
          </button>
          <button
            className={`nav-item ${activeView === 'data' ? 'active' : ''}`}
            aria-label="부재 데이터"
            aria-pressed={activeView === 'data'}
            onClick={() => setActiveView('data')}
          >
            <Database size={19} />
            부재 데이터<span className="nav-count">{elements.length}</span>
          </button>
        </nav>
        <div className="sidebar-note">
          <div className="mini-cube">
            <Cuboid size={30} strokeWidth={1.2} />
          </div>
          <strong>건물을 읽는 새로운 방식</strong>
          <p>
            층과 부재를 선택하고
            <br />
            구조와 물량을 확인하세요.
          </p>
          <span className="building-sidebar-badge">
            {ifcModel ? 'IFC MODEL · LOCAL VIEW' : '3 FLOORS · BIM DEMO'}
          </span>
        </div>
        <div className="sidebar-bottom">
          <div className="profile">
            <span>MO</span>
            <div>
              <strong>{ifcModel ? '나의 건물 모델' : '모노 오피스'}</strong>
              <small>{ifcModel ? '업로드한 IFC 모델' : '가상의 건물 예제'}</small>
            </div>
            <Building2 size={17} />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>워크스페이스</span>
            <ChevronRight size={14} />
            <strong>{activeView === 'space' ? '공간 데이터' : '부재 데이터'}</strong>
          </div>
          <div className="topbar-right">
            <span className="connection">
              <i />
              {ifcModel ? 'IFC 모델 · 브라우저 처리' : '건물 샘플 · 가상 데이터'}
            </span>
            <span className="top-avatar">B</span>
          </div>
        </header>
        <main>
          <section className="page-heading">
            <div>
              <div className="eyebrow">
                <span />
                {activeView === 'space' ? 'EXPLORE YOUR BUILDING' : 'BUILDING ELEMENT DIRECTORY'}
              </div>
              <h1>{activeView === 'space' ? '건물 모델 대시보드' : '부재 데이터'}</h1>
              <p>
                {activeView === 'space'
                  ? '층을 골라 공간을 둘러보고, 부재를 클릭해 건물의 정보를 읽어보세요.'
                  : '부재의 분류·재료·치수와 물량을 검색하고, 3D 공간에서 확인하세요.'}
              </p>
            </div>
            <div className="page-actions building-header-actions">
              <button className="button secondary" onClick={() => setBusinessOpen(true)}>
                <Link2 size={15} />
                업무 데이터 연결
              </button>
              <button className="button primary" onClick={() => ifcInput.current?.click()}>
                <Upload size={15} />
                IFC 모델 업로드
              </button>
              <button
                className="button secondary building-back"
                aria-label="카페 샘플로 돌아가기"
                onClick={onBackToCafe}
              >
                <ArrowLeft size={15} />
                카페 샘플로 돌아가기
              </button>
            </div>
          </section>
          <input
            ref={ifcInput}
            type="file"
            className="file-input"
            aria-label="IFC 파일 선택"
            accept=".ifc"
            onChange={(event) => void importIfc(event.target.files?.[0])}
          />
          {progress && (
            <section className="building-import-progress" role="status">
              <LoaderCircle size={18} className="spin" />
              <div>
                <strong>{progress.message}</strong>
                <progress max={100} value={progress.percent} />
                <span>{Math.round(progress.percent)}%</span>
              </div>
              <button className="button secondary" onClick={cancelImport}>
                <X size={14} />
                업로드 취소
              </button>
            </section>
          )}
          {importError && (
            <p className="upload-error" role="alert">
              {importError}
            </p>
          )}
          {importNotice && (
            <p className="building-import-notice" role="status">
              {importNotice}
            </p>
          )}
          <section className="building-demo-note">
            <span className="badge">{ifcModel ? 'IFC MODEL' : 'BIM DEMO'}</span>
            <span className="building-source-name" title={ifcModel?.name}>
              {ifcModel
                ? `업로드한 IFC 모델 · ${ifcModel.name}`
                : '3층 사무동의 구조 예제입니다. 실제 IFC 파일을 읽은 모델이 아닙니다.'}
            </span>
            {ifcModel ? (
              <button className="text-button" onClick={restoreSample}>
                샘플로 돌아가기
              </button>
            ) : (
              <span className="building-model-meta">8 × 6m · 3층</span>
            )}
          </section>
          {ifcModel && ifcModel.warnings.length > 0 && (
            <details className="building-model-warnings">
              <summary>모델 읽기 안내 ({ifcModel.warnings.length}건)</summary>
              <ul>
                {ifcModel.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </details>
          )}
          {business && (
            <section className="business-connected-banner">
              <Link2 size={17} />
              <div>
                <strong>{business.fileName}</strong>
                <span>
                  {business.table.name} · {business.modelKey} ↔ {business.column}
                </span>
              </div>
              <span>
                연결 {business.result.diagnostics.matchedElements} · 미연결{' '}
                {business.result.diagnostics.unmatchedElements} · 중복{' '}
                {business.result.diagnostics.ambiguousElements}
              </span>
              <button className="text-button" onClick={() => setBusiness(null)}>
                업무 데이터 연결 해제
              </button>
            </section>
          )}
          <div className="building-controls">
            <div className="building-floor-control">
              <Layers3 size={16} />
              <span>표시할 층</span>
              <div className="building-floor-buttons" role="group" aria-label="건물 층 선택">
                <button
                  className={floor === 'all' ? 'active' : ''}
                  aria-pressed={floor === 'all'}
                  onClick={() => setFloor('all')}
                >
                  전체
                </button>
                {floors.map((value) => (
                  <button
                    key={value}
                    className={floor === value ? 'active' : ''}
                    aria-pressed={floor === value}
                    onClick={() => setFloor(value)}
                  >
                    {floorLabel(value)}
                  </button>
                ))}
              </div>
            </div>
            <span className="building-filter-note">현재 표시된 부재 기준으로 집계합니다.</span>
          </div>
          <section className="metrics building-metrics" aria-label="건물 집계 지표">
            {[
              {
                label: '표시 부재',
                value: `${summary.elementCount}개`,
                note: `전체 ${fullSummary.elementCount}개 중 현재 조건`,
                icon: Box,
                color: 'mint',
              },
              {
                label: '총 체적',
                value:
                  summary.elementCount === 0 || summary.knownVolumeCount > 0
                    ? formatVolume(summary.totalVolume)
                    : '—',
                note: ifcModel
                  ? `수량 있는 ${summary.knownVolumeCount}개 합계 · ${summary.missingVolumeCount}개 미제공`
                  : '부재별 형상 체적의 합계',
                icon: Cuboid,
                color: 'blue',
              },
              {
                label: '표시 층',
                value: `${summary.floorCount}개 층`,
                note: ifcModel ? 'IFC의 층 분류 기준 · 미지정 포함' : '지상 1층부터 3층까지',
                icon: Layers3,
                color: 'sand',
              },
              {
                label: ifcModel ? '재료 표기' : '재료 종류',
                value: `${summary.byMaterial.length}종`,
                note: ifcModel ? '부재에 기록된 서로 다른 재료 표기' : '현재 표시된 부재의 재료',
                icon: Shapes,
                color: 'peach',
              },
            ].map((metric) => (
              <article key={metric.label} className="metric-card">
                <div className="metric-top">
                  <span>{metric.label}</span>
                  <span className={`metric-icon ${metric.color}`}>
                    <metric.icon size={18} strokeWidth={1.7} />
                  </span>
                </div>
                <strong>{metric.value}</strong>
                <p>
                  <span className="metric-note-dot" />
                  {metric.note}
                </p>
              </article>
            ))}
          </section>
          {activeView === 'space' && (
            <section className="building-model-grid" aria-label="건물 모델과 부재 정보">
              <article className="card building-scene-card">
                <div className="card-heading">
                  <div className="heading-with-icon">
                    <Building2 size={19} />
                    <h2>{ifcModel ? '나의 건물 모델' : '모노 오피스'}</h2>
                    <span className="subtle-badge">
                      {ifcModel ? 'IFC MODEL' : 'STRUCTURE MODEL'}
                    </span>
                  </div>
                  <button
                    className="icon-button reset-view"
                    title="시점 초기화"
                    aria-label="3D 건물 시점 초기화"
                    onClick={() => setResetKey((value) => value + 1)}
                  >
                    <RotateCcw size={16} />
                  </button>
                </div>
                <div className="building-scene-wrap">
                  <div className="scene-caption">
                    <span className="live-dot" />
                    {ifcModel ? 'IFC MODEL' : 'MONO OFFICE'}
                    <span>{floor === 'all' ? '전체 층' : floorLabel(floor)}</span>
                  </div>
                  {visible.length ? (
                    <BuildingSceneBoundary key={modelVersion}>
                      <Suspense
                        fallback={
                          <div className="scene-fallback">
                            <LoaderCircle className="spin" size={28} />
                            <p>건물 모델을 준비하고 있어요.</p>
                          </div>
                        }
                      >
                        {ifcModel ? (
                          <IfcScene
                            model={ifcModel}
                            visibleIds={visibleIfcIds}
                            selectedId={selected?.id ?? ''}
                            onSelect={setSelectedId}
                            resetKey={resetKey}
                          />
                        ) : (
                          <BuildingScene
                            elements={sampleVisible}
                            selectedId={selected?.id ?? ''}
                            onSelect={setSelectedId}
                            floor={sampleFloor}
                            resetKey={resetKey}
                          />
                        )}
                      </Suspense>
                    </BuildingSceneBoundary>
                  ) : (
                    <div className="scene-fallback">
                      <Search size={32} />
                      <strong>표시할 부재가 없습니다.</strong>
                      <p>층·종류·검색 조건을 조정해보세요.</p>
                      <button className="button secondary" onClick={clearFilters}>
                        조건 초기화
                      </button>
                    </div>
                  )}
                  <div className="scene-hint">
                    <MousePointer2 size={13} />
                    <span>부재 클릭 · 드래그하여 회전 · 스크롤로 확대</span>
                  </div>
                </div>
                <div className="building-legend">
                  {ifcModel && <span>IFC 원본 재질</span>}
                  {!ifcModel &&
                    Object.entries(KIND_LABEL).map(([value, label]) => (
                      <span key={value}>
                        <i style={{ background: KIND_COLOR[value as DisplayKind] }} />
                        {label}
                      </span>
                    ))}
                  <span className="building-selected-key">
                    <i />
                    선택한 부재
                  </span>
                </div>
              </article>
              <article className="card building-detail" aria-label="선택한 부재 정보">
                {selected ? (
                  <>
                    <div className="detail-top">
                      <span className="eyebrow">ELEMENT INSIGHT</span>
                      <span className="selected-indicator">
                        <span />
                        선택됨
                      </span>
                    </div>
                    <div className="building-detail-title">
                      <span
                        className="building-element-icon"
                        style={{
                          background: `${KIND_COLOR[selected.kind]}25`,
                          color: '#718a74',
                        }}
                      >
                        <Cuboid size={29} strokeWidth={1.4} />
                      </span>
                      <div>
                        <span>
                          {KIND_LABEL[selected.kind]} · {floorLabel(selected.floor)}
                        </span>
                        <h2>{selected.name}</h2>
                        <code>{selected.id}</code>
                      </div>
                    </div>
                    <div className="building-volume">
                      <span>선택 부재 체적</span>
                      <strong data-testid="building-selected-volume">
                        {selected.volume !== null ? (
                          <>
                            {volumeNumber(selected.volume)}
                            <small>m³</small>
                          </>
                        ) : (
                          '—'
                        )}
                      </strong>
                      <p>
                        {ifcModel
                          ? selected.volume === null
                            ? 'IFC에 체적 수량이 제공되지 않았습니다.'
                            : 'IFC 수량 속성에서 읽은 체적입니다.'
                          : '모형 치수에서 계산한 예제 물량'}
                      </p>
                    </div>
                    <dl className="building-properties">
                      <div>
                        <dt>부재 유형</dt>
                        <dd>{KIND_LABEL[selected.kind]}</dd>
                      </div>
                      <div>
                        <dt>IFC 분류</dt>
                        <dd>{selected.ifcClass}</dd>
                      </div>
                      <div>
                        <dt>층</dt>
                        <dd>{floorLabel(selected.floor)}</dd>
                      </div>
                      <div>
                        <dt>재료</dt>
                        <dd>{selected.material}</dd>
                      </div>
                      <div className="building-dimensions">
                        <dt>치수 X × Y × Z</dt>
                        <dd>
                          {selected.dimensions ? (
                            <>
                              {selected.dimensions.map((value) => number(value)).join(' × ')}
                              <small> m</small>
                            </>
                          ) : (
                            '—'
                          )}
                        </dd>
                      </div>
                    </dl>
                    <div className="building-global-id">
                      <span>{ifcModel ? 'GlobalId' : '예제 GlobalId'}</span>
                      <code>{selected.globalId || '—'}</code>
                      <p>
                        {ifcModel
                          ? `Tag: ${selected.tag || '미제공'} · Express ID: ${selected.id}`
                          : '실제 IFC에서 추출한 식별자가 아닙니다.'}
                      </p>
                    </div>
                    {ifcModel && (
                      <section className="building-ifc-properties">
                        <h3>IFC 속성</h3>
                        {propertyGroups.length ? (
                          propertyGroups.map((group, index) => (
                            <details key={group} open={index === 0}>
                              <summary>{group}</summary>
                              <dl>
                                {selected.properties
                                  .filter((property) => property.group === group)
                                  .map((property, propertyIndex) => (
                                    <div key={`${property.name}-${propertyIndex}`}>
                                      <dt>{property.name}</dt>
                                      <dd>{property.value || '—'}</dd>
                                    </div>
                                  ))}
                              </dl>
                            </details>
                          ))
                        ) : (
                          <p>이 부재에는 추가 속성 세트가 없습니다.</p>
                        )}
                      </section>
                    )}
                    {business && (
                      <section className="building-linked-data" aria-label="연결된 업무 데이터">
                        <h3>연결된 업무 데이터</h3>
                        {selectedBusiness?.status === 'matched' ? (
                          <dl>
                            {business.table.headers.map((header, index) => (
                              <div key={header}>
                                <dt>{header}</dt>
                                <dd>{selectedBusiness.rows[0]?.[index] || '—'}</dd>
                              </div>
                            ))}
                          </dl>
                        ) : (
                          <p>
                            {selectedBusiness?.status === 'ambiguous'
                              ? '중복 식별자가 있어 업무 데이터를 연결하지 않았습니다.'
                              : '이 부재에 연결된 업무 데이터가 없습니다.'}
                          </p>
                        )}
                        {selectedBusiness?.status === 'ambiguous' && (
                          <div className="business-ambiguous-candidates">
                            <strong>
                              중복 후보 {selectedBusiness.rows.length}행 · 자동 선택하지 않음
                            </strong>
                            <div tabIndex={0} aria-label="중복 업무 데이터 후보">
                              <table>
                                <thead>
                                  <tr>
                                    {business.table.headers.map((header) => (
                                      <th key={header}>{header}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {selectedBusiness.rows.slice(0, 10).map((row, index) => (
                                    <tr key={index}>
                                      {business.table.headers.map((_, column) => (
                                        <td key={column}>{row[column] ?? ''}</td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            {selectedBusiness.rows.length > 10 && (
                              <p>
                                처음 10개 행을 표시합니다. 전체 후보는 업로드한 원본 파일에서
                                확인해주세요.
                              </p>
                            )}
                          </div>
                        )}
                      </section>
                    )}
                  </>
                ) : (
                  <div className="building-no-selection">
                    <Cuboid size={38} />
                    <h2>선택할 부재가 없습니다.</h2>
                    <p>필터를 변경하면 부재의 속성을 확인할 수 있어요.</p>
                  </div>
                )}
              </article>
            </section>
          )}
          <section
            className={`building-lower-grid ${activeView === 'data' ? 'building-data-view' : ''}`}
          >
            {activeView === 'space' && (
              <article className="card building-breakdown">
                <div className="card-heading">
                  <div>
                    <h2>종류별 물량</h2>
                    <p>표시된 부재의 체적을 비교합니다.</p>
                  </div>
                  <span className="subtle-badge">m³</span>
                </div>
                <div className="building-volume-bars">
                  {summary.byKind.map((row) => (
                    <div className="building-volume-row" key={row.kind}>
                      <div>
                        <span>
                          <i style={{ background: KIND_COLOR[row.kind] }} />
                          {row.label}
                        </span>
                        <strong>
                          {row.count > 0 && row.knownVolumeCount === 0 ? (
                            '—'
                          ) : (
                            <>
                              {volumeNumber(row.volume)}
                              <small> m³</small>
                            </>
                          )}
                        </strong>
                      </div>
                      <div className="building-bar-track">
                        <span
                          style={{
                            width: `${(row.volume / maxKindVolume) * 100}%`,
                            background: KIND_COLOR[row.kind],
                          }}
                        />
                      </div>
                      <small>
                        {row.count}개 부재
                        {ifcModel && row.count > row.knownVolumeCount
                          ? ` · ${row.count - row.knownVolumeCount}개 수량 미제공`
                          : ''}
                      </small>
                    </div>
                  ))}
                  {summary.elementCount === 0 && (
                    <p className="building-empty-copy">현재 조건에 해당하는 부재가 없습니다.</p>
                  )}
                </div>
                <div className="building-quantity-note">
                  <Check size={14} />
                  <span>
                    {ifcModel ? (
                      <>
                        IFC에 제공된 체적 수량만 합산합니다.
                        <br />
                        수량이 없는 부재는 —로 표시하며 형상으로 추정하지 않습니다.
                      </>
                    ) : (
                      <>
                        체적은 각 부재의 X × Y × Z입니다.
                        <br />
                        부재 간 겹침을 차감하지 않은 예제 수량입니다.
                      </>
                    )}
                  </span>
                </div>
              </article>
            )}
            <article className="card building-table-card" aria-label="부재 목록">
              <div className="card-heading">
                <div>
                  <h2>
                    부재 목록 <span className="count-badge">{visible.length}</span>
                  </h2>
                  <p>
                    {activeView === 'space'
                      ? '목록에서 선택하면 3D 모델과 속성이 함께 바뀝니다.'
                      : '부재를 선택하면 공간 데이터 화면에서 위치와 속성을 보여드립니다.'}
                  </p>
                </div>
                {activeView === 'space' ? (
                  <button className="text-button" onClick={() => setActiveView('data')}>
                    전체 보기
                    <ChevronRight size={14} />
                  </button>
                ) : (
                  <SlidersHorizontal size={16} />
                )}
              </div>
              {activeView === 'data' && (
                <div className="building-table-tools">
                  <label className="building-kind-select">
                    <span className="sr-only">부재 종류</span>
                    <select
                      aria-label="부재 종류"
                      value={kind}
                      onChange={(e) => setKind(e.target.value as DisplayKind | 'all')}
                    >
                      <option value="all">전체 종류</option>
                      {Object.entries(KIND_LABEL).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="building-search">
                    <Search size={14} />
                    <input
                      aria-label="부재 검색"
                      value={query}
                      maxLength={80}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="부재명, ID, GlobalId, Tag 검색"
                    />
                  </label>
                  {(query || kind !== 'all' || floor !== 'all') && (
                    <button className="text-button" onClick={clearFilters}>
                      조건 초기화
                    </button>
                  )}
                </div>
              )}
              {activeView === 'data' && (
                <p className="building-scroll-hint">
                  표를 좌우로 밀어 모든 부재 속성을 확인하세요.
                </p>
              )}
              <div className="building-table-scroll">
                <table>
                  <thead>
                    <tr>
                      {activeView === 'data' && <th>부재 ID</th>}
                      <th>{activeView === 'data' ? '부재명' : '부재'}</th>
                      <th>층</th>
                      <th>종류</th>
                      {activeView === 'data' && (
                        <>
                          {ifcModel && (
                            <>
                              <th>GlobalId</th>
                              <th>Tag</th>
                            </>
                          )}
                          <th>IFC 분류</th>
                          <th>재료</th>
                          <th>치수 X × Y × Z (m)</th>
                        </>
                      )}
                      <th>체적 (m³)</th>
                      {business && <th>업무 데이터</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {tableElements.map((element) => (
                      <tr
                        key={element.id}
                        className={selected?.id === element.id ? 'selected-row' : ''}
                      >
                        {activeView === 'data' && (
                          <td className="building-data-id">
                            <code>{element.id}</code>
                          </td>
                        )}
                        <td>
                          <button
                            className="building-table-element"
                            aria-label={`${element.id} ${element.name} 선택`}
                            aria-pressed={selected?.id === element.id}
                            onClick={() => selectElement(element.id)}
                          >
                            <span
                              style={{
                                background: `${KIND_COLOR[element.kind]}22`,
                                color: '#718a74',
                              }}
                            >
                              <Cuboid size={17} />
                            </span>
                            <span>
                              <strong>{element.name}</strong>
                              <small>{element.id}</small>
                            </span>
                          </button>
                        </td>
                        <td>{floorLabel(element.floor)}</td>
                        <td>{KIND_LABEL[element.kind]}</td>
                        {activeView === 'data' && (
                          <>
                            {ifcModel && (
                              <>
                                <td className="building-data-guid">{element.globalId || '—'}</td>
                                <td>{element.tag || '—'}</td>
                              </>
                            )}
                            <td className="building-data-ifc">{element.ifcClass}</td>
                            <td>{element.material}</td>
                            <td className="building-data-dimensions">
                              {element.dimensions
                                ? element.dimensions.map((value) => number(value)).join(' × ')
                                : '—'}
                            </td>
                          </>
                        )}
                        <td>{element.volume === null ? '—' : volumeNumber(element.volume)}</td>
                        {business && (
                          <td>
                            <span
                              className={`business-link-status ${business.result.byElementId.get(element.id)?.status ?? 'unmatched'}`}
                            >
                              {business.result.byElementId.get(element.id)?.status === 'matched'
                                ? '연결됨'
                                : business.result.byElementId.get(element.id)?.status ===
                                    'ambiguous'
                                  ? '중복'
                                  : '미연결'}
                            </span>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!visible.length && (
                  <div className="building-empty-table">
                    <Search size={22} />
                    <strong>검색 결과가 없습니다.</strong>
                    <p>다른 검색어나 부재 종류를 선택해주세요.</p>
                  </div>
                )}
              </div>
              {ifcModel && visible.length > IFC_TABLE_PAGE_SIZE && (
                <nav className="building-pagination" aria-label="부재 목록 페이지">
                  <button
                    className="button secondary"
                    aria-label="이전 부재 페이지"
                    disabled={currentPage === 0}
                    onClick={() => setTablePage(currentPage - 1)}
                  >
                    이전
                  </button>
                  <span>
                    {currentPage * IFC_TABLE_PAGE_SIZE + 1}–
                    {Math.min((currentPage + 1) * IFC_TABLE_PAGE_SIZE, visible.length)} /{' '}
                    {visible.length}개
                    <small>
                      {currentPage + 1} / {pageCount} 페이지
                    </small>
                  </span>
                  <button
                    className="button secondary"
                    aria-label="다음 부재 페이지"
                    disabled={currentPage >= pageCount - 1}
                    onClick={() => setTablePage(currentPage + 1)}
                  >
                    다음
                  </button>
                </nav>
              )}
            </article>
          </section>
          {activeView === 'data' && (
            <section className="card building-data-guide">
              <div className="building-data-guide-icon">
                <Cuboid size={25} />
              </div>
              <div>
                <h2>데이터에서 공간으로, 한 번에</h2>
                <p>
                  부재명을 선택하면 3D 모델에서 해당 부재를 강조합니다. 검색어와 종류 조건은 이
                  데이터 화면에만 적용되며, 층 선택은 두 화면에서 함께 유지됩니다.
                </p>
              </div>
              <button className="button secondary" onClick={() => setActiveView('space')}>
                <Box size={15} />
                선택한 부재를 3D로 보기
              </button>
            </section>
          )}
          {(ifcModel || business) && (
            <p className="ifc-session-note">
              업로드한 모델과 업무 데이터는 이 페이지에서만 유지됩니다. 새로고침하거나 탭을 닫으면
              다시 업로드해주세요.
            </p>
          )}
          <footer className="footer">
            <span>
              <Building2 size={13} />
              MONOSPACE <span className="footer-divider">/</span>건물에서 읽는 데이터
            </span>
            <span>
              {ifcModel
                ? '업로드한 IFC 모델 · 브라우저에서만 처리'
                : '코드로 만든 BIM 예제 · IFC 파일 업로드 가능'}
            </span>
          </footer>
        </main>
      </div>
      {businessOpen && (
        <BusinessDataPanel
          elements={elements}
          onClose={() => setBusinessOpen(false)}
          onConnect={(connection) => {
            setBusiness(connection)
            setBusinessOpen(false)
          }}
        />
      )}
    </div>
  )
}
