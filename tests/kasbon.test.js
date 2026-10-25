const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const crypto=require('node:crypto');
const {periodBounds,employeeKey,summarizeKasbon}=require('../src/kasbon');
const base={user_name:'Budi',company:'PT A',division:'HR',location:'Office',order_date:'2026-01-15'};
const orders=[{...base,total_price:250000,payment_method:'Kasbon'},
  {...base,total_price:80000,payment_method:'Cash'}];
test('Cash stays separate, monthly payment defaults false and can be confirmed',()=>{
  const [unpaid]=summarizeKasbon(orders);
  assert.equal(unpaid.totalKasbon,250000);assert.equal(unpaid.totalCash,80000);
  assert.equal(unpaid.isPaid,false);
  const [paid]=summarizeKasbon(orders,[{employee_key:employeeKey(base),is_paid:true,paid_at:'2026-02-03T00:00:00Z'}]);
  assert.equal(paid.isPaid,true);assert.equal(paid.totalKasbon,250000);
});
test('Identity includes company/division and normalizes casing',()=>{
  assert.equal(employeeKey(base),employeeKey({...base,user_name:' BUDI '}));
  assert.notEqual(employeeKey(base),employeeKey({...base,company:'PT B'}));
  assert.equal(summarizeKasbon([...orders,{...orders[0],company:'PT B'}]).length,2);
});
test('Period supports December rollover and rejects invalid values',()=>{
  assert.deepEqual(periodBounds(12,2026),{period:'2026-12-01',nextMonth:'2027-01-01'});
  for(const month of [0,13,'foo',1.5]) assert.throws(()=>periodBounds(month,2026));
  assert.throws(()=>periodBounds(1,1999));
});
test('Legacy item metadata is respected for Kasbon',()=>{
  const [row]=summarizeKasbon([{...base,total_price:12000,items:[{_meta:true,payment_method:'Kasbon'}]}]);
  assert.equal(row.totalKasbon,12000);
});
function loadDb(cloud, key = 'synthetic', clock = Date) {
  let store={orders:[...orders,{...orders[0],order_date:'2026-02-01'}],menus:[],schedules:{}};
  let writes=0;
  const fakeFs={existsSync:()=>true,readFileSync:()=>JSON.stringify(store),
    writeFileSync:(_,data)=>{store=JSON.parse(data);writes++;}};
  const context={Buffer,Date:clock,module:{exports:{}},process:{env:cloud ? {SUPABASE_URL:'https://example.supabase.co',SUPABASE_KEY:key} : {}},
    __dirname:path.resolve(__dirname,'../src'),console:{log(){},warn(){},error(){}},
    require:name=>name==='fs' ? fakeFs : name==='@supabase/supabase-js' ? {createClient:()=>{if(cloud?.initError) throw Error('Synthetic initialization failure');return cloud}} :
      name==='./seedData' ? {INITIAL_MENUS:[],DAYS_OF_WEEK:[]} :
      name==='./whatsappWebhook' ? require('../src/whatsappWebhook') :
      name==='./paymentHistory' ? require('../src/paymentHistory') :
      name==='./kasbon' ? require('../src/kasbon') : require(name)};
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../src/db.js'),'utf8'),context);
  return {db:context.module.exports,getStore:()=>store,writes:()=>writes};
}
test('Menu insert failure is reported instead of claiming a local success',async()=>{
  const cloud={from(table){
    assert.equal(table,'menus');
    return {insert:async()=>({error:{message:'permission denied'}})};
  }};
  const {db,writes}=loadDb(cloud);
  await assert.rejects(()=>db.createMenu({name:'Menu Baru',price:5000,category:'Lauk',schedules:{}}),
    /Gagal menyimpan menu di Supabase: permission denied/);
  assert.equal(writes(),0);
});
test('Admin menu list reports cloud errors instead of showing local menus',async()=>{
  const cloud={from(){return {select:()=>({order:async()=>({data:null,error:{message:'cloud unavailable'}})})}}};
  const {db}=loadDb(cloud);
  await assert.rejects(()=>db.getAllMenusWithSchedules(),/cloud unavailable/);
});
test('Failed menu schedule is reported and the inserted menu is rolled back',async()=>{
  const calls=[];
  const cloud={from(table){
    if(table==='menus') return {
      insert:async()=>{calls.push('insert menu');return {error:null}},
      delete:()=>({eq:async()=>{calls.push('rollback menu');return {error:null}}})
    };
    assert.equal(table,'menu_schedules');
    return {insert:async()=>{calls.push('insert schedule');return {error:{message:'schedule denied'}}}};
  }};
  const {db,writes}=loadDb(cloud);
  await assert.rejects(()=>db.createMenu({name:'Menu Baru',price:5000,category:'Lauk',schedules:{}}),
    /Gagal menyimpan jadwal menu di Supabase: schedule denied/);
  assert.deepEqual(calls,['insert menu','insert schedule','rollback menu']);
  assert.equal(writes(),0);
});
test('One record per employee/month, unpay correction, month isolation, orders unchanged',async()=>{
  const {db,getStore}=loadDb();
  const original=JSON.stringify(getStore().orders);
  const input={month:1,year:2026,key:employeeKey(base),isPaid:true,admin:'tester'};
  const paid=await db.setKasbonPayment(input);
  assert.equal(paid.kasbon_amount,250000);assert.equal(paid.period_month,'2026-01-01');assert.ok(paid.paid_at);
  await db.setKasbonPayment(input);
  assert.equal(getStore().kasbon_payments.length,1);
  const unpaid=await db.setKasbonPayment({...input,isPaid:false});
  assert.equal(unpaid.is_paid,false);assert.equal(unpaid.paid_at,null);
  assert.equal((await db.getKasbonPayments(2,2026)).length,0);
  assert.equal(JSON.stringify(getStore().orders),original);
});
test('Configured Supabase failure never writes a local payment',async()=>{
  const broken={from(){throw Error('Synthetic cloud outage');}};
  const {db,writes}=loadDb(broken);
  await assert.rejects(()=>db.setKasbonPayment({month:1,year:2026,key:employeeKey(base),isPaid:true,admin:'tester'}));
  assert.equal(writes(),0);
});
test('Supabase upsert uses employee/month uniqueness and Kasbon-only amount',async()=>{
  let captured;
  const chain={select(){return this},gte(){return this},lt(){return this},order(){return this},
    range(){return Promise.resolve({data:orders,error:null})},
    upsert(record,options){captured={record,options};return this},
    single(){return Promise.resolve({data:captured.record,error:null})}};
  const {db,writes}=loadDb({from(){return chain}});
  const payment=await db.setKasbonPayment({month:1,year:2026,key:employeeKey(base),isPaid:true,admin:'tester'});
  assert.equal(payment.kasbon_amount,250000);
  assert.equal(captured.options.onConflict,'employee_key,period_month');
  assert.equal(writes(),0);
});
function loadServer(mockOrders = orders) {
  const routes=[];
  const app={use(){},listen(){throw Error('Unexpected server startup');}};
  for(const method of ['get','post','put','delete']) app[method]=(paths,...handlers)=>{
    for(const endpoint of [paths].flat())routes.push({method,endpoint,handlers});};
  const express=()=>app;express.json=()=>()=>{};
  const env={VERCEL:'1',ADMIN_USERNAME:'test-admin',ADMIN_PASSWORD:'test-password',JWT_SECRET:'test-signing-secret'};
  let saves=0;
  const historyCalls=[];
  const context={module:{exports:{}},process:{env},Buffer,Date,__dirname:path.resolve(__dirname,'../src'),
    console:{log(){},error(){}},require:name=>name==='express' ? express : name==='cors' ? ()=>()=>{} :
      name==='dotenv' ? {config(){}} : name==='./db' ? {
        getOrders:async()=>mockOrders,
        createPaymentHistory:async(input,options)=>{historyCalls.push({input,options});return {id:'9',...input}},
        updatePaymentHistory:async(id,input,admin)=>{historyCalls.push({id,input,admin});return {id,...input}},
        deletePaymentHistory:async(id,admin)=>{historyCalls.push({id,admin});return {id}},
        getKasbonOrders:async()=>orders,getKasbonPayments:async()=>[],
        setKasbonPayment:async input=>{saves++;return {is_paid:input.isPaid};}
      } : name==='./seedData' ? {DAYS_OF_WEEK:[]} :
      name==='./orderGrouping' ? require('../src/orderGrouping') :
      name==='./whatsappWebhook' ? require('../src/whatsappWebhook') :
      name==='./paymentHistory' ? require('../src/paymentHistory') :
      name==='./kasbon' ? require('../src/kasbon') : require(name)};
  vm.createContext(context);vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src/server.js'),'utf8'),context);
  return {routes,context,historyCalls,saves:()=>saves};
}
function response(){return {code:200,headers:{},status(code){this.code=code;return this},
  json(data){this.data=data;return this},send(data){this.data=data;return this},
  setHeader(key,value){this.headers[key]=value;}};}
