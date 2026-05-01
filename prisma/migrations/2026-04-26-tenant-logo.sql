-- Per-tenant branding — the logo URL is stored on the Tenant row so each
-- bakery (Pae Ka Yauk, future tenants) shows their own logo to their own
-- staff. No hardcoded brand assets in the codebase.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS "logoUrl" text;
