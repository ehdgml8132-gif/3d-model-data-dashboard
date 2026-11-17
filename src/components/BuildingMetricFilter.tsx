import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, RotateCcw, Search, X } from 'lucide-react'
import {
  isBuildingMetricFilterActive,
  type BuildingFilterElement,
  type BuildingMetricFilterKey,
  type BuildingMetricFilters,
} from '../lib/buildingFilters'
import VolumeDiagnostics from './VolumeDiagnostics'
import './building-metric-filter.css'

type Props = {
  filterKey: BuildingMetricFilterKey
  title: string
  colorClass: string
  icon: ReactNode
  elements: BuildingFilterElement[]
  visibleElements?: BuildingFilterElement[]
  filters: BuildingMetricFilters
  onChange: (next: BuildingMetricFilters) => void
}
type Option = { value: string; label: string; count: number; meta?: string }
type SelectionField = 'kinds' | 'elementIds' | 'floors' | 'materials'
const OPEN_EVENT = 'monospace:metric-filter-open'
const PAGE_SIZE = 100
const KIND_LABELS: Record<string, string> = {
  column: '기둥',
  beam: '보',
  slab: '슬래브',
  wall: '벽체',
  other: '기타',
}
const floorLabel = (value: string) => (/^[123]F$/.test(value) ? `${value[0]}층` : value)
const formatCount = (value: number) => new Intl.NumberFormat('ko-KR').format(value)

function groupedOptions(
  elements: BuildingFilterElement[],
  field: 'kind' | 'floor' | 'material',
): Option[] {
  const counts = new Map<string, number>()
  for (const element of elements) counts.set(element[field], (counts.get(element[field]) ?? 0) + 1)
  const entries = [...counts.entries()]
  if (field === 'kind') {
    const order = Object.keys(KIND_LABELS)
    entries.sort(([a], [b]) => {
      const first = order.indexOf(a)
      const second = order.indexOf(b)
      return (first < 0 ? order.length : first) - (second < 0 ? order.length : second)
    })
  }
  return entries.map(([value, count]) => ({
    value,
    label:
      field === 'kind'
        ? (KIND_LABELS[value] ?? value)
        : field === 'floor'
          ? floorLabel(value)
          : value,
    count,
  }))
}