test('Signed sessions reject tampering, missing expiry and non-admin role',()=>{
  const {context}=loadServer();
  const generate=vm.runInContext('generateToken',context),verify=vm.runInContext('verifyToken',context);
  const token=generate('test-admin');
  assert.equal(verify(token).role,'admin');
  assert.equal(verify(token+'.extra'),null);
  function signed(payload) {
    const encoded=Buffer.from(JSON.stringify(payload)).toString('base64url');
    return encoded+'.'+crypto.createHmac('sha256','test-signing-secret').update(encoded).digest('base64url');
  }
  assert.equal(verify(signed({username:'test-admin',role:'admin'})),null);
  assert.equal(verify(signed({username:'test-admin',role:'guest',exp:Date.now()+10000})),null);
  assert.equal(verify(signed({username:'test-admin',role:'admin',exp:Date.now()-1})),null);
});
test('Payment endpoint requires authentication and validates boolean and period',async()=>{
  const {routes,saves}=loadServer();
  const route=routes.find(route=>route.method==='put' && route.endpoint==='/api/admin/kasbon/payments');
  const res=response();let authenticated=false;
  route.handlers[0]({headers:{},query:{}},res,()=>{authenticated=true});
  assert.equal(res.code,401);assert.equal(authenticated,false);assert.equal(saves(),0);
  for(const body of [{month:13,year:2026,employeeKey:employeeKey(base),isPaid:true},
    {month:1,year:2026,employeeKey:employeeKey(base),isPaid:'true'}]) {
    const invalid=response();await route.handlers[1]({body,user:{username:'tester'}},invalid);
    assert.equal(invalid.code,400);
  }
  assert.equal(saves(),0);
});
test('Export reports separate Cash/Kasbon and monthly payment status',async()=>{
  const {routes}=loadServer(),res=response();
  const route=routes.find(route=>route.endpoint==='/api/admin/kasbon/export-csv');
  await route.handlers[1]({query:{month:1,year:2026}},res);
  assert.equal(res.code,200);
  assert.match(res.data,/Kasbon \(Rp 250\.000\) \/ Cash \(Rp 80\.000\)/);
  assert.match(res.data,/Belum bayar/);
});

