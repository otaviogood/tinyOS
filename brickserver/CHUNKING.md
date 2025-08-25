## BrickQuest Chunked World (Server + Client)

This document describes the current chunked world implementation for BrickQuest, covering both server- and client-side behavior. The system enables infinite-style worlds with efficient broadphase queries while keeping gameplay functionally identical to the pre-chunked version.

### Goals

- Single-home chunking: each brick is authored in exactly one 3D chunk
- Neighbor-aware queries: broadphase inspects adjacent chunks to avoid border misses
- Thin client: chunk membership is authoritative on the server; client never re-computes
- Precision: bricks are parented under chunk groups with local positions to reduce floating point error

---

## Server

### Constants and Chunk Coordinates

- `CHUNK_SIZE_XZ = 640` (authoritative server grid X/Z)
- `CHUNK_SIZE_Y = 768` (authoritative server grid Y). The same value is sent to clients via `chunkConfig.height` and used for group origins/helpers. Broadphase neighbor expansion still uses the X size threshold.
- Chunk coords and key:
  - `getChunkCoordForPoint(x, y, z) → { cx, cy, cz }`
  - `getChunkKey(cx, cy, cz) → string` as `"cx,cy,cz"`

### Single-home Brick Assignment

- On world rebuild and incremental add, the server computes each brick’s world AABB and assigns it to exactly one chunk based on the AABB centroid:
  - `center = (aabb.min + aabb.max) * 0.5`
  - `{cx,cy,cz} = getChunkCoordForPoint(center)`
  - Brick is stamped with authoritative `brick.chunkKey = key`

### Per-chunk BVHs

- For each chunk we maintain a compact AABB BVH over the bricks assigned to that chunk:
  - Structure: `{ boxes: Box3[], owners: string[], nodes, indices, root }`
  - Rebuilt per chunk, not globally

### Incremental Updates

- Add (`addBrickToCollision`):
  - Compute brick AABB → home chunk by centroid → push AABB/owner → rebuild that chunk’s BVH → set `brick.chunkKey` → publish `gameState.chunks[key] = { cx, cy, cz }`
- Remove (`removeBrickFromCollision`):
  - Use `brick.chunkKey` to find the home chunk → remove AABB/owner → rebuild that chunk if non-empty; delete the chunk entry if empty

### Broadphase Queries

`queryBVHForAABB(aabb, callback)` walks only the necessary chunks:

1. Compute overlapped chunk index range from `aabb`
2. Expand per axis using half of the X chunk size as the overhang threshold (independent of Y size):
   - If distance from `aabb.min` to the cell’s left boundary < `CHUNK_SIZE_XZ/2`, expand the min index on that axis by −1
   - If distance from the cell’s right boundary to `aabb.max` < `CHUNK_SIZE_XZ/2`, expand the max index by +1
3. For each candidate chunk in the final index cuboid:
   - Traverse that chunk’s BVH; on leaf overlap, invoke `callback(boxIndex, box, brickId, chunkKey)`

This ensures border-correct queries for single-home insertions while avoiding unconditional ±1 expansion.

### Collision Flow (ghost and player)

- Ghost placement collision:
  - Build ghost AABB → `queryBVHForAABB` to gather candidate bricks → precise test via `three-mesh-bvh` intersectsGeometry
- Player capsule collision:
  - Capsule AABB → `queryBVHForAABB` gather candidates → quick sphere-vs-AABB reject → precise capsule-vs-convex shapecast; apply MTV and slide

### Init + Diffs

- On connect, server emits:
  - `chunkConfig: { size, height }`
  - full state including `players`, `bricks`, `chunks` (minimal map of `{ cx, cy, cz }` by key)
- Brick place/remove is diffed; `_new` bricks include `chunkKey` before sending so clients can parent immediately under the correct chunk

---

## Client

### Runtime Chunk Config

- `threeRenderer.setChunkConfig({ size, height })` stores `CHUNK_SIZE`/`CHUNK_HEIGHT` used for group origins and helpers (client-only; `height` may exceed the server's Y grid size)
- `BrickQuest.svelte` applies `chunkConfig` before instantiating meshes

### Chunk Groups and Visualization

- `chunkGroups: Map<string, THREE.Group>` maps chunk keys to groups
- `ensureChunkGroup(cx,cy,cz)` creates a `THREE.Group` at chunk origin (cx*size, cy*height, cz*size)
- Backtick (`) toggles Box3 helpers per chunk via `setChunkDebugVisible(visible)`

### Authoritative Brick Parenting

- `createBrickMesh(brick)` requires `brick.chunkKey`
- Brick mesh is added under its chunk group, positioned locally relative to group origin (precision improvement)
- `removeBrickMesh` prunes empty chunk groups

### Initial Sync and Diffs

- On init, client copies `players`, `bricks`, `chunks`, then calls `reconcileChunksAndBricks(chunks, bricks)` to guarantee groups and create any missing meshes
- For diffs:
  - On brick `_new`, call `createBrickMesh`
  - On `_deleted`, call `removeBrickMesh`
  - If `chunks` changed, reconcile groups first

### Picking

- Raycasting uses `intersectObjects(..., true)` so meshes under chunk groups are hittable

---

## Design Guarantees

- Single-home: each brick resides in exactly one chunk (by AABB centroid)
- Border correctness: broadphase expands per axis using half of the X chunk size threshold, independent of Y size
- Thin client: server is authoritative for `chunkKey` and `chunks`
- Precision: bricks use chunk-local coordinates; ready for instancing

---

## Potential Improvements

### Features

- Streaming/visibility
  - Chunk streaming and visibility management (frustum + distance) to hide whole chunk groups outside view
  - Background loading/unloading of chunk meshes and collision data for very large worlds

- Persistence & sharding
  - Save/load world data per chunk key; server-side sharding or region servers
  - Add chunk metadata (e.g., biome/theme), move `gameState.chunks[key]` beyond minimal `{ cx, cy, cz }`

- Instancing & rendering
  - Per-chunk instanced meshes (by pieceId/material) to reduce draw calls
  - Optional static batching for ground/platform chunks

### Optimizations

- Broadphase
  - Pre-AABB cull at the chunk level before BVH traversal (cheap check vs chunk bounds)
  - Tighten neighbor expansion (e.g., only expand sides actually approached by the query AABB)

- BVH maintenance
  - Incremental BVH updates (insertion/removal) or batched rebuilds per tick rather than per add/remove
  - Pool and reuse arrays/Box3 instances to reduce GC churn

- Client picking
  - Prefilter candidate chunk groups by ray vs chunk AABB before raycasting child meshes
  - Maintain a lightweight per-chunk spatial index for picking if needed

- Networking
  - If chunk metadata grows, move chunk changes to a dedicated channel or compress updates

---

## Quick Reference

- Server entry points (chunking):
  - `rebuildWorldBVH(gameState)` – full rebuild, assigns `chunkKey`s and per-chunk BVHs
  - `addBrickToCollision(gameState, brick)` – incremental add
  - `removeBrickFromCollision(gameState, brick)` – incremental remove
  - `queryBVHForAABB(aabb, cb)` – broadphase over relevant chunks with per-axis expansion using X size threshold

- Client entry points (chunking):
  - `renderer3d.setChunkConfig({ size, height })`
  - `renderer3d.reconcileChunksAndBricks(chunks, bricks)`
  - `renderer3d.setChunkDebugVisible(visible)`


