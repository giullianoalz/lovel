-- Front-desk staff (reception) need their own role: view-only access to the
-- calendar and class alerts, without the full ADMIN surface (billing,
-- payroll, staff settings). Additive enum value, so every existing row keeps
-- the role it already has.
ALTER TYPE "user_role" ADD VALUE 'receptionist';
