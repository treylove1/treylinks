// Test-only: never accepts a remote host, connection URL, password or production database.
// The loopback branch is reserved for a fresh service on the actual GitHub Actions runner.
export function nativeTestConfig(env=process.env){
 const forbidden=['PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGPASSFILE','PGSERVICE','PGSERVICEFILE','PGSSLMODE','DATABASE_URL','POSTGRES_URL','POSTGRES_PASSWORD','PARCEL_NATIVE_HOST','PARCEL_NATIVE_URL','PARCEL_NATIVE_PASSWORD'];
 if(forbidden.some(key=>env[key]))throw Error('Native synthetic tests reject external database/credential environment settings.');
 const common={max:1,prepare:false,connect_timeout:5,ssl:false,password:''};
 if(env.PARCEL_NATIVE_CI_DISPOSABLE!==undefined){
  if(env.GITHUB_ACTIONS!=='true'||env.PARCEL_NATIVE_CI_DISPOSABLE!=='true'||env.PARCEL_NATIVE_SOCKET||env.PARCEL_NATIVE_PORT!=='55437'||env.PARCEL_NATIVE_DATABASE!=='parcel_snap_synthetic'||env.PARCEL_NATIVE_USER!=='postgres')throw Error('Loopback tests require the GitHub Actions environment marker and the exact disposable database, user, port and opt-in.');
  return {...common,host:'127.0.0.1',port:55437,database:'parcel_snap_synthetic',username:'postgres'};
 }
 if(!env.PARCEL_NATIVE_SOCKET?.startsWith('/')||env.PARCEL_NATIVE_DATABASE||env.PARCEL_NATIVE_USER)throw Error('Native local tests require an explicit disposable absolute Unix socket directory.');
 const port=env.PARCEL_NATIVE_PORT||'55437';
 if(!/^\d{1,5}$/.test(port)||Number(port)<1||Number(port)>65535)throw Error('Invalid disposable Unix-socket port.');
 return {...common,host:env.PARCEL_NATIVE_SOCKET,port:Number(port),database:'postgres',username:env.USER||'agent'};
}
