# Batch accounting fixes

> **For agentic workers:** Execute task by task with `superpowers:executing-plans`; retain the red/green evidence for each regression.

**Goal:** Correct the eight findings from the review of commit `5aa1af6`.
**Architecture:** Keep warehouse-specific batches and moving-average costing. Allocate batches inside the existing balance locks; transfers preserve each portion's number, dates and quantity. Keep serial processing at original document-line granularity.
**Tech Stack:** Bun, TypeScript, Drizzle/PostgreSQL, Hono, React/TanStack Query.
**Spec:** The eight review findings in this chat; `docs/architecture/stock.md`.

## Constraints

- Preserve existing unrelated working-tree changes. No deployment or applied-migration edits.
- Tenant context/RLS, decimal arithmetic and existing document transactions remain mandatory.
- User requested implementation in order; proceed in this chat without another approval gate.
- Tests use the dedicated local test database. No production data changes.

## Review focus

- Two concurrent withdrawals must not overdraw the same batch (task 1).
- Partial acceptance must use this shipment's batches, not another shipment's FEFO stock (task 2).
- Legacy unbatched stock must remain transferable after enabling tracking (task 2).
- Unposting must retain referenced zero-balance batches and enforce the negative-stock policy (task 5).
- Omitting batch fields preserves them; explicit null clears them (task 6).

## Steps

- [x] 1. `packages/db/src/stock.ts`, `apps/api/test/batches.test.ts`: add a deterministic concurrent 7+7 withdrawal from batches 10+10 (expect 0+6), observe red, acquire balance locks before `assignBatches`, observe green.
- [x] 2. `packages/db/src/batches.ts`, `apps/api/test/batches.test.ts`: add ordinary/transit/partial-transfer regressions, observe red, retain every outgoing portion and create or reuse corresponding destination batches with original dates. Scope transit acceptance to the document's phase-1 incoming portions; preserve unbatched portions. Observe green, including competing shipments and cancellation.
- [x] 3. `packages/db/src/production.ts`, `apps/api/test/batches.test.ts`: add a production release with saved incoming batch details, observe red, pass `lineBatches` for production and disassembly receipts, observe green.
- [x] 4. `packages/db/src/stock.ts`, `apps/api/test/batches.test.ts`: add a two-batch/two-serial withdrawal, observe red, pass original requests to `applySerialMoves`, observe green.
- [x] 5. `packages/db/src/batches.ts`, `packages/db/src/stock.ts`, `apps/api/test/batches.test.ts`: reproduce FK failure on unpost, delete only unreferenced batches, retain referenced zero balances, reject negative balances with `stock_conflict` unless negative stock is allowed. Observe green for both policies and reposting.
- [ ] 6. `packages/db/src/documents.ts`, `apps/api/test/batches.test.ts`: test null clearing versus omission, observe red, preserve undefined through line resolution and use undefined-only fallbacks in `saveLines`, observe green.
- [ ] 7. `packages/db/src/schema/documents.ts`, `packages/db/test/fk-set-null.test.ts`: align the declared FK target with the existing migration; verify the generated FK metadata and actual deletion behavior without changing migration 0090.
- [ ] 8. `packages/db/src/batches.ts`, `apps/api/src/routes/documents.ts`, `apps/web/src/app/docs/BatchesPage.tsx`: test report names/search at the API boundary, return product/warehouse names and connect search, render names and formatted quantities. Verify frontend behavior, update user docs and verification hashes.
- [ ] Run related integration tests, workspace typecheck and full test suite; inspect diff, report any unrelated failures explicitly.

## Execution log

Initial review: workspace typecheck and 56 existing tests passed; seven additional scenarios reproduced the first six findings. Schema/report findings confirmed by source inspection.

Task 1 complete: concurrent regression RED (-4/10) → GREEN (0/6); 7 batch tests pass.
Ruling: work in the existing feature branch `feat/batches-1187`, preserving unrelated changes; keep the plan as execution ledger and leave changes uncommitted for review.

Task 2 complete: three transfer regressions RED → GREEN; all 10 batch tests pass. Transit acceptance is restricted to this document/line/warehouse phase-1 portions. Legacy unbatched portions remain unbatched.

Tasks 3–5: assembly/disassembly, serial transfer/withdrawal, referenced-zero-balance unpost and negative-policy regressions RED → GREEN. Validation moved to /private/tmp/gr8r-batches.yU09Fc with gr8r_batch_fix_test after user confirmed concurrent work on 1186.
Ruling: negative batches on unpost follow allowNegativeStock; default rejection uses stock_conflict and rolls back, explicit opt-in retains referenced negative batches.
