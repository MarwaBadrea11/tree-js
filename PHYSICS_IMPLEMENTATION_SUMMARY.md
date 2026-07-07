# Bowling Pin Physics Implementation Summary

## Overview
This document summarizes the refactored custom rigid-body physics engine for bowling pins in the Three.js application, implementing exact mathematical and physical specifications for real-time stability and realistic chain reactions.

---

## 1. Pin Rigid Body Properties

### Constants (defined in `src/core/constants.js`):
- **Mass**: `1.5 kg` (regulation bowling pin mass)
- **Collision Radius**: `0.20 m` (effective cylindrical collision detection)
- **Cap Radius**: `0.06 m` (bottom cap for ground contact)
- **Half Segment**: `0.40 m` (half height of pin body)

```javascript
export const PIN_MASS = 1.5;
export const PIN_COLLIDER_RADIUS = 0.20;
export const PIN_CAP_RADIUS = 0.06;
export const PIN_HALF_SEGMENT = 0.40;
```

---

## 2. Collision Resolution & Restitution

### Restitution Coefficients:
- **Ball-to-Pin**: `e = 0.22` (22% energy retention)
- **Pin-to-Pin**: `e = 0.18` (18% energy retention - more energy loss in chain reactions)

```javascript
export const BALL_PIN_RESTITUTION = 0.22;
export const PIN_PIN_RESTITUTION = 0.18;
```

### Implementation:
The collision resolution function implements **conservation of linear momentum**:

```
j = -(1 + e) × v_rel · n / (1/m_A + 1/m_B)
```

Where:
- `j` = impulse magnitude
- `e` = coefficient of restitution
- `v_rel` = relative velocity
- `n` = collision normal
- `m_A, m_B` = masses of colliding bodies

**File**: `src/physics/collisions.js` → `resolveSphereContact()`

---

## 3. Friction & Damping Application

### Damping Coefficients (frame-rate independent):
- **Linear Damping**: `0.987` per frame
- **Angular Damping**: `0.977` per frame

```javascript
export const PIN_LINEAR_DAMPING = 0.987;
export const PIN_ANGULAR_DAMPING = 0.977;
```

### Friction Model:
For Pin-to-Pin collisions, tangential friction is modeled as:

```
F_friction = c_damping × v_relative
```

This bypasses complex surface calculations while maintaining realistic behavior.

**Implementation**: `src/physics/physicsEngine.js` → `integratePins()`

```javascript
const horizDecay = Math.pow(PIN_LINEAR_DAMPING, dt * 60);   // 0.987 per frame
const angularDecay = Math.pow(PIN_ANGULAR_DAMPING, dt * 60); // 0.977 per frame

pin.velocity.x *= horizDecay;
pin.velocity.z *= horizDecay;
pin.angularVelocity.multiplyScalar(angularDecay);
```

---

## 4. Numerical Integration Loop

### Method: **Semi-implicit Euler**
Updates velocity first, then position to prevent tunneling:

```
1. v(t+dt) = v(t) + a(t) × dt    // Update velocity
2. x(t+dt) = x(t) + v(t+dt) × dt  // Update position with new velocity
```

### Fixed Timestep:
- **dt = 1/120 seconds** (0.00833s)

```javascript
export const FIXED_DT = 1 / 120;
```

### Integration Steps (per frame):

#### Step 1: Update Velocity
```javascript
// Apply gravity
pin.velocity.y -= GRAVITY * dt;

// Apply damping
pin.velocity.x *= horizDecay;
pin.velocity.z *= horizDecay;
```

#### Step 2: Update Position
```javascript
pin.mesh.position.addScaledVector(pin.velocity, dt);
```

#### Step 3: Update Rotation
```javascript
const angSpeed = pin.angularVelocity.length();
if (angSpeed > 1e-6) {
  _axis.copy(pin.angularVelocity).normalize();
  _quat.setFromAxisAngle(_axis, angSpeed * dt);
  pin.mesh.quaternion.premultiply(_quat).normalize();
}
```

**File**: `src/physics/physicsEngine.js` → `integratePins()`

---

## 5. Accurate Knockdown Logic (Settling Phase)

### Tilt Angle Calculation:
The system calculates the **true spatial angular deviation** by applying the pin's 3D rotation matrix (Quaternion) to the world's up vector `[0, 1, 0]`.

### Formula:
```
tilt = arccos(up_y)
```

Where `up_y` is the Y component of the rotated up vector.

### Knockdown Threshold:
- **28 degrees** (0.4887 radians)

```javascript
export const KNOCK_ANGLE = THREE.MathUtils.degToRad(28);
```

### Implementation:
```javascript
export function markKnockedPins() {
  const _upVec = new THREE.Vector3();

  for (const pin of pins) {
    if (!pin.active || pin.knocked) continue;

    // Apply quaternion rotation to world up vector [0, 1, 0]
    _upVec.set(0, 1, 0).applyQuaternion(pin.mesh.quaternion);
    
    // Calculate tilt angle: θ = arccos(up_y)
    const tilt = Math.acos(clamp(_upVec.y, -1, 1));

    // Pin is knocked down if tilt exceeds 28°
    if (tilt > KNOCK_ANGLE) {
      pin.knocked = true;
    }
  }
}
```

**File**: `src/physics/collisions.js` → `markKnockedPins()`

---

## 6. Out-of-Bounds Optimization

### Boundaries:
Pins are immediately deactivated and hidden if they exceed:
- **Y > 6.0 m** (flying too high)
- **|Z| > 60.0 m** (beyond lane bounds)
- **|X| > 10.0 m** (laterally out of bounds)

