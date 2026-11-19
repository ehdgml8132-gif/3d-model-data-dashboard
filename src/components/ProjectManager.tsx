import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  Archive,
  Check,
  Copy,
  Download,
  FileBox,
  FolderOpen,
  LoaderCircle,
  Save,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import type { ProjectSnapshot, ProjectSummary, SavedProject } from '../projects/types'
import {
  buildProjectRecord,
  deleteProject,
  listProjects,
  readProject,
  summarizeProject,
  writeProject,
} from '../projects/storage'
import { decodeProjectDocument } from '../projects/html'
import { exportProjectHtml } from '../projects/standalone'
import './project-manager.css'

type Props = {
  available: boolean
  disabled: boolean
  current: ProjectSummary | null
  currentStored?: boolean
  getSnapshot: () => ProjectSnapshot
  onOpened: (record: SavedProject, source?: 'browser' | 'file') => Promise<void>
  onOpenSample: () => void
  onSaved: (summary: ProjectSummary) => void
  onDeleted?: (id: string) => void
  onCancelOpen: () => void
  progress: { percent: number; message: string } | null
}
type Modal = 'name' | 'open' | null
type NameAction = 'save' | 'copy' | 'export'
type Operation = 'save' | 'open' | 'export' | 'delete' | null

const SAMPLE_NAME = '기본 건물 샘플'
const dateFormat = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  dateStyle: 'medium',
  timeStyle: 'short',
})
function savedTime(value: string) {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? dateFormat.format(date) : '저장 시간 확인 불가'
}
function fileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 }).format(bytes / (1024 * 1024))} MB`
}
function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback
}
function isCancellation(cause: unknown) {
  return cause instanceof Error && cause.name === 'AbortError'
}
function downloadName(name: string) {
  const safe = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 100)
  return `${safe || '프로젝트'}.html`
}

export default function ProjectManager({
  available,
  disabled,
  current,
  currentStored = true,
  getSnapshot,
  onOpened,
  onOpenSample,
  onSaved,
  onDeleted,
  onCancelOpen,
  progress,
}: Props) {
  const [modal, setModal] = useState<Modal>(null)
  const [nameAction, setNameAction] = useState<NameAction>('save')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState<Operation>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [storageError, setStorageError] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set())
  const [cancelPending, setCancelPending] = useState(false)
  const nameDialog = useRef<HTMLDialogElement>(null)
  const openDialog = useRef<HTMLDialogElement>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const mounted = useRef(true)
  const operation = useRef(0)
  const listRequest = useRef(0)
  const cancelRequested = useRef(false)
  const downloadUrls = useRef(new Set<string>())
  const stored = Boolean(current && currentStored && !deletedIds.has(current.id))
  const blocked = disabled || busy !== null
  const nameTitle =
    nameAction === 'copy'
      ? '다른 이름으로 저장'
      : nameAction === 'export'
        ? '프로젝트 파일 내보내기'
        : '프로젝트 저장'

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      operation.current++
      listRequest.current++
      for (const url of downloadUrls.current) URL.revokeObjectURL(url)
      downloadUrls.current.clear()
    }
  }, [])

  useEffect(() => {
    if (!modal) return
    const dialog = modal === 'name' ? nameDialog.current : openDialog.current
    if (!dialog) return
    if (!dialog.open) dialog.showModal()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const frame = requestAnimationFrame(() => {
      if (modal === 'name') {
        nameInput.current?.focus()
        nameInput.current?.select()
      }
    })
    return () => {
      cancelAnimationFrame(frame)
      document.body.style.overflow = previousOverflow
    }
  }, [modal])

  function rememberFocus() {
    returnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
  }
  function closeModal() {
    setModal(null)
    setDeleteId(null)
    setError('')
    if (modal)
      requestAnimationFrame(() => {
        if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true })
      })
  }
  function requestClose() {
    if (busy === 'open') {
      cancelRequested.current = true
      setCancelPending(true)
      onCancelOpen()
      return
    }
    if (busy) return
    closeModal()
  }

  async function refreshList() {
    const request = ++listRequest.current
    setListLoading(true)
    setStorageError('')
    try {
      const items = await listProjects()
      if (mounted.current && request === listRequest.current) setProjects(items)
    } catch (cause) {
      if (mounted.current && request === listRequest.current)
        setStorageError(errorMessage(cause, '저장한 프로젝트 목록을 읽지 못했습니다.'))
    } finally {
      if (mounted.current && request === listRequest.current) setListLoading(false)
    }
  }

  function beginName(action: NameAction) {
    rememberFocus()
    setError('')
    setNotice('')
    setNameAction(action)
    try {
      const seed = current?.name || getSnapshot().ifcFile.name.replace(/\.ifc$/i, '')
      setName((action === 'copy' ? `${seed} 사본` : seed).slice(0, 120))
      setModal('name')
    } catch (cause) {
      setError(errorMessage(cause, '저장할 IFC 모델을 먼저 불러와 주세요.'))
    }
  }

  async function saveSnapshot(projectName: string, copy: boolean) {
    const token = ++operation.current
    setBusy('save')
    setError('')
    setNotice('')
    try {
      const previous = !copy && stored && current ? current : undefined
      const record = buildProjectRecord(projectName, getSnapshot(), previous)
      await writeProject(record)
      if (!mounted.current || token !== operation.current) return
      onSaved(summarizeProject(record))
      setNotice(`‘${record.name}’ 프로젝트를 이 브라우저에 저장했습니다.`)
      closeModal()
    } catch (cause) {
      if (mounted.current && token === operation.current)
        setError(
          errorMessage(
            cause,
            '프로젝트를 저장하지 못했습니다. 파일로 내보내기를 이용할 수 있습니다.',
          ),
        )
    } finally {
      if (mounted.current && token === operation.current) setBusy(null)
    }
  }

  async function exportSnapshot(projectName: string) {
    const token = ++operation.current
    setBusy('export')
    setError('')
    setNotice('')
    try {
      const record = buildProjectRecord(projectName, getSnapshot(), current ?? undefined)
      const blob = await exportProjectHtml(record)
      if (!mounted.current || token !== operation.current) return
      const url = URL.createObjectURL(blob)
      downloadUrls.current.add(url)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = downloadName(record.name)
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => {
        URL.revokeObjectURL(url)
        downloadUrls.current.delete(url)
      }, 30_000)
      setNotice(
        `‘${record.name}’ HTML 파일을 내려받았습니다. 파일을 브라우저에서 열면 현재 화면이 복원됩니다.`,
      )
      closeModal()
    } catch (cause) {
      if (mounted.current && token === operation.current)
        setError(errorMessage(cause, '프로젝트 파일을 만들지 못했습니다.'))
    } finally {
      if (mounted.current && token === operation.current) setBusy(null)
    }
  }

  function submitName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const projectName = name.trim()
    if (!projectName || projectName.length > 120) {
      setError('프로젝트 이름을 1~120자로 입력해 주세요.')
      return
    }
    if (nameAction === 'export') void exportSnapshot(projectName)
    else void saveSnapshot(projectName, nameAction === 'copy')
  }

  function openLibrary() {
    rememberFocus()
    setError('')
    setNotice('')
    setDeleteId(null)
    setModal('open')
    void refreshList()
  }

  async function openRecord(load: () => Promise<SavedProject>, source: 'browser' | 'file') {
    const token = ++operation.current
    cancelRequested.current = false
    setCancelPending(false)
    setBusy('open')
    setError('')
    setNotice('')
    try {
      const record = await load()
      if (cancelRequested.current)
        throw new DOMException('프로젝트 열기를 취소했습니다.', 'AbortError')
      await onOpened(record, source)
      if (!mounted.current || token !== operation.current) return
      setNotice(
        source === 'file'
          ? `‘${record.name}’ 파일을 열었습니다. 저장 목록에 남기려면 프로젝트 저장을 눌러주세요.`
          : `‘${record.name}’ 프로젝트를 열었습니다.`,
      )
      closeModal()
    } catch (cause) {
      if (mounted.current && token === operation.current) {
        if (cancelRequested.current || isCancellation(cause))
          setError('프로젝트 열기를 취소했습니다. 기존 화면은 유지됩니다.')
        else setError(errorMessage(cause, '프로젝트를 열지 못했습니다. 기존 화면은 유지됩니다.'))
      }
    } finally {
      if (mounted.current && token === operation.current) {
        setBusy(null)
        setCancelPending(false)
      }
    }
  }

  async function importFile(file?: File) {
    if (fileInput.current) fileInput.current.value = ''
    if (!file || busy || disabled) return
    if (!modal) rememberFocus()
    setModal('open')
    await openRecord(() => decodeProjectDocument(file), 'file')
  }

  async function removeProject(project: ProjectSummary) {
    const token = ++operation.current
    setBusy('delete')
    setError('')
    try {
      await deleteProject(project.id)
      if (!mounted.current || token !== operation.current) return
      setProjects((items) => items.filter((item) => item.id !== project.id))
      setDeletedIds((ids) => new Set([...ids, project.id]))
      onDeleted?.(project.id)
      setDeleteId(null)
      setNotice(`‘${project.name}’ 저장본을 삭제했습니다. 열려 있는 작업 화면은 유지됩니다.`)
    } catch (cause) {
      if (mounted.current && token === operation.current)
        setError(errorMessage(cause, '저장한 프로젝트를 삭제하지 못했습니다.'))
    } finally {
      if (mounted.current && token === operation.current) setBusy(null)
    }
  }

  const progressView = busy && (
    <div className="project-operation-progress" role="status">
      <LoaderCircle size={17} className="spin" />
      <div>
        <strong>
          {busy === 'open'
            ? cancelPending
              ? '프로젝트 열기를 취소하고 있습니다.'
              : progress?.message || '프로젝트를 불러오고 있습니다.'
            : busy === 'save'
              ? '프로젝트를 저장하고 있습니다.'
              : busy === 'export'
                ? '프로젝트 파일을 만들고 있습니다.'
                : '저장본을 삭제하고 있습니다.'}
        </strong>
        {busy === 'open' && progress && <progress max={100} value={progress.percent} />}
      </div>
      {busy === 'open' && (
        <button className="button secondary" disabled={cancelPending} onClick={requestClose}>
          불러오기 취소
        </button>
      )}
    </div>
  )

  return (
    <>
      <section className="project-toolbar" aria-label="프로젝트 작업공간">
        <div className="project-identity">
          <span className="project-identity-icon">
            <Archive size={19} />
          </span>
          <div className="project-identity-copy">
            <strong data-testid="current-project-name">
              {current?.name ?? (available ? '저장되지 않은 프로젝트' : SAMPLE_NAME)}
            </strong>
            <small>
              {current
                ? stored
                  ? `이 브라우저에 저장 · 마지막 저장 ${savedTime(current.updatedAt)}`
                  : '저장되지 않은 작업본 · 이 브라우저에는 아직 저장되지 않았습니다.'
                : available
                  ? 'IFC·업무 데이터·필터·화면 상태를 이름 붙여 보관하세요.'
                  : 'IFC 모델을 불러오면 새 프로젝트로 자동 저장됩니다.'}
            </small>
          </div>
        </div>
        <div className="project-toolbar-actions">
          <button
            className="button secondary project-compact-button"
            disabled={!available || blocked}
            onClick={() =>
              stored && current ? void saveSnapshot(current.name, false) : beginName('save')
            }
          >
            <Save size={14} /> 프로젝트 저장
          </button>
          <button
            className="button secondary project-compact-button"
            disabled={!available || blocked}
            onClick={() => beginName('copy')}
          >
            <Copy size={14} /> 다른 이름으로 저장
          </button>
          <button
            className="button secondary project-compact-button"
            disabled={blocked}
            onClick={openLibrary}
          >
            <FolderOpen size={14} /> 프로젝트 열기
          </button>
          <button
            className="button secondary project-compact-button"
            disabled={!available || blocked}
            onClick={() => (current ? void exportSnapshot(current.name) : beginName('export'))}
          >
            <Download size={14} /> 파일로 내보내기
          </button>
        </div>
      </section>
      {notice && (
        <p className="project-save-state" role="status">
          <Check size={14} />
          {notice}
        </p>
      )}
      {!modal && error && (
        <p className="project-status" data-tone="error" role="alert">
          {error}
        </p>
      )}
      {!modal && progressView}
      <input
        ref={fileInput}
        className="file-input"
        type="file"
        accept=".html,.htm,.monospace,text/html,application/octet-stream"
        aria-label="프로젝트 파일 선택"
        onChange={(event) => void importFile(event.target.files?.[0])}
      />

      {modal === 'name' && (
        <dialog
          ref={nameDialog}
          className="modal project-modal project-name-modal"
          aria-label={nameTitle}
          onCancel={(event) => {
            event.preventDefault()
            requestClose()
          }}
        >
          <form onSubmit={submitName}>
            <div className="modal-heading">
              <div>
                <span className="eyebrow">PROJECT WORKSPACE</span>
                <h2>{nameTitle}</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="프로젝트 저장 창 닫기"
                disabled={busy !== null}
                onClick={requestClose}
              >
                <X size={20} />
              </button>
            </div>
            <p className="modal-description project-modal-description">
              {nameAction === 'export'
                ? '현재 IFC와 업무 데이터, 화면 상태를 브라우저에서 바로 열 수 있는 HTML 파일로 내려받습니다.'
                : nameAction === 'copy'
                  ? '현재 화면을 새 프로젝트로 저장합니다. 기존 저장본은 그대로 남습니다.'
                  : '현재 IFC와 업무 데이터, 화면 상태를 이 브라우저에 저장합니다.'}
            </p>
            <label className="project-name-field">
              프로젝트 이름
              <input
                ref={nameInput}
                value={name}
                maxLength={120}
                disabled={busy !== null}
                onChange={(event) => {
                  setName(event.target.value)
                  setError('')
                }}
                required
              />
            </label>
            <p className="project-name-note">
              필터·검색·선택·단면상자·시점을 함께 보관합니다. 변경 후에는 다시 저장해 주세요.
            </p>
            {error && (
              <p className="project-status" data-tone="error" role="alert">
                {error}
              </p>
            )}
            {progressView}
            <div className="project-modal-actions">
              <button
                className="button secondary"
                type="button"
                disabled={busy !== null}
                onClick={requestClose}
              >
                취소
              </button>
              <button
                className="button primary"
                type="submit"
                disabled={busy !== null || !name.trim()}
              >
                {busy ? (
                  <LoaderCircle size={15} className="spin" />
                ) : nameAction === 'export' ? (
                  <Download size={15} />
                ) : (
                  <Save size={15} />
                )}
                {nameAction === 'export' ? '내보내기' : '저장'}
              </button>
            </div>
          </form>
        </dialog>
      )}

      {modal === 'open' && (
        <dialog
          ref={openDialog}
          className="modal project-modal"
          aria-label="프로젝트 열기"
          onCancel={(event) => {
            event.preventDefault()
            requestClose()
          }}
        >
          <div className="modal-heading">
            <div>
              <span className="eyebrow">SAVED PROJECTS</span>
              <h2>프로젝트 열기</h2>
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label="프로젝트 열기 창 닫기"
              disabled={busy !== null && busy !== 'open'}
              onClick={requestClose}
            >
              <X size={20} />
            </button>
          </div>
          <p className="modal-description project-modal-description">
            기본 건물 샘플, 이 브라우저에 저장한 프로젝트, 내려받은 프로젝트 파일을 열 수 있습니다.
          </p>
          <div className="project-file-actions">
            <button
              type="button"
              className="button secondary"
              disabled={blocked}
              onClick={() => fileInput.current?.click()}
            >
              <Upload size={15} /> 프로젝트 파일 열기
            </button>
            <span>.html · IFC와 연결 데이터 포함 · 기존 .monospace 파일도 열 수 있습니다.</span>
          </div>
          {error && (
            <p className="project-status" data-tone="error" role="alert">
              {error}
            </p>
          )}
          {progressView}
          <div className="project-list-item">
            <div className="project-list-info">
              <strong>{SAMPLE_NAME}</strong>
              <span>3층 사무동 예제</span>
            </div>
            <div className="project-list-actions">
              <button
                type="button"
                className="button primary"
                aria-label={`${SAMPLE_NAME} 열기`}
                disabled={blocked}
                onClick={() => {
                  onOpenSample()
                  closeModal()
                }}
              >
                <FolderOpen size={14} />
                열기
              </button>
            </div>
          </div>
          <div className="project-modal-subheading">
            <h3>이 브라우저의 저장 목록</h3>
            <button
              type="button"
              className="text-button"
              disabled={busy !== null || listLoading}
              onClick={() => void refreshList()}
            >
              목록 다시 읽기
            </button>
          </div>
          {storageError && (
            <p className="project-list-error" role="alert">
              {storageError} 프로젝트 파일로 열기는 계속 사용할 수 있습니다.
            </p>
          )}
          {listLoading ? (
            <div className="project-empty" role="status">
              <LoaderCircle className="spin" size={22} />
              <p>저장 목록을 읽고 있습니다.</p>
            </div>
          ) : projects.length ? (
            <div className="project-list">
              {projects.map((project) => (
                <article
                  key={project.id}
                  className="project-list-item"
                  aria-label={`${project.name} 프로젝트`}
                  data-current={stored && current?.id === project.id}
                >
                  <div className="project-list-info">
                    <strong>{project.name}</strong>
                    <span>
                      <FileBox size={13} />
                      {project.ifcName}
                    </span>
                    <small>
                      {savedTime(project.updatedAt)} · {fileSize(project.ifcBytes)} · 부재{' '}
                      {new Intl.NumberFormat('ko-KR').format(project.elementCount)}개
                    </small>
                  </div>
                  <div className="project-list-actions">
                    <button
                      type="button"
                      className="button primary"
                      aria-label={`${project.name} 열기`}
                      disabled={blocked}
                      onClick={() => void openRecord(() => readProject(project.id), 'browser')}
                    >
                      <FolderOpen size={14} />
                      열기
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`${project.name} 삭제`}
                      disabled={blocked}
                      onClick={() => setDeleteId(project.id)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  {deleteId === project.id && (
                    <div className="project-delete-confirm">
                      <span>‘{project.name}’ 저장본을 삭제할까요?</span>
                      <button type="button" disabled={blocked} onClick={() => setDeleteId(null)}>
                        취소
                      </button>
                      <button
                        type="button"
                        data-danger="true"
                        disabled={blocked}
                        onClick={() => void removeProject(project)}
                      >
                        저장본 삭제
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          ) : !storageError ? (
            <div className="project-empty">
              <FolderOpen size={27} />
              <strong>저장한 프로젝트가 없습니다.</strong>
              <p>IFC를 불러오면 이 목록에 새 프로젝트가 추가됩니다.</p>
            </div>
          ) : null}
          <p className="project-storage-note">
            저장 목록은 현재 브라우저에만 보관됩니다. 다른 기기에서 열거나 별도로 보관하려면 파일로
            내보내기를 이용하세요. 브라우저 데이터를 삭제하면 이 목록도 삭제됩니다.
          </p>
          <div className="project-modal-actions">
            <button
              className="button secondary"
              type="button"
              disabled={busy !== null && busy !== 'open'}
              onClick={requestClose}
            >
              {busy === 'open' ? '불러오기 취소' : '닫기'}
            </button>
          </div>
        </dialog>
      )}
    </>
  )
}
