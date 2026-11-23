import {
  Component,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  Box,
  Building2,
  Check,
  ChevronRight,
  Cuboid,
  Database,
  Link2,
  Layers3,
  LoaderCircle,
  MousePointer2,
  RotateCcw,
  Scan,
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
import type { IfcModel, IfcVolumeIssue } from '../ifc/types'
import BusinessDataPanel, { type BusinessConnection } from './BusinessDataPanel'
import BuildingAnalytics, { BuildingAnalyticsNote } from './BuildingAnalytics'
import BuildingMetricFilter from './BuildingMetricFilter'
import ProjectManager from './ProjectManager'
import ViewerCube from './ViewerCube'
import type { ViewerDirection } from './ViewerDirectionCamera'
import { joinBusinessRows } from '../lib/business'
import { buildProjectRecord, summarizeProject, writeProject } from '../projects/storage'
import { embeddedProjectToOpen, finishEmbeddedProject } from '../projects/standalone'
import type {
  ProjectCamera,
  ProjectSnapshot,
  ProjectSummary,
  SavedProject,
} from '../projects/types'
import {
  createBuildingMetricFilters,
  filterBuildingMetricElements,
  hasBuildingMetricFilters,
  type BuildingMetricFilters,
} from '../lib/buildingFilters'
import { fullSectionRanges, type SectionBoxSettings } from '../lib/sectionBox'
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
  volumeIssue?: IfcVolumeIssue
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

export default function BuildingDashboard() {
  const exportedProject = document.documentElement.dataset.monospaceProject === '1'
  const [metricFilters, setMetricFilters] = useSessionState<BuildingMetricFilters>(
    'building:metric-filters',
    createBuildingMetricFilters,
  )
  const floor = metricFilters.floors?.length === 1 ? metricFilters.floors[0] : 'all'
  const [activeView, setActiveView] = useSessionState<'space' | 'data'>('building:view', 'space')
  const [kind, setKind] = useSessionState<DisplayKind | 'all'>('building:kind', 'all')
  const [query, setQuery] = useSessionState('building:query', '')
  const [selectedId, setSelectedId] = useSessionState('building:selected', '')
  const [sectionBox, setSectionBox] = useSessionState<SectionBoxSettings | null>(
    'building:section-box',
    null,
  )
  const [sectionBoxSelected, setSectionBoxSelected] = useState(false)
  const clearSelection = useCallback(() => {
    setSelectedId('')
    setSectionBoxSelected(false)
  }, [setSelectedId])
  const [resetKey, setResetKey] = useState(0)
  const [ifcModel, setIfcModel] = useSessionState<IfcModel | null>('building:model', null)
  const [ifcTransparency, setIfcTransparency] = useState(0)
  const [sourceIfcFile, setSourceIfcFile] = useSessionState<File | null>('building:ifc-file', null)
  const [currentProject, setCurrentProject] = useSessionState<ProjectSummary | null>(
    'building:project',
    null,
  )
  const [currentProjectStored, setCurrentProjectStored] = useSessionState(
    'building:project-stored',
    false,
  )
  const [cameraPose, setCameraPose] = useSessionState<ProjectCamera | null>('building:camera', null)
  const [cameraRestoreKey, setCameraRestoreKey] = useState(0)
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
  const cameraGeneration = useRef(0)
  const cameraCapture = useRef<(() => ProjectCamera) | null>(null)
  const directionControl = useRef<((direction: ViewerDirection) => void) | null>(null)
  const [viewerDirection, setViewerDirection] = useState<ViewerDirection | null>(null)
  const restoredTablePage = useRef<number | null>(null)
  const reportCamera = useCallback(
    (pose: ProjectCamera) => {
      if (cameraGeneration.current === modelVersion) setCameraPose(pose)
    },
    [modelVersion, setCameraPose],
  )
  const elements: DisplayElement[] = useMemo(
    () => ifcModel?.elements ?? SAMPLE_ELEMENTS,
    [ifcModel],
  )
  const floors = useMemo(() => [...new Set(elements.map((element) => element.floor))], [elements])
  const spatialElements = useMemo(
    () => filterBuildingMetricElements(elements, metricFilters),
    [elements, metricFilters],
  )
  const dataElements = useMemo(
    () =>
      spatialElements.filter(
        (element) =>
          (kind === 'all' || element.kind === kind) &&
          `${element.id} ${element.name} ${element.ifcClass} ${element.material} ${element.globalId} ${element.tag ?? ''}`
            .toLocaleLowerCase()
            .includes(query.toLocaleLowerCase().trim()),
      ),
    [spatialElements, kind, query],
  )
  const visible = activeView === 'data' ? dataElements : spatialElements
  const pageCount = ifcModel ? Math.max(1, Math.ceil(visible.length / IFC_TABLE_PAGE_SIZE)) : 1
  const currentPage = Math.min(tablePage, pageCount - 1)
  const tableElements = ifcModel
    ? visible.slice(currentPage * IFC_TABLE_PAGE_SIZE, (currentPage + 1) * IFC_TABLE_PAGE_SIZE)
    : visible
  const selected = spatialElements.find((element) => element.id === selectedId)
  const summary = useMemo(() => summarize(visible), [visible])
  const fullSummary = useMemo(() => summarize(elements), [elements])
  const maxKindVolume = Math.max(1, ...summary.byKind.map((row) => row.volume))
  const hasMetricFilters = hasBuildingMetricFilters(metricFilters)
  const filterLabels = [
    metricFilters.kinds !== null ? `부재 종류 ${metricFilters.kinds.length}개` : '',
    metricFilters.elementIds !== null ? `개별 부재 ${metricFilters.elementIds.length}개` : '',
    metricFilters.floors !== null ? `층 ${metricFilters.floors.length}개` : '',
    metricFilters.materials !== null ? `재료 ${metricFilters.materials.length}개` : '',
    metricFilters.volume.min !== null || metricFilters.volume.max !== null
      ? `체적 ${metricFilters.volume.min ?? 0} ~ ${metricFilters.volume.max ?? '제한 없음'} m³`
      : '',
    !metricFilters.volume.includeUnknown ? '체적 미확인 제외' : '',
  ].filter(Boolean)
  useEffect(() => {
    if (selectedId && !selected) clearSelection()
  }, [selected, selectedId, clearSelection])
  useEffect(() => {
    setTablePage(restoredTablePage.current ?? 0)
    restoredTablePage.current = null
  }, [ifcModel, metricFilters, activeView, kind, query])
  useEffect(() => setSectionBoxSelected(false), [activeView, metricFilters])
  useEffect(() => {
    const deselect = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return
      if (
        event.target instanceof HTMLInputElement &&
        event.target.hasAttribute('data-section-rotation-input')
      )
        return
      clearSelection()
    }
    window.addEventListener('keydown', deselect, true)
    return () => window.removeEventListener('keydown', deselect, true)
  }, [clearSelection])
  useEffect(
    () => () => {
      importRequest.current?.controller.abort()
      importRequest.current = null
    },
    [],
  )

  async function importIfc(file?: File) {
    if (!file) return
    if (ifcInput.current) ifcInput.current.value = ''
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
      const workspace: ProjectSnapshot['workspace'] = {
        activeView,
        metricFilters: createBuildingMetricFilters(),
        kind: 'all',
        query: '',
        selectedId: '',
        sectionBox: null,
        camera: null,
        tablePage: 0,
      }
      let saved: ProjectSummary | null = null
      let saveError = ''
      if (!exportedProject) {
        setProgress({ percent: 100, message: 'IFC 모델을 새 프로젝트로 저장하고 있습니다.' })
        try {
          const name =
            file.name
              .replace(/\.ifc$/i, '')
              .trim()
              .slice(0, 120) || 'IFC 프로젝트'
          const record = buildProjectRecord(name, {
            ifcFile: file,
            elementCount: model.elements.length,
            business: null,
            workspace,
          })
          await writeProject(record, controller.signal)
          saved = summarizeProject(record)
        } catch (cause) {
          saveError =
            cause instanceof Error
              ? cause.message
              : '프로젝트 저장을 다시 시도하거나 파일로 내보내 주세요.'
        }
      }
      if (controller.signal.aborted || importRequest.current?.token !== token) return

      cameraGeneration.current += 1
      setIfcModel(model)
      setIfcTransparency(0)
      setSourceIfcFile(file)
      setCurrentProject(saved)
      setCurrentProjectStored(saved !== null)
      setCameraPose(workspace.camera)
      setSectionBox(workspace.sectionBox)
      setSectionBoxSelected(false)
      setModelVersion((value) => value + 1)
      setBusiness(null)
      setBusinessOpen(false)
      setMetricFilters(workspace.metricFilters)
      setKind(workspace.kind)
      setQuery(workspace.query)
      setSelectedId(workspace.selectedId)
      setTablePage(workspace.tablePage)
      setResetKey((value) => value + 1)
      if (saveError) setImportError(`IFC 모델을 열었지만 자동 저장하지 못했습니다. ${saveError}`)
      else
        setImportNotice(
          saved
            ? `‘${saved.name}’ 프로젝트를 이 브라우저에 저장했습니다. ‘프로젝트 열기’에서 다시 열 수 있습니다.`
            : `${model.name} 모델을 불러왔습니다.`,
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
    cameraGeneration.current += 1
    setIfcModel(null)
    setIfcTransparency(0)
    setSourceIfcFile(null)
    setCurrentProject(null)
    setCurrentProjectStored(false)
    setCameraPose(null)
    setSectionBox(null)
    setSectionBoxSelected(false)
    setModelVersion((value) => value + 1)
    setBusiness(null)
    setBusinessOpen(false)
    clearFilters()
    setActiveView('space')
    setSelectedId('')
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
    setMetricFilters(createBuildingMetricFilters())
    setKind('all')
    setQuery('')
  }
  function showHome() {
    clearFilters()
    setActiveView('space')
  }
  function selectElement(id: string) {
    setSelectedId(id)
    setSectionBoxSelected(false)
    setActiveView('space')
  }

  function selectInViewer(id: string) {
    setSelectedId(id)
    setSectionBoxSelected(false)
  }

  function projectSnapshot(): ProjectSnapshot {
    if (!ifcModel || !sourceIfcFile) throw new Error('저장할 IFC 모델을 먼저 업로드해 주세요.')
    return {
      ifcFile: sourceIfcFile,
      elementCount: ifcModel.elements.length,
      business: business
        ? {
            fileName: business.fileName,
            table: business.table,
            modelKey: business.modelKey,
            column: business.column,
          }
        : null,
      workspace: {
        activeView,
        metricFilters,
        kind,
        query,
        selectedId,
        sectionBox,
        camera: cameraCapture.current?.() ?? cameraPose,
        tablePage: currentPage,
      },
    }
  }

  async function openProject(record: SavedProject, source: 'browser' | 'file' = 'browser') {
    importRequest.current?.controller.abort()
    const controller = new AbortController()
    const token = ++importToken.current
    importRequest.current = { controller, token }
    setImportError('')
    setImportNotice('')
    setProgress({ percent: 0, message: '저장한 프로젝트의 IFC 모델을 불러옵니다.' })
    try {
      const snapshot = record.snapshot
      const model = await loadIfcFile(snapshot.ifcFile, {
        signal: controller.signal,
        onProgress: (next) => {
          if (importRequest.current?.token === token) setProgress(next)
        },
      })
      if (controller.signal.aborted || importRequest.current?.token !== token)
        throw new DOMException('프로젝트 불러오기를 취소했습니다.', 'AbortError')
      const savedBusiness = snapshot.business
      const restoredBusiness: BusinessConnection | null = savedBusiness
        ? {
            ...savedBusiness,
            result: joinBusinessRows(model.elements, savedBusiness.table, {
              modelKey: savedBusiness.modelKey,
              column: savedBusiness.column,
            }),
          }
        : null
      // Prepare the complete model and join before replacing the current workspace.
      cameraGeneration.current += 1
      restoredTablePage.current = snapshot.workspace.tablePage
      setIfcModel(model)
      setIfcTransparency(0)
      setSourceIfcFile(snapshot.ifcFile)
      setBusiness(restoredBusiness)
      setBusinessOpen(false)
      setMetricFilters(snapshot.workspace.metricFilters)
      setKind(snapshot.workspace.kind)
      setQuery(snapshot.workspace.query)
      setActiveView(snapshot.workspace.activeView)
      setSelectedId(snapshot.workspace.selectedId)
      setSectionBox(snapshot.workspace.sectionBox)
      setSectionBoxSelected(false)
      setCameraPose(snapshot.workspace.camera)
      setCameraRestoreKey((value) => value + 1)
      setModelVersion((value) => value + 1)
      setResetKey((value) => value + 1)
      setCurrentProject(summarizeProject(record))
      setCurrentProjectStored(source === 'browser')
      setImportNotice(`${record.name} 프로젝트를 열었습니다.`)
    } finally {
      if (importRequest.current?.token === token) {
        importRequest.current = null
        setProgress(null)
      }
    }
  }

  useEffect(() => {
    const embedded = embeddedProjectToOpen()
    if (!embedded) return
    let active = true
    const controller = new AbortController()
    const token = ++importToken.current
    importRequest.current = { controller, token }
    setProgress({ percent: 0, message: 'HTML에 담긴 프로젝트를 준비하고 있습니다.' })
    void embedded
      .then(async (record) => {
        if (!active) return
        if (controller.signal.aborted || importRequest.current?.token !== token) {
          finishEmbeddedProject()
          return
        }
        // Transfer ownership without aborting the completed decode. Real IFC
        // parse failures must still reach the startup error message below.
        importRequest.current = null
        await openProject(record, 'file')
        if (active) finishEmbeddedProject()
      })
      .catch((cause: unknown) => {
        if (!active) return
        finishEmbeddedProject()
        if (controller.signal.aborted || (cause instanceof Error && cause.name === 'AbortError'))
          return
        setImportError(
          cause instanceof Error ? cause.message : 'HTML의 프로젝트를 열지 못했습니다.',
        )
      })
      .finally(() => {
        if (active && importRequest.current?.token === token) {
          importRequest.current = null
          setProgress(null)
        }
      })
    return () => {
      active = false
      if (importRequest.current?.token === token) controller.abort()
    }
  }, [])

  return (
    <div className={`app-shell building-app ${ifcModel ? 'has-ifc' : ''}`}>
      <aside className="sidebar">
        <a
          className="brand"
          href="#building"
          aria-label="공간·부재 정보 홈"
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
        <nav aria-label="대시보드" className="building-home-nav">
          <button
            className="nav-item active"
            aria-label="공간·부재 정보"
            title="공간·부재 정보"
            onClick={showHome}
          >
            <Building2 size={19} />
            공간·부재 정보
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
            </div>
          </section>
          {!exportedProject && (
            <ProjectManager
              available={ifcModel !== null && sourceIfcFile !== null}
              disabled={progress !== null}
              current={currentProject}
              currentStored={currentProjectStored}
              getSnapshot={projectSnapshot}
              onOpened={openProject}
              onOpenSample={restoreSample}
              onSaved={(summary) => {
                // A pending save may finish after another model replaces this workspace.
                if (cameraGeneration.current !== modelVersion) return
                setCurrentProject(summary)
                setCurrentProjectStored(true)
                setImportError('')
                setImportNotice('')
              }}
              onDeleted={(id) => {
                if (currentProject?.id === id) setCurrentProjectStored(false)
              }}
              onCancelOpen={cancelImport}
              progress={progress}
            />
          )}
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
            {!ifcModel && (
              <div className="building-floor-control">
                <Layers3 size={16} />
                <span>표시할 층</span>
                <div className="building-floor-buttons" role="group" aria-label="건물 층 선택">
                  <button
                    className={metricFilters.floors === null ? 'active' : ''}
                    aria-pressed={metricFilters.floors === null}
                    onClick={() => setMetricFilters((current) => ({ ...current, floors: null }))}
                  >
                    전체
                  </button>
                  {floors.map((value) => (
                    <button
                      key={value}
                      className={metricFilters.floors?.includes(value) ? 'active' : ''}
                      aria-pressed={metricFilters.floors?.includes(value) ?? false}
                      onClick={() =>
                        setMetricFilters((current) => ({ ...current, floors: [value] }))
                      }
                    >
                      {floorLabel(value)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <span className="building-filter-note">카드 아이콘을 눌러 표시 조건을 선택하세요.</span>
          </div>
          <section className="metrics building-metrics" aria-label="건물 집계 지표">
            {[
              {
                label: '표시 부재',
                filterKey: 'members' as const,
                value: `${summary.elementCount}개`,
                note: `전체 ${fullSummary.elementCount}개 중 현재 조건`,
                icon: Box,
                color: 'mint',
              },
              {
                label: '총 체적',
                filterKey: 'volume' as const,
                value:
                  summary.elementCount === 0 || summary.knownVolumeCount > 0
                    ? formatVolume(summary.totalVolume)
                    : '—',
                note: ifcModel
                  ? `체적 확인 ${summary.knownVolumeCount}개 합계 · ${summary.missingVolumeCount}개 미확인`
                  : '부재별 형상 체적의 합계',
                icon: Cuboid,
                color: 'blue',
              },
              {
                label: '표시 층',
                filterKey: 'floors' as const,
                value: `${summary.floorCount}개 층`,
                note: ifcModel ? 'IFC의 층 분류 기준 · 미지정 포함' : '지상 1층부터 3층까지',
                icon: Layers3,
                color: 'sand',
              },
              {
                label: ifcModel ? '재료 표기' : '재료 종류',
                filterKey: 'materials' as const,
                value: `${summary.byMaterial.length}종`,
                note: ifcModel ? '부재에 기록된 서로 다른 재료 표기' : '현재 표시된 부재의 재료',
                icon: Shapes,
                color: 'peach',
              },
            ].map((metric) => (
              <article key={metric.label} className="metric-card">
                <div className="metric-top">
                  <span>{metric.label}</span>
                  <BuildingMetricFilter
                    filterKey={metric.filterKey}
                    title={metric.label}
                    colorClass={metric.color}
                    icon={<metric.icon size={18} strokeWidth={1.7} />}
                    elements={elements}
                    visibleElements={visible}
                    filters={metricFilters}
                    onChange={setMetricFilters}
                  />
                </div>
                <strong>{metric.value}</strong>
                <p>
                  <span className="metric-note-dot" />
                  {metric.note}
                </p>
              </article>
            ))}
          </section>
          {hasMetricFilters && (
            <section className="building-active-filters" aria-label="적용된 카드 필터">
              <div>
                <SlidersHorizontal size={14} />
                {filterLabels.map((label) => (
                  <span key={label}>{label}</span>
                ))}
              </div>
              <button type="button" className="text-button" onClick={clearFilters}>
                <RotateCcw size={13} /> 전체 필터 초기화
              </button>
            </section>
          )}
          {activeView === 'space' && (
            <section className="building-model-grid" aria-label="건물 모델과 부재 정보">
              <div className="building-viewer-column">
                <article className="card building-scene-card">
                  <div className="card-heading">
                    <div className="heading-with-icon">
                      <Building2 size={19} />
                      <h2>{ifcModel ? '나의 건물 모델' : '모노 오피스'}</h2>
                      <span className="subtle-badge">
                        {ifcModel ? 'IFC MODEL' : 'STRUCTURE MODEL'}
                      </span>
                    </div>
                    <div className="building-viewer-tools">
                      <button
                        type="button"
                        className="building-clear-selection"
                        aria-label="선택 해제"
                        disabled={!selected && !sectionBoxSelected}
                        onClick={clearSelection}
                      >
                        <X size={13} /> 선택 해제
                      </button>
                      <label className={`building-section-toggle ${sectionBox ? 'active' : ''}`}>
                        <input
                          type="checkbox"
                          checked={sectionBox !== null}
                          onChange={(event) => {
                            setSectionBoxSelected(false)
                            setSectionBox(
                              event.target.checked
                                ? { targetId: selected?.id ?? null, ranges: fullSectionRanges() }
                                : null,
                            )
                          }}
                        />
                        단면상자
                      </label>
                      {sectionBox && (
                        <button
                          type="button"
                          className="icon-button reset-view"
                          title="단면 범위 초기화"
                          aria-label="단면 범위 초기화"
                          onClick={() =>
                            setSectionBox({ ...sectionBox, ranges: fullSectionRanges() })
                          }
                        >
                          <Scan size={14} />
                        </button>
                      )}
                      <button
                        className="icon-button reset-view"
                        title="시점 초기화"
                        aria-label="3D 건물 시점 초기화"
                        onClick={() => setResetKey((value) => value + 1)}
                      >
                        <RotateCcw size={16} />
                      </button>
                      {sectionBoxSelected && sectionBox && (
                        <button
                          type="button"
                          className="icon-button reset-view"
                          title="단면 회전 초기화"
                          aria-label="단면 회전 초기화"
                          disabled={!(sectionBox.rotationY ?? 0)}
                          onClick={() =>
                            setSectionBox((current) => current && { ...current, rotationY: 0 })
                          }
                        >
                          <RotateCcw size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="building-scene-wrap">
                    <div className="scene-caption">
                      <span className="live-dot" />
                      {ifcModel ? 'IFC MODEL' : 'MONO OFFICE'}
                      <span>
                        {metricFilters.floors === null
                          ? '전체 층'
                          : metricFilters.floors.length === 1
                            ? floorLabel(metricFilters.floors[0])
                            : `${metricFilters.floors.length}개 층`}
                      </span>
                    </div>
                    <div className="building-view-controls">
                      {visible.length > 0 && (
                        <ViewerCube
                          direction={viewerDirection}
                          onSelect={(direction) => directionControl.current?.(direction)}
                        />
                      )}
                      {ifcModel && (
                        <label className="ifc-transparency-control">
                          <span>투명도</span>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            step={5}
                            value={ifcTransparency}
                            aria-label="투명도"
                            aria-valuetext={`${ifcTransparency}%`}
                            onChange={(event) =>
                              setIfcTransparency(event.currentTarget.valueAsNumber)
                            }
                          />
                          <span aria-hidden="true">{ifcTransparency}%</span>
                        </label>
                      )}
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
                              transparency={ifcTransparency}
                              visibleIds={visibleIfcIds}
                              selectedId={selected?.id ?? ''}
                              onSelect={selectInViewer}
                              resetKey={resetKey}
                              sectionBox={sectionBox}
                              onSectionBoxChange={setSectionBox}
                              sectionBoxSelected={sectionBoxSelected}
                              onSectionBoxSelect={() => setSectionBoxSelected(true)}
                              onSectionBoxDeselect={clearSelection}
                              cameraRestore={cameraPose}
                              cameraRestoreKey={cameraRestoreKey}
                              onCameraChange={reportCamera}
                              cameraCapture={cameraCapture}
                              directionControl={directionControl}
                              onDirectionChange={setViewerDirection}
                            />
                          ) : (
                            <BuildingScene
                              elements={sampleVisible}
                              selectedId={selected?.id ?? ''}
                              onSelect={selectInViewer}
                              floor={sampleFloor}
                              resetKey={resetKey}
                              sectionBox={sectionBox}
                              onSectionBoxChange={setSectionBox}
                              sectionBoxSelected={sectionBoxSelected}
                              onSectionBoxSelect={() => setSectionBoxSelected(true)}
                              onSectionBoxDeselect={clearSelection}
                              directionControl={directionControl}
                              onDirectionChange={setViewerDirection}
                            />
                          )}
                        </Suspense>
                      </BuildingSceneBoundary>
                    ) : (
                      <div className="scene-fallback">
                        <Search size={32} />
                        <strong>표시할 부재가 없습니다.</strong>
                        <p>카드 필터나 층·검색 조건을 조정해보세요.</p>
                        <button className="button secondary" onClick={clearFilters}>
                          조건 초기화
                        </button>
                      </div>
                    )}
                    <div className="scene-hint">
                      <MousePointer2 size={13} />
                      <span>
                        {sectionBox
                          ? sectionBoxSelected
                            ? '화살표로 크기 조절 · 회전 손잡이를 드래그하거나 각도 칸을 클릭'
                            : '단면상자 윤곽선을 클릭해 크기와 회전을 조절하세요'
                          : '부재 클릭 · 드래그하여 회전 · 스크롤로 확대'}
                      </span>
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
                <BuildingAnalytics elements={spatialElements} />
              </div>
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
                            ? 'Pset의 체적·Volume 값 또는 단위를 확인할 수 없습니다.'
                            : 'Pset 체적·Volume 속성을 m³로 환산한 값입니다.'
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
                    <h2>
                      {spatialElements.length
                        ? '선택한 부재가 없습니다.'
                        : '선택할 부재가 없습니다.'}
                    </h2>
                    <p>
                      {spatialElements.length
                        ? '3D 모델이나 부재 목록에서 객체를 선택해 주세요.'
                        : '필터를 변경하면 부재의 속성을 확인할 수 있어요.'}
                    </p>
                  </div>
                )}
              </article>
              <BuildingAnalyticsNote isIfc={ifcModel !== null} />
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
                          ? ` · ${row.count - row.knownVolumeCount}개 체적 미확인`
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
                        Pset 체적·Volume을 m³로 환산해 합산합니다.
                        <br />
                        속성값이나 단위를 확인할 수 없는 부재는 —로 표시합니다.
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
                  {(query || kind !== 'all' || hasMetricFilters) && (
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
              프로젝트를 저장하면 모델과 업무 데이터, 현재 화면을 이 브라우저에서 다시 열 수
              있습니다. 다른 브라우저에서는 내보낸 프로젝트 파일을 불러와주세요.
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
