# DBD Overlay (working name)

Free, open source overlay toolkit for Dead by Daylight. Built for scrim, league and 1v1 players, usable by anyone.

Not affiliated with or endorsed by Behaviour Interactive. Use at your own risk: Behaviour has not published a position on overlay tools. This app reads no game memory and sends no input to the game.

## Tools

| Tool | Status |
|---|---|
| 1v1 Timer (two runs, rounds, penalty) | Working |
| Crosshair | Working |
| Perk Timers (hotkey-fired, tone per timer) | Working |
| Streak Counter | Working |
| Perk Shuffle | Working |
| Killer Shuffle | Working |
| Build Library with ruleset check | Working |
| Lobby Perks | Working, manual entry |
| Match Scoreboard (sets, hook stages, gens, kills) | Working, manual entry |
| Statistics | Working, manual entry |
| Challenges | Working |
| Map Callouts | Working with your own images. Map detection by screen reading: untested against the game |
| My League (roster, roles) | Local only |
| Party, live league tracking, friends | Planned, needs a server. See `docs/ONLINE.md` |

Every tool has an in-app panel and an overlay. An overlay can be shown as a window over the game (borderless or windowed mode) or added to OBS as a browser source from its local URL.

## Run

```bash
npm install
```

```bash
npm start
```

```bash
npm test
```

## Layout

| Path | Contents |
|---|---|
| `src/main/tools.js` | Tool state and actions. Plain logic, unit tested |
| `src/main/main.js` | Windows, hotkeys, local server (127.0.0.1 only) |
| `src/ui/` | Main window |
| `src/overlay/` | Overlay pages, shared by app windows and OBS |
| `src/main/detect.js` | Map detection: screen capture, OCR, fuzzy match |
| `data/` | Perk, character and map names. Refresh with `npm run update-data` |
| `assets/game/` | Perk icons and portraits. Refresh with `npm run update-assets` |

## Data and credits

Perk and character names come from the dbd.tricky.lol community API. Perk icons and portraits come from deadbydaylight.wiki.gg. Dead by Daylight, its names and its art are property of Behaviour Interactive and are not covered by the MIT license. See `assets/game/NOTICE.md`.

## License

MIT. See `LICENSE`.
