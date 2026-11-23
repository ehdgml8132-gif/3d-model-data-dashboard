import type { ViewerDirection } from './ViewerDirectionCamera'
import './viewer-cube.css'

const faces = [
  { direction: 'top', name: '윗면', label: '윗면', title: '윗면(평면) 보기' },
  { direction: 'front', name: '정면', label: '정면', title: '정면 보기' },
  { direction: 'right', name: '오른쪽', label: '우측', title: '오른쪽 보기' },
] satisfies { direction: ViewerDirection; name: string; label: string; title: string }[]

export default function ViewerCube({
  direction,
  onSelect,
}: {
  direction: ViewerDirection | null
  onSelect: (direction: ViewerDirection) => void
}) {
  return (
    <div className="viewer-cube" role="group" aria-label="뷰 방향">
      {faces.map((face) => (
        <button
          key={face.direction}
          type="button"
          className="viewer-cube-face"
          data-direction={face.direction}
          aria-label={face.name}
          title={face.title}
          aria-pressed={direction === face.direction}
          onClick={() => onSelect(face.direction)}
        >
          {face.label}
        </button>
      ))}
    </div>
  )
}
