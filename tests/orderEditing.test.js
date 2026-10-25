const test=require('node:test');const assert=require('node:assert/strict');
const {validateOrderEdit,priceEditedItems,editFailure}=require('../src/orderEditing');
const menus=[{id:'a',name:'Menu A',price:4000,is_active:true},{id:'b',name:'Menu B',price:0,is_active:true}];
const body={revision:1,items:[{id:'a',qty:2,expectedPrice:4000},{id:'b',qty:1,expectedPrice:0}]};
test('Server pricing ignores client names/prices/totals and supports free menus',()=>{
 const valid=validateOrderEdit({...body,total:1,items:body.items.map(x=>({...x,price:1,name:'Spoof'}))});
 const result=priceEditedItems(valid.items,menus);assert.equal(result.total,8000);assert.equal(result.items[0].name,'Menu A');assert.equal(result.items[0].price,4000);
});
test('Edit rejects invalid revision, duplicate menus, invalid quantities and total overflow',()=>{
 for(const value of [{...body,revision:0},{...body,revision:'1'},{...body,items:[]},{...body,items:[body.items[0],body.items[0]]},...[-1,0,1.5,1000,'2'].map(qty=>({...body,items:[{...body.items[0],qty}]}))])assert.throws(()=>validateOrderEdit(value),e=>e.status===400);
 assert.throws(()=>priceEditedItems([{id:'a',qty:999,expectedPrice:2147483647}],[{id:'a',price:2147483647}]),e=>e.status===400);
});
test('Inactive/deleted menus and stale master price cannot be saved',()=>{
 assert.throws(()=>priceEditedItems(body.items,[{...menus[0],is_active:false}]),e=>e.status===422);
 assert.throws(()=>priceEditedItems(body.items,[]),e=>e.status===422);
 assert.throws(()=>priceEditedItems(body.items,[{...menus[0],price:5000},menus[1]]),e=>e.status===409);
 assert.equal(editFailure({message:'ORDER_EDIT_CONFLICT'}).status,409);
});

test('Checkout ignores forged payload prices and rejects unknown or duplicate menus',()=>{
 const {priceCheckoutItems}=require('../src/orderEditing');
 const result=priceCheckoutItems([{id:'a',name:'Spoof',price:1,qty:3}],menus);
 assert.equal(result.total,12000);assert.equal(result.items[0].id,'a');assert.equal(result.items[0].name,'Menu A');
 assert.throws(()=>priceCheckoutItems([{id:'missing',qty:1}],menus),e=>e.status===422);
 assert.throws(()=>priceCheckoutItems([{id:'a',qty:1},{id:'a',qty:1}],menus),e=>e.status===400);
});
