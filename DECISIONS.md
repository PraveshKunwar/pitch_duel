# Decisions

## Raw SQL instead of an ORM

Write SQL by hand with `pg` so queries, transactions, and indexes stay explicit for interviews. Tradeoff: more boilerplate than Prisma/Drizzle.

## Argon2id for passwords

Hash passwords with Argon2id via `argon2`. The library owns the salt; only the encoded string is stored in `password_hash`.

## Access JWT + rotating refresh cookies

Short-lived access JWTs (15m, `sub` = user id). Refresh tokens are random, SHA-256 hashed in Postgres, rotated on each use, with family revoke on reuse. Delivered as HttpOnly Secure SameSite=lax cookies on `/auth`.

## WebSocket tickets (day 6)

Do not put the access JWT in the WebSocket URL. `POST /auth/ws-ticket` (JWT-protected) issues a 30s one-time Redis ticket (`SET` hash → userId with TTL; consume with `GETDEL`). The client connects to `/ws?ticket=...`.

## In-memory game sessions (day 6)

Live matches for the WebSocket milestone live in a process-local `GameSessionStore`. Sequence numbers for duplicate detection are also process-local. This is **not** horizontally safe. Day 8 should move authoritative live state (and sequences) into Redis; day 11 adds pub/sub across instances.

## Heartbeats vs reconnect grace

WS ping/pong every 30s detects dead TCP connections. The 60-second mid-game reconnect grace period is a later milestone and is intentionally separate.