test('Order CSV accumulates only matching name, company, division, and delivery date',async()=>{
  const sameIdentity={...base,order_date:'2026-10-13'};
  const testOrders=[
    {...sameIdentity,order_number:'A',total_price:3000},
    {...sameIdentity,order_number:'B',total_price:10000},
    {...sameIdentity,company:'PT B',order_number:'C',total_price:7000},
    {...sameIdentity,division:'Finance',order_number:'D',total_price:5000},
    {...sameIdentity,order_date:'2026-10-14',order_number:'E',total_price:2000}
  ];
  const {routes}=loadServer(testOrders),res=response();
  const route=routes.find(route=>route.endpoint==='/api/admin/orders/export-csv');
  await route.handlers[1]({query:{}},res);
  assert.equal(res.code,200);
  const dailyTotals=res.data.trim().split('\r\n').slice(1).map(row=>Number(row.split(';').at(-1)));
  assert.deepEqual(dailyTotals,[13000,13000,7000,5000,2000]);
});

test('Public Supabase key gives actionable error without querying or writing payments',async()=>{
  const cloud={from(){throw Error('Public key must be rejected before querying');}};
  const anonKey='eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({role:'anon'})).toString('base64url')+'.synthetic';
  for(const key of [anonKey,'sb_publishable_synthetic']) {
    const {db,writes}=loadDb(cloud,key);
    const check=error=>error.status===503 && error.message.includes('service_role') && !error.message.includes(key);
    await assert.rejects(()=>db.getKasbonPayments(10,2026),check);
    await assert.rejects(()=>db.setKasbonPayment({month:10,year:2026,key:employeeKey(base),isPaid:true,admin:'tester'}),check);
    assert.equal(writes(),0);
  }
});

