import postgres from 'npm:postgres@3.4.7';
import { withSupabase } from 'npm:@supabase/server@1.9.1';
import { authorizeScan } from './authorize.mjs';
const sql=postgres(Deno.env.get('SUPABASE_DB_URL')!,{prepare:false,max:1});
export default {fetch:withSupabase({auth:'user'},async(req,ctx)=>{
 if(req.method!=='POST')return Response.json({error:'METHOD_NOT_ALLOWED'},{status:405});
 try{
  const result=await authorizeScan(sql,ctx.userClaims?.id);
  return Response.json(result||{error:'ACCESS_DENIED'},{status:result?200:403,headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'AUTHORIZATION_UNAVAILABLE'},{status:503});}
})};
