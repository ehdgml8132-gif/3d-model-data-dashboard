import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, FileSpreadsheet, Link2, LoaderCircle, X } from 'lucide-react'
import type {
  BusinessJoinResult,
  BusinessModelElement,
  BusinessTable,
  BusinessWorkbook,
} from '../business/types'
import { BUSINESS_LIMITS, joinBusinessRows, loadBusinessFile } from '../lib/business'
import './business-panel.css'

export type BusinessConnection = {
  fileName: string
  table: BusinessTable
  modelKey: 'globalId' | 'tag' | 'id'
  column: string
  result: BusinessJoinResult
}

export default function BusinessDataPanel({
  elements,
  onConnect,
  onClose,
}: {
  elements: BusinessModelElement[]
  onConnect: (connection: BusinessConnection) => void
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const request = useRef(0)
  const [workbook, setWorkbook] = useState<BusinessWorkbook | null>(null)
  const [sheetIndex, setSheetIndex] = useState(0)
  const [fileName, setFileName] = useState('')
  const [modelKey, setModelKey] = useState<'globalId' | 'tag' | 'id'>('globalId')
  const [column, setColumn] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const table = workbook?.sheets[sheetIndex]
  const result = useMemo(() => {
    if (!table || !column) return null
    try {
      return joinBusinessRows(elements, table, { modelKey, column })
    } catch {
      return null
    }
  }, [elements, table, modelKey, column])

  useEffect(() => {
    dialog.current?.showModal()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = overflow
      request.current += 1
    }
  }, [])

  async function readFile(file?: File) {
    if (!file) return
    const token = ++request.current
    setError('')
    setWorkbook(null)
    setFileName('')
    setColumn('')
    setLoading(false)
    if (fileInput.current) fileInput.current.value = ''
    if (!/\.(csv|xlsx)$/i.test(file.name)) {
      setError('CSV 또는 XLSX 파일을 선택해주세요.')
      return
    }
    if (file.size > BUSINESS_LIMITS.fileBytes) {
      setError('10MB 이하의 업무 데이터 파일을 선택해주세요.')
      return
    }
    setLoading(true)
    try {
      const next = await loadBusinessFile(file)
      if (request.current !== token) return
      if (!next.sheets.length) throw new Error('데이터가 있는 시트가 없습니다.')
      setWorkbook(next)
      setSheetIndex(0)
      setFileName(file.name)
      const firstHeaders = next.sheets[0].headers
      setColumn(
        firstHeaders.find((header) => /^(global_?id|ifc_?guid|guid)$/i.test(header)) ??
          firstHeaders[0] ??
          '',
      )
    } catch (cause) {
      if (request.current === token)
        setError(cause instanceof Error ? cause.message : '업무 데이터 파일을 읽지 못했습니다.')
    } finally {
      if (request.current === token) setLoading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  return (
    <dialog
      ref={dialog}
      className="modal business-modal"
      aria-labelledby="business-modal-title"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClose={onClose}
    >
      <div className="modal-heading">
        <div>
          <span className="eyebrow">CONNECT BUSINESS DATA</span>
          <h2 id="business-modal-title">업무 데이터 연결</h2>
        </div>
        <button className="icon-button" aria-label="업무 데이터 창 닫기" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      <p className="modal-description">
        IFC 부재의 고유 식별자와 엑셀·CSV의 열을 연결합니다. 같은 이름을 가진 부재가 있어도 이름으로
        자동 연결하지 않습니다.
      </p>
      <input
        ref={fileInput}
        type="file"
        className="file-input"
        aria-label="업무 데이터 파일 선택"
        accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={(event) => void readFile(event.target.files?.[0])}
      />
      <button className="upload-zone business-upload" onClick={() => fileInput.current?.click()}>
        <span className="upload-zone-icon">
          {loading ? <LoaderCircle className="spin" size={24} /> : <FileSpreadsheet size={24} />}
        </span>
        <strong>
          {loading ? '업무 데이터를 읽고 있어요' : fileName || 'CSV 또는 XLSX 파일 선택'}
        </strong>
        <span>최대 10MB · 파일은 외부로 전송하지 않습니다.</span>
      </button>
      {error && (
        <p className="upload-error" role="alert">
          {error}
        </p>
      )}
      {table && !loading && (
        <>
          {workbook?.warnings?.length ? (
            <div className="business-warning">
              {workbook.warnings.map((warning, index) => (
                <p key={index}>{warning}</p>
              ))}
            </div>
          ) : null}
          <div className="business-mapping-fields">
            <label>
              업무 데이터 시트
              <select
                aria-label="업무 데이터 시트"
                value={sheetIndex}
                onChange={(event) => {
                  const index = Number(event.target.value)
                  setSheetIndex(index)
                  setColumn(workbook?.sheets[index].headers[0] ?? '')
                }}
              >
                {workbook?.sheets.map((sheet, index) => (
                  <option key={index} value={index}>
                    {sheet.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              모델 연결 키
              <select
                aria-label="모델 연결 키"
                value={modelKey}
                onChange={(event) => setModelKey(event.target.value as 'globalId' | 'tag' | 'id')}
              >
                <option value="globalId">GlobalId (권장)</option>
                <option value="tag">Tag</option>
                <option value="id">부재 ID</option>
              </select>
            </label>
            <label>
              데이터 연결 열
              <select
                aria-label="데이터 연결 열"
                value={column}
                onChange={(event) => setColumn(event.target.value)}
              >
                {table.headers.map((header) => (
                  <option key={header} value={header}>
                    {header}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="business-key-note">
            <Link2 size={14} />
            앞뒤 공백을 제거한 정확한 값으로 연결합니다. 부재 ID는 표의 ID 값(IFC-번호 또는 예제
            코드)입니다.
          </p>
          {result && (
            <>
              <div className="business-preview-metrics" aria-label="연결 미리보기">
                {[
                  ['연결 가능 부재', result.diagnostics.matchedElements],
                  ['미연결 부재', result.diagnostics.unmatchedElements],
                  ['중복·모호한 부재', result.diagnostics.ambiguousElements],
                ].map(([label, value]) => (
                  <div key={String(label)}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
              <dl className="business-diagnostics">
                <div>
                  <dt>업무 데이터 행</dt>
                  <dd>{result.diagnostics.businessRows}</dd>
                </div>
                <div>
                  <dt>중복 데이터 키</dt>
                  <dd>{result.diagnostics.duplicateBusinessKeys}</dd>
                </div>
                <div>
                  <dt>중복 모델 키</dt>
                  <dd>{result.diagnostics.duplicateModelKeys}</dd>
                </div>
                <div>
                  <dt>빈 모델 키</dt>
                  <dd>{result.diagnostics.blankModelKeys}</dd>
                </div>
                <div>
                  <dt>빈 데이터 키</dt>
                  <dd>{result.diagnostics.blankBusinessKeys}</dd>
                </div>
                <div>
                  <dt>연결되지 않은 데이터 행</dt>
                  <dd>{result.diagnostics.unmatchedBusinessRows}</dd>
                </div>
              </dl>
              {result.diagnostics.ambiguousElements > 0 && (
                <p className="business-warning">
                  중복 식별자는 어느 행을 연결할지 확정할 수 없어 제외합니다. 연결 가능한 부재에만
                  데이터를 적용합니다.
                </p>
              )}
            </>
          )}
          <div className="business-preview-table" tabIndex={0} aria-label="업무 데이터 미리보기 표">
            <table>
              <thead>
                <tr>
                  {table.headers.map((header) => (
                    <th key={header}>{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.slice(0, 5).map((row, index) => (
                  <tr key={index}>
                    {table.headers.map((_, columnIndex) => (
                      <td key={columnIndex}>{row[columnIndex] ?? ''}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="business-key-note">
            처음 5개 행 미리보기 · 연결 전까지 기존 업무 데이터는 유지됩니다.
          </p>
        </>
      )}
      <div className="business-modal-actions">
        <button className="button secondary" onClick={onClose}>
          취소
        </button>
        <button
          className="button primary"
          disabled={
            !table ||
            !result ||
            result.diagnostics.matchedElements + result.diagnostics.ambiguousElements === 0 ||
            loading
          }
          onClick={() => {
            if (table && result) onConnect({ fileName, table, modelKey, column, result })
          }}
        >
          <Check size={16} />
          데이터 연결
        </button>
      </div>
    </dialog>
  )
}
