import postgres from "npm:postgres@3.4.7";
import { createClient } from "npm:@supabase/supabase-js@2";
import { processArrival, createArrivalRepository, reviewSavedArrival, customerContactVersion, packageReviewVersion } from "./arrival-workflow.mjs";

const DB_URL = Deno.env.get("SUPABASE_DB_URL")!;
const sql = postgres(DB_URL, { prepare: false, max: 1 });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const secretKeysRaw = Deno.env.get("SUPABASE_SECRET_KEYS") || "";
const secretKey = secretKeysRaw
  ? JSON.parse(secretKeysRaw)["default"]
  : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, secretKey);

const PAYMENT_LINK = "https://buy.stripe.com/7sY9ATdyO5zD7vs545bo408";
const PHOTO_BUCKET = "parcel-snap-package-photos";
const ALLOWED_ORIGINS = new Set([
  "https://www.yourelectronicneeds.org",
  "https://yourelectronicneeds.org",
  "https://treylove1.github.io"
]);

function cors(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : "https://www.yourelectronicneeds.org";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin"
  };
}

function json(req: Request, data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors(req) }
  });
}

function decodeVerifiedJwt(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\\s+/i, "");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Missing authenticated session");
  const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const claims = JSON.parse(atob(padded));
  if (!claims.sub) throw new Error("Missing user identity");
  return { userId: String(claims.sub), email: String(claims.email || "") };
}

async function queryOne(query: string, params: unknown[] = []) {
  const rows = await sql.unsafe(query, params as any[]);
  return rows[0] || null;
}
async function queryMany(query: string, params: unknown[] = []) {
  return await sql.unsafe(query, params as any[]);
}

async function getMembership(userId: string) {
  return await queryOne(
    "select m.company_id, m.role, c.name as company_name, s.status as subscription_status, s.current_period_end, s.stripe_customer_id, s.stripe_subscription_id from parcel_snap.company_memberships m join parcel_snap.companies c on c.id = m.company_id left join parcel_snap.company_subscriptions s on s.company_id = m.company_id where m.user_id = $1::uuid and m.active = true order by m.created_at asc limit 1",
    [userId]
  );
}

function entitled(m: any) {
  if (!m) return false;
  if (!["ACTIVE", "TRIALING"].includes(String(m.subscription_status || ""))) return false;
  if (!m.current_period_end) return true;
  return new Date(m.current_period_end).getTime() > Date.now();
}
function canWrite(role: string) {
  return ["OWNER", "MANAGER", "STAFF"].includes(String(role || ""));
}
function canManage(role: string) {
  return ["OWNER", "MANAGER"].includes(String(role || ""));
}
function isAdmin(role: string) {
  return ["OWNER", "MANAGER"].includes(String(role || ""));
}

async function allowedFacilityIds(userId: string, companyId: string, role: string) {
  if (isAdmin(role)) {
    const rows = await queryMany(
      "select id from parcel_snap.facilities where company_id=$1::uuid and active=true order by name",
      [companyId]
    );
    return rows.map((r: any) => String(r.id));
  }
  const rows = await queryMany(
    "select a.facility_id from parcel_snap.member_facility_access a where a.user_id=$1::uuid and a.company_id=$2::uuid and a.active=true order by a.created_at",
    [userId, companyId]
  );
  return rows.map((r: any) => String(r.facility_id));
}

async function canOperateFacility(userId: string, companyId: string, role: string, facilityId: string) {
  if (isAdmin(role)) return true;
  if (!["STAFF", "DRIVER"].includes(role)) return false;
  const row = await queryOne(
    "select 1 from parcel_snap.member_facility_access where user_id=$1::uuid and company_id=$2::uuid and facility_id=$3::uuid and permission='OPERATE' and active=true limit 1",
    [userId, companyId, facilityId]
  );
  return Boolean(row);
}

async function hashInviteCode(codeValue: string) {
  const data = new TextEncoder().encode(codeValue.trim().toUpperCase());
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function makeInviteCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes).map(b => alphabet[b % alphabet.length]).join("");
}

async function integrationSecret(name: string) {
  const row = await queryOne(
    "select secret_value from parcel_snap.integration_secrets where name = $1 limit 1",
    [name]
  );
  return row?.secret_value ? String(row.secret_value) : "";
}

const arrivalRepository = createArrivalRepository(sql);

function arrivalDependencies() {
  return {
    repo: arrivalRepository,
    storage: admin.storage.from(PHOTO_BUCKET),
    assertPrivateStorage: async () => {
      const { data, error } = await admin.storage.getBucket(PHOTO_BUCKET);
      if (error || !data || data.public !== false) {
        throw Object.assign(new Error("Private package-photo storage could not be verified. No arrival saved."), { status: 503 });
      }
    },
    secret: integrationSecret,
    fetch,
    canOperate: canOperateFacility
  };
}

async function saveArrival(body: any, companyId: string, userId: string, role: string, actor: string, kind: string) {
  return await processArrival({ body, companyId, userId, role, actor, kind }, arrivalDependencies());
}

async function markPendingOriginReviews(packages: any[], companyId: string, role: string, scopedFacilities: string[]) {
  for (const p of packages) {
    p.origin_review_pending = false;
    p.review_version = await packageReviewVersion(companyId, p);
  }
  if (!canWrite(role)) return;
  const pending = await arrivalRepository.pendingOriginReviews(companyId, packages.map(p => p.id));
  const allowed = new Set(pending.filter((n: any) => isAdmin(role) || scopedFacilities.includes(n.facility_id)).map((n: any) => n.package_id));
  for (const p of packages) p.origin_review_pending = allowed.has(p.id);
}

