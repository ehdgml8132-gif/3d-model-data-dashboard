import { Component, Suspense, lazy, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  ArrowDownToLine,
  ArrowUpRight,
  Box,
  Building2,
  Check,
  ChevronRight,
  Coffee,
  Database,
  FileSpreadsheet,
  HelpCircle,
  Layers3,
  Leaf,
  LoaderCircle,
  MousePointer2,
  Package,
  RotateCcw,
  Search,
  ShoppingBag,
  Upload,
  Wallet,
  X,
} from 'lucide-react'
import type { Product, ProductId } from './types'
import { SAMPLE_PRODUCTS } from './data/sample'
import {
  formatCurrency,
  formatNumber,
  getDailyTotals,
  getLatestDate,
  getProductStats,
  parseProductsCsv,
} from './lib/data'

const CafeScene = lazy(() => import('./components/CafeScene'))
const BuildingDashboard = lazy(() => import('./components/BuildingDashboard'))
const STORAGE_KEY = 'mono-space:products:v1'
const STOCK_THRESHOLD = 20
const SAMPLE_CSV_URL = `${import.meta.env.BASE_URL}sample-products.csv`
const PRODUCT_STYLE: Record<ProductId, { color: string; label: string; emoji: string }> = {
  P001: { color: '#947456', label: '커피', emoji: '☕' },
  P002: { color: '#d2ae7d', label: '커피', emoji: '🥛' },
  P003: { color: '#dc9b51', label: '베이커리', emoji: '🥐' },
  P004: { color: '#d2888d', label: '디저트', emoji: '🍰' },
}

function loadInitialData(): { products: Product[]; source: string | null } {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const { csv, source } = JSON.parse(stored) as { csv: string; source: string }
      if (typeof csv === 'string' && typeof source === 'string') {
        return { products: parseProductsCsv(csv), source }
      }
    }
  } catch {
    /* A corrupt or unavailable browser store falls back to the sample. */
  }
  return { products: SAMPLE_PRODUCTS, source: null }
}

class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? (
      <div className="scene-fallback">
        <Box size={38} />
        <strong>이 브라우저에서 3D 화면을 열 수 없습니다.</strong>
        <p>
          WebGL을 지원하는 브라우저를 사용해주세요.
          <br />
          아래 상품 버튼으로 데이터는 계속 확인할 수 있습니다.
        </p>
      </div>
    ) : (
      this.props.children
    )
  }
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="modal-title"
      onCancel={onClose}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal-heading">
        <div>
          <span className="eyebrow">CONNECT YOUR DATA</span>
          <h2 id="modal-title">{title}</h2>
        </div>
        <button className="icon-button" aria-label="닫기" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  )
}

function ProductAvatar({ id, small = false }: { id: ProductId; small?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`product-avatar ${small ? 'small' : ''}`}
      style={{ background: `${PRODUCT_STYLE[id].color}20` }}
    >
      {PRODUCT_STYLE[id].emoji}
    </span>
  )
}

