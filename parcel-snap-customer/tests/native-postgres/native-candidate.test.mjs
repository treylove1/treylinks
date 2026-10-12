// NEW FICTIONAL CONTRACT TESTS ONLY. Does not prove full production compatibility.
// Never imports the portal bootstrap or calls Storage, mail, inference or a remote DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {nativeCandidateTestConfig} from './candidate-test-config.mjs';
import {arrivalSchemaReady, arrivalCapabilities, SCHEMA_PROBE_SQL} from '../../backend/arrival-capabilities.mjs';
import {createArrivalRepository} from '../../backend/arrival-workflow.mjs';

// Guard executes BEFORE loading the SQL client or opening any socket.
const config = nativeCandidateTestConfig();
const {default: postgres} = await import(new URL('./node_modules/postgres/src/index.js', import.meta.url));
const fixture = fs.readFileSync(new URL('./candidate-contract-fixture.sql', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../../backend/migration-candidates/arrival-notices-v1.sql', import.meta.url), 'utf8');
const expected = JSON.parse(fs.readFileSync(new URL('../../backend/arrival-schema-contract.json', import.meta.url)));
const company = '10000000-0000-4000-8000-000000000001';
const id = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tracking = '00000000000000000001';

test('candidate additive migration, native catalog/ACL contract and independent claims', {timeout: 90000}, async t => {
  const a = postgres(config), b = postgres(config), locker = postgres(config), observer = postgres(config);
  t.after(() => Promise.all([a, b, locker, observer].map(sql => sql.end({timeout: 1}))));
  const pids = await Promise.all([a, b, locker, observer].map(async sql => (await sql`select pg_backend_pid() as pid`)[0].pid));
  assert.equal(new Set(pids).size, 4, 'four real independent database sessions');
  const [server] = await a`select current_database() as db, current_user as username,
    current_setting('server_version_num')::int as version,
    to_regnamespace('parcel_snap') as app_schema, to_regnamespace('auth') as auth_schema`;
  assert.equal(server.db, 'parcel_snap_synthetic');
  assert.equal(server.username, 'postgres');
  assert(server.version >= 170000 && server.version < 180000, 'requires native PostgreSQL 17');
  assert.equal(server.app_schema, null, 'refuses an existing application schema');
  assert.equal(server.auth_schema, null, 'refuses an existing Auth schema');
  const roles = await a`select rolname from pg_roles where rolname in ('anon', 'authenticated', 'service_role', 'fictional_reader')`;
  assert.equal(roles.length, 0, 'requires a fresh service, not another suite\'s database');
  t.diagnostic(JSON.stringify({postgres_version_num: server.version, independent_backend_pids: pids, fixture: 'independently-authored-minimal-contract'}));
  await a.unsafe(fixture).simple();
  const queryOne = async query => (await a.unsafe(query))[0] || null;
  const ready = () => arrivalSchemaReady(queryOne);
  const baseSnapshot = async () => JSON.parse(JSON.stringify({
    companies: await a`select * from parcel_snap.companies order by id`,
    grants: await a`select c.relname, c.relacl::text as acl from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='parcel_snap' and c.relkind='r' and c.relname<>'arrival_notices' order by c.relname`,
    defaults: await a`select defaclrole::regrole::text as owner, defaclnamespace::regnamespace::text as schema,
      defaclobjtype, defaclacl::text as acl from pg_default_acl order by 1, 2, 3`,
  }));
  // The migration includes its own BEGIN/COMMIT. Restore the session after the
  // expected failure, then inspect durable state from an independent connection.
  const rejectMigration = async pattern => {
    await assert.rejects(() => a.unsafe(migration).simple(), pattern);
    await a.unsafe('rollback').simple();
    const [row] = await observer`select to_regclass('parcel_snap.arrival_notices') as ledger,
      to_regclass('parcel_snap.packages_arrival_identity') as first_index`;
    assert.equal(row.ledger, null);
    assert.equal(row.first_index, null, 'earlier DDL in the failed transaction rolled back');
  };

  await t.test('absent ledger stays fail-closed', async () => assert.equal(await ready(), false));

  await t.test('conflicting index aborts all earlier migration DDL', async () => {
    await a.unsafe('create index customers_arrival_identity on parcel_snap.customers(email)').simple();
    const before = await baseSnapshot();
    await rejectMigration(/already exists/);
    assert.deepEqual(await baseSnapshot(), before);
    const [kept] = await a`select pg_get_indexdef('parcel_snap.customers_arrival_identity'::regclass) as definition`;
    assert.match(kept.definition, /\(email\)/);
    await a.unsafe('drop index parcel_snap.customers_arrival_identity').simple();
  });

  await t.test('unexpected default ACL aborts atomically without changing default privileges', async () => {
    await a.unsafe('alter default privileges in schema parcel_snap grant all on tables to service_role; alter default privileges in schema parcel_snap grant select on tables to fictional_reader').simple();
    const before = await baseSnapshot();
    await rejectMigration(/Unexpected ledger access/);
    assert.deepEqual(await baseSnapshot(), before);
    await a.unsafe('alter default privileges in schema parcel_snap revoke select on tables from fictional_reader').simple();
  });

  await t.test('additive candidate revokes inherited service ACL and preserves existing rows/grants/defaults', async () => {
    const before = await baseSnapshot();
    await a.unsafe(migration).simple();
    assert.deepEqual(await baseSnapshot(), before);
    const [service] = await a`select rolbypassrls from pg_roles where rolname='service_role'`;
    assert.equal(service.rolbypassrls, true, 'reproduces the bypass-RLS hazard');
    const [acl] = await a`select has_table_privilege('service_role','parcel_snap.arrival_notices','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as access`;
    assert.equal(acl.access, false);
    const row = await queryOne(SCHEMA_PROBE_SQL);
    // Diagnostics show only candidate-ledger contract details, never base-schema captures.
    assert.deepEqual(row.columns, expected.columns);
    assert.deepEqual(row.constraints, expected.constraints, 'native deparsed constraints must exactly match the reviewed contract');
    assert.equal(await ready(), true);
    const capability = await arrivalCapabilities({queryOne, companyId: company, userId: id(999), role: 'OWNER', writesFlag: 'true'});
    assert.equal(capability.schema_ready, true);
    assert.equal(capability.mode, 'PAUSED', 'the real candidate must stay hard-paused');
  });

  await t.test('a repeated migration fails without replacing the existing ledger', async () => {
    const [before] = await a`select 'parcel_snap.arrival_notices'::regclass::oid as oid`;
    await assert.rejects(() => a.unsafe(migration).simple(), /Arrival ledger already exists/);
    await a.unsafe('rollback').simple();
    const [after] = await observer`select 'parcel_snap.arrival_notices'::regclass::oid as oid`;
    assert.equal(after.oid, before.oid);
    assert.equal(await ready(), true);
  });

  await t.test('anon, authenticated and bypass-RLS service role cannot read or mutate the ledger', async () => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      for (const query of ['select * from parcel_snap.arrival_notices', "update parcel_snap.arrival_notices set status='UNKNOWN'", 'delete from parcel_snap.arrival_notices']) {
        await assert.rejects(() => a.begin(async tx => {await tx.unsafe(`set local role ${role}`); await tx.unsafe(query);}), e => e.code === '42501');
      }
    }
    // Existing unrelated grant is still usable.
    await a.begin(async tx => {await tx.unsafe('set local role authenticated'); await tx`select * from parcel_snap.customers`;});
  });

  await t.test('RLS, marker, service grant, arbitrary grant and column-grant drift all pause capability', async () => {
    for (const [drift, restore] of [
      ['alter table parcel_snap.arrival_notices disable row level security', 'alter table parcel_snap.arrival_notices enable row level security'],
      ["comment on table parcel_snap.arrival_notices is 'fictional-wrong-marker'", "comment on table parcel_snap.arrival_notices is 'parcel-snap-arrival-ledger-v1'"],
      ['grant select on parcel_snap.arrival_notices to service_role', 'revoke select on parcel_snap.arrival_notices from service_role'],
      ['grant select on parcel_snap.arrival_notices to fictional_reader', 'revoke select on parcel_snap.arrival_notices from fictional_reader'],
      ['grant select (id) on parcel_snap.arrival_notices to authenticated', 'revoke select (id) on parcel_snap.arrival_notices from authenticated'],
    ]) {
      await a.unsafe(drift).simple();
      try {assert.equal(await ready(), false, drift);} finally {await a.unsafe(restore).simple();}
      assert.equal(await ready(), true, restore);
    }
  });

  let sequence = 100;
  const seedNotice = async (status = 'PENDING') => {
    const customer = id(sequence++), facility = id(sequence++), pkg = id(sequence++), photo = id(sequence++);
    const email = `recipient-${sequence}@example.invalid`;
    await a`insert into parcel_snap.customers values(${customer},${company},${email})`;
    await a`insert into parcel_snap.facilities values(${facility},${company},true,'ORIGIN')`;
    await a`insert into parcel_snap.packages values(${pkg},${company},${customer},${tracking},${facility},null,'ORIGIN_RECEIVED')`;
    await a`insert into parcel_snap.package_photos values(${photo},${company},${pkg},${facility})`;
    await a`insert into parcel_snap.company_profiles values(${company},true,array['EMAIL']) on conflict(company_id) do nothing`;
    const [notice] = await a.unsafe(`insert into parcel_snap.arrival_notices
      (company_id,package_id,customer_id,facility_id,event_type,photo_id,photo_path,photo_mime,photo_sha256,fingerprint,payload,status)
      values ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'ORIGIN_ARRIVAL',$5::uuid,'fictional/no-object.jpg','image/jpeg',$6,$6,$7::text::jsonb,$8) returning *`,
      [company, pkg, customer, facility, photo, 'a'.repeat(64), JSON.stringify({to: [email], text: 'Fictional claim only. No delivery.'}), status]);
    const [revision] = await a`select xmin::text as revision from parcel_snap.customers where id=${customer}`;
    return {notice, customer, revision: revision.revision};
  };
  const repoA = createArrivalRepository(a), repoB = createArrivalRepository(b);

  await t.test('stale reviewed contact and tracking cannot acquire a claim or increment attempts', async () => {
    const h = await seedNotice();
    await a`update parcel_snap.customers set email='changed@example.invalid' where id=${h.customer}`;
    assert.equal(await repoB.claim(h.notice, id(999), h.revision, tracking), null);
    const fresh = await seedNotice();
    assert.equal(await repoB.claim(fresh.notice, id(999), fresh.revision, 'unreviewed-tracking'), null);
    const rows = await observer`select status,attempt_count from parcel_snap.arrival_notices where id in (${h.notice.id},${fresh.notice.id})`;
    assert.equal(rows.length, 2);
    for (const row of rows) {assert.equal(row.status, 'PENDING'); assert.equal(row.attempt_count, 0);}
  });

  await t.test('forced overlapping claims on independent connections have one durable winner', async () => {
    const h = await seedNotice();
    let release, locked;
    const gate = new Promise(resolve => {release = resolve;});
    const acquired = new Promise(resolve => {locked = resolve;});
    const lock = locker.begin(async tx => {await tx`select id from parcel_snap.arrival_notices where id=${h.notice.id} for update`; locked(); await gate;});
    await Promise.race([acquired, lock]);
    const claims = Promise.all([repoA.claim(h.notice, id(998), h.revision, tracking), repoB.claim(h.notice, id(999), h.revision, tracking)])
      .then(value => ({value}), error => ({error}));
    try {
      let bothBlocked = false;
      for (let attempt = 0; attempt < 250; attempt++) {
        const rows = await observer`select pid,wait_event_type from pg_stat_activity where pid in (${pids[0]},${pids[1]})`;
        if (rows.length === 2 && rows.every(row => row.wait_event_type === 'Lock')) {bothBlocked = true; break;}
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.equal(bothBlocked, true, 'both independent claim updates must be observed waiting on a real row lock');
    } finally {release(); await Promise.allSettled([lock, claims]);}
    await lock;
    const completed = await claims;
    if (completed.error) throw completed.error;
    const winners = completed.value.filter(Boolean);
    assert.equal(winners.length, 1);
    const [saved] = await observer`select status,attempt_count,claim_token,confirmed_by,payload from parcel_snap.arrival_notices where id=${h.notice.id}`;
    assert.equal(saved.status, 'SENDING');
    assert.equal(saved.attempt_count, 1);
    assert.equal(saved.claim_token, winners[0].claim_token);
    assert.equal(saved.confirmed_by, winners[0].confirmed_by);
    assert.deepEqual(saved.payload, h.notice.payload);
    assert.equal(await repoB.claim(h.notice, id(999), h.revision, tracking), null, 'SENDING cannot be reclaimed');
  });

  await t.test('UNKNOWN survives an independent connection and never becomes a new claim', async () => {
    const h = await seedNotice('UNKNOWN');
    assert.equal(await repoB.claim(h.notice, id(999), h.revision, tracking), null);
    const [row] = await observer`select status,attempt_count from parcel_snap.arrival_notices where id=${h.notice.id}`;
    assert.equal(row.status, 'UNKNOWN');
    assert.equal(row.attempt_count, 0);
  });
});
