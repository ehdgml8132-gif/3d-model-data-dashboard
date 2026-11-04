import { useEffect, useRef, useState } from 'react'
import { Canvas, type ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, RoundedBox } from '@react-three/drei'
import * as THREE from 'three'
import type { Product, ProductId } from '../types'

type Props = {
  products: Product[]
  selectedId: ProductId
  onSelect: (id: ProductId) => void
  resetKey: number
}

type Vector = [number, number, number]

function Block({
  position,
  size,
  color,
  radius = 0.035,
}: {
  position: Vector
  size: Vector
  color: string
  radius?: number
}) {
  return (
    <RoundedBox
      position={position}
      args={size}
      radius={radius}
      smoothness={2}
      castShadow
      receiveShadow
    >
      <meshStandardMaterial color={color} roughness={0.75} />
    </RoundedBox>
  )
}

function LeafyPlant({ position, scale = 1 }: { position: Vector; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.22, 0]} castShadow>
        <cylinderGeometry args={[0.25, 0.18, 0.44, 24]} />
        <meshStandardMaterial color="#d9b69c" roughness={0.9} />
      </mesh>
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <group key={i} rotation={[0, i * 2.4, 0]}>
          <mesh
            position={[0.13, 0.65 + (i % 3) * 0.12, 0]}
            rotation={[0, 0, -0.35]}
            scale={[0.16, 0.38, 0.11]}
            castShadow
          >
            <sphereGeometry args={[1, 12, 10]} />
            <meshStandardMaterial color={i % 2 ? '#56795b' : '#87a17a'} roughness={0.9} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

function Chair({ position, rotation = 0 }: { position: Vector; rotation?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 0.48, 0]} castShadow>
        <cylinderGeometry args={[0.28, 0.28, 0.09, 24]} />
        <meshStandardMaterial color="#dcbf96" roughness={0.9} />
      </mesh>
      <Block position={[0, 0.75, -0.23]} size={[0.5, 0.42, 0.07]} color="#dcbf96" />
      {[-1, 1].flatMap((x) =>
        [-1, 1].map((z) => (
          <mesh key={`${x}${z}`} position={[x * 0.17, 0.24, z * 0.17]} castShadow>
            <cylinderGeometry args={[0.025, 0.022, 0.45, 8]} />
            <meshStandardMaterial color="#607065" />
          </mesh>
        )),
      )}
    </group>
  )
}

function Table({ position }: { position: Vector }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.78, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.55, 0.55, 0.1, 36]} />
        <meshStandardMaterial color="#e6cfaa" roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.4, 0]} castShadow>
        <cylinderGeometry args={[0.055, 0.075, 0.72, 12]} />
        <meshStandardMaterial color="#627568" />
      </mesh>
      <mesh position={[0, 0.055, 0]}>
        <cylinderGeometry args={[0.26, 0.28, 0.05, 24]} />
        <meshStandardMaterial color="#627568" />
      </mesh>
      <LeafyPlant position={[0, 0.84, 0]} scale={0.23} />
    </group>
  )
}

function Cup({ latte = false }: { latte?: boolean }) {
  return (
    <group>
      <mesh position={[0, 0.025, 0]} receiveShadow>
        <cylinderGeometry args={[0.28, 0.26, 0.05, 36]} />
        <meshStandardMaterial color="#f5efe2" />
      </mesh>
      <mesh position={[0, 0.2, 0]} castShadow>
        <cylinderGeometry args={[0.2, 0.15, 0.33, 32]} />
        <meshStandardMaterial color={latte ? '#bed3b6' : '#fbf5e8'} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.37, 0]}>
        <cylinderGeometry args={[0.173, 0.173, 0.008, 32]} />
        <meshStandardMaterial color={latte ? '#bb885f' : '#493126'} />
      </mesh>
      {latte && (
        <group position={[0, 0.378, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          {[0, 1, 2].map((i) => (
            <mesh key={i} position={[0, i * 0.027 - 0.03, 0]} scale={[1 - i * 0.16, 0.6, 1]}>
              <circleGeometry args={[0.083, 20]} />
              <meshStandardMaterial color="#f6e3c7" />
            </mesh>
          ))}
        </group>
      )}
      <mesh position={[0.21, 0.22, 0]}>
        <torusGeometry args={[0.1, 0.035, 8, 20]} />
        <meshStandardMaterial color={latte ? '#bed3b6' : '#fbf5e8'} />
      </mesh>
    </group>
  )
}

