# FINGuard Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **Strict Owner Isolation**: A user may only read, list, create, update, or delete documents under `/users/{userId}` when `request.auth.uid == userId`, `request.auth.token.email_verified == true` (for writes), and `ownerId == request.auth.uid`.
2. **PII Isolation (Split Collection)**: Email, displayName, avatarUrl, and upiId live exclusively in `/users/{userId}/private/info` and are strictly unreadable/unlistable to any other authenticated or unauthenticated user.
3. **Master Gate Parent Existence**: Subcollections (`/trades`, `/strategies`, `/cashflow`, `/mandates`, `/private`) verify parent existence and ownership via `get(/databases/$(database)/documents/users/$(userId)).data.ownerId == request.auth.uid` on single-document operations.
4. **Immutable Ownership & Creation Timestamps**: `ownerId` and `createdAt` can never change on update. `createdAt == request.time` on create; `updatedAt == request.time` on create and update.
5. **Bounded Types & Strict Keys**: Every collection enforces exact `hasAll` + `hasOnly` key allowlists, enum allowlists, positive numeric bounds on quantities/prices/amounts, bounded array lengths (`universe.size() >= 1 && universe.size() <= 15`), and explicit `.size()` limits on all strings.
6. **Terminal State Lock on SIP Mandates**: Once a mandate reaches `status == 'CANCELLED'`, no further updates are permitted.
7. **Zero Unfiltered List Queries**: Every `allow list` validates `resource.data.ownerId == request.auth.uid` without calling `get()` or `exists()`.

## 2. "Dirty Dozen" Attack Payloads (All Must Return PERMISSION_DENIED)
1. **Unauthenticated Read/Write**: Read `/users/userA` with `auth == null`.
2. **Unverified Email Write**: Create `/users/userA` with `email_verified: false`.
3. **Cross-Tenant Account Takeover**: `userB` attempts to `get` `/users/userA/private/info`.
4. **Owner Spoofing on Create**: `userB` writes `/users/userB/trades/t1` with `ownerId: 'userA'`.
5. **Shadow / Ghost Field Injection**: `userA` creates `/users/userA` injecting `{ isAdmin: true }` or `{ tier: 'ENTERPRISE' }`.
6. **Path ID Poisoning**: `userA` attempts to write `/users/userA/trades/invalid$id..1234` violating `^[a-zA-Z0-9_\-]+$`.
7. **Backdated / Forged Timestamp**: `userA` creates `/users/userA/trades/t1` with `createdAt: '2020-01-01T00:00:00Z'` instead of server `request.time`.
8. **Immutable Field Mutation**: `userA` updates `/users/userA/trades/t1` attempting to mutate `createdAt` or `ownerId`.
9. **Negative / Zero Financial Value**: `userA` writes `/users/userA/trades/t1` with `quantity: -5` or `priceInr: 0`.
10. **Unbounded String / Denial-of-Wallet Payload**: `userA` writes `/users/userA/strategies/s1` with a 5,000-char `promptText` (> 500 max) or 25 tickers in `universe` (> 15 max).
11. **Terminal State Bypass**: `userA` attempts to reactivate a `CANCELLED` mandate in `/users/userA/mandates/m1` back to `ACTIVE`.
12. **Blanket List Scraping**: `userB` attempts an unconstrained collection/document list on `/users/userA/trades` or `collectionGroup('trades')`.