async function workspace(companyId: string, userId: string, role: string) {
  const scopedFacilities = await allowedFacilityIds(userId, companyId, role);

  if (isAdmin(role)) {
    const packages = await queryMany(
      "select p.id, p.customer_id, p.tracking_number, p.carrier, p.size_class, p.weight_lb, p.payment_status, p.stage, p.origin_received_at, p.last_arrived_at, p.storage_started_at, p.free_storage_days, p.storage_rate_per_day, p.current_location_id, p.origin_facility_id, p.destination_facility_id, p.current_facility_id, p.updated_at, c.name as customer_name, c.email as customer_email, l.code as location_code, l.shelf, l.bin, l.zone_type, (select count(*) from parcel_snap.package_photos ph where ph.package_id=p.id) as photo_count from parcel_snap.packages p left join parcel_snap.customers c on c.id = p.customer_id left join parcel_snap.warehouse_locations l on l.id = p.current_location_id where p.company_id = $1::uuid order by p.updated_at desc limit 200",
      [companyId]
    );
    await markPendingOriginReviews(packages, companyId, role, scopedFacilities);
    const customers = await queryMany(
      "select c.id,c.xmin::text as contact_revision,c.name,c.customer_type,c.email,c.phone,c.status,c.updated_at,coalesce((select jsonb_agg(jsonb_build_object('alias',ca.alias,'alias_type',ca.alias_type) order by ca.alias_type,ca.alias) from parcel_snap.customer_aliases ca where ca.customer_id=c.id and ca.active=true),'[]'::jsonb) as aliases from parcel_snap.customers c where c.company_id=$1::uuid order by lower(c.name) limit 500",
      [companyId]
    );
    for (const customer of customers) {
      customer.contact_version = await customerContactVersion(companyId, customer);
      delete customer.contact_revision;
      customer.contact_email_visible = true;
    }
    const facilities = await queryMany(
      "select id, code, name, facility_type, address_line1, address_line2, city, region, postal_code, country, notification_label, timezone, active from parcel_snap.facilities where company_id = $1::uuid order by facility_type, name",
      [companyId]
    );
    const locations = await queryMany(
      "select id, facility_id, code, zone_type, shelf, bin, capacity, priority, active, allowed_size_classes from parcel_snap.warehouse_locations where company_id = $1::uuid order by priority, code",
      [companyId]
    );
    const attention = await queryMany(
      "select id, tracking_number, customer_name, payment_status, stage, current_location_code, suggested_location_code, storage_days, storage_fee, action_needed, action_priority, updated_at from parcel_snap.warehouse_attention where company_id = $1::uuid and action_needed <> 'OK' order by action_priority asc, updated_at asc limit 200",
      [companyId]
    );
    const staff = await queryMany(
      "select m.user_id,m.role,m.active,u.email,m.billing_exempt from parcel_snap.company_memberships m join auth.users u on u.id=m.user_id where m.company_id=$1::uuid order by m.created_at",
      [companyId]
    );
    const pending_invites = await queryMany(
      "select id,email,role,expires_at,created_at from parcel_snap.staff_invites where company_id=$1::uuid and accepted_at is null and expires_at > now() order by created_at desc",
      [companyId]
    );
    const route_destinations = facilities.filter((f:any)=>["DESTINATION","TRANSIT"].includes(String(f.facility_type||"")));
    return { packages, customers, facilities, route_destinations, locations, attention, facility_scope: scopedFacilities, staff, pending_invites };
  }

  if (!scopedFacilities.length) {
    return { packages: [], customers: [], facilities: [], locations: [], attention: [], facility_scope: [] };
  }

  const packageScope =
    "(p.current_facility_id = any($2::uuid[]) " +
    "or (p.origin_facility_id = any($2::uuid[]) and p.stage in ('ORIGIN_RECEIVED','IN_TRANSIT')) " +
    "or (p.destination_facility_id = any($2::uuid[]) and p.stage in ('IN_TRANSIT','DESTINATION_RECEIVED','WAREHOUSED','READY_FOR_PICKUP','OUT_FOR_DELIVERY','PICKED_UP','DELIVERED')))";

  const packages = await queryMany(
    "select p.id, p.customer_id, p.tracking_number, p.carrier, p.size_class, p.weight_lb, p.payment_status, p.stage, p.origin_received_at, p.last_arrived_at, p.storage_started_at, p.free_storage_days, p.storage_rate_per_day, p.current_location_id, p.origin_facility_id, p.destination_facility_id, p.current_facility_id, p.updated_at, c.name as customer_name, null::text as customer_email, l.code as location_code, l.shelf, l.bin, l.zone_type, (select count(*) from parcel_snap.package_photos ph where ph.package_id=p.id) as photo_count from parcel_snap.packages p left join parcel_snap.customers c on c.id = p.customer_id left join parcel_snap.warehouse_locations l on l.id = p.current_location_id where p.company_id = $1::uuid and " + packageScope + " order by p.updated_at desc limit 200",
    [companyId, scopedFacilities]
  );

  await markPendingOriginReviews(packages, companyId, role, scopedFacilities);
  const customers = await queryMany(
    "select c.id,c.xmin::text as contact_revision,c.name,c.customer_type,null::text as email,null::text as phone,c.status,c.updated_at,coalesce((select jsonb_agg(jsonb_build_object('alias',ca.alias,'alias_type',ca.alias_type) order by ca.alias_type,ca.alias) from parcel_snap.customer_aliases ca where ca.customer_id=c.id and ca.active=true),'[]'::jsonb) as aliases from parcel_snap.customers c where c.company_id=$1::uuid order by lower(c.name) limit 500",
    [companyId]
  );
  for (const customer of customers) {
    customer.contact_version = await customerContactVersion(companyId, customer);
    delete customer.contact_revision;
    customer.contact_email_visible = false;
    customer.email = null;
  }

  const facilities = await queryMany(
    "select id, code, name, facility_type, address_line1, address_line2, city, region, postal_code, country, notification_label, timezone, active from parcel_snap.facilities where company_id=$1::uuid and id = any($2::uuid[]) order by facility_type, name",
    [companyId, scopedFacilities]
  );

  const locations = await queryMany(
    "select id, facility_id, code, zone_type, shelf, bin, capacity, priority, active, allowed_size_classes from parcel_snap.warehouse_locations where company_id=$1::uuid and facility_id = any($2::uuid[]) order by priority, code",
    [companyId, scopedFacilities]
  );

  const attention = await queryMany(
    "select a.id, a.tracking_number, a.customer_name, a.payment_status, a.stage, a.current_location_code, a.suggested_location_code, a.storage_days, a.storage_fee, a.action_needed, a.action_priority, a.updated_at from parcel_snap.warehouse_attention a join parcel_snap.packages p on p.id=a.id where a.company_id=$1::uuid and a.action_needed <> 'OK' and " + packageScope + " order by a.action_priority asc, a.updated_at asc limit 200",
    [companyId, scopedFacilities]
  );

  const route_destinations = await queryMany(
    "select id,code,name,facility_type,city,notification_label,active from parcel_snap.facilities where company_id=$1::uuid and active=true and facility_type in ('DESTINATION','TRANSIT') order by name",
    [companyId]
  );

  return { packages, customers, facilities, route_destinations, locations, attention, facility_scope: scopedFacilities };
}