const {validatePaymentHistory,historyPage}=require('../src/paymentHistory');
const historyInput={user_name:' Budi ',company:'PT A',division:'HR',payment_date:'2026-10-17'};
test('History validates identities and assigns the server date instead of a client date',()=>{
  const now=new Date('2026-10-17T17:00:00Z');
  assert.equal(validatePaymentHistory(historyInput,now).user_name,'Budi');
  for (const change of [{user_name:' '},{company:42},{division:'x'.repeat(256)}]) {
    assert.throws(()=>validatePaymentHistory({...historyInput,...change},now),error=>error.status===400);
  }
  assert.equal(validatePaymentHistory({...historyInput,payment_date:'1900-01-01'},now).payment_date,'2026-10-18');
  assert.equal(historyPage(),1);
  for(const page of ['0','-1','1.5',[],{},'1000000']) assert.throws(()=>historyPage(page));
});
test('History local storage persists independently, sorts latest first and paginates',async()=>{
  const {db,getStore}=loadDb();
  for(let index=0;index<51;index++) await db.createPaymentHistory({...historyInput,payment_date:index===0?'2026-10-18':'2026-10-17'});
  const first=await db.getPaymentHistory(1),second=await db.getPaymentHistory(2);
  assert.equal(first.payments.length,50);assert.equal(first.hasMore,true);
  assert.equal(first.payments[0].id,51);
  assert.equal(first.payments[0].payment_date,require('../src/paymentHistory').jakartaDate());
  assert.equal(second.payments.length,1);assert.equal(second.hasMore,false);
  assert.equal(getStore().orders.length,3);
});
test('History cloud failures never save locally and public keys are rejected',async()=>{
  const cloud={from(){throw Error('Synthetic cloud outage');}};
  const {db,writes}=loadDb(cloud);
  await assert.rejects(()=>db.createPaymentHistory(historyInput),/Synthetic cloud outage/);
  await assert.rejects(()=>db.getPaymentHistory(),/Synthetic cloud outage/);
  assert.equal(writes(),0);
  const publicDb=loadDb(cloud,'sb_publishable_synthetic').db;
  await assert.rejects(()=>publicDb.getPaymentHistory(),error=>error.status===503);
  await assert.rejects(()=>publicDb.createPaymentHistory(historyInput),error=>error.status===503);
});
test('History uses the requested Supabase table and inserts only validated fields',async()=>{
  let inserted;
  const chain={insert(value){inserted=value;return this},select(){return this},
    single:async()=>({data:{id:1,...inserted},error:null})};
  const {db,writes}=loadDb({from(table){assert.equal(table,'history_payments');return chain;}});
  const result=await db.createPaymentHistory({...historyInput,id:999,unwanted:'discard'});
  assert.equal(result.id,1);assert.equal(result.user_name,'Budi');
  assert.equal(inserted.unwanted,undefined);assert.equal(inserted.id,undefined);assert.equal(writes(),0);
});
test('History endpoints require admin login and reject invalid requests',async()=>{
  const {routes}=loadServer();
  for(const method of ['get','post']) {
    const route=routes.find(route=>route.method===method && route.endpoint==='/api/admin/history-payments');
    const res=response();let next=false;
    route.handlers[0]({headers:{},query:{}},res,()=>{next=true;});
    assert.equal(res.code,401);assert.equal(next,false);
    const bad=response();
    await route.handlers[1]({query:{page:'0'},body:{},user:{username:'tester'}},bad);
    assert.equal(bad.code,400);
  }
});

test('WhatsApp redelivery deduplicates persisted local history without changing the original date',async()=>{
  const {db,getStore,writes}=loadDb();
  const first=await db.createPaymentHistory(historyInput,{messageId:'wamid.saved'});
  const duplicate=await db.createPaymentHistory({...historyInput,user_name:'Changed'},{messageId:'wamid.saved'});
  assert.equal(duplicate,null);assert.equal(writes(),1);
  assert.equal(getStore().history_payments.length,1);
  assert.equal(getStore().history_payments[0].user_name,'Budi');
  assert.equal(getStore().history_payments[0].payment_date,first.payment_date);
});
test('WhatsApp cloud inserts use a unique message key and preserve existing rows on redelivery',async()=>{
  let captured,seen=false;
  const chain={upsert(record,options){captured={record,options};return this},select(){return this},
    async maybeSingle(){if(seen)return {data:null,error:null};seen=true;return {data:captured.record,error:null}}};
  const {db,writes}=loadDb({from(table){assert.equal(table,'history_payments');return chain}});
  const first=await db.createPaymentHistory(historyInput,{messageId:'wamid.cloud'});
  const duplicate=await db.createPaymentHistory(historyInput,{messageId:'wamid.cloud'});
  assert.equal(first.whatsapp_message_id,'wamid.cloud');assert.equal(duplicate,null);
  assert.equal(captured.options.onConflict,'whatsapp_message_id');
  assert.equal(captured.options.ignoreDuplicates,true);assert.equal(writes(),0);
});
test('WhatsApp verification and receiving endpoints are registered',()=>{
  const {routes}=loadServer();
  for(const method of ['get','post']) {
    assert.ok(routes.find(route=>route.method===method && route.endpoint==='/api/webhooks/whatsapp'));
  }
});

