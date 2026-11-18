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
| Map Callouts, Build Library, Match Scoreboard, Lobby Perks, Statistics, Challenges | Planned |
| Party, League Tracker | Planned, needs a server |

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
| `data/` | Perk and character names. Refresh with `npm run update-data` |

## Data and credits

Perk and character names come from the dbd.tricky.lol community API. Dead by Daylight and its names are property of Behaviour Interactive. No game art is included in this repository.

## License

MIT. See `LICENSE`.