function normalizeBusinessSetup(profile: any, locations: any[], fallbackName: string) {
  const businessType = String(profile?.business_type || "").trim();
  const primaryBusinessName = String(profile?.primary_business_name || fallbackName || "").trim();
  const employeeCount = profile?.employee_count === "" || profile?.employee_count == null ? null : Number(profile.employee_count);
  const estimatedCustomers = profile?.estimated_customers === "" || profile?.estimated_customers == null ? null : Number(profile.estimated_customers);
  const packagesPerDay = profile?.packages_per_day === "" || profile?.packages_per_day == null ? null : Number(profile.packages_per_day);

  if (!businessType) throw new Error("Tell us what kind of business you operate.");
  if (!primaryBusinessName) throw new Error("Enter the business name.");
  if (!Array.isArray(locations) || !locations.length) throw new Error("Add at least one business location.");

  const cleanLocations = locations.map((raw:any, index:number) => {
    const city = String(raw?.city || "").trim();
    const label = String(raw?.label || city || ("Location " + (index + 1))).trim();
    const operationRole = String(raw?.operation_role || "BOTH").toUpperCase();
    const useType = String(raw?.use_type || "WAREHOUSE").toUpperCase();

    if (!city) throw new Error("Every location needs a city.");
    if (!["RECEIVE","DESTINATION","BOTH","NON_WAREHOUSE"].includes(operationRole)) {
      throw new Error("Invalid location operation role.");
    }
    if (!["WAREHOUSE","OFFICE","PICKUP_POINT","STORAGE_ONLY","OTHER"].includes(useType)) {
      throw new Error("Invalid location type.");
    }

    return {
      label,
      city,
      region: String(raw?.region || "").trim() || null,
      country: String(raw?.country || "").trim() || null,
      address_line1: String(raw?.address_line1 || "").trim() || null,
      address_line2: String(raw?.address_line2 || "").trim() || null,
      postal_code: String(raw?.postal_code || "").trim() || null,
      use_type: useType,
      operation_role: operationRole,
      employee_count: raw?.employee_count === "" || raw?.employee_count == null ? null : Number(raw.employee_count),
      handles_customer_pickup: Boolean(raw?.handles_customer_pickup),
      handles_delivery_dispatch: Boolean(raw?.handles_delivery_dispatch),
      handles_returns: Boolean(raw?.handles_returns),
      handles_inspection: Boolean(raw?.handles_inspection)
    };
  });

  const channels = Array.isArray(profile?.notification_channels)
    ? profile.notification_channels.map((x:any)=>String(x).toUpperCase()).filter((x:string)=>["EMAIL","WHATSAPP","SMS"].includes(x))
    : ["EMAIL"];

  return {
    businessType,
    primaryBusinessName,
    employeeCount,
    estimatedCustomers,
    packagesPerDay,
    warehouseCount: cleanLocations.filter((x:any)=>x.operation_role!=="NON_WAREHOUSE").length,
    cleanLocations,
    channels: channels.length ? channels : ["EMAIL"]
  };
}

