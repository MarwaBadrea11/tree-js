# Three.js Bowling Game (Custom Physics)

This project is a beginner-friendly bowling game built with Three.js and plain JavaScript.
It does not use external physics engines.

## Features

- Custom physics loop using vectors and fixed time step
- Manual gravity + ground friction for ball motion
- Ball to pin and pin to pin collision response
- Pin collapse animation using angular velocity
- Camera modes:
  - Aiming: first-person style view from player side
  - Rolling: third-person follow camera behind the ball
- Throw strength control:
  - Keyboard: hold Space and release
  - Touch: power slider + Roll button
- Physics sidebar with live calculations:
  - speed, momentum, kinetic energy, friction force, gravity force

## Setup

1. Install Node.js LTS from https://nodejs.org
2. Open this folder in VS Code
3. Run in terminal:

```bash
npm install
npm run dev
```

4. Open the local URL printed in terminal (usually http://localhost:5173)

## Controls

- A / D or Left / Right: aim direction
- Space hold: increase roll power
- Space release: roll ball
- R: reset the full game
- Mobile/tablet: use Aim slider, Power slider, and Roll button

## Game Flow

- 10 rounds total
- Each round has up to 2 throws
- Strike: all pins in first throw
- Spare: all pins across 2 throws
- Sidebar tracks total pinfall, strikes, and spares
