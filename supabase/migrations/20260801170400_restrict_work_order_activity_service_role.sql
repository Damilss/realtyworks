-- `work_order_activity` is the append-only audit trail, including for callers
-- using the service key. The original GRANT ALL bypassed the table's RLS and
-- exposed UPDATE, DELETE, and TRUNCATE even though no server workflow needs
-- them. A narrower GRANT alone would not subtract those existing privileges,
-- so remove the old grant set before restoring the two required operations.

revoke all privileges on table public.work_order_activity from service_role;

grant select, insert on table public.work_order_activity to service_role;

-- Redundant with REVOKE ALL above by design: keep the append-only boundary
-- legible in the migration and easy to catch in review.
revoke update, delete, truncate on table public.work_order_activity from service_role;

-- A service-role DELETE on work_orders still cascades activity rows. Postgres
-- authorizes ON DELETE CASCADE through the parent's DELETE privilege; it does
-- not require DELETE on this child table.
