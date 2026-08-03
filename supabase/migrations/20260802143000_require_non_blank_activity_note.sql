-- Require a note to carry actual text (docs/backlog.md, issue #76).
--
-- `activity_note_requires_text` only checked `note is not null`, and the length
-- check is `<= 2000`, so '' and '   ' both inserted. The activity trail is
-- append-only for EVERYONE — no UPDATE/DELETE policy, no grant, a forbid
-- trigger, and (since 2026-08-01) not even a service_role privilege — which
-- makes a blank note permanent and unfixable in the table CLAUDE.md §5 calls a
-- product feature. The Phase 3 note form is the first client that can write one,
-- so the hole closes with the surface that opens it.
--
-- Forward migration, not an edit: the original is on `main` (CLAUDE.md §5).
--
-- `note is not null` has to stay in the predicate. A CHECK evaluating to NULL
-- passes, and char_length(trim(null)) is NULL — so testing the trimmed length
-- alone would let a null note through on a 'note_added' row, which is the exact
-- case the constraint exists to prevent.

alter table public.work_order_activity
  drop constraint activity_note_requires_text;

alter table public.work_order_activity
  add constraint activity_note_requires_text
    check (
      action <> 'note_added'
      or (note is not null and char_length(trim(note)) > 0)
    );