const { validateManualPaymentHistory, paymentHistoryId } = require('../src/paymentHistory');
test('Manual payments validate actual dates while WhatsApp keeps a server assigned date', () => {
  assert.equal(validateManualPaymentHistory({...historyInput,payment_date:'2024-02-29'}).payment_date,'2024-02-29');
  for (const value of ['',null,'2026-02-29','2026-04-31','2026-2-01','0000-01-01','tomorrow']) {
    assert.throws(()=>validateManualPaymentHistory({...historyInput,payment_date:value}),error=>error.status===400);
  }
  for (const id of ['0','-1','1.5','abc','9223372036854775808']) {
    assert.throws(()=>paymentHistoryId(id),error=>error.status===400);
  }
  assert.equal(paymentHistoryId('9223372036854775807'),'9223372036854775807');
});
test('Admin can create a manual payment, correct identity/date, and hide it without losing deduplication',async()=>{
  const {db,getStore}=loadDb();
  const manual=await db.createPaymentHistory({...historyInput,payment_date:'2026-01-01'},{manual:true,admin:'operator'});
  assert.equal(manual.payment_date,'2026-01-01');assert.equal(manual.updated_by,'operator');
  const original=await db.createPaymentHistory(historyInput,{messageId:'wamid.editable'});
  const changed=await db.updatePaymentHistory(String(original.id),
    {...historyInput,user_name:'Budi Baru',payment_date:'2026-01-02',whatsapp_message_id:'spoofed',created_at:'spoofed'},'admin');
  assert.equal(changed.user_name,'Budi Baru');assert.equal(changed.payment_date,'2026-01-02');
  assert.equal(changed.whatsapp_message_id,'wamid.editable');assert.equal(changed.created_at,original.created_at);
  assert.equal(changed.updated_by,'admin');assert.ok(changed.updated_at);
  await db.deletePaymentHistory(String(original.id),'admin');
  const listed=await db.getPaymentHistory();
  assert.equal(listed.payments.length,1);assert.equal(listed.payments[0].id,manual.id);
  const stored=getStore().history_payments.find(row=>row.id===original.id);
  assert.ok(stored.deleted_at);assert.equal(stored.whatsapp_message_id,'wamid.editable');
  assert.equal(await db.createPaymentHistory(historyInput,{messageId:'wamid.editable'}),null);
  await assert.rejects(()=>db.updatePaymentHistory(String(original.id),historyInput,'admin'),error=>error.status===404);
  await assert.rejects(()=>db.deletePaymentHistory(String(original.id),'admin'),error=>error.status===404);
  assert.equal(getStore().orders.length,3);
});
test('Invalid manual dates and missing IDs do not write payment storage',async()=>{
  const {db,writes}=loadDb();
  await assert.rejects(()=>db.createPaymentHistory({...historyInput,payment_date:'2026-02-30'},{manual:true}),error=>error.status===400);
  await assert.rejects(()=>db.updatePaymentHistory('999',historyInput,'admin'),error=>error.status===404);
  await assert.rejects(()=>db.deletePaymentHistory('999','admin'),error=>error.status===404);
  assert.equal(writes(),0);
});
test('Cloud corrections and deletion filter active records; cloud errors never fall back locally',async()=>{
  const calls=[];
  let updated;
  const chain={update(record){updated=record;return this},eq(field,value){calls.push(['eq',field,value]);return this},
    is(field,value){calls.push(['is',field,value]);return this},select(){return this},
    maybeSingle:async()=>({data:{id:'9',...updated},error:null})};
  const {db,writes}=loadDb({from(table){assert.equal(table,'history_payments');return chain}});
  await db.updatePaymentHistory('9',{...historyInput,payment_date:'2026-10-01'},'operator');
  assert.equal(updated.payment_date,'2026-10-01');assert.equal(updated.updated_by,'operator');
  assert.equal(updated.whatsapp_message_id,undefined);
  await db.deletePaymentHistory('9','operator');
  assert.ok(updated.deleted_at);
  assert.deepEqual(calls,[['eq','id','9'],['is','deleted_at',null],['eq','id','9'],['is','deleted_at',null]]);
  assert.equal(writes(),0);
  const broken=loadDb({from(){throw Error('Cloud offline');}});
  await assert.rejects(()=>broken.db.updatePaymentHistory('9',historyInput,'operator'),/Cloud offline/);
  await assert.rejects(()=>broken.db.deletePaymentHistory('9','operator'),/Cloud offline/);
  assert.equal(broken.writes(),0);
});
test('Cloud history excludes deleted records and paginates 50 active rows',async()=>{
  const calls=[];
  const chain={select(){return this},is(field,value){calls.push([field,value]);return this},order(){return this},
    range(from,to){assert.equal(from,50);assert.equal(to,100);return Promise.resolve({data:Array.from({length:51},(_,id)=>({id})),error:null})}};
  const {db}=loadDb({from(){return chain}});
  const listed=await db.getPaymentHistory(2);
  assert.equal(listed.payments.length,50);assert.equal(listed.hasMore,true);
  assert.deepEqual(calls,[['deleted_at',null]]);
});
test('Payment management API requires admin and passes manual dates and operator identity',async()=>{
  const {routes,historyCalls}=loadServer();
  for(const method of ['post','put','delete']){
    const endpoint=method==='post'?'/api/admin/history-payments':'/api/admin/history-payments/:id';
    const route=routes.find(route=>route.method===method&&route.endpoint===endpoint);
    const denied=response();route.handlers[0]({headers:{},query:{}},denied,()=>assert.fail('Anonymous request'));
    assert.equal(denied.code,401);
    const res=response();
    await route.handlers[1]({body:{...historyInput,payment_date:'2026-01-02'},params:{id:'9'},user:{username:'operator'}},res);
    assert.equal(res.code,method==='post'?201:200);assert.equal(res.data.success,true);
  }
  assert.equal(historyCalls[0].input.payment_date,'2026-01-02');
  assert.equal(historyCalls[0].options.manual,true);assert.equal(historyCalls[0].options.admin,'operator');
  assert.equal(historyCalls[1].input.payment_date,'2026-01-02');assert.equal(historyCalls[1].admin,'operator');
  assert.equal(historyCalls[2].admin,'operator');
  const invalid=response();
  await routes.find(route=>route.method==='put'&&route.endpoint==='/api/admin/history-payments/:id')
    .handlers[1]({body:{...historyInput,payment_date:'2026-02-30'},params:{id:'9'},user:{username:'operator'}},invalid);
  assert.equal(invalid.code,400);assert.equal(historyCalls.length,3);
});

