import { useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { BarChart3, ChevronLeft, ChevronRight, ChartPie, Info } from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  useChartHeight,
  useChartWidth,
  type TooltipContentProps,
} from 'recharts'
import './building-analytics.css'

type AnalyticsElement = {
  id: string
  name: string
  floor: string
  kind: string
  material: string
  volume: number | null
}
type Props = { elements: AnalyticsElement[] }
type FloorRow = {
  floor: string
  label: string
  count: number
  volume: number
  knownCount: number
}
const FLOOR_PAGE_SIZE = 8
const KIND_OUTER_RADIUS = 73
const KIND_TOOLTIP_GAP = 7
const KIND_TOOLTIP_MOVE_MS = 280
const KIND_TOOLTIP_HIDE_MS = 90
const KIND_STYLE = [
  { key: 'column', label: '기둥', color: '#527b63' },
  { key: 'beam', label: '보', color: '#a5bb83' },
  { key: 'slab', label: '슬래브', color: '#85acb4' },
  { key: 'wall', label: '벽체', color: '#d6b17b' },
  { key: 'other', label: '기타', color: '#b1a2c4' },
]
const countFormat = new Intl.NumberFormat('ko-KR')
const volumeFormat = new Intl.NumberFormat('ko-KR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const floorLabel = (floor: string) => (/^[123]F$/.test(floor) ? `${floor[0]}층` : floor)

type Point = { x: number; y: number }
const tooltipTransform = ({ x, y }: Point) => `translate(${x}px, ${y}px) translate(-50%, -50%)`

function KindTooltip({
  active,
  coordinate,
  payload,
  hoverSequence,
}: Pick<TooltipContentProps<number, string>, 'active' | 'coordinate' | 'payload'> & {
  hoverSequence: RefObject<number>
}) {
  const width = useChartWidth()
  const height = useChartHeight()
  const tooltip = useRef<HTMLDivElement>(null)
  const motion = useRef<Animation | null>(null)
  const previous = useRef<{ width: number; height: number; sequence: number } | null>(null)
  const [lastItem, setLastItem] = useState<{
    name: string | number | undefined
    value: number
  } | null>(null)
  const item = payload[0]
  const name = item?.name
  const value = item?.value
  const x = coordinate?.x
  const y = coordinate?.y

  useLayoutEffect(() => {
    const element = tooltip.current
    const wrapper = element?.parentElement
    if (!active || x === undefined || y === undefined || typeof value !== 'number') return
    if (!element || !wrapper || !width || !height) return
    const centerX = width / 2
    const centerY = height / 2
    const angle = Math.atan2(y - centerY, x - centerX)
    const halfWidth = element.offsetWidth / 2
    const halfHeight = element.offsetHeight / 2
    const outer = KIND_OUTER_RADIUS + KIND_TOOLTIP_GAP
    const place = (direction: number): Point => {
      const dx = Math.cos(direction)
      const dy = Math.sin(direction)
      const distance = outer + Math.abs(dx) * halfWidth + Math.abs(dy) * halfHeight
      const left = Math.max(halfWidth, Math.min(width - halfWidth, centerX + dx * distance))
      let top = Math.max(halfHeight, Math.min(height - halfHeight, centerY + dy * distance))
      const horizontalGap = Math.max(0, Math.abs(left - centerX) - halfWidth)
      if (horizontalGap < outer) {
        // Near the card edge, shift vertically to keep the entire tooltip outside the ring.
        const verticalOffset = Math.sqrt(outer ** 2 - horizontalGap ** 2) + halfHeight
        if (Math.abs(top - centerY) < verticalOffset) {
          top = centerY + (dy < 0 ? -verticalOffset : verticalOffset)
        }
      }
      return { x: left, y: top }
    }

    const canAnimate =
      previous.current?.width === width &&
      previous.current.height === height &&
      previous.current.sequence === hoverSequence.current &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    previous.current = { width, height, sequence: hoverSequence.current }
    setLastItem((previous) =>
      previous && previous.name === name && previous.value === value ? previous : { name, value },
    )

    const target = place(angle)
    const before = element.getBoundingClientRect()
    const origin = wrapper.getBoundingClientRect()
    const from = {
      x: before.left + before.width / 2 - origin.left,
      y: before.top + before.height / 2 - origin.top,
    }
    motion.current?.cancel()
    element.style.transform = tooltipTransform(target)
    if (!canAnimate || Math.hypot(target.x - from.x, target.y - from.y) < 1) return

    const start = Math.atan2(from.y - centerY, from.x - centerX)
    const delta = Math.atan2(Math.sin(angle - start), Math.cos(angle - start))
    const steps = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 45)))
    const points = [
      from,
      ...Array.from({ length: steps }, (_, index) => place(start + delta * ((index + 1) / steps))),
    ]
    const clearance = ({ x: left, y: top }: Point) =>
      Math.hypot(
        Math.max(0, Math.abs(left - centerX) - halfWidth),
        Math.max(0, Math.abs(top - centerY) - halfHeight),
      ) - KIND_OUTER_RADIUS
    // Adjacent points must leave enough clearance for the straight step between them.
    const canTravel = points.every((point, index) => {
      if (index === 0) return clearance(point) > 0
      const previous = points[index - 1]
      return (
        Math.hypot(point.x - previous.x, point.y - previous.y) <
        clearance(point) + clearance(previous)
      )
    })
    if (canTravel) {
      motion.current = element.animate(
        points.map((point) => ({ transform: tooltipTransform(point) })),
        {
          duration: KIND_TOOLTIP_MOVE_MS,
          easing: 'ease-out',
        },
      )
    } else {
      // Some narrow charts have no path beside the ring. Relocate while fully faded out.
      motion.current = element.animate(
        clearance(from) > 0
          ? [
              { transform: tooltipTransform(from), opacity: 1 },
              { transform: tooltipTransform(from), opacity: 0, offset: 0.4 },
              { transform: tooltipTransform(target), opacity: 0, offset: 0.6 },
              { transform: tooltipTransform(target), opacity: 1 },
            ]
          : [{ opacity: 0 }, { opacity: 1 }],
        { duration: KIND_TOOLTIP_MOVE_MS, easing: 'ease-out' },
      )
    }
  }, [active, height, hoverSequence, name, value, width, x, y])

  useLayoutEffect(() => () => motion.current?.cancel(), [])

  const displayedItem =
    active && coordinate && typeof value === 'number' ? { name, value } : lastItem
  if (!displayedItem) return null
  return (
    <div ref={tooltip} className="building-analytics-tooltip building-kind-tooltip" role="tooltip">
      <strong>{displayedItem.name}</strong>
      <span>{countFormat.format(displayedItem.value)}개</span>
    </div>
  )
}