### Implementation:
```javascript
if (pin.mesh.position.y > 6.0 || 
    Math.abs(pin.mesh.position.z) > 60.0 || 
    Math.abs(pin.mesh.position.x) > 10.0) {
  pin.active = false;
  pin.mesh.visible = false;  // Save rendering costs
}
```

**File**: `src/physics/physicsEngine.js` → `integratePins()`

---

## 7. Real-Time Physics-to-Graphics Binding

### Synchronization:
The mathematical position and quaternion matrices are **directly updated** on the Three.js mesh object in the same frame:

```javascript
// Position update
pin.mesh.position.addScaledVector(pin.velocity, dt);

// Rotation update
pin.mesh.quaternion.premultiply(_quat).normalize();
```

Three.js automatically renders the updated transforms in the next render frame. No additional synchronization is needed.

**File**: `src/physics/physicsEngine.js` → `integratePins()`

---

## 8. Collision Handlers

### Ball-to-Pin Collisions
- Uses `BALL_PIN_RESTITUTION = 0.22`
- Applies angular impulse for realistic tipping
- Handles low-impulse grazing collisions

**File**: `src/physics/collisions.js` → `solveBallPinCollisions()`

### Pin-to-Pin Collisions (Chain Reactions)
- Uses `PIN_PIN_RESTITUTION = 0.18`
- Applies mutual torque (Newton's third law)
- Models friction via damping coefficient against relative velocity

**File**: `src/physics/collisions.js` → `solvePinPinCollisions()`

---

## 9. Ground Collision & Friction

### Dynamic Bottom Height Calculation:
```javascript
_up.set(0, 1, 0).applyQuaternion(pin.mesh.quaternion);
let bottomHeight = PIN_HALF_SEGMENT * Math.abs(_up.y) + PIN_CAP_RADIUS;

// Clamp for knocked/tilted pins
if (pin.knocked || Math.abs(_up.y) < 0.85) {
  bottomHeight = Math.min(bottomHeight, pin.radius || PIN_CAP_RADIUS);
}
```

### Ground Friction:
- **Upright pins**: 92% velocity retention
- **Knocked pins**: 85% velocity retention (higher friction)

### Sleeping Threshold:
Pins come to complete rest when:
- Linear velocity² < 0.0003
- Angular velocity² < 0.0006

**File**: `src/physics/physicsEngine.js` → `integratePins()`

---

## Mathematical Summary

| Property | Value | Formula/Description |
|----------|-------|---------------------|
| **Pin Mass** | 1.5 kg | Regulation bowling pin |
| **Collision Radius** | 0.20 m | Effective cylinder |
| **Ball-Pin Restitution** | 0.22 | 22% energy retention |
| **Pin-Pin Restitution** | 0.18 | 18% energy retention |
| **Linear Damping** | 0.987 | Frame-independent decay |
| **Angular Damping** | 0.977 | Rotational slowdown |
| **Knockdown Angle** | 28° | θ = arccos(up_y) |
| **Fixed Timestep** | 1/120 s | 0.00833 seconds |
| **Integration** | Semi-implicit Euler | v first, then x |
| **Friction Model** | F = c_damping × v_rel | Simplified tangential force |

---

## Files Modified

1. **`src/core/constants.js`**
   - Updated pin physical constants
   - Added detailed documentation

2. **`src/physics/physicsEngine.js`**
   - Refactored `integratePins()` with Semi-implicit Euler
   - Implemented frame-rate independent damping
   - Added out-of-bounds optimization
   - Enhanced ground collision handling

3. **`src/physics/collisions.js`**
   - Refactored `resolveSphereContact()` with conservation of momentum
   - Updated `solveBallPinCollisions()` with correct restitution
   - Updated `solvePinPinCollisions()` with friction modeling
   - Enhanced `markKnockedPins()` with accurate tilt calculation

---

## Testing Recommendations

1. **Collision Response**: Verify energy conservation in Ball-Pin impacts
2. **Chain Reactions**: Test Pin-Pin domino effects with correct restitution
3. **Settling Behavior**: Confirm pins settle realistically with damping
4. **Knockdown Detection**: Validate 28° threshold accuracy
5. **Out-of-Bounds**: Test boundary detection at extreme velocities
6. **Frame Rate Independence**: Verify consistent behavior at different FPS

---

## Performance Optimizations

- **Object Pooling**: Reused vectors (`_up`, `_axis`, `_quat`, `_spin`) prevent allocations
- **Early Exits**: Inactive pins skip processing entirely
- **Visibility Culling**: Out-of-bounds pins hidden from renderer
- **Fixed Timestep**: Consistent physics regardless of render FPS
- **Sleeping Detection**: Static pins can be excluded from updates

---

## Conclusion

The refactored physics engine now implements:
✅ Exact pin mass (1.5 kg) and collision radius (0.20 m)
✅ Correct restitution coefficients (0.22 Ball-Pin, 0.18 Pin-Pin)
✅ Frame-independent damping (0.987 linear, 0.977 angular)
✅ Semi-implicit Euler integration (dt = 1/120s)
✅ Accurate knockdown detection (28° tilt threshold)
✅ Out-of-bounds optimization (Y>6, |Z|>60, |X|>10)
✅ Real-time physics-to-graphics synchronization

The system provides stable, realistic bowling pin physics with proper energy conservation, momentum transfer, and settling behavior for chain reactions.