async function materializeBusinessSetup(companyId: string, profile: any, locations: any[], fallbackName: string) {
  const setup = normalizeBusinessSetup(profile, locations, fallbackName);

  await sql.begin(async tx => {
    await tx.unsafe(
      "insert into parcel_snap.company_profiles(company_id,business_type,primary_business_name,website,employee_count,warehouse_count,estimated_customers,packages_per_day,handles_pallets,handles_oversize,handles_appliances,handles_tvs,needs_storage,needs_returns,needs_inspection,needs_delivery,needs_customer_notifications,notification_channels,needs_worker_sublogins,needs_driver_access,needs_multi_warehouse,notes,onboarding_complete,updated_at) values ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::text[],$19,$20,$21,$22,true,now()) on conflict (company_id) do update set business_type=excluded.business_type,primary_business_name=excluded.primary_business_name,website=excluded.website,employee_count=excluded.employee_count,warehouse_count=excluded.warehouse_count,estimated_customers=excluded.estimated_customers,packages_per_day=excluded.packages_per_day,handles_pallets=excluded.handles_pallets,handles_oversize=excluded.handles_oversize,handles_appliances=excluded.handles_appliances,handles_tvs=excluded.handles_tvs,needs_storage=excluded.needs_storage,needs_returns=excluded.needs_returns,needs_inspection=excluded.needs_inspection,needs_delivery=excluded.needs_delivery,needs_customer_notifications=excluded.needs_customer_notifications,notification_channels=excluded.notification_channels,needs_worker_sublogins=excluded.needs_worker_sublogins,needs_driver_access=excluded.needs_driver_access,needs_multi_warehouse=excluded.needs_multi_warehouse,notes=excluded.notes,onboarding_complete=true,updated_at=now()",
      [
        companyId,
        setup.businessType,
        setup.primaryBusinessName,
        String(profile?.website || "").trim() || null,
        setup.employeeCount,
        setup.warehouseCount,
        setup.estimatedCustomers,
        setup.packagesPerDay,
        Boolean(profile?.handles_pallets),
        Boolean(profile?.handles_oversize),
        Boolean(profile?.handles_appliances),
        Boolean(profile?.handles_tvs),
        Boolean(profile?.needs_storage),
        Boolean(profile?.needs_returns),
        Boolean(profile?.needs_inspection),
        Boolean(profile?.needs_delivery),
        Boolean(profile?.needs_customer_notifications),
        setup.channels,
        Boolean(profile?.needs_worker_sublogins),
        Boolean(profile?.needs_driver_access),
        setup.cleanLocations.length > 1,
        String(profile?.notes || "").trim() || null
      ]
    );

    await tx.unsafe(
      "delete from parcel_snap.company_onboarding_locations where company_id=$1::uuid",
      [companyId]
    );

    for (const loc of setup.cleanLocations) {
      await tx.unsafe(
        "insert into parcel_snap.company_onboarding_locations(company_id,label,city,region,country,address_line1,address_line2,postal_code,use_type,operation_role,employee_count,handles_customer_pickup,handles_delivery_dispatch,handles_returns,handles_inspection) values ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",
        [companyId,loc.label,loc.city,loc.region,loc.country,loc.address_line1,loc.address_line2,loc.postal_code,loc.use_type,loc.operation_role,loc.employee_count,loc.handles_customer_pickup,loc.handles_delivery_dispatch,loc.handles_returns,loc.handles_inspection]
      );
    }

    for (let i=0;i<setup.cleanLocations.length;i++) {
      const loc = setup.cleanLocations[i];
      if (loc.operation_role === "NON_WAREHOUSE") continue;

      const base = loc.city.replace(/[^A-Za-z0-9]/g,"").slice(0,3).toUpperCase() || "LOC";
      const codeValue = base + (i + 1);
      const facilityType = loc.operation_role === "RECEIVE"
        ? "ORIGIN"
        : loc.operation_role === "DESTINATION"
          ? "DESTINATION"
          : "TRANSIT";

      await tx.unsafe(
        "insert into parcel_snap.facilities(company_id,code,name,facility_type,address_line1,address_line2,city,region,postal_code,country,notification_label,active,updated_at) values ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,now()) on conflict (company_id,code) do update set name=excluded.name,facility_type=excluded.facility_type,address_line1=excluded.address_line1,address_line2=excluded.address_line2,city=excluded.city,region=excluded.region,postal_code=excluded.postal_code,country=excluded.country,notification_label=excluded.notification_label,active=true,updated_at=now()",
        [companyId,codeValue,loc.label,facilityType,loc.address_line1,loc.address_line2,loc.city,loc.region,loc.postal_code,loc.country,loc.city]
      );
    }
  });

  return {
    warehouse_count: setup.warehouseCount,
    employee_count: setup.employeeCount,
    packages_per_day: setup.packagesPerDay,
    features: {
      storage: Boolean(profile?.needs_storage),
      returns: Boolean(profile?.needs_returns),
      inspection: Boolean(profile?.needs_inspection),
      delivery: Boolean(profile?.needs_delivery),
      worker_sublogins: Boolean(profile?.needs_worker_sublogins),
      driver_access: Boolean(profile?.needs_driver_access)
    }
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  try {
    const { userId, email } = decodeVerifiedJwt(req);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "workspace");

    if (action === "claim_staff_invite") {
      const inviteCode = String(body.code || "").trim().toUpperCase();
      if (!inviteCode) return json(req, { error: "Invite code is required." }, 400);
      const codeHash = await hashInviteCode(inviteCode);

      const invite = await queryOne(
        "select id,company_id,email,role,expires_at,accepted_at from parcel_snap.staff_invites where code_hash=$1 and accepted_at is null and expires_at > now() limit 1",
        [codeHash]
      );
      if (!invite) return json(req, { error: "Invite code is invalid or expired." }, 404);
      if (invite.email && String(invite.email).toLowerCase() !== email.toLowerCase()) {
        return json(req, { error: "This invite belongs to a different email address." }, 403);
      }

      await sql.begin(async tx => {
        await tx.unsafe(
          "insert into parcel_snap.company_memberships(user_id,company_id,role,active,billing_exempt) values ($1::uuid,$2::uuid,$3,true,false) on conflict (user_id,company_id) do update set role=excluded.role,active=true",
          [userId, String(invite.company_id), String(invite.role)]
        );

        const facilityRows = await tx.unsafe(
          "select facility_id,permission from parcel_snap.staff_invite_facilities where invite_id=$1::uuid",
          [String(invite.id)]
        );
        for (const row of facilityRows) {
          await tx.unsafe(
            "insert into parcel_snap.member_facility_access(user_id,company_id,facility_id,permission,active) values ($1::uuid,$2::uuid,$3::uuid,$4,true) on conflict (user_id,company_id,facility_id) do update set permission=excluded.permission,active=true",
            [userId, String(invite.company_id), String(row.facility_id), String(row.permission)]
          );
        }

        await tx.unsafe(
          "update parcel_snap.staff_invites set accepted_by=$1::uuid,accepted_at=now() where id=$2::uuid",
          [userId, String(invite.id)]
        );
      });

      return json(req, { ok: true, state: "ACTIVE" });
    }

    if (action === "onboard") {
      const companyName = String(body.company_name || "").trim();
      if (!email) return json(req, { error: "Your login needs an email address." }, 400);
      if (!companyName) return json(req, { error: "Company name is required." }, 400);

      await sql.unsafe(
        "insert into parcel_snap.portal_onboarding(user_id,email,company_name,updated_at) values ($1::uuid,$2,$3,now()) on conflict (user_id) do update set email=excluded.email,company_name=excluded.company_name,updated_at=now()",
        [userId, email, companyName]
      );

      const membership = await getMembership(userId);
      const onboarding = await queryOne(
        "select company_name,business_profile,business_locations,business_setup_complete from parcel_snap.portal_onboarding where user_id=$1::uuid limit 1",
        [userId]
      );
      const state = membership && entitled(membership)
        ? "ACTIVE"
        : onboarding?.business_setup_complete
          ? "PAYMENT_REQUIRED"
          : "BUSINESS_SETUP_PREPAY";

      return json(req, {
        ok: true,
        state,
        payment_link: PAYMENT_LINK,
        company: { name: membership?.company_name || companyName, role: membership?.role || "OWNER" },
        company_name: membership?.company_name || companyName,
        profile: onboarding?.business_profile || {},
        locations: onboarding?.business_locations || []
      });
    }

    if (action === "save_prepaid_business_profile") {
      const onboarding = await queryOne(
        "select company_name from parcel_snap.portal_onboarding where user_id=$1::uuid limit 1",
        [userId]
      );
      const profile = body.profile && typeof body.profile === "object" ? body.profile : {};
      const locations = Array.isArray(body.locations) ? body.locations : [];
      const fallbackName = String(onboarding?.company_name || profile.primary_business_name || "").trim();
      const setup = normalizeBusinessSetup(profile, locations, fallbackName);

      await sql.unsafe(
        "insert into parcel_snap.portal_onboarding(user_id,email,company_name,business_profile,business_locations,business_setup_complete,business_setup_completed_at,updated_at) values ($1::uuid,$2,$3,$4::jsonb,$5::jsonb,true,now(),now()) on conflict (user_id) do update set email=excluded.email,company_name=excluded.company_name,business_profile=excluded.business_profile,business_locations=excluded.business_locations,business_setup_complete=true,business_setup_completed_at=now(),updated_at=now()",
        [
          userId,
          email,
          setup.primaryBusinessName,
          JSON.stringify(profile),
          JSON.stringify(setup.cleanLocations)
        ]
      );

      return json(req, {
        ok: true,
        state: "PAYMENT_REQUIRED",
        payment_link: PAYMENT_LINK,
        company_name: setup.primaryBusinessName,
        tailored: {
          warehouse_count: setup.warehouseCount,
          employee_count: setup.employeeCount,
          packages_per_day: setup.packagesPerDay
        }
      });
    }

    const membership = await getMembership(userId);

    if (!membership) {
      const onboarding = await queryOne(
        "select company_name,email,business_profile,business_locations,business_setup_complete from parcel_snap.portal_onboarding where user_id=$1::uuid limit 1",
        [userId]
      );

      if (!onboarding?.company_name) {
        return json(req, { state: "NO_COMPANY", onboarding, payment_link: PAYMENT_LINK });
      }

      if (!onboarding.business_setup_complete) {
        return json(req, {
          state: "BUSINESS_SETUP_PREPAY",
          company: { name: onboarding.company_name, role: "OWNER" },
          profile: onboarding.business_profile || {},
          locations: onboarding.business_locations || [],
          payment_link: PAYMENT_LINK
        });
      }

      return json(req, {
        state: "PAYMENT_REQUIRED",
        company: { name: onboarding.company_name, role: "OWNER" },
        profile: onboarding.business_profile || {},
        locations: onboarding.business_locations || [],
        subscription: { status: "INACTIVE", current_period_end: null },
        payment_link: PAYMENT_LINK
      });
    }

    if (!entitled(membership)) {
      return json(req, {
        state: "PAYMENT_REQUIRED",
        company: { id: membership.company_id, name: membership.company_name, role: membership.role },
        subscription: { status: membership.subscription_status || "INACTIVE", current_period_end: membership.current_period_end || null },
        payment_link: PAYMENT_LINK
      });
    }

    const companyId = String(membership.company_id);
    const role = String(membership.role || "");

    if (action === "workspace" && ["OWNER","MANAGER"].includes(role)) {
      let profile = await queryOne(
        "select * from parcel_snap.company_profiles where company_id=$1::uuid limit 1",
        [companyId]
      );

      if ((!profile || profile.onboarding_complete !== true) && role === "OWNER") {
        const onboarding = await queryOne(
          "select business_profile,business_locations,business_setup_complete from parcel_snap.portal_onboarding where user_id=$1::uuid limit 1",
          [userId]
        );

        if (onboarding?.business_setup_complete) {
          await materializeBusinessSetup(
            companyId,
            onboarding.business_profile || {},
            Array.isArray(onboarding.business_locations) ? onboarding.business_locations : [],
            membership.company_name
          );
          profile = await queryOne(
            "select * from parcel_snap.company_profiles where company_id=$1::uuid limit 1",
            [companyId]
          );
        }
      }

      if (!profile || profile.onboarding_complete !== true) {
        const savedLocations = await queryMany(
          "select * from parcel_snap.company_onboarding_locations where company_id=$1::uuid and active=true order by created_at,id",
          [companyId]
        );
        return json(req, {
          state: "BUSINESS_SETUP_REQUIRED",
          company: { id: companyId, name: membership.company_name, role },
          profile: profile || null,
          locations: savedLocations,
          subscription: {
            status: membership.subscription_status,
            current_period_end: membership.current_period_end
          }
        });
      }
    }

    if (action === "preview_business_profile") {
      if (role !== "OWNER") {
        return json(req, { error: "Only the company owner can run setup preview mode." }, 403);
      }

      const profile = body.profile && typeof body.profile === "object" ? body.profile : {};
      const locations = Array.isArray(body.locations) ? body.locations : [];

      const businessType = String(profile.business_type || "").trim();
      const employeeCount = profile.employee_count === "" || profile.employee_count == null ? null : Number(profile.employee_count);
      const estimatedCustomers = profile.estimated_customers === "" || profile.estimated_customers == null ? null : Number(profile.estimated_customers);
      const packagesPerDay = profile.packages_per_day === "" || profile.packages_per_day == null ? null : Number(profile.packages_per_day);

      if (!businessType) return json(req, { error: "Tell us what kind of business you operate." }, 400);
      if (!locations.length) return json(req, { error: "Add at least one business location." }, 400);

      const cleanLocations = locations.map((raw:any, index:number) => {
        const city = String(raw?.city || "").trim();
        const label = String(raw?.label || city || ("Location " + (index + 1))).trim();
        const operationRole = String(raw?.operation_role || "BOTH").toUpperCase();
        const useType = String(raw?.use_type || "WAREHOUSE").toUpperCase();
        if (!city) throw new Error("Every location needs a city.");
        if (!["RECEIVE","DESTINATION","BOTH","NON_WAREHOUSE"].includes(operationRole)) throw new Error("Invalid location operation role.");
        if (!["WAREHOUSE","OFFICE","PICKUP_POINT","STORAGE_ONLY","OTHER"].includes(useType)) throw new Error("Invalid location type.");
        return {
          label,
          city,
          region: String(raw?.region || "").trim() || null,
          country: String(raw?.country || "").trim() || null,
          use_type: useType,
          operation_role: operationRole,
          employee_count: raw?.employee_count === "" || raw?.employee_count == null ? null : Number(raw.employee_count),
          handles_customer_pickup: Boolean(raw?.handles_customer_pickup),
          handles_delivery_dispatch: Boolean(raw?.handles_delivery_dispatch),
          handles_returns: Boolean(raw?.handles_returns),
          handles_inspection: Boolean(raw?.handles_inspection)
        };
      });

      const featureSet = {
        storage: Boolean(profile.needs_storage),
        returns: Boolean(profile.needs_returns),
        inspection: Boolean(profile.needs_inspection),
        delivery: Boolean(profile.needs_delivery),
        pallets: Boolean(profile.handles_pallets),
        oversize: Boolean(profile.handles_oversize),
        appliances: Boolean(profile.handles_appliances),
        tvs: Boolean(profile.handles_tvs),
        worker_sublogins: Boolean(profile.needs_worker_sublogins),
        driver_access: Boolean(profile.needs_driver_access),
        customer_notifications: Boolean(profile.needs_customer_notifications)
      };

      const facilityPlan = cleanLocations
        .filter((loc:any)=>loc.operation_role!=="NON_WAREHOUSE")
        .map((loc:any,index:number)=>({
          name: loc.label,
          city: loc.city,
          facility_type:
            loc.operation_role==="RECEIVE" ? "ORIGIN" :
            loc.operation_role==="DESTINATION" ? "DESTINATION" :
            "TRANSIT",
          suggested_code: (loc.city.replace(/[^A-Za-z0-9]/g,"").slice(0,3).toUpperCase() || "LOC") + (index+1)
        }));

      const recommendations:string[] = [];
      if (employeeCount !== null && employeeCount > 1 && profile.needs_worker_sublogins) recommendations.push("Use individual worker logins with warehouse-scoped access.");
      if (cleanLocations.length > 1) recommendations.push("Use multi-location routing and facility-specific permissions.");
      if (packagesPerDay !== null && packagesPerDay >= 100) recommendations.push("Enable high-volume intake, exception queue, and capacity monitoring.");
      if (estimatedCustomers !== null && estimatedCustomers >= 250) recommendations.push("Use customer aliases and known-identity matching at scale.");
      if (profile.needs_storage) recommendations.push("Enable storage zones, days-stored tracking, and capacity alerts.");
      if (profile.needs_returns) recommendations.push("Create a dedicated returns workflow and return holding area.");
      if (profile.needs_inspection) recommendations.push("Create inspection status, inspection photo, and approval workflow.");
      if (profile.handles_pallets || profile.handles_oversize || profile.handles_appliances) recommendations.push("Track pallet/oversize capacity separately from standard package bins.");

      return json(req, {
        ok: true,
        preview: true,
        no_changes_saved: true,
        tailored: {
          business_type: businessType,
          employee_count: employeeCount,
          estimated_customers: estimatedCustomers,
          packages_per_day: packagesPerDay,
          locations: cleanLocations,
          facilities: facilityPlan,
          features: featureSet,
          recommendations
        }
      });
    }

    if (action === "save_business_profile") {
      if (!["OWNER","MANAGER"].includes(role)) {
        return json(req, { error: "Only owners or managers can complete business setup." }, 403);
      }

      const profile = body.profile && typeof body.profile === "object" ? body.profile : {};
      const locations = Array.isArray(body.locations) ? body.locations : [];
      const tailored = await materializeBusinessSetup(companyId, profile, locations, membership.company_name);

      return json(req, {
        ok: true,
        state: "ACTIVE",
        tailored
      });
    }

    if (action === "create_staff_invite") {
      if (!["OWNER","MANAGER"].includes(role)) {
        return json(req, { error: "Only owners or managers can create staff access." }, 403);
      }

      const inviteRole = String(body.role || "STAFF").toUpperCase();
      const allowedRoles = role === "OWNER"
        ? ["MANAGER","STAFF","DRIVER","VIEWER"]
        : ["STAFF","DRIVER","VIEWER"];
      if (!allowedRoles.includes(inviteRole)) {
        return json(req, { error: "You cannot assign that role." }, 403);
      }

      const facilityIds = Array.isArray(body.facility_ids)
        ? body.facility_ids.map((x: unknown) => String(x)).filter(Boolean)
        : [];

      if (["STAFF","DRIVER","VIEWER"].includes(inviteRole) && facilityIds.length === 0) {
        return json(req, { error: "Choose at least one warehouse for this worker." }, 400);
      }

      if (facilityIds.length) {
        const valid = await queryMany(
          "select id from parcel_snap.facilities where company_id=$1::uuid and id = any($2::uuid[])",
          [companyId, facilityIds]
        );
        if (valid.length !== facilityIds.length) {
          return json(req, { error: "One or more warehouse selections are invalid." }, 400);
        }
      }

      const inviteCode = makeInviteCode();
      const codeHash = await hashInviteCode(inviteCode);
      const inviteEmail = String(body.email || "").trim().toLowerCase() || null;
      const permission = inviteRole === "VIEWER" ? "VIEW" : "OPERATE";

      const invite = await queryOne(
        "insert into parcel_snap.staff_invites(company_id,email,role,code_hash,created_by,expires_at) values ($1::uuid,$2,$3,$4,$5::uuid,now()+interval '7 days') returning id,expires_at",
        [companyId, inviteEmail, inviteRole, codeHash, userId]
      );

      for (const facilityId of facilityIds) {
        await sql.unsafe(
          "insert into parcel_snap.staff_invite_facilities(invite_id,facility_id,permission) values ($1::uuid,$2::uuid,$3)",
          [String(invite.id), facilityId, permission]
        );
      }

      return json(req, {
        ok: true,
        invite: {
          code: inviteCode,
          role: inviteRole,
          email: inviteEmail,
          facility_ids: facilityIds,
          expires_at: invite.expires_at
        }
      });
    }

    if (action === "create_customer") {
      if (!canWrite(role)) return json(req, { error: "You do not have permission to add customers." }, 403);
      const name = String(body.name || "").trim();
      const customerEmail = String(body.email || "").trim().toLowerCase() || null;
      const phone = String(body.phone || "").trim() || null;
      const customerType = String(body.customer_type || "PERSON").toUpperCase();

      if (!name) return json(req, { error: "Customer name is required." }, 400);
      if (!["PERSON","BUSINESS"].includes(customerType)) {
        return json(req, { error: "Invalid customer type." }, 400);
      }

      const row = await queryOne(
        "insert into parcel_snap.customers(company_id,name,email,phone,customer_type,updated_at) values ($1::uuid,$2,$3,$4,$5,now()) returning id,name,email,phone,customer_type,status,xmin::text as contact_revision",
        [companyId, name, customerEmail, phone, customerType]
      );

      const primaryAliasType = customerType === "BUSINESS" ? "BUSINESS_NAME" : "PERSON_NAME";

      await sql.unsafe(
        "insert into parcel_snap.customer_aliases(company_id,customer_id,alias,alias_type) values ($1::uuid,$2::uuid,$3,$4) on conflict do nothing",
        [companyId, String(row.id), name, primaryAliasType]
      );

      const aliases = [{ alias: name, alias_type: primaryAliasType }];
      const extraAliases = Array.isArray(body.aliases) ? body.aliases : [];

      for (const item of extraAliases) {
        const alias = String(item?.alias || "").trim();
        const aliasType = String(item?.alias_type || "LABEL").toUpperCase();
        if (!alias) continue;
        if (!["PERSON_NAME","BUSINESS_NAME","LABEL","CUSTOMER_CODE"].includes(aliasType)) continue;

        await sql.unsafe(
          "insert into parcel_snap.customer_aliases(company_id,customer_id,alias,alias_type) values ($1::uuid,$2::uuid,$3,$4) on conflict do nothing",
          [companyId, String(row.id), alias, aliasType]
        );

        aliases.push({ alias, alias_type: aliasType });
      }

      row.aliases = aliases;
      row.contact_version = await customerContactVersion(companyId, row);
      delete row.contact_revision;
      row.contact_email_visible = true;
      return json(req, { ok: true, customer: row });
    }

    if (action === "add_customer_alias") {
      if (!canWrite(role)) return json(req, { error: "You do not have permission to edit recognition targets." }, 403);

      const customerId = String(body.customer_id || "");
      const alias = String(body.alias || "").trim();
      const aliasType = String(body.alias_type || "LABEL").toUpperCase();

      if (!customerId || !alias) return json(req, { error: "Customer and alias are required." }, 400);
      if (!["PERSON_NAME","BUSINESS_NAME","LABEL","CUSTOMER_CODE"].includes(aliasType)) {
        return json(req, { error: "Invalid alias type." }, 400);
      }

      const customer = await queryOne(
        "select id from parcel_snap.customers where id=$1::uuid and company_id=$2::uuid limit 1",
        [customerId, companyId]
      );
      if (!customer) return json(req, { error: "Customer not found." }, 404);

      const row = await queryOne(
        "insert into parcel_snap.customer_aliases(company_id,customer_id,alias,alias_type) values ($1::uuid,$2::uuid,$3,$4) on conflict do nothing returning id,alias,alias_type",
        [companyId, customerId, alias, aliasType]
      );

      return json(req, {
        ok: true,
        alias: row || { alias, alias_type: aliasType, existing: true }
      });
    }

    if (action === "create_facility") {
      if (!canManage(role)) return json(req, { error: "Only owners or managers can add warehouses." }, 403);
      const name = String(body.name || "").trim();
      const type = String(body.facility_type || "ORIGIN").toUpperCase();
      const city = String(body.city || "").trim();
      if (!name || !city) return json(req, { error: "Warehouse name and city are required." }, 400);
      if (!["ORIGIN","DESTINATION","TRANSIT"].includes(type)) return json(req, { error: "Invalid warehouse type." }, 400);
      const code = String(body.code || city.slice(0,3).toUpperCase()).trim().toUpperCase();
      const row = await queryOne(
        "insert into parcel_snap.facilities(company_id,code,name,facility_type,address_line1,address_line2,city,region,postal_code,country,notification_label,timezone,active) values ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true) returning *",
        [companyId, code, name, type, body.address_line1 || null, body.address_line2 || null, city, body.region || null, body.postal_code || null, body.country || null, body.notification_label || city, body.timezone || null]
      );
      return json(req, { ok: true, facility: row });
    }

    if (action === "create_location") {
      if (!canManage(role)) return json(req, { error: "Only owners or managers can add warehouse locations." }, 403);
      const facilityId = String(body.facility_id || "");
      const code = String(body.code || "").trim().toUpperCase();
      const zone = String(body.zone_type || "STORAGE").toUpperCase();
      if (!facilityId || !code) return json(req, { error: "Facility and location code are required." }, 400);
      const facility = await queryOne(
        "select id,name,city from parcel_snap.facilities where id=$1::uuid and company_id=$2::uuid limit 1",
        [facilityId, companyId]
      );
      if (!facility) return json(req, { error: "Warehouse not found." }, 404);
      const row = await queryOne(
        "insert into parcel_snap.warehouse_locations(company_id,facility_id,site,code,zone_type,shelf,bin,capacity,priority,active) values ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9,true) returning *",
        [companyId, facilityId, body.site || facility.city || facility.name || "WAREHOUSE", code, zone, body.shelf || null, body.bin || null, Number(body.capacity || 1), Number(body.priority || 100)]
      );
      return json(req, { ok: true, location: row });
    }

    if (action === "review_saved_arrival") {
      if (!canWrite(role)) return json(req, { error: "You do not have permission to review saved arrivals." }, 403);
      const result = await reviewSavedArrival({ body, companyId, userId, role }, arrivalDependencies());
      return json(req, result);
    }

    if (action === "receive_package" || action === "destination_arrival") {
      if (!canWrite(role)) return json(req, { error: "You do not have permission to save package arrivals." }, 403);
      // Rollout starts paused. This is an ordinary non-secret safety flag, not a credential.
      if (body.reconcile_notification !== true && Deno.env.get("PARCEL_ARRIVAL_WRITES_ENABLED") !== "true") {
        return json(req, { error: "Package arrivals are temporarily paused for verification.", photo_saved: false }, 503);
      }
      const result = await saveArrival(body, companyId, userId, role, email || "PORTAL_USER", action === "receive_package" ? "origin" : "destination");
      return json(req, result);
    }

    const data = await workspace(companyId, userId, role);
    const companyProfile = await queryOne(
      "select * from parcel_snap.company_profiles where company_id=$1::uuid limit 1",
      [companyId]
    );
    return json(req, {
      state: "ACTIVE",
      company: { id: companyId, name: membership.company_name, role },
      subscription: { status: membership.subscription_status, current_period_end: membership.current_period_end },
      profile: companyProfile,
      ...data
    });
  } catch (err) {
    console.error(err);
    return json(req, { error: err instanceof Error ? err.message : "Portal request failed." }, Number((err as any)?.status) || 500);
  }
});