function Croissant() {
  return (
    <group>
      <mesh position={[0, 0.025, 0]} receiveShadow>
        <cylinderGeometry args={[0.4, 0.37, 0.045, 36]} />
        <meshStandardMaterial color="#f9f0dc" />
      </mesh>
      {[-2, -1, 0, 1, 2].map((i) => (
        <mesh
          key={i}
          position={[i * 0.105, 0.15, Math.abs(i) * 0.045]}
          rotation={[0, i * -0.24, 0]}
          scale={[0.105 - Math.abs(i) * 0.011, 0.09 - Math.abs(i) * 0.01, 0.2 - Math.abs(i) * 0.03]}
          castShadow
        >
          <sphereGeometry args={[1, 16, 12]} />
          <meshStandardMaterial color={i % 2 ? '#d99544' : '#eab366'} roughness={0.85} />
        </mesh>
      ))}
    </group>
  )
}

function Cake() {
  return (
    <group>
      <mesh position={[0, 0.025, 0]} receiveShadow>
        <cylinderGeometry args={[0.38, 0.35, 0.05, 36]} />
        <meshStandardMaterial color="#f7eee1" />
      </mesh>
      <Block position={[0, 0.22, 0]} size={[0.4, 0.34, 0.45]} color="#efd8b6" radius={0.02} />
      <Block position={[0, 0.22, 0]} size={[0.41, 0.065, 0.46]} color="#efb9af" radius={0.01} />
      <Block position={[0, 0.4, 0]} size={[0.42, 0.07, 0.47]} color="#fff6e8" radius={0.02} />
      {[-1, 1].map((i) => (
        <mesh key={i} position={[i * 0.09, 0.5, 0]} scale={[0.075, 0.105, 0.07]} castShadow>
          <sphereGeometry args={[1, 14, 12]} />
          <meshStandardMaterial color="#bd6057" roughness={0.7} />
        </mesh>
      ))}
    </group>
  )
}

function Merchandise({
  product,
  position,
  selected,
  onSelect,
}: {
  product: Product
  position: Vector
  selected: boolean
  onSelect: Props['onSelect']
}) {
  const [hovered, setHovered] = useState(false)
  const marker = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    if (marker.current) marker.current.position.y = 0.7 + Math.sin(clock.elapsedTime * 2) * 0.045
  })
  useEffect(() => {
    if (hovered) document.body.style.cursor = 'pointer'
    return () => {
      document.body.style.cursor = ''
    }
  }, [hovered])
  const click = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    onSelect(product.id)
  }
  return (
    <group
      position={position}
      onClick={click}
      onPointerOver={(event) => {
        event.stopPropagation()
        setHovered(true)
      }}
      onPointerOut={() => setHovered(false)}
    >
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.43, selected || hovered ? 0.5 : 0.455, 48]} />
        <meshBasicMaterial
          color={selected || hovered ? '#3f8f73' : '#b1bfa5'}
          transparent
          opacity={selected || hovered ? 0.9 : 0.55}
          side={THREE.DoubleSide}
        />
      </mesh>
      {product.id === 'P001' && <Cup />}
      {product.id === 'P002' && <Cup latte />}
      {product.id === 'P003' && <Croissant />}
      {product.id === 'P004' && <Cake />}
      {/* A generous invisible hit target keeps small objects easy to select. */}
      <mesh position={[0, 0.25, 0]}>
        <boxGeometry args={[0.83, 0.65, 0.83]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {selected && (
        <mesh ref={marker} rotation={[0, 0, Math.PI]}>
          <coneGeometry args={[0.075, 0.13, 4]} />
          <meshBasicMaterial color="#34765d" />
        </mesh>
      )}
    </group>
  )
}

function CameraReset({ resetKey }: { resetKey: number }) {
  const { camera, controls, size } = useThree()
  useEffect(() => {
    camera.position.set(9, 8, 10)
    camera.lookAt(0, 0.9, 0)
    if (camera instanceof THREE.OrthographicCamera) {
      camera.zoom = Math.min(size.width / 11.4, size.height / 9.1)
      camera.updateProjectionMatrix()
    }
    if (controls && 'target' in controls) {
      const orbit = controls as unknown as { target: THREE.Vector3; update: () => void }
      orbit.target.set(0, 0.9, 0)
      orbit.update()
    }
  }, [resetKey, camera, controls, size.width, size.height])
  return null
}

