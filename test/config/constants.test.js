'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createRequire}=require('node:module');
const C=require('../../config/constants');
const {presentFees}=require('../../presenters/feesPresenter');
const {presentSalutStatus}=require('../../presenters/salutPresenter');
const uid='33333333-3333-3333-3333-333333333333';
function load(relative,mocks){const filename=path.resolve(__dirname,'../../',relative),m={exports:{}};const fallback=createRequire(filename);const req=name=>Object.hasOwn(mocks,name)?mocks[name]:fallback(name);vm.runInThisContext('(function(require,module,exports){'+fs.readFileSync(filename,'utf8')+'\n})',{filename})(req,m,m.exports);return m.exports;}
function response(){return {code:200,status(c){this.code=c;return this;},json(data){this.data=data;return this;}};}
function application(user={},save=true){let written,conditions;const fields=new Proxy({},{get:(_,p)=>p});const chain={set(data){written=data;return this;},where(data){conditions=data;return this;},async returning(){return save?[{id:uid}]:[];}};const ctrl=load('controllers/salutController.js',{
 '../config/supabase':{supabaseAdmin:{}},'../db':{db:{query:{users:{findFirst:async()=>({is_salut:false,salut_status:'none',current_semester:3,salut_approved_at:null,nim:'000000001',...user})}},update:()=>chain}},'../db/schema':{users:fields},'drizzle-orm':{eq:(a,b)=>['eq',a,b],ne:(a,b)=>['ne',a,b],and:(...args)=>args},uuid:{v4:()=>uid},'../services/userStatusEventBus':{emitUserStatusUpdate:()=>{}}
 });return {ctrl,get written(){return written;},get conditions(){return conditions;}};}
function body(extra={}){return {proofUrl:uid+'/proof.jpg',wa_number:'+886900000001',note:'Nama pengirim berbeda',...extra};}
async function apply(h,data=body()){const res=response();await h.ctrl.applyForMembership({user:{id:uid},body:data},res);return res;}

test('every semester and missing semester have the same NTD 1700 fee',()=>{for(const semester of [1,2,9,null,undefined]){assert.equal(C.getSalutMembershipFee(semester).amount,1700);assert.equal(C.getSalutMembershipFee(semester).billing,'once_per_study');assert.equal(C.getSalutMembershipFee(semester).amount_idr,null);}});
test('approved contribution remains active across May, November and later study years',()=>{for(const date of ['2026-05-01','2026-11-01','2027-05-01','2030-11-01'])assert.equal(C.isSalutActive('2026-01-01',new Date(date)),true);assert.equal(C.nextSalutExpiry(),null);assert.equal(C.mostRecentExpiryBefore(),null);});
test('missing, invalid or future approvals never grant eligibility',()=>{for(const approval of [null,'invalid','2099-01-01'])assert.equal(C.isSalutActive(approval,new Date('2026-11-01')),false);});
test('fees do not quote QRIS/IDR or periodic renewal dates',()=>{const out=presentFees({salutMembership:{new:1700,returning:1700,billing:'once_per_study',renewalPolicy:{}},serviceFees:[],totalServiceFees:0});assert.equal(out.salutMembership.new_display_idr,null);assert.equal(out.salutMembership.returning_display_idr,null);assert.equal(out.salutMembership.renewalPolicy.next_renewal_date_display,null);assert.match(out.salutMembership.tier_combined_display,/sekali selama masa perkuliahan/);});
test('historical expired records stay marked for review',()=>{assert.equal(presentSalutStatus({salut_status:'expired',is_salut_active:false}).effective_status,'expired');});
test('a returning student submits NTD 1700 and the note is persisted',async()=>{const h=application();const r=await apply(h);assert.equal(r.code,200);assert.equal(r.data.fee.amount,1700);assert.equal(r.data.nextExpiry,null);assert.equal(h.written.salut_payment_note,'Nama pengirim berbeda');assert.equal(h.written.salut_applied_fee_amount,1700);assert.ok(h.conditions.some(x=>x[0]==='ne'&&x[2]==='pending'));});
test('unknown semester does not block a one-time contribution',async()=>{const h=application({current_semester:null});const r=await apply(h);assert.equal(r.code,200);assert.equal(h.written.salut_applied_semester,null);});
test('pending, approved and historical expired students cannot pay again',async()=>{for(const user of [{salut_status:'pending'},{salut_status:'approved',salut_approved_at:'2020-01-01'},{salut_status:'expired'}]){const h=application(user);const r=await apply(h);assert.ok([400,409].includes(r.code));assert.equal(h.written,undefined);}});
test('a receipt belonging to another account is rejected',async()=>{const h=application();const r=await apply(h,body({proofUrl:'someone-else/proof.jpg'}));assert.equal(r.code,400);assert.equal(h.written,undefined);});
test('oversized notes are rejected before saving',async()=>{const h=application();const r=await apply(h,body({note:'x'.repeat(1001)}));assert.equal(r.code,400);assert.equal(h.written,undefined);});
test('a concurrent status change yields a conflict instead of success',async()=>{const h=application({},false);const r=await apply(h);assert.equal(r.code,409);});
function auth(matches){const calls=[];const ctrl=load('controllers/authController.js',{'../config/supabase':{supabase:{auth:{signInWithPassword:async data=>{calls.push(data);return {data:{session:{access_token:'test',refresh_token:'test',expires_at:1},user:{id:uid,email:data.email}},error:null};}}},supabaseAdmin:{}},'../db':{db:{query:{users:{findMany:async()=>matches}}}},'../db/schema':{users:{nim:'nim'}},'drizzle-orm':{eq:(...args)=>args},'../config/env':{},'../presenters/userPresenter':{presentUser:x=>x},'../config/banks':{getBankName:()=>''}});return {ctrl,calls};}
test('NIM login resolves the registered email and still checks the password',async()=>{const h=auth([{email:'student@example.invalid'}]),r=response();await h.ctrl.login({body:{email:'000000001',password:'test-password'}},r);assert.equal(r.code,200);assert.deepEqual(h.calls,[{email:'student@example.invalid',password:'test-password'}]);});
test('unknown or ambiguous NIM cannot authenticate another account',async()=>{for(const matches of [[],[{email:'one@example.invalid'},{email:'two@example.invalid'}]]){const h=auth(matches),r=response();await h.ctrl.login({body:{email:'000000001',password:'test'}},r);assert.equal(r.code,401);assert.equal(h.calls.length,0);}});
test('existing email login remains supported',async()=>{const h=auth([]),r=response();await h.ctrl.login({body:{email:'student@example.invalid',password:'test'}},r);assert.equal(r.code,200);assert.equal(h.calls[0].email,'student@example.invalid');});
