# UI Data Synchronization Fix - Round Tracker

## Problem Description
The Round Tracker in the Physics Sidebar was not updating correctly because:

1. **Timing Issue**: Score updates happened in `setTimeout()` callbacks (1200ms delay), but the UI was reading state every frame
2. **Premature State Change**: The game state was set to AIMING before `finishThrow()` executed
3. **Round Counter Mismatch**: Game logic used 10 rounds but UI showed "/ 5"

## Root Cause
```javascript
// OLD CODE - BAD TIMING
setTimeout(() => {
  finishThrow();  // Updates state here (1.2 seconds later)
}, 1200);
session.gameState = GAME_STATE.AIMING; // But state changes immediately!

// Meanwhile in animate() loop...
updateRoundSummary(); // This reads OLD state before finishThrow() runs!
```

## Solution Implemented

### 1. **Removed setTimeout Delays** (main.js)
Changed from delayed execution to immediate execution:
```javascript
// NEW CODE - IMMEDIATE EXECUTION
if (session.settleTimer > 1.2 && pinsSleeping()) {
  if (_gutterPending) {
    showGameEndOverlay();
    gutterThrow();        // Execute immediately
    resetBallForAim(true);
  } else {
    showGameEndOverlay();
    notifyBallPastPins();
    finishThrow();        // Execute immediately
  }
}
```

### 2. **Fixed Round Counter Logic** (game.js)
Changed maximum rounds from 10 to 5:
- `finishThrow()`: Changed `session.round <= 10` to `session.round <= 5`
- `gutterThrow()`: Changed `session.round <= 10` to `session.round <= 5`

### 3. **Guaranteed UI Updates** (game.js)
Ensured callbacks are invoked immediately after state changes:
```javascript
// In finishThrow()
session.strikes++;
session.totalPinfall += session.lastThrowPins;
session.round++;

// Update UI IMMEDIATELY after state change
playRoundResultSfx(isStrike, isSpare, session.lastThrowPins);
_cbUpdateRoundLog();
_cbUpdateRoundSum();  // This updates Round Tracker UI
```

## Data Flow (After Fix)

```
Physics Settling (1.2s+)
    ↓
pinsSleeping() = true
    ↓
finishThrow() / gutterThrow()
    ↓
Update session state:
  - session.round++
  - session.totalPinfall += pins
  - session.strikes++ (if strike)
  - session.spares++ (if spare)
    ↓
_cbUpdateRoundSum()
    ↓
updateRoundSummary() in hud.js
    ↓
DOM updates with fresh data:
  - hud.roundNumber.textContent
  - hud.totalPinfall.textContent
  - hud.strikesCount.textContent
  - hud.sparesCount.textContent
```

## Round Tracker UI Elements
The following fields now update correctly:

1. **Round Counter**: Shows current round / 5 (e.g., "3 / 5")
2. **Total Pinfall**: Accumulates knocked pins across all throws
3. **Strikes**: Increments when all 10 pins fall on first throw
4. **Spares**: Increments when remaining pins fall on second throw

## Strike & Spare Logic
- **Strike**: `standingAfter === 0` on first throw
- **Spare**: `(first + second) >= 10` on second throw
- Both properly increment their respective UI counters

## Testing Checklist
- [x] Round counter increments correctly (1→5)
- [x] Total Pinfall accumulates accurately
- [x] Strike detection works (first throw, all pins)
- [x] Spare detection works (second throw, remaining pins)
- [x] UI updates immediately after pins settle
- [x] Game ends correctly after round 5
- [x] No race conditions between state and UI

## Files Modified
1. `main.js` - Removed setTimeout delays in checkThrowLifecycle()
2. `game.js` - Fixed round limits (10→5) and UI callback timing
3. `hud.js` - No changes needed (already working correctly)