function Cafe({ products, selectedId, onSelect }: Omit<Props, 'resetKey'>) {
  const locations: Record<ProductId, Vector> = {
    P001: [-0.7, 1.14, -0.75],
    P002: [0.45, 1.14, -0.75],
    P003: [1.65, 1.14, -0.75],
    P004: [2.8, 1.14, -0.75],
  }
  return (
    <group>
      <Block position={[0, -0.2, 0]} size={[8, 0.3, 5.8]} color="#d3c7b5" radius={0.1} />
      <Block position={[0, -0.035, 0]} size={[7.8, 0.07, 5.6]} color="#ece5d5" />
      {Array.from({ length: 12 }, (_, i) => (
        <Block
          key={`x${i}`}
          position={[-3.6 + i * 0.65, 0.004, 0]}
          size={[0.009, 0.005, 5.5]}
          color="#dcd4c4"
          radius={0.001}
        />
      ))}
      {Array.from({ length: 9 }, (_, i) => (
        <Block
          key={`z${i}`}
          position={[0, 0.005, -2.6 + i * 0.65]}
          size={[7.7, 0.005, 0.009]}
          color="#dcd4c4"
          radius={0.001}
        />
      ))}
      <Block position={[0, 1.45, -2.8]} size={[7.9, 2.9, 0.15]} color="#b6c6ad" />
      <Block position={[-3.85, 1.45, -0.8]} size={[0.14, 2.9, 4]} color="#cfdbbe" />
      <Block position={[-3.73, 0.12, -0.8]} size={[0.12, 0.23, 3.98]} color="#95a789" />
      <Block position={[0, 0.12, -2.69]} size={[7.7, 0.23, 0.1]} color="#95a789" />
      {[-2.25, 1.9].map((x) => (
        <group key={x} position={[x, 1.9, -2.69]}>
          <Block position={[0, 0, 0]} size={[2.05, 1.5, 0.1]} color="#f1eddc" />
          <Block position={[0, 0, 0.06]} size={[1.85, 1.3, 0.03]} color="#dce9dc" />
          <Block position={[0, 0, 0.09]} size={[0.045, 1.3, 0.03]} color="#f7f1e3" />
          <Block position={[0, 0, 0.09]} size={[1.85, 0.045, 0.03]} color="#f7f1e3" />
          <Block position={[0, -0.78, 0.13]} size={[2.2, 0.1, 0.3]} color="#eee5d1" />
        </group>
      ))}
      {/* Back bar and the softly fluted timber merchandise counter. */}
      <Block position={[1.05, 0.46, -2.16]} size={[5.3, 0.9, 0.77]} color="#d9c19c" />
      <Block position={[1.05, 0.94, -2.12]} size={[5.5, 0.11, 0.93]} color="#f6efe0" />
      <Block position={[1.05, 0.51, -0.81]} size={[5.4, 1.02, 1.03]} color="#bd9871" />
      {Array.from({ length: 28 }, (_, i) => (
        <Block
          key={i}
          position={[-1.55 + i * 0.193, 0.52, -0.275]}
          size={[0.065, 0.88, 0.035]}
          color="#d5b68c"
          radius={0.012}
        />
      ))}
      <Block position={[1.05, 1.075, -0.81]} size={[5.6, 0.12, 1.2]} color="#f2e9d7" />
      {/* Espresso machine, grinder and rows of cups. */}
      <Block position={[-0.9, 1.25, -2.08]} size={[0.85, 0.54, 0.5]} color="#566e61" />
      <Block position={[-0.9, 1.3, -1.8]} size={[0.68, 0.21, 0.1]} color="#bac5ba" />
      <Block position={[-0.9, 1.025, -1.78]} size={[0.82, 0.05, 0.27]} color="#46584e" />
      {[-1.1, -0.75].map((x) => (
        <Block
          key={x}
          position={[x, 1.16, -1.67]}
          size={[0.04, 0.13, 0.14]}
          color="#334c40"
          radius={0.01}
        />
      ))}
      {[0, 1, 2].map((i) => (
        <group key={i} position={[0.3 + i * 0.3, 1.02, -2.1]} scale={0.5}>
          <Cup latte={i % 2 === 0} />
        </group>
      ))}
      <Block position={[1.7, 1.19, -2.07]} size={[0.4, 0.36, 0.39]} color="#c2b29c" />
      <mesh position={[1.7, 1.48, -2.07]} castShadow>
        <cylinderGeometry args={[0.17, 0.1, 0.25, 20]} />
        <meshStandardMaterial color="#6d5b46" />
      </mesh>
      <LeafyPlant position={[3.15, 1.01, -2.15]} scale={0.45} />
      <Table position={[-2.6, 0, 0.2]} />
      <Chair position={[-2.6, 0, 1.08]} rotation={Math.PI} />
      <Chair position={[-2.6, 0, -0.67]} />
      <Table position={[-0.45, 0, 1.65]} />
      <Chair position={[-1.35, 0, 1.65]} rotation={Math.PI / 2} />
      <Chair position={[0.45, 0, 1.65]} rotation={-Math.PI / 2} />
      <LeafyPlant position={[-3.25, 0, -2.02]} scale={1.05} />
      <LeafyPlant position={[3.2, 0, 2]} scale={1.15} />
      {/* A compact menu on the side wall and two pendants. */}
      <Block position={[-3.72, 1.85, -0.3]} size={[0.08, 0.96, 0.72]} color="#e5d4b5" />
      <Block position={[-3.66, 1.85, -0.3]} size={[0.035, 0.8, 0.58]} color="#465d4e" />
      {[0, 1, 2, 3].map((i) => (
        <Block
          key={i}
          position={[-3.63, 2.1 - i * 0.14, -0.3]}
          size={[0.01, 0.025, i % 2 ? 0.29 : 0.39]}
          color="#d1d9c4"
          radius={0.001}
        />
      ))}
      {[-0.2, 2.1].map((x) => (
        <group key={x} position={[x, 0, -0.75]}>
          <mesh position={[0, 3.05, 0]}>
            <cylinderGeometry args={[0.013, 0.013, 0.8, 8]} />
            <meshStandardMaterial color="#6e7869" />
          </mesh>
          <mesh position={[0, 2.6, 0]} castShadow>
            <coneGeometry args={[0.35, 0.24, 32, 1, true]} />
            <meshStandardMaterial color="#e9d5a9" side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[0, 2.51, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.25, 24]} />
            <meshStandardMaterial color="#fff3ce" emissive="#f1c974" emissiveIntensity={0.15} />
          </mesh>
        </group>
      ))}
      {products.map((product) => (
        <Merchandise
          key={product.id}
          product={product}
          position={locations[product.id]}
          selected={selectedId === product.id}
          onSelect={onSelect}
        />
      ))}
    </group>
  )
}

