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
-- passes, and btrim(null, …) is NULL — so testing the trimmed value alone would
-- let a null note through on a 'note_added' row, which is the exact case the
-- constraint exists to prevent.
--
-- The character set is spelled out rather than left to trim(), whose default is
-- the ASCII space and nothing else: a note of tabs or newlines comes back from
-- trim() unchanged and passes any length test built on it. `authenticated` holds
-- `insert (work_order_id, note)`, so such a note reaches the table through a
-- direct Data API call without ever meeting the zod schema — this constraint is
-- the only thing between PostgREST and a permanently blank entry in the trail
-- (CLAUDE.md §2: the client may mirror the rule, the database enforces it).
--
-- The set is exactly what String.prototype.trim() removes (ECMAScript
-- WhiteSpace + LineTerminator), so this constraint and `addNoteSchema`'s
-- .trim().min(1) in src/schemas/work-order.ts accept and reject the same
-- strings; neither is the softer of the two. Written as literal code points
-- rather than a [:space:] regex on purpose — character classes resolve against
-- the database's ctype, and a constraint whose meaning shifts with the host's
-- locale is not one to carry into a self-host (CLAUDE.md §7).

alter table public.work_order_activity
  drop constraint activity_note_requires_text;

alter table public.work_order_activity
  add constraint activity_note_requires_text
    check (
      action <> 'note_added'
      or (
        note is not null
        -- Tab, LF, VT, FF, CR, space, NBSP, ogham space, the U+2000–U+200A
        -- quad/em/thin family, line/paragraph separator, narrow NBSP, medium
        -- mathematical space, ideographic space, and the zero-width no-break
        -- space a paste from a rich-text editor leaves behind. UESCAPE '!' so
        -- the code points read as code points.
        and btrim(
              note,
              U&'!0009!000A!000B!000C!000D!0020!00A0!1680!2000!2001!2002!2003!2004!2005!2006!2007!2008!2009!200A!2028!2029!202F!205F!3000!FEFF' UESCAPE '!'
            ) <> ''
      )
    );