test('Queued group payments preserve the backend receipt date across retries',async()=>{
  const {db}=loadDb();
  const payment=await db.createPaymentHistory({...historyInput,payment_date:'1900-01-01'},
    {messageId:'baileys:synthetic-queued',receivedAt:'2026-10-17T16:59:00.000Z'});
  assert.equal(payment.payment_date,'2026-10-17');
  const duplicate=await db.createPaymentHistory(historyInput,
    {messageId:'baileys:synthetic-queued',receivedAt:'2026-10-18T17:00:00.000Z'});
  assert.equal(duplicate,null);
  await assert.rejects(()=>db.createPaymentHistory(historyInput,{receivedAt:'invalid'}),error=>error.status===400);
});

test('Concurrent menu creation at an identical timestamp keeps IDs distinct', async () => {
  class FrozenDate extends Date { static now() { return 1234567890000; } }
  const { db, getStore } = loadDb(undefined, 'synthetic', FrozenDate);
  const menus = await Promise.all(Array.from({ length: 100 }, (_, index) =>
    db.createMenu({ name: 'Synthetic ' + index, price: 5000, category: 'Lauk', schedules: {} })));
  assert.equal(new Set(menus.map(menu => menu.id)).size, 100);
  assert.ok(menus.every(menu => menu.id.length <= 50));
  assert.equal(getStore().menus.length, 100);
});

test('Configured cloud outages never silently read or write a different local dataset', async () => {
  const operations = [
    db => db.getMenusByDay('Senin'),
    db => db.updateMenu('m-1', { name: 'Synthetic', price: 5000, schedules: {} }),
    db => db.deleteMenu('m-1'),
    db => db.updateSchedules({ 'm-1': { Senin: true } }),
    db => db.createOrder({ userName: 'Synthetic', company: 'PT Test', division: 'QA',
      location: 'Office', items: [], totalPrice: 0 }),
    db => db.getOrders({})
  ];
  for (const operation of operations) {
    const { db, writes } = loadDb({ from() { throw Error('Synthetic unavailable cloud'); } });
    await assert.rejects(() => operation(db), /Synthetic unavailable cloud/);
    assert.equal(writes(), 0);
  }
});

test('Configured but uninitializable cloud client also fails closed on legacy operations', async () => {
  for (const operation of [
    db => db.getMenusByDay('Senin'),
    db => db.updateMenu('m-1', { name: 'Synthetic' }),
    db => db.deleteMenu('m-1'),
    db => db.updateSchedules({}),
    db => db.createOrder({}),
    db => db.getOrders({})
  ]) {
    const { db, writes } = loadDb({ initError: true });
    await assert.rejects(() => operation(db), /Koneksi Supabase tidak tersedia/);
    assert.equal(writes(), 0);
  }
});

test('Menu deletion uses one parent DELETE so the FK cascade is atomic', async () => {
  const tables = [];
  const { db, writes } = loadDb({ from(table) {
    tables.push(table);
    return { delete() { return this; }, async eq(field, value) {
      assert.equal(field, 'id'); assert.equal(value, 'm-1');
      return { error: null };
    } };
  } });
  await db.deleteMenu('m-1');
  assert.deepEqual(tables, ['menus']);
  assert.equal(writes(), 0);
});

test('Schedule aliases are registered before the dynamic menu update route', () => {
  const { routes } = loadServer();
  const index = path => routes.findIndex(route => route.method === 'put' && route.endpoint === path);
  assert.ok(index('/api/admin/menus/schedules') < index('/api/admin/menus/:id'));
  assert.ok(index('/api/admin/schedules') < index('/api/admin/menus/:id'));
});

