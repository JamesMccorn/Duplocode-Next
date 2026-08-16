import assert from 'node:assert/strict'; import test from 'node:test'; import { verify } from './index.js'
const spec={id:'node',digest:'sha256:spec',command:['npm','test']} as const
test('unavailable verifier withholds verdict',async()=>{const r=await verify('run','sha256:candidate',spec,{execute:async()=>({ran:false,detail:'unavailable'})},'verify','clean','sha256:verify');assert.equal(r.verdict.kind,'inconclusive');assert.equal(r.evidence.ran,false)})
