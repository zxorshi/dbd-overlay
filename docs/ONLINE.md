# Online features: design notes

Party, live league tracking, profiles, friends and stat comparison need accounts and a server. No backend is chosen yet.

## What exists now

All app state changes go through one function: `dispatch(state, actionName, payload)` in `src/main/tools.js`. Actions are plain data (`'score.bump', { field: 'stages', delta: 1 }`).

## How a server attaches

A sync adapter sits between the UI and `dispatch`:

| Method | Purpose |
|---|---|
| `connect(session)` | Sign in, join a party or league room |
| `send(actionName, payload)` | Forward a local action for shared state slices |
| `onRemote(fn)` | Receive actions from other members and pass them to `dispatch` |
| `permissions(role)` | Which action prefixes a role may send |

Shared slices by feature:

| Feature | State slice | Who writes |
|---|---|---|
| Party | `timer`, `map`, `lobby` | Any party member |
| League tracker | `score` | Referee, admin, owner |
| League roster | `league` | Admin, owner |
| Stat comparison | `stats` (read-only copy) | Each player, own data |

Any backend that can relay small JSON messages to a room and identify the sender fits this shape.