export default function App() {
  const [sample, setSample] = useState<'cafe' | 'building'>(() =>
    document.documentElement.dataset.sample === 'building' ||
    new URLSearchParams(window.location.search).get('sample') === 'building'
      ? 'building'
      : 'cafe',
  )
  const [initial] = useState(loadInitialData)
  const [products, setProducts] = useState(initial.products)
  const [source, setSource] = useState<string | null>(initial.source)
  const [dataPersisted, setDataPersisted] = useState(true)
  const [selectedId, setSelectedId] = useState<ProductId>('P001')
  const [days, setDays] = useState<7 | 30>(7)
  const [activeView, setActiveView] = useState<'space' | 'data'>('space')
  const [modal, setModal] = useState<'upload' | 'help' | null>(null)
  const [uploadError, setUploadError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [resetKey, setResetKey] = useState(0)
  const [chartMetric, setChartMetric] = useState<'revenue' | 'quantity'>('revenue')
  const fileInput = useRef<HTMLInputElement>(null)

  const latest = getLatestDate(products)!
  const dailyTotals = getDailyTotals(products, days)
  const stats = products.map((product) => ({ product, ...getProductStats(product, days, latest) }))
  const totalRevenue = stats.reduce((sum, row) => sum + row.revenue, 0)
  const totalQuantity = stats.reduce((sum, row) => sum + row.quantity, 0)
  const totalStock = products.reduce((sum, product) => sum + product.stock, 0)
  const lowStock = products.filter((product) => product.stock <= STOCK_THRESHOLD)
  const selected = products.find((product) => product.id === selectedId)!
  const selectedStats = getProductStats(selected, days, latest)
  const selectedShare = totalRevenue ? Math.round((selectedStats.revenue / totalRevenue) * 100) : 0
  const visibleRows = stats.filter(
    ({ product }) =>
      activeView === 'space' ||
      `${product.id} ${product.name} ${product.category}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
  )
  const startDate = dailyTotals[0]?.date
  const dateText = (date: string) => date.replaceAll('-', '.')

  useEffect(() => {
    document.title =
      sample === 'building'
        ? '모노 스페이스 · 건물 모델 대시보드'
        : '모노 스페이스 · 3D 데이터 대시보드'
  }, [sample])

  useEffect(() => {
    if (!notice) return
    const timeout = setTimeout(() => setNotice(''), 5000)
    return () => clearTimeout(timeout)
  }, [notice])

  function openUpload() {
    setUploadError('')
    setModal('upload')
  }
  async function importFile(file?: File) {
    if (!file) return
    setUploadError('')
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setUploadError('CSV 파일을 선택해주세요. 엑셀에서 CSV UTF-8 형식으로 저장할 수 있습니다.')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setUploadError('2MB 이하의 CSV 파일을 선택해주세요.')
      return
    }
    setUploading(true)
    try {
      const csv = await file.text()
      const next = parseProductsCsv(csv)
      let persisted = true
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ csv, source: file.name }))
      } catch {
        persisted = false
      }
      setProducts(next)
      setSource(file.name)
      setDataPersisted(persisted)
      setModal(null)
      setNotice(
        `${next.length}개 상품 데이터를 연결했습니다.${persisted ? '' : ' 브라우저 저장소를 사용할 수 없어 이번 방문에만 유지됩니다.'}`,
      )
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : '파일을 읽지 못했습니다. CSV 내용을 확인해주세요.',
      )
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }
  function restoreSample() {
    setProducts(SAMPLE_PRODUCTS)
    setSource(null)
    setDataPersisted(true)
    let removed = true
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      removed = false
    }
    setNotice(
      `샘플 데이터로 돌아왔습니다.${removed ? '' : ' 저장소 초기화가 차단되어 새로고침하면 이전 데이터가 다시 표시될 수 있습니다.'}`,
    )
  }

  if (sample === 'building') {
    return (
      <Suspense
        fallback={
          <div className="sample-loading" role="status">
            <LoaderCircle className="spin" size={28} />
            건물 샘플을 준비하고 있어요.
          </div>
        }
      >
        <BuildingDashboard onBackToCafe={() => setSample('cafe')} />
      </Suspense>
    )
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          aria-label="모노 스페이스 홈"
          onClick={(e) => {
            e.preventDefault()
            setActiveView('space')
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
            <Coffee size={20} />
          </div>
          <div>
            <strong>모노 카페</strong>
            <span>나의 워크스페이스</span>
          </div>
          <span className="workspace-dot" />
        </div>
        <nav className="cafe-sample-switch" aria-label="샘플 선택">
          <button
            className="active"
            aria-pressed="true"
            aria-label="카페 샘플"
            title="카페 샘플"
            onClick={() => setActiveView('space')}
          >
            <Coffee size={15} />
            <span>카페 샘플</span>
          </button>
          <button
            aria-pressed="false"
            aria-label="건물 샘플"
            title="건물 샘플"
            onClick={() => setSample('building')}
          >
            <Building2 size={15} />
            <span>건물 샘플</span>
          </button>
        </nav>
        <span className="nav-caption">WORKSPACE</span>
        <nav aria-label="주 메뉴">
          <button
            className={`nav-item ${activeView === 'space' ? 'active' : ''}`}
            onClick={() => setActiveView('space')}
          >
            <Box size={19} />
            공간 대시보드
            <span className="nav-active-dot" />
          </button>
          <button
            className={`nav-item ${activeView === 'data' ? 'active' : ''}`}
            onClick={() => setActiveView('data')}
          >
            <Database size={19} />
            상품 데이터<span className="nav-count">{products.length}</span>
          </button>
        </nav>
        <div className="sidebar-note">
          <div className="mini-cube">
            <Box size={30} strokeWidth={1.2} />
          </div>
          <strong>공간과 데이터의 연결</strong>
          <p>
            익숙한 공간에서
            <br />
            새로운 인사이트를 발견하세요.
          </p>
          <button onClick={() => setModal('help')}>
            사용 방법 알아보기
            <ArrowUpRight size={14} />
          </button>
        </div>
        <div className="sidebar-bottom">
          <button onClick={() => setModal('help')}>
            <HelpCircle size={18} />
            도움말
          </button>
          <div className="profile">
            <span>MK</span>
            <div>
              <strong>모노 카페</strong>
              <small>데모 워크스페이스</small>
            </div>
            <Leaf size={17} />
          </div>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>워크스페이스</span>
            <ChevronRight size={14} />
            <strong>{activeView === 'space' ? '공간 대시보드' : '상품 데이터'}</strong>
          </div>
          <div className="topbar-right">
            <span className="connection">
              <i />
              {source ? '내 데이터 연결됨' : '샘플 데이터 연결됨'}
            </span>
            <button
              className="icon-button mobile-help"
              aria-label="도움말"
              onClick={() => setModal('help')}
            >
              <HelpCircle size={17} />
            </button>
            <span className="top-avatar">M</span>
          </div>
        </header>
        <main>
          <section className="page-heading">
            <div>
              <div className="eyebrow">
                <span />
                YOUR SPACE, AT A GLANCE
              </div>
              <h1>{activeView === 'space' ? '모노 카페 대시보드' : '상품 데이터'}</h1>
              <p>
                {activeView === 'space'
                  ? '공간 속 상품을 클릭하고, 우리 매장의 흐름을 살펴보세요.'
                  : '3D 공간과 연결된 상품을 확인하고, 나의 데이터를 불러오세요.'}
              </p>
            </div>
            <div className="page-actions">
              <a className="button secondary" href={SAMPLE_CSV_URL} download="sample-products.csv">
                <ArrowDownToLine size={16} />
                샘플 CSV
              </a>
              <button className="button primary" onClick={openUpload}>
                <Upload size={16} />
                데이터 업로드
              </button>
            </div>
          </section>

          <div className="report-toolbar">
            <div className="report-source">
              <span className={`badge ${source ? 'green' : ''}`}>
                {source ? '내 데이터' : 'DEMO'}
              </span>
              <span title={source ?? undefined}>
                {source ?? '샘플 카페의 가상 판매 데이터입니다.'}
              </span>
              {source && (
                <button className="text-button" onClick={restoreSample}>
                  샘플로 초기화
                </button>
              )}
            </div>
            <div className="date-controls">
              <span>
                {startDate ? dateText(startDate) : ''} — {dateText(latest)}
              </span>
              <div className="segmented" aria-label="집계 기간">
                <button
                  aria-pressed={days === 7}
                  className={days === 7 ? 'selected' : ''}
                  onClick={() => setDays(7)}
                >
                  7일
                </button>
                <button
                  aria-pressed={days === 30}
                  className={days === 30 ? 'selected' : ''}
                  onClick={() => setDays(30)}
                >
                  30일
                </button>
              </div>
            </div>
          </div>

          <section className="metrics" aria-label="전체 매장 지표">
            {[
              {
                label: '총 매출',
                value: formatCurrency(totalRevenue),
                note: `최근 ${days}일 판매 합계`,
                icon: Wallet,
                className: 'mint',
              },
              {
                label: '판매 수량',
                value: `${formatNumber(totalQuantity)}개`,
                note: `${products.length}개 상품의 판매 수량`,
                icon: ShoppingBag,
                className: 'sand',
              },
              {
                label: '현재 재고',
                value: `${formatNumber(totalStock)}개`,
                note: '데이터에 기록된 현재 수량',
                icon: Package,
                className: 'blue',
              },
              {
                label: '재고 확인 필요',
                value: `${lowStock.length}개 상품`,
                note: `재고 ${STOCK_THRESHOLD}개 이하 기준`,
                icon: Layers3,
                className: 'peach',
              },
            ].map((metric) => (
              <article className="metric-card" key={metric.label}>
                <div className="metric-top">
                  <span>{metric.label}</span>
                  <span className={`metric-icon ${metric.className}`}>
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
            <section className="space-grid" aria-label="3D 공간과 선택한 상품">
              <article className="card scene-card">
                <div className="card-heading">
                  <div className="heading-with-icon">
                    <Box size={19} />
                    <h2>우리 매장, 한눈에</h2>
                    <span className="subtle-badge">3D SPACE</span>
                  </div>
                  <button
                    className="icon-button reset-view"
                    title="시점 초기화"
                    aria-label="3D 시점 초기화"
                    onClick={() => setResetKey((key) => key + 1)}
                  >
                    <RotateCcw size={16} />
                  </button>
                </div>
                <div className="scene-wrap">
                  <div className="scene-caption">
                    <span className="live-dot" />
                    MONO CAFE<span>가상 매장</span>
                  </div>
                  <SceneBoundary>
                    <Suspense
                      fallback={
                        <div className="scene-fallback">
                          <LoaderCircle className="spin" size={28} />
                          <p>매장 공간을 준비하고 있어요.</p>
                        </div>
                      }
                    >
                      <CafeScene
                        products={products}
                        selectedId={selectedId}
                        onSelect={setSelectedId}
                        resetKey={resetKey}
                      />
                    </Suspense>
                  </SceneBoundary>
                  <div className="scene-hint">
                    <MousePointer2 size={13} />
                    <span>상품 클릭 · 드래그하여 회전 · 스크롤로 확대</span>
                  </div>
                </div>
                <div className="scene-products">
                  <span>상품 선택</span>
                  <div className="product-chips" aria-label="3D 상품 선택">
                    {products.map((product) => (
                      <button
                        key={product.id}
                        aria-pressed={selectedId === product.id}
                        className={`product-chip ${selectedId === product.id ? 'selected' : ''}`}
                        onClick={() => setSelectedId(product.id)}
                      >
                        <i style={{ background: PRODUCT_STYLE[product.id].color }} />
                        {product.name}
                      </button>
                    ))}
                  </div>
                </div>
              </article>

              <article className="card detail-card" aria-label="선택한 상품 정보">
                <div className="detail-top">
                  <span className="eyebrow">PRODUCT INSIGHT</span>
                  <span className="selected-indicator">
                    <span />
                    선택됨
                  </span>
                </div>
                <div className="detail-product">
                  <ProductAvatar id={selected.id} />
                  <div>
                    <span>
                      {selected.category} <span className="muted">· {selected.id}</span>
                    </span>
                    <h2>{selected.name}</h2>
                  </div>
                </div>
                <div className="detail-revenue">
                  <span>최근 {days}일 매출</span>
                  <strong data-testid="selected-revenue">
                    {formatCurrency(selectedStats.revenue)}
                  </strong>
                  <span className="detail-period">
                    {startDate?.slice(5).replace('-', '.')} — {latest.slice(5).replace('-', '.')}
                  </span>
                </div>
                <div className="detail-mini-stats">
                  <div>
                    <span>판매 수량</span>
                    <strong>
                      {formatNumber(selectedStats.quantity)}
                      <small>개</small>
                    </strong>
                  </div>
                  <div>
                    <span>현재 재고</span>
                    <strong>
                      {formatNumber(selected.stock)}
                      <small>개</small>
                    </strong>
                  </div>
                  <div>
                    <span>판매 단가</span>
                    <strong>
                      {formatNumber(selected.unitPrice)}
                      <small>원</small>
                    </strong>
                  </div>
                </div>
                <div className="share-heading">
                  <span>전체 매출 비중</span>
                  <strong>{selectedShare}%</strong>
                </div>
                <div className="share-track">
                  <span style={{ width: `${selectedShare}%` }} />
                </div>
                <div
                  className={`stock-message ${selected.stock <= STOCK_THRESHOLD ? 'warning' : ''}`}
                >
                  <span className="status-dot" />
                  <div>
                    <strong>
                      {selected.stock <= STOCK_THRESHOLD
                        ? '재고를 확인해주세요'
                        : '재고가 충분해요'}
                    </strong>
                    <p>
                      {selected.stock <= STOCK_THRESHOLD
                        ? `현재 ${selected.stock}개 남아 있어요. 보충 계획을 확인하세요.`
                        : '선택한 상품의 재고가 기준 수량보다 많습니다.'}
                    </p>
                  </div>
                </div>
              </article>
            </section>
          )}

          <section className={`analytics-grid ${activeView === 'data' ? 'data-view' : ''}`}>
            {activeView === 'space' && (
              <article className="card chart-card">
                <div className="card-heading">
                  <div>
                    <h2>판매 흐름</h2>
                    <p>최근 {days}일, 매장의 변화를 살펴보세요.</p>
                  </div>
                  <div className="chart-switch" aria-label="차트 지표">
                    <button
                      className={chartMetric === 'revenue' ? 'active' : ''}
                      aria-pressed={chartMetric === 'revenue'}
                      onClick={() => setChartMetric('revenue')}
                    >
                      매출
                    </button>
                    <button
                      className={chartMetric === 'quantity' ? 'active' : ''}
                      aria-pressed={chartMetric === 'quantity'}
                      onClick={() => setChartMetric('quantity')}
                    >
                      판매량
                    </button>
                  </div>
                </div>
                <div className="chart-summary">
                  <strong>
                    {chartMetric === 'revenue'
                      ? formatCurrency(totalRevenue)
                      : `${formatNumber(totalQuantity)}개`}
                  </strong>
                  <span>
                    <span className="chart-legend" />
                    전체 상품
                  </span>
                </div>
                <div
                  className="chart-container"
                  role="img"
                  aria-label={`최근 ${days}일 ${chartMetric === 'revenue' ? '매출' : '판매량'} 차트. 총 ${chartMetric === 'revenue' ? formatCurrency(totalRevenue) : `${formatNumber(totalQuantity)}개`}`}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      accessibilityLayer
                      data={dailyTotals}
                      margin={{ top: 10, right: 10, left: -12, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="sales-gradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#6a9b7b" stopOpacity={0.24} />
                          <stop offset="100%" stopColor="#6a9b7b" stopOpacity={0.01} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="#edf0ed" vertical={false} strokeDasharray="3 4" />
                      <XAxis
                        dataKey="label"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: '#929b96', fontSize: 11 }}
                        minTickGap={25}
                        dy={8}
                      />
                      <YAxis
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: '#929b96', fontSize: 10 }}
                        tickFormatter={(value) =>
                          chartMetric === 'revenue' ? `${Number(value) / 10000}만` : `${value}`
                        }
                        width={55}
                      />
                      <Tooltip
                        contentStyle={{
                          border: '1px solid #e4e9e4',
                          borderRadius: 12,
                          fontSize: 12,
                        }}
                        formatter={(value) =>
                          chartMetric === 'revenue'
                            ? formatCurrency(Number(value))
                            : `${formatNumber(Number(value))}개`
                        }
                        labelFormatter={(_, payload) => payload[0]?.payload.date ?? ''}
                      />
                      <Area
                        type="monotone"
                        dataKey={chartMetric}
                        name={chartMetric === 'revenue' ? '매출' : '판매량'}
                        stroke="#527e64"
                        strokeWidth={2.5}
                        fill="url(#sales-gradient)"
                        activeDot={{ r: 5, strokeWidth: 3, stroke: '#fff' }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </article>
            )}

            <article className="card table-card">
              <div className="card-heading">
                <div>
                  <h2>
                    상품별 현황 <span className="count-badge">{products.length}</span>
                  </h2>
                  <p>
                    {activeView === 'data'
                      ? '상품을 선택하면 3D 공간에서 확인할 수 있어요.'
                      : '공간에 연결된 상품의 판매와 재고'}
                  </p>
                </div>
                {activeView === 'space' && (
                  <button className="text-button" onClick={() => setActiveView('data')}>
                    전체 보기
                    <ChevronRight size={14} />
                  </button>
                )}
              </div>
              {activeView === 'data' && (
                <div className="table-search">
                  <Search size={16} />
                  <input
                    aria-label="상품 검색"
                    placeholder="상품명, 코드, 카테고리 검색"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <span>{visibleRows.length}개 상품</span>
                </div>
              )}
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>상품</th>
                      <th>판매량</th>
                      <th>매출</th>
                      <th>재고</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map(({ product, quantity, revenue }) => (
                      <tr
                        key={product.id}
                        className={selectedId === product.id ? 'selected-row' : ''}
                      >
                        <td>
                          <button
                            className="table-product"
                            onClick={() => {
                              setSelectedId(product.id)
                              if (activeView === 'data') setActiveView('space')
                            }}
                          >
                            <ProductAvatar id={product.id} small />
                            <span>
                              <strong>{product.name}</strong>
                              <small>
                                {product.id} · {product.category}
                              </small>
                            </span>
                          </button>
                        </td>
                        <td>
                          {formatNumber(quantity)}
                          <small>개</small>
                        </td>
                        <td>{formatCurrency(revenue)}</td>
                        <td>
                          <span
                            className={`stock-pill ${product.stock <= STOCK_THRESHOLD ? 'low' : ''}`}
                          >
                            {product.stock <= STOCK_THRESHOLD && <i />}
                            {formatNumber(product.stock)}개
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!visibleRows.length && <div className="empty-search">검색 결과가 없습니다.</div>}
              </div>
            </article>
          </section>

          {activeView === 'data' && (
            <section className="data-guide card">
              <FileSpreadsheet size={28} />
              <div>
                <h2>나의 데이터로 공간을 채워보세요.</h2>
                <p>
                  샘플 CSV의 상품 코드 P001~P004를 유지하고, 상품명·가격·재고·일별 판매량을 수정해
                  업로드하세요.
                  <br />
                  업로드한 파일은 서버로 전송되지 않으며 이 브라우저에 저장됩니다.
                </p>
              </div>
              <button className="button secondary" onClick={openUpload}>
                CSV 연결하기
                <ArrowUpRight size={16} />
              </button>
            </section>
          )}
          <footer className="footer">
            <span>
              <Box size={13} />
              MONOSPACE <span className="footer-divider">/</span>공간으로 읽는 데이터
            </span>
            <span>
              {source
                ? dataPersisted
                  ? '브라우저에 저장된 업로드 데이터'
                  : '이번 방문에만 유지되는 업로드 데이터'
                : '데모 · 실제 매장 데이터가 아닙니다.'}
            </span>
          </footer>
        </main>
      </div>

      {notice && (
        <div className="toast" role="status">
          <Check size={18} />
          {notice}
          <button aria-label="알림 닫기" onClick={() => setNotice('')}>
            <X size={16} />
          </button>
        </div>
      )}
      {modal === 'upload' && (
        <Modal title="우리 매장 데이터 연결" onClose={() => setModal(null)}>
          <p className="modal-description">
            샘플 파일을 내려받아 수정한 후 업로드해주세요.
            <br />
            상품 코드를 기준으로 3D 공간의 4개 상품과 연결합니다.
          </p>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            aria-label="CSV 파일 선택"
            className="file-input"
            disabled={uploading}
            onChange={(e) => void importFile(e.target.files?.[0])}
          />
          <button
            className="upload-zone"
            disabled={uploading}
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              if (!uploading) void importFile(e.dataTransfer.files[0])
            }}
          >
            <span className="upload-zone-icon">
              {uploading ? <LoaderCircle className="spin" size={26} /> : <Upload size={26} />}
            </span>
            <strong>
              {uploading ? '데이터를 확인하고 있어요' : 'CSV 파일을 선택하거나 여기에 놓아주세요'}
            </strong>
            <span>UTF-8 CSV · 최대 2MB</span>
          </button>
          {uploadError && (
            <p className="upload-error" role="alert">
              {uploadError}
            </p>
          )}
          <a className="download-template" href={SAMPLE_CSV_URL} download="sample-products.csv">
            <FileSpreadsheet size={18} />
            <span>
              샘플 데이터 다운로드<small>4개 상품 · 30일 판매 기록</small>
            </span>
            <ArrowDownToLine size={18} />
          </a>
          <div className="schema-note">
            <strong>파일에 필요한 열</strong>
            <code>product_id, product_name, category, unit_price, stock, date, quantity</code>
            <p>
              한 행은 상품 하나의 하루 판매 기록입니다. P001~P004를 모두 포함하고, 날짜는 YYYY-MM-DD
              형식으로 입력해주세요. 같은 상품의 이름·분류·단가·현재 재고는 모든 행에서 같아야
              합니다.
            </p>
          </div>
          <p className="privacy-note">
            <Check size={14} />
            파일은 외부로 전송되지 않고, 이 브라우저에만 저장됩니다.
          </p>
        </Modal>
      )}
      {modal === 'help' && (
        <Modal title="공간에서 데이터를 읽는 방법" onClose={() => setModal(null)}>
          <div className="help-steps">
            <div>
              <span>01</span>
              <div>
                <h3>매장 속 상품을 선택하세요</h3>
                <p>
                  3D 공간의 상품이나 하단 상품 버튼을 누르면 매출·판매 수량·재고가 오른쪽에
                  표시됩니다. 드래그로 회전하고 스크롤로 확대할 수 있어요.
                </p>
              </div>
            </div>
            <div>
              <span>02</span>
              <div>
                <h3>기간을 바꾸고 흐름을 확인하세요</h3>
                <p>
                  7일·30일 버튼으로 매출과 판매량을 비교하세요. 기간은 업로드한 데이터의 가장 최근
                  날짜를 기준으로 계산됩니다. 현재 재고는 기간과 무관한 수량입니다.
                </p>
              </div>
            </div>
            <div>
              <span>03</span>
              <div>
                <h3>CSV로 나의 데이터를 연결하세요</h3>
                <p>
                  샘플 CSV에서 상품 코드 P001~P004를 유지하고 데이터를 수정해주세요. 엑셀은 CSV
                  UTF-8 형식으로 저장하면 됩니다. 이 버전은 CSV를 지원하며 실제 API·DB 및 3D 모델
                  파일 연결은 이후 확장할 수 있습니다.
                </p>
              </div>
            </div>
          </div>
          <button className="button primary full-width" onClick={openUpload}>
            내 데이터 연결하기
            <ArrowUpRight size={16} />
          </button>
        </Modal>
      )}
    </div>
  )
}
