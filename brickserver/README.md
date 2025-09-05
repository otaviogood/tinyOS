# BrickQuest Server

A simple Node.js server for the multiplayer LEGO building game.

## Getting Started

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
npm start
```
Or start it with nodemon watching for changes and autorestarting:
```bash
npm run dev
```

The server will run on port 3001 by default.

## Architecture

This is a thin-client architecture where:
- Client sends keyboard/mouse input to server
- Server processes all game logic and physics
- Server sends back game state to all clients
- Clients only handle rendering

## Features

- Supports up to 10 concurrent players
- Real-time block placement/removal
- Simple physics (gravity, jumping)
- 16x16x10 block grid
- WebSocket communication using Socket.io

## Network Protocol

### Client → Server:
- `input`: Keyboard state, mouse position, and click events

### Server → Client:
- `init`: Initial game state when player joins
- `playerJoined`: New player connected
- `playerLeft`: Player disconnected
- `stateUpdate`: Regular position updates (20Hz)
- `blockUpdate`: Block placement/removal events 