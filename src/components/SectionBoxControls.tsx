import { RotateCcw, Scan } from 'lucide-react'
import type { SectionBoxSettings } from '../lib/sectionBox'
import './section-box-controls.css'

export const fullSectionRanges = (): SectionBoxSettings['ranges'] => ({
  x: [0, 100],
  y: [0, 100],
  z: [0, 100],
})

export default function SectionBoxControls({
  settings,
  targetName,
  onChange,
}: {
  settings: SectionBoxSettings
  targetName?: string
  onChange: (settings: SectionBoxSettings) => void
}) {
  const changeRange = (axis: 'x' | 'y' | 'z', side: 0 | 1, value: number) => {
    const range = [...settings.ranges[axis]] as [number, number]
    range[side] = side === 0 ? Math.min(value, range[1] - 1) : Math.max(value, range[0] + 1)
    onChange({ ...settings, ranges: { ...settings.ranges, [axis]: range } })
  }
  return (
    <section className="section-range-panel" aria-label="단면상자 범위">
      <div className="section-range-heading">
        <div>
          <strong>
            <Scan size={14} />
            {settings.targetId
              ? `선택 부재 기준: ${targetName ?? settings.targetId}`
              : '전체 건물 기준'}
          </strong>
          <p>
            상자의 화살표를 드래그해 내부를 확인하세요. 아래 슬라이더로도 세밀하게 조절할 수
            있습니다.
          </p>
        </div>
        <button
          type="button"
          className="section-range-reset"
          aria-label="단면 범위 초기화"
          onClick={() => onChange({ ...settings, ranges: fullSectionRanges() })}
        >
          <RotateCcw size={13} /> 범위 초기화
        </button>
      </div>
      <div className="section-range-axes">
        {(['x', 'y', 'z'] as const).map((axis) => (
          <fieldset key={axis}>
            <legend>
              {axis.toUpperCase()} · {axis === 'y' ? '높이' : axis === 'x' ? '좌우' : '앞뒤'}
            </legend>
            {([0, 1] as const).map((side) => (
              <label key={side}>
                <span>
                  {side === 0 ? '최소' : '최대'} <output>{settings.ranges[axis][side]}%</output>
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={settings.ranges[axis][side]}
                  aria-label={`${axis.toUpperCase()} ${side === 0 ? '최소' : '최대'}`}
                  onChange={(event) => changeRange(axis, side, Number(event.target.value))}
                />
              </label>
            ))}
          </fieldset>
        ))}
      </div>
    </section>
  )
}
