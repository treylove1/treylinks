// No database/client bootstrap, provider, Storage, HTTP or socket usage.
// This checks the versioned request boundary, not deployed JWT enforcement.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {nativeCandidateTestConfig} from './candidate-test-config.mjs';
import {
  ARRIVAL_CONTRACT, ARRIVAL_DEPLOYMENT, FREE_ONLY_RELEASE_VERIFIED,
  arrivalCapabilities, assertArrivalRequest,
} from '../../backend/arrival-capabilities.mjs';

const expected = JSON.parse(fs.readFileSync(new URL('../../backend/arrival-schema-contract.json', import.meta.url)));
const goodCatalog = () => ({rls: true, public_access: false, marker: expected.marker, columns: expected.columns, constraints: expected.constraints});
const request = () => ({arrival_contract: ARRIVAL_CONTRACT, arrival_deployment_id: ARRIVAL_DEPLOYMENT,
  customer_id: 'fictional-customer', label_confirmed: true, confirmed_customer_id: 'fictional-customer',
  confirmed_customer_contact_version: 'fictional-contact-revision', confirmed_package_review_version: 'fictional-package-review'});
// An explicit in-memory capability lets us test review checks while the actual
// candidate stays hard-paused. It does not alter the production constant.
const enabled = {contract: ARRIVAL_CONTRACT, deployment_id: ARRIVAL_DEPLOYMENT, schema_ready: true, mode: 'ENABLED'};

test('candidate CI opt-in rejects local execution and service credentials without connecting', () => {
  const env = {GITHUB_ACTIONS: 'true', PARCEL_NATIVE_CI_DISPOSABLE: 'true', PARCEL_NATIVE_CANDIDATE: 'true',
    PARCEL_NATIVE_PORT: '55437', PARCEL_NATIVE_DATABASE: 'parcel_snap_synthetic', PARCEL_NATIVE_USER: 'postgres'};
  assert.equal(nativeCandidateTestConfig(env).host, '127.0.0.1');
  for (const key of Object.keys(env)) {
    const missing = {...env}; delete missing[key];
    assert.throws(() => nativeCandidateTestConfig(missing));
  }
  assert.throws(() => nativeCandidateTestConfig({PARCEL_NATIVE_SOCKET: '/fictional/socket'}));
  for (const key of ['SUPABASE_URL', 'SUPABASE_DB_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEYS', 'RESEND_API_KEY', 'DATABASE_URL', 'PGHOST']) {
    assert.throws(() => nativeCandidateTestConfig({...env, [key]: 'fictional-disallowed-config'}));
  }
});

test('the exact release candidate stays paused even with its environment flag true', async () => {
  assert.equal(FREE_ONLY_RELEASE_VERIFIED, false);
  let reads = 0;
  const capability = await arrivalCapabilities({queryOne: async sql => {assert.match(sql, /^select\s/i); reads++; return goodCatalog();},
    companyId: 'fictional-company', userId: 'fictional-user', role: 'OWNER', writesFlag: 'true'});
  assert.equal(reads, 1);
  assert.equal(capability.schema_ready, true);
  assert.equal(capability.mode, 'PAUSED');
  assert.throws(() => assertArrivalRequest(request(), capability, 'origin'), e => e.status === 503);
});

test('missing/stale contract, deployment and customer review reject before any save', () => {
  let saves = 0;
  const invoke = (body, kind = 'origin', capability = enabled) => {
    assertArrivalRequest(body, capability, kind);
    saves++;
  };
  for (const patch of [
    {arrival_contract: undefined}, {arrival_contract: 'fictional-obsolete-contract'},
    {arrival_deployment_id: undefined}, {arrival_deployment_id: 'fictional-old-deployment'},
    {label_confirmed: false}, {confirmed_customer_id: ''},
    {confirmed_customer_id: 'fictional-other-customer'}, {confirmed_customer_contact_version: ''},
  ]) assert.throws(() => invoke({...request(), ...patch}), e => e.status === 409);
  assert.throws(() => invoke({...request(), confirmed_package_review_version: ''}, 'destination'), e => e.status === 409);
  assert.throws(() => invoke(request(), 'origin', {...enabled, schema_ready: false}), e => e.status === 503);
  assert.equal(saves, 0);
  invoke(request());
  invoke(request(), 'destination');
  assert.equal(saves, 2);
});

test('reconciliation keeps version/schema gates even though it is exempt from a new-send pause', () => {
  const body = {...request(), reconcile_notification: true};
  assert.doesNotThrow(() => assertArrivalRequest(body, {...enabled, mode: 'PAUSED'}, 'origin'));
  assert.throws(() => assertArrivalRequest({...body, arrival_contract: ''}, enabled, 'origin'), e => e.status === 409);
  assert.throws(() => assertArrivalRequest(body, {...enabled, schema_ready: false}, 'origin'), e => e.status === 503);
});