export default function BuildingMetricFilter({
  filterKey,
  title,
  colorClass,
  icon,
  elements,
  visibleElements = elements,
  filters,
  onChange,
}: Props) {
  const id = useId()
  const dialogId = `${id}-metric-filter`
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDialogElement>(null)
  const minimumInput = useRef<HTMLInputElement>(null)
  const maximumInput = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [memberTab, setMemberTab] = useState<'kinds' | 'elements'>('kinds')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [minimum, setMinimum] = useState('')
  const [maximum, setMaximum] = useState('')
  const [includeUnknown, setIncludeUnknown] = useState(true)
  const [volumeError, setVolumeError] = useState('')
  const active = isBuildingMetricFilterActive(filters, filterKey)

  const close = useCallback((restoreFocus = false) => {
    setOpen(false)
    if (restoreFocus) requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }))
  }, [])

  const openPanel = () => {
    window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }))
    setMinimum(filters.volume.min === null ? '' : String(filters.volume.min))
    setMaximum(filters.volume.max === null ? '' : String(filters.volume.max))
    setIncludeUnknown(filters.volume.includeUnknown)
    setVolumeError('')
    setOpen(true)
  }

  useEffect(() => {
    const otherOpened = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id) close()
    }
    window.addEventListener(OPEN_EVENT, otherOpened)
    return () => window.removeEventListener(OPEN_EVENT, otherOpened)
  }, [close, id])

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      const target = event.target
      if (
        target instanceof Node &&
        !panel.current?.contains(target) &&
        !trigger.current?.contains(target)
      )
        close()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      close(true)
    }
    document.addEventListener('pointerdown', outside, true)
    window.addEventListener('keydown', escape)
    const frame = requestAnimationFrame(() => {
      const first = panel.current?.querySelector<HTMLElement>('input, [role="tab"]')
      first?.focus({ preventScroll: true })
    })
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('keydown', escape)
      cancelAnimationFrame(frame)
    }
  }, [close, open])

  useLayoutEffect(() => {
    if (!open) return
    const position = () => {
      const button = trigger.current
      const dialog = panel.current
      if (!button || !dialog) return
      const rect = button.getBoundingClientRect()
      const width = Math.min(340, window.innerWidth - 24)
      const cap = Math.min(520, window.innerHeight - 24)
      dialog.style.width = `${width}px`
      dialog.style.maxHeight = `${cap}px`
      const height = dialog.getBoundingClientRect().height
      const left = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12))
      const below = rect.bottom + 8
      const preferredTop = below + height <= window.innerHeight - 12 ? below : rect.top - height - 8
      const top = Math.max(12, Math.min(preferredTop, window.innerHeight - height - 12))
      dialog.style.left = `${left}px`
      dialog.style.top = `${top}px`
    }
    position()
    const scroll = (event: Event) => {
      if (event.target instanceof Node && panel.current?.contains(event.target)) return
      position()
    }
    window.addEventListener('resize', position)
    window.addEventListener('scroll', scroll, true)
    const observer = new ResizeObserver(position)
    if (panel.current) observer.observe(panel.current)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', scroll, true)
    }
  }, [open, memberTab, query, page, volumeError])

  const options = useMemo(() => {
    if (filterKey === 'members') return groupedOptions(elements, 'kind')
    if (filterKey === 'floors') return groupedOptions(elements, 'floor')
    if (filterKey === 'materials') return groupedOptions(elements, 'material')
    return []
  }, [elements, filterKey])
  const allElementIds = useMemo(() => elements.map((element) => element.id), [elements])
  const searchedElements = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    return normalized
      ? elements.filter((element) =>
          `${element.name} ${element.id} ${element.floor}`.toLocaleLowerCase().includes(normalized),
        )
      : elements
  }, [elements, query])
  const pageCount = Math.max(1, Math.ceil(searchedElements.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1)
  const individual = filterKey === 'members' && memberTab === 'elements'
  const field: SelectionField =
    filterKey === 'members'
      ? individual
        ? 'elementIds'
        : 'kinds'
      : filterKey === 'floors'
        ? 'floors'
        : 'materials'
  const universe = individual ? allElementIds : options.map((option) => option.value)
  const selected = filters[field] === null ? null : new Set(filters[field])
  const rows: Option[] = individual
    ? searchedElements
        .slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
        .map((element) => ({
          value: element.id,
          label: element.name,
          count: 1,
          meta: `${element.id} · ${floorLabel(element.floor)}`,
        }))
    : options

  const toggle = (value: string, checked: boolean) => {
    const next = new Set(filters[field] ?? universe)
    if (checked) next.add(value)
    else next.delete(value)
    const all = next.size === universe.length && universe.every((item) => next.has(item))
    onChange({ ...filters, [field]: all ? null : [...next] })
  }

  const reset = () => {
    if (filterKey === 'members') onChange({ ...filters, kinds: null, elementIds: null })
    else if (filterKey === 'volume') {
      onChange({ ...filters, volume: { min: null, max: null, includeUnknown: true } })
      setMinimum('')
      setMaximum('')
      setIncludeUnknown(true)
      setVolumeError('')
    } else onChange({ ...filters, [field]: null })
  }

  const applyVolume = () => {
    const min = minimum.trim() === '' ? null : Number(minimum)
    const max = maximum.trim() === '' ? null : Number(maximum)
    if (
      minimumInput.current?.validity.badInput ||
      maximumInput.current?.validity.badInput ||
      (min !== null && (!Number.isFinite(min) || min < 0)) ||
      (max !== null && (!Number.isFinite(max) || max < 0))
    ) {
      setVolumeError('0 이상의 올바른 체적 숫자를 입력해주세요.')
      return
    }
    if (min !== null && max !== null && min > max) {
      setVolumeError('최소 체적은 최대 체적보다 클 수 없습니다.')
      return
    }
    onChange({ ...filters, volume: { min, max, includeUnknown } })
    close(true)
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`metric-icon building-metric-filter-trigger ${colorClass}`}
        data-active={active ? 'true' : undefined}
        aria-label={`${title} 필터`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? dialogId : undefined}
        title={`${title} 필터${active ? ' · 적용 중' : ''}`}
        onClick={() => (open ? close() : openPanel())}
      >
        {icon}
        {active && <span className="building-metric-filter-dot" aria-hidden="true" />}
      </button>
      {open &&
        createPortal(
          <dialog
            ref={panel}
            id={dialogId}
            open
            aria-label={`${title} 필터`}
            className="building-metric-filter-popover"
          >
            <div className="building-metric-filter-heading">
              <div>
                <h2>{title} 필터</h2>
                <p>선택 조건을 뷰어·목록·그래프에 함께 적용합니다.</p>
              </div>
              <button
                type="button"
                className="building-metric-filter-close"
                aria-label={`${title} 필터 닫기`}
                onClick={() => close(true)}
              >
                <X size={17} />
              </button>
            </div>
            {filterKey === 'members' && (
              <div
                className="building-metric-filter-tabs"
                role="tablist"
                aria-label="부재 선택 방식"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={memberTab === 'kinds'}
                  onClick={() => {
                    setMemberTab('kinds')
                    setPage(0)
                  }}
                >
                  부재 종류
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={memberTab === 'elements'}
                  onClick={() => {
                    setMemberTab('elements')
                    setPage(0)
                  }}
                >
                  개별 부재
                </button>
              </div>
            )}
            <div className="building-metric-filter-body">
              {filterKey === 'volume' ? (
                <>
                  <p className="building-metric-filter-summary">
                    부재별 체적을 m³ 기준으로 비교합니다. 빈칸은 범위 제한이 없습니다.
                  </p>
                  <div className="building-metric-volume-fields">
                    <label>
                      최소 체적 (m³)
                      <input
                        ref={minimumInput}
                        type="number"
                        min={0}
                        step="any"
                        value={minimum}
                        onChange={(event) => {
                          setMinimum(event.target.value)
                          setVolumeError('')
                        }}
                      />
                    </label>
                    <label>
                      최대 체적 (m³)
                      <input
                        ref={maximumInput}
                        type="number"
                        min={0}
                        step="any"
                        value={maximum}
                        onChange={(event) => {
                          setMaximum(event.target.value)
                          setVolumeError('')
                        }}
                      />
                    </label>
                  </div>
                  <label className="building-metric-volume-unknown">
                    <input
                      type="checkbox"
                      checked={includeUnknown}
                      onChange={(event) => setIncludeUnknown(event.target.checked)}
                    />
                    체적 미확인 포함
                  </label>
                  {volumeError && (
                    <p className="building-metric-filter-error" role="alert">
                      {volumeError}
                    </p>
                  )}
                  <VolumeDiagnostics elements={visibleElements} />
                </>
              ) : (
                <>
                  {individual && (
                    <label className="building-metric-filter-search">
                      <Search size={15} />
                      <input
                        type="search"
                        aria-label="개별 부재 검색"
                        placeholder="이름·ID로 검색"
                        value={query}
                        onChange={(event) => {
                          setQuery(event.target.value)
                          setPage(0)
                        }}
                      />
                    </label>
                  )}
                  <div className="building-metric-filter-actions">
                    <button type="button" onClick={() => onChange({ ...filters, [field]: null })}>
                      전체 선택
                    </button>
                    <button type="button" onClick={() => onChange({ ...filters, [field]: [] })}>
                      전체 해제
                    </button>
                    <span>
                      {filters[field] === null
                        ? '전체 선택됨'
                        : `${formatCount(filters[field].length)}개 선택`}
                    </span>
                  </div>
                  {filterKey === 'members' && (
                    <p className="building-metric-filter-summary">
                      부재 종류와 개별 부재 조건을 함께 적용합니다.
                    </p>
                  )}
                  <div className="building-metric-filter-options">
                    {rows.length ? (
                      rows.map((option) => (
                        <label key={option.value} className="building-metric-filter-option">
                          <input
                            type="checkbox"
                            aria-label={
                              individual ? `${option.label} (${option.value})` : option.label
                            }
                            checked={selected === null || selected.has(option.value)}
                            onChange={(event) => toggle(option.value, event.target.checked)}
                          />
                          <span>
                            {option.label}
                            {option.meta && <small>{option.meta}</small>}
                          </span>
                          {!individual && <em>{formatCount(option.count)}개</em>}
                        </label>
                      ))
                    ) : (
                      <p className="building-metric-filter-empty">
                        {individual && query ? '검색 결과가 없습니다.' : '선택할 항목이 없습니다.'}
                      </p>
                    )}
                  </div>
                  {individual && pageCount > 1 && (
                    <nav
                      className="building-metric-filter-pages"
                      aria-label="개별 부재 필터 페이지"
                    >
                      <button
                        type="button"
                        aria-label="이전 부재 선택 페이지"
                        disabled={currentPage === 0}
                        onClick={() => setPage(currentPage - 1)}
                      >
                        <ChevronLeft size={15} />
                      </button>
                      <span>
                        {currentPage * PAGE_SIZE + 1}–
                        {Math.min((currentPage + 1) * PAGE_SIZE, searchedElements.length)} /{' '}
                        {formatCount(searchedElements.length)}개
                      </span>
                      <button
                        type="button"
                        aria-label="다음 부재 선택 페이지"
                        disabled={currentPage === pageCount - 1}
                        onClick={() => setPage(currentPage + 1)}
                      >
                        <ChevronRight size={15} />
                      </button>
                    </nav>
                  )}
                  <p className="building-metric-filter-summary">
                    선택지는 전체 모델 기준이며, 여러 카드의 조건을 함께 적용합니다.
                  </p>
                </>
              )}
            </div>
            <div className="building-metric-filter-footer">
              <button type="button" onClick={reset}>
                <RotateCcw size={13} />이 필터 초기화
              </button>
              <button
                type="button"
                className="button primary"
                onClick={filterKey === 'volume' ? applyVolume : () => close(true)}
              >
                {filterKey === 'volume' ? '적용' : '완료'}
              </button>
            </div>
          </dialog>,
          document.body,
        )}
    </>
  )
}
