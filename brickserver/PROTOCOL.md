## BrickQuest Networking Protocol

This document specifies the real-time networking protocol between the BrickQuest client (`src/apps/BrickQuest/BrickQuest.svelte`) and the server (`brickserver/server.js`). It uses Socket.IO over WebSocket and a compact object-diff format for efficient state sync.

### Transport

- **Library**: Socket.IO
- **URL**: `http://localhost:3001`
- **Transports**: WebSocket only (`transports: ['websocket'], upgrade: false` on client)
- **CORS**: Server allows all origins
- **Health**: HTTP `GET /health` returns `{ ok: true }`

Handshake auth (sent by client on connect):
- `auth: { colorLegs: number, colorTorso: number, name: string }`

### Message Channels (Socket.IO events)

- **Server → Client**
  - `init`: Sends initial full world snapshot and metadata on connect
  - `stateDiff`: Sends incremental state updates (diffs)

- **Client → Server**
  - `inputDiff`: Sends incremental input updates (diffs), plus a frame counter used for RTT

### Server tick and send rates

- **Physics tick**: 60 Hz (server-side movement, gravity)
- **Send rate**: 60 Hz (emits `stateDiff` only when there are changes)
- Optional latency simulation can add delay, jitter, and packet loss on the server; protocol semantics remain the same.

## Schemas

Types are shown in JSON-like notation. Coordinates are numbers in world units.

### init (Server → Client)

Payload:

```json
{
  "playerId": "<socketId>",
  "state": {
    "players": {
      "<socketId>": {
        "id": "<socketId>",
        "position": { "x": 0, "y": 50, "z": 0 },
        "rotation": { "y": 0, "pitch": 0 },
        "velocity": { "x": 0, "y": 0, "z": 0 },
        "colorLegs": 949839,
        "colorTorso": 949839,
        "name": "builder123",
        "selectedPieceIndex": 0,
        "selectedColorIndex": 0,
        "selectedAntiStudIndex": 0,
        "selectedStudIndex": 0,
        "anchorMode": "anti",
        "lastFrameCounter": null
      }
      // ...other players
    },
    "chunks": {
      "0,0,0": {
        "cx": 0, "cy": 0, "cz": 0,
        "bricks": {
          "1": {
            "id": "1",
            "position": { "x": 0, "y": 0, "z": 0 },
            "rotation": { "x": 0, "y": 0, "z": 0 },
            "colorIndex": 0,
            "pieceId": "3022",
            "type": "basic"
          }
          // ...other bricks in this chunk
        }
      }
      // ...other chunks
    },
    "nextBrickId": 123
  },
  "pieceList": [
    { "id": "3001", "color": "white", "name": "brick 2x4" }
    // ...see server PIECE_LIST
  ],
  "piecesData": {
    "3022": {
      "studs": [ { "x": 10, "y": 0, "z": -10 }, { "x": -10, "y": 0, "z": -10 }, { "x": 10, "y": 0, "z": 10 }, { "x": -10, "y": 0, "z": 10 } ],
      "antiStuds": [ { "x": 10, "y": 0, "z": -10 } ]
    }
    // pieceId → { studs: Vec3[], antiStuds: Vec3[] }
  },
  "chunkConfig": { "size": 640, "height": 768 }
}
```

Notes:
- `piecesData` is parsed from GLTF `extras` for each part; if loading fails, studs/antiStuds arrays are empty.
- `chunks` is a minimal authoritative map of present chunks. See CHUNKING.md.
- `chunkConfig` informs client chunk group origins; must be applied before creating meshes.

### inputDiff (Client → Server)

The client maintains an input object and transmits only changes since the last send using the delta format below. A `frame` counter is always added for RTT estimation.

Shape (only changed fields are present):

```json
{
  "keys": { "w": true, "a": false, "s": false, "d": true, "space": false },
  "mouse": { "x": 12.3, "y": 54.0, "z": -7.1 },
  "camera": { "yaw": 1.234, "pitch": -0.12 },
  "events": [
    { "type": "click", "button": 0,
      "closestStud": { "position": { "x": 40, "y": 8, "z": 80 }, "direction": { "x": 0, "y": 1, "z": 0 } },
      "closestAntiStud": { "position": { "x": 60, "y": 8, "z": 80 }, "direction": { "x": 0, "y": 1, "z": 0 } },
      "rotation": { "x": 0, "y": 1.5708, "z": 0 },
      "rotationY": 1.5708,
      "brickId": "17" },
    { "type": "pieceChange", "delta": 1 },
    { "type": "colorChange", "delta": 1 },
    { "type": "setColor", "index": 3 },
    { "type": "setPlayerColors", "legs": 949839, "torso": 16777215 },
    { "type": "cycleAnchor", "delta": 1 }
  ],
  "ghost": {
    "yaw": 0.0,
    "rotation": { "x": 0, "y": 0, "z": 0 },
    "closestStud": { "position": { "x": 40, "y": 8, "z": 80 } },
    "closestAntiStud": { "position": { "x": 60, "y": 8, "z": 80 } }
  },
  "keepalive": true,
  "frame": 1234
}
```

Server handling:
- `keys`: Sets per-tick velocity for X/Z; space triggers jump if on ground.
- `camera`: Updates `rotation.y` (yaw) and `rotation.pitch` (pitch).
- `mouse`: Provides a world-space ray/point for grid-snapped placement fallback.
- `events`:
  - `click` with `button: 0`: place a brick. Server computes authoritative ghost placement using `closestStud` or `closestAntiStud` plus rotation (`rotation` or `rotationY`); falls back to grid snapping if no snap target.
  - `click` with `button: 2`: remove brick identified by `brickId` if present and if its `type` is not `ground`.
  - `pieceChange`: adjusts `selectedPieceIndex` by `delta` with clamping and resets anchor selection.
  - `colorChange`: increments `selectedColorIndex` by `delta` (clamped to server palette).
  - `setColor`: sets `selectedColorIndex` to `index` (clamped).
  - `setPlayerColors`: sets `colorLegs`/`colorTorso` to provided RGB ints.
  - `cycleAnchor`: cycles through anti-studs or studs; supports `delta` of +1/-1.
