import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { BuildingFilterElement } from '../lib/buildingFilters'
import { summarizeVolumeIssues, VOLUME_ISSUE_INFO } from '../lib/volumeDiagnostics'
import './volume-diagnostics.css'

const PAGE_SIZE = 20
const count = (value: number) => new Intl.NumberFormat('ko-KR').format(value)
const floorLabel = (value: string) => (/^[123]F$/.test(value) ? `${value[0]}층` : value)

export default function VolumeDiagnostics({ elements }: { elements: BuildingFilterElement[] }) {
  const summary = useMemo(() => summarizeVolumeIssues(elements), [elements])
  const [page, setPage] = useState(0)
  const pageCount = Math.max(1, Math.ceil(summary.total / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1)
  const start = currentPage * PAGE_SIZE
  const rows = summary.elements.slice(start, start + PAGE_SIZE)

  useEffect(() => setPage(0), [elements])

  return (
    <section className="volume-diagnostics" aria-label="체적 미확인 사유">
      <div className="volume-diagnostics-heading">
        <h3>체적 미확인 사유</h3>
        <strong>현재 표시 부재 중 {count(summary.total)}개</strong>
      </div>
      {summary.total === 0 ? (
        <p className="volume-diagnostics-empty">현재 표시된 부재에는 체적 미확인이 없습니다.</p>
      ) : (
        <>
          <p className="volume-diagnostics-note">
            현재 카드에 표시된 부재를 기준으로 집계합니다. 입력한 체적 조건은 적용 후 반영됩니다.
          </p>
          <ul className="volume-diagnostics-groups">
            {summary.groups.map((group) => (
              <li key={group.code}>
                <div>
                  <strong>{group.label}</strong>
                  <span>{count(group.count)}개</span>
                </div>
                <p>{group.description}</p>
              </li>
            ))}
          </ul>
          <details className="volume-diagnostics-members">
            <summary>미확인 부재 보기</summary>
            <ol aria-label="미확인 부재 목록" start={start + 1}>
              {rows.map((element) => (
                <li key={element.id}>
                  <strong>{element.name || element.id}</strong>
                  <small>
                    {element.id} · {floorLabel(element.floor)}
                  </small>
                  <p>{VOLUME_ISSUE_INFO[element.issue.code].label}</p>
                  {(element.issue.source ||
                    element.issue.value !== undefined ||
                    element.issue.unit !== undefined) && (
                    <dl>
                      {element.issue.source && (
                        <div>
                          <dt>속성</dt>
                          <dd>{element.issue.source}</dd>
                        </div>
                      )}
                      {element.issue.value !== undefined && (
                        <div>
                          <dt>
                            {element.issue.code === 'conflicting-values' ? '환산 값' : '원본 값'}
                          </dt>
                          <dd>{element.issue.value || '(비어 있음)'}</dd>
                        </div>
                      )}
                      {element.issue.unit !== undefined && (
                        <div>
                          <dt>단위</dt>
                          <dd>{element.issue.unit || '(지정 없음)'}</dd>
                        </div>
                      )}
                    </dl>
                  )}
                </li>
              ))}
            </ol>
            {pageCount > 1 && (
              <nav className="volume-diagnostics-pages" aria-label="미확인 부재 페이지">
                <button
                  type="button"
                  aria-label="이전 미확인 부재 페이지"
                  disabled={currentPage === 0}
                  onClick={() => setPage(currentPage - 1)}
                >
                  <ChevronLeft size={15} />
                </button>
                <span>
                  {count(start + 1)}–{count(Math.min(start + PAGE_SIZE, summary.total))} /{' '}
                  {count(summary.total)}개
                </span>
                <button
                  type="button"
                  aria-label="다음 미확인 부재 페이지"
                  disabled={currentPage === pageCount - 1}
                  onClick={() => setPage(currentPage + 1)}
                >
                  <ChevronRight size={15} />
                </button>
              </nav>
            )}
          </details>
        </>
      )}
    </section>
  )
}
