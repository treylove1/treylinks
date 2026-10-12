import {nativeTestConfig} from './native-test-config.mjs';

// Dedicated CI-only opt-in. Never emulate GitHub markers on a local executor.
export function nativeCandidateTestConfig(env = process.env) {
  if (env.PARCEL_NATIVE_CANDIDATE !== 'true' || env.GITHUB_ACTIONS !== 'true' || env.PARCEL_NATIVE_CI_DISPOSABLE !== 'true') {
    throw Error('Candidate SQL checks require the explicitly authorized fresh GitHub CI service.');
  }
  for (const key of ['SUPABASE_URL', 'SUPABASE_DB_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEYS', 'RESEND_API_KEY']) {
    if (env[key]) throw Error('Candidate SQL checks reject application service configuration or credentials.');
  }
  return nativeTestConfig(env);
}