export default function CafeScene({ products, selectedId, onSelect, resetKey }: Props) {
  return (
    <Canvas
      orthographic
      shadows
      dpr={[1, 1.75]}
      camera={{ position: [9, 8, 10], zoom: 45, near: 0.1, far: 100 }}
      gl={{ antialias: true, alpha: true }}
      style={{ touchAction: 'none' }}
    >
      <color attach="background" args={['#f1f3ec']} />
      <ambientLight intensity={1.7} />
      <hemisphereLight args={['#fff8e8', '#a8b6a0', 1]} />
      <directionalLight
        position={[4, 9, 6]}
        intensity={2.4}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-7}
        shadow-camera-right={7}
        shadow-camera-top={7}
        shadow-camera-bottom={-7}
        shadow-normalBias={0.035}
        shadow-bias={-0.0001}
      />
      <mesh position={[0, -0.37, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <shadowMaterial transparent opacity={0.12} />
      </mesh>
      <Cafe products={products} selectedId={selectedId} onSelect={onSelect} />
      <OrbitControls
        makeDefault
        target={[0, 0.9, 0]}
        enablePan={false}
        minZoom={25}
        maxZoom={135}
        minPolarAngle={Math.PI / 5}
        maxPolarAngle={Math.PI / 2.3}
        minAzimuthAngle={-Math.PI / 8}
        maxAzimuthAngle={Math.PI / 2.3}
      />
      <CameraReset resetKey={resetKey} />
    </Canvas>
  )
}