const { paymentHistoryFilters } = require('../src/paymentHistory');

test('History filters validate dates, leap months, boundaries and malformed inputs', () => {
  assert.deepEqual(paymentHistoryFilters({ search: ' Budi ', company: 'PT A', division: 'HR', date: '2026-10-24' }),
    { search: 'Budi', company: 'PT A', division: 'HR', startDate: '2026-10-24', endDate: '2026-10-24' });
  assert.deepEqual(paymentHistoryFilters({ month: '2', year: '2024' }),
    { startDate: '2024-02-01', endDate: '2024-02-29' });
  assert.deepEqual(paymentHistoryFilters({ month: '12', year: '2026' }),
    { startDate: '2026-12-01', endDate: '2026-12-31' });
  for (const query of [
    { date: '2026-02-30' }, { date: ['2026-10-24'] }, { search: {} },
    { company: 'x'.repeat(256) }, { month: '13', year: '2026' }, { year: '2026' },
    { startDate: '2026-10-25', endDate: '2026-10-24' },
    { date: '2026-10-24', startDate: '2026-10-01' },
    { month: '10', year: '2026', endDate: '2026-10-24' }
  ]) assert.throws(() => paymentHistoryFilters(query), error => error.status === 400);
});

test('History applies combined filters before pagination and excludes soft-deleted payments', async () => {
  const { db, getStore } = loadDb();
  const rows = Array.from({ length: 60 }, (_, index) => ({ id: index + 1, user_name: 'Budi Santoso',
    company: 'PT A', division: 'HR', payment_date: '2026-10-24' }));
  getStore().history_payments = [
    ...rows,
    { ...rows[0], id: 100, company: 'PT B' },
    { ...rows[0], id: 101, division: 'IT' },
    { ...rows[0], id: 102, user_name: 'Other' },
    { ...rows[0], id: 103, payment_date: '2026-10-25' },
    { ...rows[0], id: 104, deleted_at: '2026-10-24T12:00:00Z' }
  ];
  const filters = { search: 'bUdI', company: 'PT A', division: 'HR', date: '2026-10-24' };
  const first = await db.getPaymentHistory(1, filters), second = await db.getPaymentHistory(2, filters);
  assert.equal(first.payments.length, 50); assert.equal(first.hasMore, true);
  assert.equal(second.payments.length, 10); assert.equal(second.hasMore, false);
  assert.equal(first.payments[0].id, 60); assert.equal(second.payments.at(-1).id, 1);
  const none = await db.getPaymentHistory(1, { company: 'missing' });
  assert.equal(none.payments.length, 0);
});

test('Cloud history filters precede range and escape literal search wildcards', async () => {
  const calls = [];
  const chain = {};
  for (const method of ['select', 'is', 'ilike', 'eq', 'gte', 'lte', 'order']) {
    chain[method] = (...args) => { calls.push([method, ...args]); return chain; };
  }
  chain.range = async (...args) => { calls.push(['range', ...args]); return { data: [], error: null }; };
  const { db, writes } = loadDb({ from(table) { assert.equal(table, 'history_payments'); return chain; } });
  await db.getPaymentHistory(2, { search: '50%_off', company: 'PT A', division: 'HR', month: '2', year: '2024' });
  assert.ok(calls.some(call => call[0] === 'ilike' && call[1] === 'user_name' && call[2] === '%50\\%\\_off%'));
  assert.ok(calls.some(call => call[0] === 'gte' && call[2] === '2024-02-01'));
  assert.ok(calls.some(call => call[0] === 'lte' && call[2] === '2024-02-29'));
  assert.deepEqual(calls.at(-1), ['range', 50, 100]);
  assert.equal(writes(), 0);
});

const { groupOrdersByCustomerDay } = require('../src/orderGrouping');

test('Compact orders merge five same-day orders without changing source records or their totals', () => {
  const input = Array.from({ length: 5 }, (_, index) => ({
    ...base, user_name: index % 2 ? ' BUDI ' : 'Budi', order_date: '2026-10-24',
    order_number: 'ORD-' + index, total_price: 3000, payment_method: 'Cash',
    created_at: '2026-10-24T03:0' + index + ':00Z',
    items: [{ name: index < 2 ? 'Oseng labu siam' : 'Oseng tahu', qty: 1, price: 3000, subtotal: 3000 }],
    notes: index === 0 ? 'sayap' : '', location: index === 0 ? 'Gedung A' : 'Gedung B'
  }));
  const original = JSON.stringify(input);
  const [row] = groupOrdersByCustomerDay(input);
  assert.equal(row.order_count, 5); assert.equal(row.total_price, 15000);
  assert.equal(row.cash_total, 15000); assert.equal(row.kasbon_total, 0);
  assert.deepEqual(row.items.map(item => item.qty), [2, 3]);
  assert.equal(row.order_numbers.length, 5);
  assert.match(row.location, /Gedung A/); assert.match(row.location, /Gedung B/);
  assert.match(row.notes, /ORD-0: sayap/);
  assert.equal(row.created_at, '2026-10-24T03:04:00Z');
  assert.equal(JSON.stringify(input), original);
});

