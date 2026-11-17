import type { IfcVolumeIssue, IfcVolumeIssueCode } from '../ifc/types'
import type { BuildingFilterElement } from './buildingFilters'

export type VolumeDiagnosticCode = IfcVolumeIssueCode | 'unclassified'
export type VolumeDiagnosticIssue = Omit<IfcVolumeIssue, 'code'> & { code: VolumeDiagnosticCode }

export const VOLUME_ISSUE_INFO: Record<
  VolumeDiagnosticCode,
  { label: string; description: string }
> = {
  'missing-property': {
    label: '체적 속성 없음',
    description:
      'Pset에 체적 또는 Volume 단일 값 속성이 없습니다. Qto 수량값은 체적으로 사용하지 않습니다.',
  },
  'empty-value': {
    label: '체적 값 비어 있음',
    description: '체적 속성은 있으나 값이 입력되지 않았습니다.',
  },
  'invalid-value': {
    label: '체적 값 해석 불가',
    description: '값이 올바른 0 이상의 숫자가 아니거나 지원하지 않는 값 형식입니다.',
  },
  'unknown-unit': {
    label: '체적 단위 확인 불가',
    description: '속성·값에 적힌 단위 또는 프로젝트 체적 단위를 m³로 환산할 수 없습니다.',
  },
  'conflicting-units': {
    label: '체적 단위 불일치',
    description: '속성의 명시 단위와 값에 적힌 단위가 서로 다릅니다.',
  },
  'conflicting-values': {
    label: '체적 값 충돌',
    description: '같은 부재에서 체적 값이 서로 다르게 기록되어 하나를 확정할 수 없습니다.',
  },
  'property-read-error': {
    label: '속성 읽기 실패',
    description: '부재의 속성 정보를 끝까지 읽지 못해 체적을 확인할 수 없습니다.',
  },
  'property-limit': {
    label: '속성 탐색 한도 도달',
    description: '속성 탐색 한도에 도달해 체적을 끝까지 확인하지 못했습니다.',
  },
  unclassified: {
    label: '상세 사유 미기록',
    description: '체적 판독 사유가 기록되어 있지 않습니다. IFC를 다시 열어 확인해 주세요.',
  },
}

export function summarizeVolumeIssues(elements: BuildingFilterElement[]) {
  const unknown = elements
    .filter((element) => element.volume === null)
    .map((element) => ({
      id: element.id,
      name: element.name,
      floor: element.floor,
      issue: (element.volumeIssue ?? { code: 'unclassified' }) as VolumeDiagnosticIssue,
    }))
  const counts = new Map<VolumeDiagnosticCode, number>()
  for (const element of unknown)
    counts.set(element.issue.code, (counts.get(element.issue.code) ?? 0) + 1)
  return {
    total: unknown.length,
    groups: (
      Object.entries(VOLUME_ISSUE_INFO) as [
        VolumeDiagnosticCode,
        (typeof VOLUME_ISSUE_INFO)[VolumeDiagnosticCode],
      ][]
    )
      .filter(([code]) => counts.has(code))
      .map(([code, info]) => ({ code, ...info, count: counts.get(code)! })),
    elements: unknown,
  }
}
