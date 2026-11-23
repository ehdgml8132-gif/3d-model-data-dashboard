import { useLayoutEffect, useRef, useState } from 'react'
import './section-rotation-input.css'

type Props = {
  angle: number
  onChange: (angle: number) => void
}

export default function SectionRotationInput({ angle, onChange }: Props) {
  const [editing, setEditing] = useState(false)
  const field = useRef<HTMLInputElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const restoreFocus = useRef(false)

  useLayoutEffect(() => {
    if (editing) {
      field.current?.focus({ preventScroll: true })
      field.current?.select()
    } else if (restoreFocus.current) {
      restoreFocus.current = false
      trigger.current?.focus({ preventScroll: true })
    }
  }, [editing])

  return (
    <div
      className="section-rotation-label"
      data-editing={editing ? '' : undefined}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {editing ? (
        <>
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
              if (currentTarget.validity.valid && Number.isFinite(value) && value !== angle) {
                onChange(value)
              }
              setEditing(false)
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== 'Escape') return
              event.preventDefault()
              event.stopPropagation()
              restoreFocus.current = true
              if (event.key === 'Escape') event.currentTarget.value = String(angle)
              event.currentTarget.blur()
            }}
          />
          <span aria-hidden="true">°</span>
        </>
      ) : (
        <button
          ref={trigger}
          type="button"
          className="section-rotation-trigger"
          aria-label="회전 각도 입력"
          onClick={() => setEditing(true)}
        >
          회전 {angle}°
        </button>
      )}
    </div>
  )
}
