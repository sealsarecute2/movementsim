import {loadStagingConfig,createStagingClient} from './staging-client.mjs';
try{
  const api=createStagingClient(loadStagingConfig()),stop=process.argv[2]==='stop';
  console.log(JSON.stringify(await api.json(stop?'/v1/stop-all':'/v1/status',stop?{}:undefined),null,2));
}catch(error){console.error('Staging control stopped: '+error.message);process.exitCode=1;}