- `frame`: copied into `players[socketId].lastFrameCounter` for RTT measurement.
- `ghost`: Optional. Requests server to compute an authoritative `ghostPose` for preview; response is included in `stateDiff` under the local player.
- `keepalive`: Optional hint; any `inputDiff` refreshes server `lastHeardAt` for inactivity handling.

Frequency: up to render tick (nominally 60 Hz). The client only sends a diff when something changed.

### stateDiff (Server → Client)

Payload:

```json
{
  "diff": {
    "players": {
      "<socketId>": {
        "position": { "x": 5.0, "y": 50.0, "z": -2.0 },
        "lastFrameCounter": 1234,
        "ghostPose": { "pieceId": "3022", "position": { "x": 80, "y": 8, "z": 40 }, "rotation": { "x": 0, "y": 0, "z": 0 } },
        "ghostColliding": false
      },
      "otherId": { "_deleted": true },
      "newId": {
        "id": "newId",
        "position": { "x": 0, "y": 50, "z": 0 },
        "rotation": { "y": 0, "pitch": 0 },
        "velocity": { "x": 0, "y": 0, "z": 0 },
        "colorLegs": 949839,
        "colorTorso": 949839,
        "selectedPieceIndex": 0,
        "selectedColorIndex": 0,
        "selectedAntiStudIndex": 0,
        "selectedStudIndex": 0,
        "anchorMode": "anti",
        "lastFrameCounter": null,
        "_new": true
      }
    },
    "chunks": {
      "0,0,0": {
        "cx": 0, "cy": 0, "cz": 0,
        "bricks": {
          "42": { "position": { "x": 80, "y": 8, "z": 40 } },
          "99": { "_deleted": true },
          "150": {
            "id": "150",
            "position": { "x": 100, "y": 8, "z": 60 },
            "rotation": { "x": 0, "y": 0, "z": 0 },
            "colorIndex": 1,
            "pieceId": "3022",
            "type": "basic",
            "_new": true
          }
        }
      },
      "1,0,0": { "_deleted": true }
    }
  },
  "timestamp": 1710000000000
}
```

Client handling:
- Applies `diff` to local state using the delta algorithm (see below).
- Uses `players[playerId].lastFrameCounter` to compute RTT by matching the last sent `frame`.
- Creates, updates, and removes Three.js meshes per `_new`/`_deleted` and updates.
- Ensures chunk groups exist before creating brick meshes; bricks are parented under their authoritative `chunkKey` group.
- If provided, applies `players[playerId].ghostPose` and shows collision state via `ghostColliding`.

Frequency: up to 60 Hz; only emitted when there are changes since the last send.

## Delta format

Both sides use the same delta helper (`src/lib/delta-core.js`). It tracks changed paths and can produce a compact diff object.

- **Creation**: `createDeltaState()` returns a proxy-wrapped object with helpers:
  - `_diff()`: returns a diff object or `null` if nothing changed
  - `_clear()`: clears dirty tracking
  - `_pause()` / `_resume()`: suspend/resume dirty tracking (used while applying diffs)
  - `_state`: access raw object (used by the server for full-state in `init`)

- **Encoding rules**:
  - New objects are sent with all fields plus `"_new": true`.
  - Deletions are sent as `{ "_deleted": true }` at the key to remove.
  - Updates to object-typed fields send the whole object value (not a per-field patch).
  - Updates to primitive fields send the primitive value.

- **Application**: `applyDiff(target, diff)` recursively:
  - Deletes keys with `_deleted`.
  - Replaces/creates keys with `_new` (strips the flag).
  - For nested objects, ensures existence and then merges recursively.
  - For primitives, assigns directly.

Implications:
- Diffs are idempotent with respect to the current tick’s base state.
- A lost `stateDiff` is typically corrected by subsequent diffs, since objects are sent as whole values when marked dirty.

## Sequencing and timing

1. Client connects → server emits `init` with full state and metadata.
2. Client starts render/tick loop and begins sending `inputDiff` when changes occur.
3. Server ticks physics at 60 Hz and emits `stateDiff` at up to 60 Hz when changes exist.
4. Client applies `stateDiff` and updates visuals; computes RTT using `lastFrameCounter`.

## RTT estimation

- Client includes `frame` in each `inputDiff` and stores a send timestamp per frame.
- Server copies `frame` to `players[socketId].lastFrameCounter`.
- Client reads `lastFrameCounter` from `stateDiff` and computes RTT as `now - sentTime(frame)` with exponential smoothing for display.

## Security and validation

- No authentication or authoritative validation beyond basic clamping of `selectedPieceIndex`.
- Server is authoritative for world state: it creates/removes bricks and integrates player movement.
- Brick deletion requires a valid `brickId` from client picking and is rejected for `type: 'ground'` bricks.
- Brick placement is collision-checked on the server using BVH broadphase + narrow-phase tests; colliding placements are rejected.

## Keepalive and inactivity

- Clients emit lightweight `inputDiff` messages with `{ frame, keepalive: true }` every 500ms when idle.
- Server tracks `players[*].lastHeardAt` and removes inactive players if no message is received for ~2000ms.

## Versioning

- No explicit protocol versioning; server and client code are co-located and expected to match.


