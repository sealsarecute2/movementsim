import {ownerAuthorized} from './auth.js';
import {authenticatePlayer,PlayerAuthError} from './player-auth.js';
export const privateTestingEnabled=env=>env.PRIVATE_PLAYER_TESTING_ENABLED==='true'&&env.STAGING_ENABLED==='true';
export const privateTestOrigin='http://localhost:5173';
const admission=env=>env.ADMISSION.get(env.ADMISSION.idFromName('global-v1'));
const internal=(path,body)=>new Request('https://internal/'+path,{method:'POST',body:JSON.stringify(body)});
export async function privateTesterAllowed(env,accountId){
  const response=await admission(env).fetch(internal('private-check',{accountId}));
  if(!response.ok)throw new PlayerAuthError('private-test-unavailable',503);
  return (await response.json()).allowed===true;
}
export async function enrollPrivateTester(request,env){
  if(!privateTestingEnabled(env)||request.headers.get('origin')!==privateTestOrigin)throw new PlayerAuthError('private-test-disabled',503);
  if(request.method!=='POST')throw new PlayerAuthError('method-not-allowed',405);
  const key=request.headers.get('x-staging-key');
  if(!key||key.length>256||!ownerAuthorized(new Request('https://internal',{headers:{authorization:'Bearer '+key}}),env.STAGING_KEY))throw new PlayerAuthError('owner-auth-required',401);
  // The account always comes from a verified session. The loopback helper
  // supplies only the owner proof; neither an account ID nor email is accepted.
  const player=await authenticatePlayer(request,env);
  return admission(env).fetch(internal('private-enroll',{accountId:player.accountId}));
}
