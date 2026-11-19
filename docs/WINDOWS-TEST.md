# Windows test checklist

The app was developed on Linux. These checks need Windows and the game. Record pass or fail and any error text.

## Start

| # | Check | Expected |
|---|---|---|
| 1 | Run `DBD Overlay.exe` | Main window opens. Tray icon appears |
| 2 | Run it a second time | The first window comes to the front. No second copy |
| 3 | Home page with the game closed, then open | Status changes to "Dead by Daylight is running" within about 5 seconds |

## Overlays over the game (borderless or windowed mode)

| # | Check | Expected |
|---|---|---|
| 4 | 1v1 Timer, Show on screen | Timer appears above the game |
| 5 | Drag it while unlocked | It moves. Position is kept after restart |
| 6 | Lock it, click where it sits | The click reaches the game |
| 7 | Size and Background sliders | Overlay scales, its window resizes to fit |
| 8 | F8 | All overlays hide and return |
| 9 | Crosshair, Show on screen | Mark sits at the exact screen center |
| 10 | OBS: add a Browser source with an overlay URL | Overlay shows with a transparent background |

## Hotkeys

| # | Check | Expected |
|---|---|---|
| 11 | Standard mode, game focused, press F1 | Timer starts. The game does not receive F1 |
| 12 | Settings, click a binding, press a key | Binding changes |
| 13 | Pass-through mode, bind the crouch key to timer start | Crouching in game also starts the timer |
| 14 | If 13 does nothing | Run the app as administrator and retry |
| 15 | Pass-through, bind a mouse side button | It triggers the action |
| 16 | Hold a pass-through key down | The action fires once, not repeatedly |

## Map detection

| # | Check | Expected |
|---|---|---|
| 17 | Map Callouts, detection on, load into a trial | Map locks within a few seconds. Reader shows "Windows OCR" |
| 18 | "Last text read" during the loading screen | Contains the map name |
| 19 | Reach the end-of-match screen | Map unlocks. It does not lock again on the same screen |
| 20 | A map with variants | F9 switches variant |
| 21 | Set Reader to "Tesseract only", repeat 17 | Map locks (may be slower) |
| 22 | Two monitors | The monitor with the game is the one read (primary display) |

## Sound

| # | Check | Expected |
|---|---|---|
| 23 | Perk Timers overlay shown, fire a 10 s timer | Short tone 3 s before the end, longer tone at the end |

## Data

| # | Check | Expected |
|---|---|---|
| 24 | Build Library, Load preset list, import DBDLeague | Ruleset appears with ban counts |
| 25 | Close and reopen the app | Builds, stats, layout and hotkeys are kept |
