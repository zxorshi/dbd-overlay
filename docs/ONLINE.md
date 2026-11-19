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

## Backend options (researched 2026-11-19)

| Option | Free tier that matters here | Discord login | Role enforcement | Main drawback |
|---|---|---|---|---|
| Supabase | 50k monthly users, 500 MB database, 200 concurrent realtime connections, 2M realtime messages a month | Built in | Row level security on tables and on realtime channels | Free projects pause after a week without activity |
| Cloudflare Workers + Durable Objects + D1 | 100k requests a day, D1 5M row reads a day | Hand-written in a Worker | Own code in the room object | Auth, sessions and every permission check are written by hand |
| Firebase | 100 simultaneous realtime connections | Not built in | Security rules and custom claims | Proprietary, no self-host |
| PocketBase on a VM | Limited by the VM | Built in | Collection rules | A server to run and pay for |
| Discord only | No fee | Native | Bot code | A bot still needs a host and a database |

Ranking from the research: Supabase first (covers login, data and rooms without server code), Cloudflare second (never pauses, more work). Not verified: whether Supabase counts broadcast messages per recipient; Appwrite and Convex details.

Because the client is open source, any key in the app is public. Access control has to live in server-side rules.

Design rule that follows from the message quota: send events (timer started at T, hook on survivor 2), never ticks.
