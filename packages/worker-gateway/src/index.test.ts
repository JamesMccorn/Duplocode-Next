import assert from 'node:assert/strict'
import test from 'node:test'
import { createObservationsGateway, type WorkerAuthenticator, type ObservationSink } from './index.js'
const raw={id:'e',runId:'r',producer:'w',sequence:1,observedAt:'t',class:'TOOL_RESULT' as const,payload:{token:'secret'}}
test('authenticated observations are scrubbed and remain untrusted',()=>{const records: unknown[]=[];const auth:WorkerAuthenticator={authenticate:()=>({workerId:'w',runId:'r'})};const sink:ObservationSink={append:r=>{records.push(r)},list:()=>[]};const gateway=createObservationsGateway({authenticator:auth,scrubber:{scrub:()=>({classification:'untrusted-worker',redacted:true,retained:null})},sink});const result=gateway.ingest(raw,{principal:'w',token:'x'});assert.equal(result.status,'accepted');assert.equal(records.length,1)})
