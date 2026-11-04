import { Component, Suspense, lazy, useEffect, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  Box,
  Building2,
  Check,
  ChevronRight,
  Coffee,
  Cuboid,
  Database,
  Layers3,
  LoaderCircle,
  MousePointer2,
  RotateCcw,
  Search,
  Shapes,
  SlidersHorizontal,
} from 'lucide-react'
import {
  BUILDING_ELEMENTS,
  BUILDING_FLOORS,
  type ElementKind,
  type FloorFilter,
} from '../data/building'
import { ELEMENT_KIND_LABELS, formatVolume, getBuildingSummary } from '../lib/building'
import './building.css'

const BuildingScene = lazy(() => import('./BuildingScene'))
const KIND_LABEL = ELEMENT_KIND_LABELS
const KIND_COLOR: Record<ElementKind, string> = {
  column: '#e2d9c7',
  beam: '#bc9f78',
  slab: '#95b5bd',
  wall: '#d2d6ca',
}
const floorLabel = (floor: string) => `${floor.slice(0, 1)}층`
const number = (value: number) =>
  new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 }).format(value)
const volumeNumber = (value: number) =>
  new Intl.NumberFormat('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    value,
  )

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
  const [floor, setFloor] = useState<FloorFilter>('all')
  const [activeView, setActiveView] = useState<'space' | 'data'>('space')
  const [kind, setKind] = useState<ElementKind | 'all'>('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('1F-C09')
  const [resetKey, setResetKey] = useState(0)
  const floorElements = BUILDING_ELEMENTS.filter(
    (element) => floor === 'all' || element.floor === floor,
  )
  const dataElements = floorElements.filter(
    (element) =>
      (kind === 'all' || element.kind === kind) &&
      `${element.id} ${element.name} ${element.ifcClass} ${element.material}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase().trim()),
  )
  const visible = activeView === 'data' ? dataElements : floorElements
  const selected = floorElements.find((element) => element.id === selectedId) ?? floorElements[0]
  const summary = getBuildingSummary(visible)
  const fullSummary = getBuildingSummary(BUILDING_ELEMENTS)
  const maxKindVolume = Math.max(1, ...summary.byKind.map((row) => row.volume))
  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id)
  }, [selected, selectedId])

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
    <div className="app-shell building-app">
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
            <strong>모노 오피스</strong>
            <span>건물 모델 워크스페이스</span>
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
            부재 데이터<span className="nav-count">{BUILDING_ELEMENTS.length}</span>
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
          <span className="building-sidebar-badge">3 FLOORS · BIM DEMO</span>
        </div>
        <div className="sidebar-bottom">
          <div className="profile">
            <span>MO</span>
            <div>
              <strong>모노 오피스</strong>
              <small>가상의 건물 예제</small>
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
              건물 샘플 · 가상 데이터
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
            <button
              className="button secondary building-back"
              aria-label="카페 샘플로 돌아가기"
              onClick={onBackToCafe}
            >
              <ArrowLeft size={15} />
              카페 샘플로 돌아가기
            </button>
          </section>
          <section className="building-demo-note">
            <span className="badge">BIM DEMO</span>
            <span>3층 사무동의 구조 예제입니다. 실제 IFC 파일을 읽은 모델이 아닙니다.</span>
            <span className="building-model-meta">8 × 6m · 3층</span>
          </section>
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
                {BUILDING_FLOORS.map((value) => (
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
                value: formatVolume(summary.totalVolume),
                note: '부재별 형상 체적의 합계',
                icon: Cuboid,
                color: 'blue',
              },
              {
                label: '표시 층',
                value: `${summary.floorCount}개 층`,
                note: '지상 1층부터 3층까지',
                icon: Layers3,
                color: 'sand',
              },
              {
                label: '재료 종류',
                value: `${summary.byMaterial.length}종`,
                note: '현재 표시된 부재의 재료',
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
                    <h2>모노 오피스</h2>
                    <span className="subtle-badge">STRUCTURE MODEL</span>
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
                    MONO OFFICE<span>{floor === 'all' ? '전체 층' : floorLabel(floor)}</span>
                  </div>
                  {visible.length ? (
                    <BuildingSceneBoundary>
                      <Suspense
                        fallback={
                          <div className="scene-fallback">
                            <LoaderCircle className="spin" size={28} />
                            <p>건물 모델을 준비하고 있어요.</p>
                          </div>
                        }
                      >
                        <BuildingScene
                          elements={visible}
                          selectedId={selected?.id ?? ''}
                          onSelect={setSelectedId}
                          floor={floor}
                          resetKey={resetKey}
                        />
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
                  {Object.entries(KIND_LABEL).map(([value, label]) => (
                    <span key={value}>
                      <i style={{ background: KIND_COLOR[value as ElementKind] }} />
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
                        {volumeNumber(selected.volume)}
                        <small>m³</small>
                      </strong>
                      <p>모형 치수에서 계산한 예제 물량</p>
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
                          {selected.dimensions.map((value) => number(value)).join(' × ')}
                          <small> m</small>
                        </dd>
                      </div>
                    </dl>
                    <div className="building-global-id">
                      <span>예제 GlobalId</span>
                      <code>{selected.globalId}</code>
                      <p>실제 IFC에서 추출한 식별자가 아닙니다.</p>
                    </div>
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
                          {volumeNumber(row.volume)}
                          <small> m³</small>
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
                      <small>{row.count}개 부재</small>
                    </div>
                  ))}
                  {summary.elementCount === 0 && (
                    <p className="building-empty-copy">현재 조건에 해당하는 부재가 없습니다.</p>
                  )}
                </div>
                <div className="building-quantity-note">
                  <Check size={14} />
                  <span>
                    체적은 각 부재의 X × Y × Z입니다.
                    <br />
                    부재 간 겹침을 차감하지 않은 예제 수량입니다.
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
                      onChange={(e) => setKind(e.target.value as ElementKind | 'all')}
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
                      placeholder="부재명, 코드, 재료 검색"
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
                          <th>IFC 분류</th>
                          <th>재료</th>
                          <th>치수 X × Y × Z (m)</th>
                        </>
                      )}
                      <th>체적 (m³)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((element) => (
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
                            <td className="building-data-ifc">{element.ifcClass}</td>
                            <td>{element.material}</td>
                            <td className="building-data-dimensions">
                              {element.dimensions.map((value) => number(value)).join(' × ')}
                            </td>
                          </>
                        )}
                        <td>{volumeNumber(element.volume)}</td>
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
          <footer className="footer">
            <span>
              <Building2 size={13} />
              MONOSPACE <span className="footer-divider">/</span>건물에서 읽는 데이터
            </span>
            <span>코드로 만든 BIM 예제 · IFC 업로드 미지원</span>
          </footer>
        </main>
      </div>
    </div>
  )
}
