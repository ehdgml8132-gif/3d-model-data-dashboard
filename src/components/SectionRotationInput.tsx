import { useLayoutEffect, useRef } from 'react'
import './section-rotation-input.css'

type Props = {
  angle: number
  onChange: (angle: number) => void
}

export default function SectionRotationInput({ angle, onChange }: Props) {
  const field = useRef<HTMLInputElement>(null)

  useLayoutEffect(() => {
    if (field.current) field.current.value = String(angle)
  }, [angle])

  return (
    <label className="section-rotation-input">
      회전
      <input
        ref={field}
        data-section-rotation-input=""
        type="number"
        min={-180}
        max={180}
        step="any"
        required
        aria-label="단면상자 회전 각도"
        defaultValue={angle}
        onBlur={({ currentTarget }) => {
          const value = currentTarget.valueAsNumber
          if (currentTarget.validity.valid && Number.isFinite(value)) {
            currentTarget.value = String(value)
            if (value !== angle) onChange(value)
          } else {
            currentTarget.value = String(angle)
          }
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          if (event.key === 'Escape') event.currentTarget.value = String(angle)
          event.currentTarget.blur()
        }}
      />
      <span aria-hidden="true">°</span>
    </label>
  )
}