test('Compact identity keeps different companies, divisions and delivery dates separate', () => {
  const order = { ...base, total_price: 3000, items: [] };
  const rows = groupOrdersByCustomerDay([
    order, { ...order, user_name: ' BUDI ' }, { ...order, company: 'PT B' },
    { ...order, division: 'IT' }, { ...order, order_date: '2026-01-16' }
  ]);
  assert.equal(rows.length, 4);
  assert.equal(rows[0].order_count, 2);
  assert.equal(rows.reduce((sum, row) => sum + row.total_price, 0), 15000);
});

test('Mixed payments and menu price changes retain distinct amounts and ignore legacy metadata items', () => {
  const rows = groupOrdersByCustomerDay([
    { ...base, total_price: 3000, payment_method: 'Cash',
      items: [{ name: 'Nasi', qty: 1, price: 3000 }] },
    { ...base, total_price: 5000,
      items: [{ name: 'Nasi', qty: 1, price: 5000 }, { _meta: true, payment_method: 'Kasbon', notes: 'pedas' }] }
  ]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].payment_methods, ['Cash', 'Kasbon']);
  assert.equal(rows[0].cash_total, 3000); assert.equal(rows[0].kasbon_total, 5000);
  assert.equal(rows[0].total_price, 8000); assert.equal(rows[0].items.length, 2);
  assert.match(rows[0].notes, /pedas/);
});

test('Orders API preserves original statistics and adds grouped rows', async () => {
  const input = [
    { ...base, order_number: 'A', total_price: 3000, items: [] },
    { ...base, order_number: 'B', total_price: 3000, items: [] }
  ];
  const { routes } = loadServer(input), res = response();
  await routes.find(route => route.method === 'get' && route.endpoint === '/api/admin/orders')
    .handlers[1]({ query: {} }, res);
  assert.equal(res.code, 200);
  assert.equal(res.data.orders.length, 2);
  assert.equal(res.data.summary.totalTransactions, 2);
  assert.equal(res.data.summary.totalRevenue, 6000);
  assert.equal(res.data.groupedOrders.length, 1);
  assert.equal(res.data.groupedOrders[0].total_price, 6000);
});

function parseCsvLine(line) {
  const values = []; let text = '', quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { text += '"'; index++; }
      else quoted = !quoted;
    } else if (char === ';' && !quoted) { values.push(text); text = ''; }
    else text += char;
  }
  values.push(text); return values;
}

test('Grouped CSV exports one row per customer/day, complete references, and separate payment amounts', async () => {
  const input = [
    { ...base, order_number: 'ORD-A', total_price: 3000, payment_method: 'Cash',
      notes: 'sayap; "pedas"', items: [{ name: 'Oseng tahu', price: 3000, qty: 1 }] },
    { ...base, order_number: 'ORD-B', total_price: 3000, payment_method: 'Kasbon',
      items: [{ name: 'Oseng tahu', price: 3000, qty: 1 }] },
    { ...base, user_name: 'Other', order_number: 'ORD-C', total_price: 5000, items: [] }
  ];
  const { routes } = loadServer(input), res = response();
  const route = routes.find(route => route.endpoint === '/api/admin/orders/export-csv');
  await route.handlers[1]({ query: { groupBy: 'customer_day' } }, res);
  assert.equal(res.code, 200);
  const lines = res.data.trim().split('\r\n');
  assert.equal(lines.length, 3);
  const header = parseCsvLine(lines[0]), row = parseCsvLine(lines[1]);
  assert.equal(row.length, header.length);
  assert.equal(row[1], 'ORD-A | ORD-B');
  assert.match(row[9], /sayap; "pedas"/);
  assert.equal(row[10], 'Oseng tahu (2x)');
  assert.equal(Number(row[11]), 6000);
  assert.equal(Number(row[13]), 2);
  assert.equal(Number(row[14]), 3000);
  assert.equal(Number(row[15]), 3000);
  assert.match(res.headers['Content-Disposition'], /Ringkas_/);
  const invalid = response();
  await route.handlers[1]({ query: { groupBy: 'unsupported' } }, invalid);
  assert.equal(invalid.code, 400);
});
