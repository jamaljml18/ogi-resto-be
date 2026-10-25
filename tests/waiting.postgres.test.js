const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve, dirname, basename } = require('node:path');
const { createServer } = require('node:net');

const run = promisify(execFile);
const quote = text => "'" + text.replace(/'/g, "''") + "'";
const fixture = (number, name) => ({ order_number:number,user_name:name,company:'Synthetic PT',division:'QA',
  location:'Office',items:[{name:'Synthetic menu',qty:1,price:3000,subtotal:3000}],total_price:3000,
  order_day:'Hari Ini',order_date:'2026-10-25',notes:'synthetic' });

test('PostgreSQL waiting-payment transactions and concurrent operations', { timeout:120000 }, async t => {
  const bin = process.env.OGI_POSTGRES_BIN || 'C:\\Program Files\\PostgreSQL\\17\\bin';
  const root = await mkdtemp(join(tmpdir(),'ogi-waiting-pg-'));
  if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('ogi-waiting-pg-')) throw Error('Unsafe fixture directory');
  const data = join(root,'data'), log = join(root,'postgres.log');
  const ext = process.platform === 'win32' ? '.exe' : '';
  const exe = name => join(bin,name+ext);
  const server = createServer();
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  let started = false;
  t.after(async () => {
    if (started) { try { execFileSync(exe('pg_ctl'),['-D',data,'-m','immediate','-w','stop'],{windowsHide:true,stdio:'ignore',timeout:15000}); } catch {} }
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('ogi-waiting-pg-')) throw Error('Unsafe cleanup directory');
    await rm(root,{recursive:true,force:true});
  });
  execFileSync(exe('initdb'),['-D',data,'-A','trust','-U','postgres','--no-locale','--encoding=UTF8'],{windowsHide:true,stdio:'pipe'});
  started = true;
  execFileSync(exe('pg_ctl'),['-D',data,'-l',log,'-o','-h 127.0.0.1 -p '+port+' -F','-w','start'],{windowsHide:true,stdio:'ignore',timeout:20000});
  const args = ['-X','-h','127.0.0.1','-p',String(port),'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-q','-w','-t','-A'];
  const fixtureEnv = { ...process.env, PGSSLMODE:'disable', PGCONNECT_TIMEOUT:'5', PGPASSFILE:join(root,'no-password-file') };
  delete fixtureEnv.PGSERVICE; delete fixtureEnv.PGPASSWORD;
  const options = { windowsHide:true,encoding:'utf8',env:fixtureEnv,maxBuffer:4*1024*1024,timeout:15000 };
  const sql = text => execFileSync(exe('psql'),[...args,'-c',text],options).trim();
  const concurrent = text => run(exe('psql'),[...args,'-c',text],options);
  const json = text => JSON.parse(sql(text));
  sql('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;');
  sql(await readFile(join(__dirname,'../schema.sql'),'utf8'));
  await t.test('Migration 005 handles legacy orders without payment columns; repair 006 is repeatable', async()=>{
    sql('ALTER TABLE public.orders DROP COLUMN payment_method, DROP COLUMN notes;');
    sql(await readFile(join(__dirname,'../migrations/005_waiting_payments.sql'),'utf8'));
    sql('ALTER TABLE public.orders DROP COLUMN payment_method, DROP COLUMN notes;');
    const repair=await readFile(join(__dirname,'../migrations/006_orders_payment_columns.sql'),'utf8');
    sql(repair);sql(repair);
    assert.equal(sql("SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name IN ('payment_method','notes');"),'2');
  });
  const create = (number,name,hash) => 'SELECT public.create_waiting_order('+quote(JSON.stringify(fixture(number,name)))+'::jsonb,'+quote(hash.repeat(64))+');';
  const record = (name,id,received='clock_timestamp()') => "SELECT public.record_payment_and_settle_waiting("+
    quote(JSON.stringify({user_name:name,company:'Synthetic PT',division:'QA',payment_date:'2026-10-25'}))+
    '::jsonb,'+quote(id)+','+received+",'test');";
  const settle = (number,action) => 'SELECT public.settle_waiting_order('+quote(number)+','+quote(action)+",'admin');";

  await t.test('Only one parallel checkout can reserve a normalized identity',async()=>{
    const results = await Promise.allSettled([
      concurrent('BEGIN;'+create('ORD-UNIQUE-A','Unique','a')+'SELECT pg_sleep(0.2);COMMIT;'),
      concurrent(create('ORD-UNIQUE-B',' UNIQUE ','b'))
    ]);
    assert.equal(results.filter(row=>row.status==='fulfilled').length,1);
    assert.equal(sql("SELECT count(*) FROM public.waiting_payments WHERE lower(btrim(user_name))='unique';"),'1');
  });

  await t.test('Receipt and admin pay racing create exactly one completed order',async()=>{
    sql(create('ORD-RACE','Race','c'));
    const results = await Promise.allSettled([
      concurrent('BEGIN;'+settle('ORD-RACE','pay')+'SELECT pg_sleep(0.2);COMMIT;'),
      concurrent(record('Race','wa.race'))
    ]);
    assert.ok(results.every(row=>row.status==='fulfilled'));
    assert.equal(sql("SELECT count(*) FROM public.orders WHERE order_number='ORD-RACE';"),'1');
    assert.equal(sql("SELECT count(*) FROM public.waiting_payments WHERE order_number='ORD-RACE';"),'0');
    assert.equal(sql("SELECT count(*) FROM public.history_payments WHERE whatsapp_message_id='wa.race';"),'1');
    assert.equal(sql("SELECT status FROM public.order_payment_status WHERE order_number='ORD-RACE';"),'paid');
  });

  await t.test('An insert failure rolls back the history, status update and removal together',async()=>{
    sql(create('ORD-ROLLBACK','Rollback','d'));
    sql("CREATE FUNCTION public.synthetic_block() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.order_number='ORD-ROLLBACK' THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER synthetic_block BEFORE INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public.synthetic_block();");
    assert.throws(()=>sql(record('Rollback','wa.rollback')));
    assert.equal(sql("SELECT count(*) FROM public.history_payments WHERE whatsapp_message_id='wa.rollback';"),'0');
    assert.equal(sql("SELECT count(*) FROM public.waiting_payments WHERE order_number='ORD-ROLLBACK';"),'1');
    assert.equal(sql("SELECT status FROM public.order_payment_status WHERE order_number='ORD-ROLLBACK';"),'waiting');
    sql('DROP TRIGGER synthetic_block ON public.orders; DROP FUNCTION public.synthetic_block();');
    sql(record('Rollback','wa.rollback'));
    assert.equal(sql("SELECT count(*) FROM public.orders WHERE order_number='ORD-ROLLBACK';"),'1');
  });

  await t.test('A replay or old queued receipt cannot settle the next order for the same identity',async()=>{
    sql(create('ORD-REPLAY-A','Replay','e'));
    sql(record('Replay','wa.replay'));
    sql(create('ORD-REPLAY-B','Replay','f'));
    assert.equal(sql(record('Replay','wa.replay')),'');
    sql(record('Replay','wa.old',"'2000-01-01T00:00:00Z'::timestamptz"));
    assert.equal(sql("SELECT status FROM public.order_payment_status WHERE order_number='ORD-REPLAY-B';"),'waiting');
    assert.equal(sql("SELECT count(*) FROM public.orders WHERE order_number='ORD-REPLAY-B';"),'0');
  });

  await t.test('Concurrent delete and pay have one winner and no duplicate or half-moved row',async()=>{
    sql(create('ORD-DELETE-RACE','DeleteRace','1'));
    const results = await Promise.allSettled([
      concurrent('BEGIN;'+settle('ORD-DELETE-RACE','pay')+'SELECT pg_sleep(0.2);COMMIT;'),
      concurrent(settle('ORD-DELETE-RACE','delete'))
    ]);
    assert.equal(results.filter(row=>row.status==='fulfilled').length,1);
    const status=sql("SELECT status FROM public.order_payment_status WHERE order_number='ORD-DELETE-RACE';");
    assert.ok(['paid','deleted'].includes(status));
    assert.equal(sql("SELECT count(*) FROM public.waiting_payments WHERE order_number='ORD-DELETE-RACE';"),'0');
    assert.equal(sql("SELECT count(*) FROM public.orders WHERE order_number='ORD-DELETE-RACE';"),status==='paid'?'1':'0');
  });

  await t.test('A checkout retry reuses its original reference before and after confirmation',async()=>{
    const first=json(create('ORD-RETRY-A','Retry  Customer','3'));
    const retry=json(create('ORD-RETRY-B',' retry customer ','3'));
    assert.equal(retry.order_number,first.order_number);
    assert.equal(sql("SELECT count(*) FROM public.waiting_payments WHERE order_number IN ('ORD-RETRY-A','ORD-RETRY-B');"),'1');
    sql(record('Retry Customer','wa.retry'));
    const completed=json(create('ORD-RETRY-C','Retry Customer','3'));
    assert.equal(completed.order_number,first.order_number);assert.equal(completed.payment_status,'paid');
  });

  await t.test('Reapplying migration 005 preserves existing completed and waiting orders',async()=>{
    const counts=()=>json("SELECT json_build_object('orders',(SELECT count(*) FROM public.orders),'waiting',(SELECT count(*) FROM public.waiting_payments),'history',(SELECT count(*) FROM public.history_payments));");
    const before=counts();
    sql(await readFile(join(__dirname,'../migrations/005_waiting_payments.sql'),'utf8'));
    assert.deepEqual(counts(),before);
  });

  await t.test('Old direct Cash inserts are rejected while direct Kasbon remains allowed',async()=>{
    const insert=(number,method)=>"INSERT INTO public.orders(order_number,user_name,company,division,location,items,total_price,order_day,order_date,payment_method) VALUES ('"+number+"','Legacy','PT Test','QA','Office','[]',3000,'Hari Ini','2026-10-25','"+method+"');";
    assert.throws(()=>sql(insert('ORD-DIRECT-CASH','Cash')));
    sql(insert('ORD-DIRECT-KASBON','Kasbon'));
    assert.equal(sql("SELECT count(*) FROM public.orders WHERE order_number='ORD-DIRECT-CASH';"),'0');
    assert.equal(sql("SELECT count(*) FROM public.orders WHERE order_number='ORD-DIRECT-KASBON';"),'1');
  });

  await t.test('Public roles cannot read waiting data or execute settlement RPCs',async()=>{
    assert.throws(()=>sql('SET ROLE anon; SELECT * FROM public.waiting_payments;'));
    assert.throws(()=>sql('SET ROLE authenticated; SELECT * FROM public.order_payment_status;'));
    assert.throws(()=>sql("SET ROLE anon; SELECT public.settle_waiting_order('ORD-RACE','pay','spoof');"));
    assert.throws(()=>sql('SET ROLE anon; SELECT * FROM public.orders;'));
    const result=json('SET ROLE service_role;'+create('ORD-SERVICE','Service','2'));
    assert.equal(result.order_number,'ORD-SERVICE');
  });
  const makeEditOrder=(number,name)=>sql("INSERT INTO public.orders(order_number,user_name,company,division,location,items,total_price,order_day,order_date,payment_method,notes) VALUES ("+quote(number)+","+quote(name)+",'Synthetic PT','QA','Office','[]',3000,'Hari Ini','2026-10-25','Kasbon','keep notes');");
  const edit=(number,revision=1,qty=2,price=4000)=>"SELECT public.edit_order_items("+quote(number)+","+revision+","+quote(JSON.stringify([{id:'edit-a',qty,expectedPrice:price}]))+"::jsonb,'admin');";
  sql("INSERT INTO public.menus(id,name,price,category,is_active) VALUES ('edit-a','Replacement A',4000,'Lauk',true),('edit-b','Replacement B',7000,'Lauk',true);");
  await t.test('Edit uses master prices, preserves details and writes audit',async()=>{
   makeEditOrder('ORD-EDIT-A','EditA');const data=json(edit('ORD-EDIT-A'));
   assert.equal(data.total_price,8000);assert.equal(data.revision,2);assert.equal(data.notes,'keep notes');assert.equal(data.payment_method,'Kasbon');
   assert.equal(data.items[0].name,'Replacement A');assert.equal(data.items[0].subtotal,8000);
   assert.equal(sql("SELECT before_total||':'||after_total FROM public.order_item_changes WHERE order_number='ORD-EDIT-A';"),'3000:8000');
  });
  await t.test('Parallel edits at the same revision have exactly one winner',async()=>{
   makeEditOrder('ORD-EDIT-RACE','EditRace');const results=await Promise.allSettled([concurrent('BEGIN;'+edit('ORD-EDIT-RACE',1,2)+'SELECT pg_sleep(0.2);COMMIT;'),concurrent(edit('ORD-EDIT-RACE',1,3))]);
   assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
   assert.equal(sql("SELECT count(*) FROM public.order_item_changes WHERE order_number='ORD-EDIT-RACE';"),'1');
   assert.equal(sql("SELECT revision FROM public.orders WHERE order_number='ORD-EDIT-RACE';"),'2');
  });
  await t.test('Invalid quantity, stale price and inactive menus leave orders intact',async()=>{
   makeEditOrder('ORD-EDIT-INVALID','EditInvalid');assert.throws(()=>sql(edit('ORD-EDIT-INVALID',1,1,1)));assert.throws(()=>sql(edit('ORD-EDIT-INVALID',1,0)));
   sql("UPDATE public.menus SET is_active=false WHERE id='edit-a';");assert.throws(()=>sql(edit('ORD-EDIT-INVALID')));sql("UPDATE public.menus SET is_active=true WHERE id='edit-a';");
   assert.equal(sql("SELECT total_price||':'||revision FROM public.orders WHERE order_number='ORD-EDIT-INVALID';"),'3000:1');
   assert.equal(sql("SELECT count(*) FROM public.order_item_changes WHERE order_number='ORD-EDIT-INVALID';"),'0');
  });
  await t.test('Audit failure rolls back the order total and revision',async()=>{
   makeEditOrder('ORD-EDIT-ROLLBACK','EditRollback');
   sql("CREATE FUNCTION public.fail_edit_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.order_number='ORD-EDIT-ROLLBACK' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_edit_audit BEFORE INSERT ON public.order_item_changes FOR EACH ROW EXECUTE FUNCTION public.fail_edit_audit();");
   assert.throws(()=>sql(edit('ORD-EDIT-ROLLBACK')));assert.equal(sql("SELECT total_price||':'||revision FROM public.orders WHERE order_number='ORD-EDIT-ROLLBACK';"),'3000:1');
   sql('DROP TRIGGER fail_edit_audit ON public.order_item_changes;DROP FUNCTION public.fail_edit_audit();');
  });
  const payEdit=name=>"INSERT INTO public.kasbon_payments(employee_key,period_month,user_name,company,division,kasbon_amount,is_paid,paid_at) VALUES ("+quote('synthetic-'+name)+",'2026-10-01',"+quote(name)+",'Synthetic PT','QA',1,true,now());";
  await t.test('Paid kasbon edit is blocked until reopened; payment amount is recalculated',async()=>{
   makeEditOrder('ORD-EDIT-PAID','EditPaid');sql(payEdit('EditPaid'));
   assert.equal(sql("SELECT kasbon_amount FROM public.kasbon_payments WHERE user_name='EditPaid';"),'3000');
   assert.throws(()=>sql(edit('ORD-EDIT-PAID')));
   sql("UPDATE public.kasbon_payments SET is_paid=false,paid_at=null WHERE user_name='EditPaid';");sql(edit('ORD-EDIT-PAID'));
   assert.equal(sql("SELECT total_price FROM public.orders WHERE order_number='ORD-EDIT-PAID';"),'8000');
  });
  await t.test('Payment racing with an edit records the final amount under the same lock',async()=>{
   makeEditOrder('ORD-EDIT-PAY-RACE','EditPayRace');
   const results=await Promise.allSettled([concurrent('BEGIN;'+edit('ORD-EDIT-PAY-RACE')+'SELECT pg_sleep(0.2);COMMIT;'),concurrent(payEdit('EditPayRace'))]);
   assert.equal(results[1].status,'fulfilled');
   const amount=sql("SELECT total_price FROM public.orders WHERE order_number='ORD-EDIT-PAY-RACE';");
   assert.equal(sql("SELECT kasbon_amount FROM public.kasbon_payments WHERE user_name='EditPayRace';"),amount);
  });
  await t.test('Public users cannot edit or read audit data; migration 007 is repeatable',async()=>{
   assert.throws(()=>sql("SET ROLE anon;"+edit('ORD-EDIT-A',2)));
   assert.throws(()=>sql('SET ROLE authenticated;SELECT * FROM public.order_item_changes;'));
   assert.throws(()=>sql('SET ROLE anon;UPDATE public.menus SET price=1;'));
   assert.throws(()=>sql('SET ROLE authenticated;DELETE FROM public.menu_schedules;'));
   const before=sql('SELECT count(*) FROM public.order_item_changes;');
   sql(await readFile(join(__dirname,'../migrations/007_order_item_editing.sql'),'utf8'));
   assert.equal(sql('SELECT count(*) FROM public.order_item_changes;'),before);
  });

});
