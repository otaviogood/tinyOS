# LDraw to GLTF Converter

A Node.js utility that converts LDraw files to GLTF format while extracting and preserving LEGO stud and anti-stud (connection point) positions.

## Installation

1. Navigate to the node_utils directory:
```bash
cd node_utils
```

2. Install dependencies:
```bash
npm install
```

## Usage
### Advanced Version (loads actual part files)
```bash
node ldraw-to-gltf-advanced.js <input.ldr> [output.gltf] [parts-library-path]
```

### Examples
```
node node_utils/ldraw-to-gltf-advanced.js public/apps/ldraw/parts/4070.dat node_utils/4070-ot.gltf public/apps/ldraw
```
### Batch mode get it done
```
node node_utils/ldraw-to-gltf-batch.js node_utils/piece_list_auto.csv public/apps/bricks/all_pieces.gltf public/apps/ldraw
```

## CLI tools and parameters

### ldraw-to-gltf-advanced.js
```
node node_utils/ldraw-to-gltf-advanced.js <input.ldr|.dat> [output.gltf] [parts-library-path]
```
- **input.ldr|.dat**: Path to an LDraw file (model or single part).
- **output.gltf (optional)**: Output path. Defaults to input filename with `.gltf` extension.
- **parts-library-path (optional)**: Root of the LDraw parts library. If omitted, uses the `LDRAW_LIBRARY_PATH` env var; otherwise falls back to local-only references.

Notes:
- Extracts studs and anti-studs into `root.extras.studs` and `root.extras.antiStuds`.
- Uses LDCad Shadow Library when available to infer SNAP_CYL connectors.

### ldraw-to-gltf-batch.js
```
node node_utils/ldraw-to-gltf-batch.js <piece_list.csv> [output.gltf] [parts-library-path] [--max N]
```
- **piece_list.csv**: CSV with rows like `3001, white, brick 2x4`.
- **output.gltf (optional)**: Combined GLTF output path (default: `all_pieces.gltf`).
- **parts-library-path (optional)**: Root of the LDraw parts library. If omitted, uses `LDRAW_LIBRARY_PATH` or `public/apps/ldraw`.
- **--max N (optional flag)**: Process only the first N rows.

Outputs:
- Combined GLTF at `output.gltf` and a CSV `exported_pieces.csv` next to it.
- Individual GLTFs in an `individual/` subfolder next to `output.gltf`.

Behavior:
- Skips parts that are not found in the library.
- Skips parts that have neither studs nor anti-studs detected.

### make-piece-list.js
```
node node_utils/make-piece-list.js
```
- No parameters. Reads `public/apps/bricks/lego_pick_a_brick_simple.csv` and writes `node_utils/piece_list_auto.csv`.
- Filters out DUPLO and certain categories (e.g., wigs, helmets, clothing).

### inspect-gltf-hierarchy.js
```
node node_utils/inspect-gltf-hierarchy.js [gltfPath]
```
- **gltfPath (optional)**: Path to a GLTF file to inspect (default: `all_pieces.gltf`).
- Prints the node hierarchy and summary (nodes/meshes/materials).
