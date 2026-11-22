> Question: The open-source reverse-engineered reimplementations of Grand Theft Auto III and Vice City (the re3 and reVC projects) contain the original games' camera code. How do those games implement the third-person camera that follows the player on foot and the one that follows a car? Name the source files, classes, functions and constants involved, and say where the source can be read today. Cite sources.

The re3/reVC camera is organized around `CCamera`, which selects an active `CCam` mode each frame; `CCam::Process()` then dispatches to the mode-specific implementation. The relevant source is in the public re3 repository’s `src/core` directory, with the same camera code used by the `miami` branch for reVC.[2]

## Main source files and classes

- `src/core/Camera.h` — declares `CCamera`, camera-mode identifiers, camera state, zoom constants, and the `CCam` interface.[3]
- `src/core/Camera.cpp` — implements `CCamera`, including per-frame camera control, target selection, mode changes, collision/geometry handling, and camera input.[1]
- `src/core/Cam.cpp` — implements `CCam`’s actual camera algorithms, including pedestrian, vehicle, boat, aiming, and scripted-camera modes.[1][3]

The principal classes are:

- `CCamera` — owns the camera array, chooses the active camera mode, tracks the target entity, processes input, and updates the rendered camera.
- `CCam` — represents one camera mode and contains the mode-specific position/orientation calculations.
- `CPed` and `CVehicle` — provide the player/vehicle target and orientation data consumed by the camera code.

## On-foot camera

The normal third-person pedestrian camera uses the `MODE_FOLLOWPED` mode, whose implementation is:

```cpp
CCam::Process_FollowPed(...)
```

in `src/core/Cam.cpp`.[1][3]

`CCamera::CamControl()` selects `MODE_FOLLOWPED` when the active target is the player pedestrian and no more specialized state—such as aiming, being arrested, swimming, entering a vehicle, or a scripted camera—takes precedence.[1]

`Process_FollowPed()` broadly does the following:

- Uses the player ped as the camera target.
- Maintains the camera at a configurable distance and height behind/around the ped.
- Uses the camera’s horizontal angle, `Beta`, and vertical angle, `Alpha`, to construct the camera position.
- Smooths angular and positional changes rather than snapping immediately.
- Re-centers behind the player when the “center camera” control is pressed or when game logic requests it.
- Adjusts the camera to avoid world geometry and obstructions.
- Applies the three ordinary zoom settings represented by `CAM_ZOOM_1`, `CAM_ZOOM_2`, and `CAM_ZOOM_3`.[1][3]

The PC mouse variant is:

```cpp
CCam::Process_FollowPedWithMouse(...)
```

also in `src/core/Cam.cpp`.[3] It uses mouse input to change `Beta` (yaw) and `Alpha` (pitch), applies the mouse-acceleration variables such as `m_fMouseAccelHorzntl` and `m_fMouseAccelVertical`, and performs line-of-sight/geometry correction so the camera does not remain inside walls or other objects.[3]

The camera’s smoothing and “return toward a desired angle” behavior is implemented through helpers such as `WellBufferMe()`, while geometry avoidance is handled through camera collision helpers including `AvoidTheGeometry()`.[1][3]

## Car-following camera

For a normal automobile, `CCamera::CamControl()` selects the vehicle-following modes, principally:

```cpp
MODE_BEHINDCAR
MODE_CAM_ON_A_STRING
```

with boat-specific behavior represented separately by `MODE_BEHINDBOAT`.[1][3]

The standard behind-car implementation is in `CCam.cpp` as the corresponding `CCam::Process_BehindCar(...)` routine. The “camera on a string” implementation is:

```cpp
CCam::Process_Cam_On_A_String(...)
```

which the reverse-engineered source describes as the principal spherical vehicle-following algorithm.[1]

`Process_Cam_On_A_String()` follows the vehicle by treating the camera as if attached to the target by a flexible string:

- The vehicle is the target entity.
- `Beta` controls the camera’s orbit/yaw around the vehicle.
- `Alpha` controls elevation.
- The target’s position and orientation determine the desired camera position.
- Distance changes with the selected zoom level.
- Vehicle pitch and special vehicle types affect the vertical placement.
- The result is smoothed and corrected for obstacles before being committed to the game camera.[1]

The vehicle algorithm also contains special handling for boats, helicopters, and remote-control vehicles; those cases are selected through other camera modes or branches in the same camera-processing code.[1]

## Important constants and state

The most visible named constants are the camera-mode identifiers in `Camera.h`:

```cpp
MODE_FOLLOWPED
MODE_BEHINDCAR
MODE_BEHINDBOAT
MODE_CAM_ON_A_STRING
```

and the ordinary zoom identifiers:

```cpp
CAM_ZOOM_1
CAM_ZOOM_2
CAM_ZOOM_3
```

The principal continuously changing camera variables are:

- `Alpha` — vertical camera angle/elevation.
- `Beta` — horizontal orbit angle/yaw.
- Camera target position and orientation.
- Camera distance/ground-distance values.
- Mouse acceleration fields, including `m_fMouseAccelHorzntl` and `m_fMouseAccelVertical`.
- `m_fMinRealGroundDist`, used by the follow/string-style logic to maintain a usable distance from the ground and target.[1][3]

The exact formulas are distributed among `CCamera::CamControl()`, `CCam::Process()`, the mode-specific `Process_*` methods, smoothing helpers such as `WellBufferMe()`, and geometry routines such as `AvoidTheGeometry()` rather than being contained in one single “follow camera” function.[1][3]

## Where to read it today

The source can be read in the public GitHub repository **gibesauce/re3**:

- GTA III: the repository’s main branch.
- Vice City: the `miami` branch, which contains reVC.[2]

Within either branch, start with:

```text
src/core/Camera.h
src/core/Camera.cpp
src/core/Cam.cpp
```

The repository identifies itself as a fully reverse-engineered source tree for GTA III and Vice City, and states that reVC was developed from the re3 codebase.[2]

[1] Camera System | mrxenginner/reVC | DeepWiki (https://deepwiki.com/mrxenginner/reVC/10-camera-system)
[2] github.com · gibesauce · re3GitHub - gibesauce/re3 (https://github.com/gibesauce/re3)
[3] Camera Modes | mrxenginner/reVC | DeepWiki (https://deepwiki.com/mrxenginner/reVC/10.1-camera-modes)
[4] github.com · repomansez · reVCGitHub - repomansez/reVC (https://github.com/repomansez/reVC)
[5] Cai1Hsu/re3: Fuck you, Take Two (https://github.com/Cai1Hsu/re3)
[6] GitHub - toryren/re3: GTA III, Vice City (https://github.com/toryren/re3)
[7] GitHub - bani4kaskashka/GTA-Trilogy-DE-NoControllerCam-Papers ... (https://github.com/bani4kaskashka/GTA-Trilogy-DE-NoControllerCam-Papers)
[8] GitHub - HeavyDutyGames/Re3 (https://github.com/HeavyDutyGames/Re3)
[9] github.com › gmh5225 › reGTAGitHub - gmh5225/reGTA: Reverse Engineered GTA III and GTA VC (https://github.com/gmh5225/reGTA)
[10] GitHub - LakoMoor/reGTA: GTA III, Vice City (https://github.com/LakoMoor/reGTA)