export default function BuildingAnalytics({ elements }: Props) {
  const titleId = useId()
  const kindHoverSequence = useRef(0)
  const [metric, setMetric] = useState<'volume' | 'count'>('volume')
  const [page, setPage] = useState(0)
  const data = useMemo(() => {
    const floors = new Map<string, FloorRow>()
    const counts = new Map<string, number>()
    let missingCount = 0
    for (const element of elements) {
      const row = floors.get(element.floor) ?? {
        floor: element.floor,
        label: floorLabel(element.floor),
        count: 0,
        volume: 0,
        knownCount: 0,
      }
      row.count++
      if (element.volume !== null && Number.isFinite(element.volume) && element.volume >= 0) {
        row.volume += element.volume
        row.knownCount++
      } else missingCount++
      floors.set(element.floor, row)
      const kind = KIND_STYLE.some((style) => style.key === element.kind) ? element.kind : 'other'
      counts.set(kind, (counts.get(kind) ?? 0) + 1)
    }
    return {
      floors: [...floors.values()],
      kinds: KIND_STYLE.map((kind) => ({ ...kind, count: counts.get(kind.key) ?? 0 })).filter(
        (kind) => kind.count > 0,
      ),
      missingCount,
    }
  }, [elements])
  const pageCount = Math.max(1, Math.ceil(data.floors.length / FLOOR_PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1)
  const floorRows = data.floors.slice(
    currentPage * FLOOR_PAGE_SIZE,
    (currentPage + 1) * FLOOR_PAGE_SIZE,
  )
  const chartRows = floorRows.map((row) => ({
    ...row,
    value: metric === 'count' ? row.count : row.knownCount ? row.volume : null,
  }))
  const hasVolume = floorRows.some((row) => row.knownCount > 0)
  const title = metric === 'volume' ? '층별 체적' : '층별 부재 수'

  return (
    <section className="building-analytics" aria-label="건물 데이터 그래프">
      <article className="card building-analytics-card" aria-labelledby={`${titleId}-floor`}>
        <div className="building-analytics-heading">
          <div>
            <span className="building-analytics-eyebrow">FLOOR INSIGHT</span>
            <h2 id={`${titleId}-floor`}>
              <BarChart3 size={17} />
              {title}
            </h2>
            <p>층별 물량과 부재 규모를 비교하세요.</p>
          </div>
          <div className="building-analytics-switch" role="group" aria-label="층별 그래프 지표">
            <button
              type="button"
              aria-pressed={metric === 'volume'}
              onClick={() => setMetric('volume')}
            >
              체적
            </button>
            <button
              type="button"
              aria-pressed={metric === 'count'}
              onClick={() => setMetric('count')}
            >
              부재 수
            </button>
          </div>
        </div>
        {floorRows.length ? (
          <>
            <div className="building-analytics-chart-heading">
              <span>{metric === 'volume' ? '단위 m³' : '단위 개'}</span>
              <span>{countFormat.format(data.floors.length)}개 층</span>
            </div>
            {metric === 'volume' && !hasVolume ? (
              <div className="building-analytics-empty" role="img" aria-label="층별 체적 차트">
                <BarChart3 size={27} />
                <strong>확인된 체적이 없습니다.</strong>
                <p>부재 수로 전환하거나 IFC의 체적 속성을 확인하세요.</p>
              </div>
            ) : (
              <div
                className="building-floor-chart"
                style={{ height: Math.max(155, chartRows.length * 34 + 30) }}
                role="img"
                aria-label={`${title} 차트`}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    accessibilityLayer
                    data={chartRows}
                    layout="vertical"
                    margin={{ top: 2, right: 23, bottom: 1, left: 0 }}
                  >
                    <CartesianGrid stroke="#edf1e8" horizontal={false} strokeDasharray="3 4" />
                    <XAxis
                      type="number"
                      axisLine={false}
                      tickLine={false}
                      allowDecimals={metric === 'volume'}
                      tick={{ fill: '#8b9980', fontSize: 9 }}
                      tickFormatter={(value) => countFormat.format(Number(value))}
                      domain={[0, 'auto']}
                    />
                    <YAxis
                      type="category"
                      dataKey="label"
                      width={85}
                      axisLine={false}
                      tickLine={false}
                      interval={0}
                      tick={{ fill: '#6f8261', fontSize: 10 }}
                      tickFormatter={(value) =>
                        String(value).length > 12 ? `${String(value).slice(0, 11)}…` : String(value)
                      }
                    />
                    <Tooltip
                      cursor={{ fill: '#f3f6ef' }}
                      content={({ active, payload }) => {
                        const row = payload?.[0]?.payload as FloorRow | undefined
                        return active && row ? (
                          <div className="building-analytics-tooltip">
                            <strong>{row.label}</strong>
                            <span>
                              체적{' '}
                              {row.knownCount ? `${volumeFormat.format(row.volume)} m³` : '미확인'}
                            </span>
                            <span>부재 {countFormat.format(row.count)}개</span>
                            {row.count > row.knownCount && (
                              <small>
                                체적 미확인 {countFormat.format(row.count - row.knownCount)}개
                              </small>
                            )}
                          </div>
                        ) : null
                      }}
                    />
                    <Bar
                      dataKey="value"
                      name={metric === 'volume' ? '체적' : '부재 수'}
                      fill="#7c9e78"
                      radius={[0, 5, 5, 0]}
                      maxBarSize={16}
                      isAnimationActive={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            {pageCount > 1 && (
              <nav className="building-chart-pager" aria-label="층별 그래프 페이지">
                <button
                  type="button"
                  aria-label="이전 층 그래프"
                  disabled={currentPage === 0}
                  onClick={() => setPage(currentPage - 1)}
                >
                  <ChevronLeft size={15} />
                </button>
                <span>
                  {currentPage * FLOOR_PAGE_SIZE + 1}–
                  {Math.min((currentPage + 1) * FLOOR_PAGE_SIZE, data.floors.length)} /{' '}
                  {countFormat.format(data.floors.length)}개 층
                </span>
                <button
                  type="button"
                  aria-label="다음 층 그래프"
                  disabled={currentPage === pageCount - 1}
                  onClick={() => setPage(currentPage + 1)}
                >
                  <ChevronRight size={15} />
                </button>
              </nav>
            )}
            <details className="building-chart-data">
              <summary>층별 수치 보기</summary>
              <div>
                <table aria-label="층별 그래프 데이터">
                  <thead>
                    <tr>
                      <th scope="col">층</th>
                      <th scope="col">체적 (m³)</th>
                      <th scope="col">부재 수</th>
                      <th scope="col">체적 미확인</th>
                    </tr>
                  </thead>
                  <tbody>
                    {floorRows.map((row) => (
                      <tr key={row.floor}>
                        <th scope="row">{row.label}</th>
                        <td>{row.knownCount ? volumeFormat.format(row.volume) : '—'}</td>
                        <td>{countFormat.format(row.count)}개</td>
                        <td>{countFormat.format(row.count - row.knownCount)}개</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        ) : (
          <div className="building-analytics-empty">
            <BarChart3 size={27} />
            <strong>표시할 부재가 없습니다.</strong>
            <p>다른 층을 선택해 그래프를 확인하세요.</p>
          </div>
        )}
      </article>

      <article className="card building-analytics-card" aria-labelledby={`${titleId}-kind`}>
        <div className="building-analytics-heading">
          <div>
            <span className="building-analytics-eyebrow">MODEL COMPOSITION</span>
            <h2 id={`${titleId}-kind`}>
              <ChartPie size={17} />
              부재 종류 구성
            </h2>
            <p>선택한 층의 구조를 개수로 살펴보세요.</p>
          </div>
          <span className="building-analytics-badge">{countFormat.format(elements.length)}개</span>
        </div>
        {elements.length ? (
          <div className="building-composition-body">
            <div
              className="building-kind-chart"
              role="img"
              aria-label="부재 종류별 개수 차트"
              onPointerLeave={() => kindHoverSequence.current++}
            >
              <ResponsiveContainer width="100%" height="100%">
                <PieChart accessibilityLayer>
                  <Pie
                    data={data.kinds}
                    dataKey="count"
                    nameKey="label"
                    innerRadius={51}
                    outerRadius={KIND_OUTER_RADIUS}
                    paddingAngle={data.kinds.length > 1 ? 3 : 0}
                    stroke="none"
                    isAnimationActive={false}
                  >
                    {data.kinds.map((kind) => (
                      <Cell key={kind.key} fill={kind.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    isAnimationActive={false}
                    wrapperStyle={{
                      width: '100%',
                      height: '100%',
                      transform: 'none',
                      transition: `visibility ${KIND_TOOLTIP_HIDE_MS}ms linear`,
                    }}
                    content={(props) => (
                      <KindTooltip {...props} hoverSequence={kindHoverSequence} />
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="building-kind-total" aria-hidden="true">
                <strong>{countFormat.format(elements.length)}</strong>
                <span>전체 부재</span>
              </div>
            </div>
            <dl className="building-kind-legend">
              {data.kinds.map((kind) => (
                <div key={kind.key}>
                  <dt>
                    <i style={{ background: kind.color }} />
                    {kind.label}
                  </dt>
                  <dd>
                    <strong>{countFormat.format(kind.count)}개</strong>
                    <span>{Math.round((kind.count / elements.length) * 100)}%</span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ) : (
          <div className="building-analytics-empty">
            <ChartPie size={27} />
            <strong>부재 종류를 확인할 수 없습니다.</strong>
            <p>표시할 부재가 있는 층을 선택하세요.</p>
          </div>
        )}
        {data.missingCount > 0 && (
          <p className="building-analytics-missing">
            체적 미확인 {countFormat.format(data.missingCount)}개는 체적 그래프 합계에서 제외됩니다.
          </p>
        )}
      </article>
    </section>
  )
}

export function BuildingAnalyticsNote({ isIfc = false }: { isIfc?: boolean }) {
  return (
    <p className="building-analytics-note">
      <Info size={13} />
      <span>
        카드와 층 필터 조건에 맞는 부재를 집계합니다. 단면상자는 화면만 자르며 그래프의 물량은
        바꾸지 않습니다.{' '}
        {isIfc ? '체적은 Pset 체적·Volume 값입니다.' : '체적은 샘플 모형 치수로 계산한 값입니다.'}
      </span>
    </p>
  )
}
