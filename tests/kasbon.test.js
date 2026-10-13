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
function loadDb(cloud, key = 'synthetic') {
  let store={orders:[...orders,{...orders[0],order_date:'2026-02-01'}],menus:[],schedules:{}};
  let writes=0;
  const fakeFs={existsSync:()=>true,readFileSync:()=>JSON.stringify(store),
    writeFileSync:(_,data)=>{store=JSON.parse(data);writes++;}};
  const context={Buffer,module:{exports:{}},process:{env:cloud ? {SUPABASE_URL:'https://example.supabase.co',SUPABASE_KEY:key} : {}},
    __dirname:path.resolve(__dirname,'../src'),console:{log(){},warn(){},error(){}},
    require:name=>name==='fs' ? fakeFs : name==='@supabase/supabase-js' ? {createClient:()=>cloud} :
      name==='./seedData' ? {INITIAL_MENUS:[],DAYS_OF_WEEK:[]} :
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
  const context={module:{exports:{}},process:{env},Buffer,Date,__dirname:path.resolve(__dirname,'../src'),
    console:{log(){},error(){}},require:name=>name==='express' ? express : name==='cors' ? ()=>()=>{} :
      name==='dotenv' ? {config(){}} : name==='./db' ? {
        getOrders:async()=>mockOrders,
        getKasbonOrders:async()=>orders,getKasbonPayments:async()=>[],
        setKasbonPayment:async input=>{saves++;return {is_paid:input.isPaid};}
      } : name==='./seedData' ? {DAYS_OF_WEEK:[]} :
      name==='./kasbon' ? require('../src/kasbon') : require(name)};
  vm.createContext(context);vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src/server.js'),'utf8'),context);
  return {routes,context,saves:()=>saves};
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
