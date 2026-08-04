-- The six remaining application tables also inherited table-administration
-- privileges from GRANT ALL. They are mutable records, so preserve ordinary
-- row DML while removing TRUNCATE, REFERENCES, TRIGGER, MAINTAIN, and any
-- future table-level privilege included by ALL.
--
-- DELETE remains intentional here: profiles/properties/units/vendors have
-- guarded lifecycle deletes, while work_orders and work_order_attachments use
-- coordinated service-role deletion. None of those flows requires TRUNCATE;
-- on attachment metadata it would bypass Storage cleanup and orphan objects.

revoke all privileges on table
  public.profiles,
  public.properties,
  public.units,
  public.vendors,
  public.work_orders,
  public.work_order_attachments
from service_role;

grant select, insert, update, delete on table
  public.profiles,
  public.properties,
  public.units,
  public.vendors,
  public.work_orders,
  public.work_order_attachments
to service_role;

-- Redundant with REVOKE ALL above so the bulk-erasure boundary is explicit.
revoke truncate on table
  public.profiles,
  public.properties,
  public.units,
  public.vendors,
  public.work_orders,
  public.work_order_attachments
from service_role;
