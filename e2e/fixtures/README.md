# Authored IFC fixture

`public/examples/authored-building.ifc` is a small, self-authored IFC4 STEP file.
It is **not a Revit export**. It exercises the official IFC parser, geometry
mesher, property extraction, spatial hierarchy, and joins to external data.

The project uses millimetres for lengths and cubic metres for volume properties.
Its two storeys are at 0 mm and 3,000 mm. All five elements have genuine swept
solid IFC geometry, a material, `Pset_DemoCommon.FireRating`, and a Revit-style
`Pset_DemoCommon.체적` single-value property containing an `IfcVolumeMeasure`.
The beam property has an explicit cubic-metre unit reference; the other members
use the project's volume unit. The existing `Qto_DemoBaseQuantities.NetVolume`
entries remain in the fixture, but the app must not use them for member volumes.

| Element                   | GlobalId                 | Tag    | Storey       | Pset 체적 (m³) |
| ------------------------- | ------------------------ | ------ | ------------ | -------------: |
| Round concrete column G   | `0nKbBzQJnGpBAXy9$4zESO` | `0001` | Ground floor |    0.589048623 |
| Concrete wall G           | `3P$rDISXjUYgBIiZ$KERSS` | `0002` | Ground floor |            3.6 |
| Round concrete column 1   | `3eiABnlqPU7hTXm4qM4hP1` | `0003` | First floor  |    0.589048623 |
| First floor concrete slab | `0$MI6tbevVyufUN1Pjawmo` | `0004` | First floor  |            4.8 |
| Steel beam 1              | `3US19W0$vRUeNsBV7TCnlc` | `0005` | First floor  |           1.25 |

`public/examples/authored-building-data.csv` supplies matching GlobalIds and
string Tags, together with workflow status, cost, currency, owner, and notes.
The four-character Tags intentionally contain leading zeros.

Run the independent official-engine check after installing dependencies:

```sh
node e2e/fixtures/validate-authored-ifc.mjs
```

The checker opens the actual STEP bytes with `web-ifc` 0.0.78, checks five real
meshes, two storeys, properties, materials, declared units and quantities, and
matching CSV keys. At 32 circle segments the round column has 250 vertices and
a transformed bounding-box volume of about 0.7471 m³, which differs from its
declared 0.589048623 m³ property. Its local geometry buffers are in millimetres;
the placement transform includes the 0.001 scale and orientation conversion.

For a valid missing-property case, replace `(#109,#110,#204)` with `(#109,#110)`
in the beam's `#111` property set. This removes only the `체적` property reference,
preserving its geometry, other properties, and quantity set. The checker verifies
this variant still produces five meshes. A loader must then report the beam's
volume as unavailable rather than substituting Qto or a bounding-box estimate.
