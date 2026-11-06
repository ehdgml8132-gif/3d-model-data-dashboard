# Third-party components

## web-ifc 0.0.78

The IFC importer uses the official, unmodified web-ifc engine from the locked npm
package. JavaScript is bundled into the local import worker. Browser WebAssembly
engine files and their license are served from `ifc/` on the same website.

- License: Mozilla Public License 2.0; included at `ifc/LICENSE.md`.
- Source: https://github.com/ThatOpen/engine_web-ifc
- Versioned package: https://www.npmjs.com/package/web-ifc/v/0.0.78

Selected IFC files are processed in the browser and are not sent to these hosts.

## ExcelJS 4.4.0 and fflate 0.8.3

ExcelJS reads uploaded XLSX workbooks in the browser. fflate verifies compressed
entry size limits before workbook loading. Both are distributed under the MIT
license; upstream source and license:

- https://github.com/exceljs/exceljs
- https://github.com/101arrowz/fflate

## Authored IFC example

`examples/authored-building.ifc` and its CSV are authored test/demo fixtures.
They are synthetic examples, not Revit exports or engineering design documents.
