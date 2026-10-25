const { problem } = require('./waitingPayments');
function validateOrderEdit(body = {}) {
  if (!Number.isSafeInteger(body.revision) || body.revision < 1) throw problem(400,'Versi pesanan tidak valid. Buka ulang editor.');
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50) throw problem(400,'Pilih antara 1 dan 50 menu.');
  const seen = new Set();
  const items = body.items.map(item => {
    if (!item || typeof item.id !== 'string' || !item.id.trim() || item.id.length > 50 ||
      !Number.isSafeInteger(item.qty) || item.qty < 1 || item.qty > 999 ||
      !Number.isSafeInteger(item.expectedPrice) || item.expectedPrice < 0 || item.expectedPrice > 2147483647) {
      throw problem(400,'Menu, jumlah (1-999), atau harga pembanding tidak valid.');
    }
    if (seen.has(item.id)) throw problem(400,'Menu yang sama cukup dicatat sekali. Gabungkan jumlahnya.');
    seen.add(item.id);
    return { id:item.id, qty:item.qty, expectedPrice:item.expectedPrice };
  });
  return { revision:body.revision, items };
}
function priceEditedItems(items, menus) {
  const catalog = new Map(menus.map(menu => [menu.id,menu])); let total=0;
  const priced = items.map(item => {
    const menu=catalog.get(item.id);
    if (!menu || menu.is_active === false) throw problem(422,'Menu tidak tersedia. Muat ulang daftar menu dan pilih pengganti.');
    if (!Number.isSafeInteger(Number(menu.price)) || Number(menu.price)<0 || Number(menu.price)!==item.expectedPrice) throw problem(409,'Harga menu telah berubah. Muat ulang editor sebelum menyimpan.');
    const subtotal=Number(menu.price)*item.qty; total+=subtotal;
    if (!Number.isSafeInteger(total) || total>2147483647) throw problem(400,'Total pesanan melebihi batas yang didukung.');
    return {id:menu.id,name:menu.name,price:Number(menu.price),qty:item.qty,subtotal};
  });
  return {items:priced,total};
}
function editFailure(error) {
  const messages=[
    ['ORDER_NOT_FOUND',404,'Pesanan tidak ditemukan.'],
    ['ORDER_EDIT_CONFLICT',409,'Pesanan telah diubah admin lain. Buka ulang editor untuk melihat versi terbaru.'],
    ['ORDER_PRICE_CHANGED',409,'Harga menu telah berubah. Muat ulang editor sebelum menyimpan.'],
    ['ORDER_KASBON_ALREADY_PAID',409,'Kasbon periode ini sudah lunas. Batalkan status lunas terlebih dahulu sebelum mengedit pesanan.'],
    ['ORDER_MENU_UNAVAILABLE',422,'Menu tidak tersedia. Muat ulang daftar menu dan pilih pengganti.'],
    ['ORDER_TOTAL_OVERFLOW',400,'Total pesanan melebihi batas yang didukung.'],
    ['ORDER_INVALID_ITEMS',400,'Data perubahan menu tidak valid.'],
    ['ORDER_DUPLICATE_MENU',400,'Menu yang sama cukup dicatat sekali.'],
    ['ORDER_NO_KASBON',409,'Tidak ada tagihan kasbon yang dapat dikonfirmasi.']
  ];
  for (const [code,status,message] of messages) if (error?.message?.includes(code)) return problem(status,message);
  if (['42703','42P01','42883','PGRST202','PGRST205'].includes(error?.code)) return problem(503,'Editor pesanan belum tersedia. Jalankan migrasi 007_order_item_editing.sql di Supabase.');
  return problem(503,'Perubahan pesanan belum dapat dikonfirmasi. Muat ulang riwayat sebelum mencoba lagi.');
}
function priceCheckoutItems(items, menus) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 50) throw problem(400,'Pilih antara 1 dan 50 menu.');
  const catalog=new Map(menus.filter(menu=>menu.is_active!==false).map(menu=>[menu.id,menu]));
  const intent=items.map(item=>{
    if (!item || typeof item!=='object') throw problem(400,'Item pesanan tidak valid.');
    const matches=menus.filter(menu=>menu.is_active!==false && menu.name===item.name);
    const menu=typeof item.id==='string' ? catalog.get(item.id) : (matches.length===1 ? matches[0] : null);
    if (!menu) throw problem(422,'Menu tidak tersedia. Muat ulang halaman dan pilih menu kembali.');
    return {id:menu.id,qty:Number(item.qty),expectedPrice:Number(menu.price)};
  });
  return priceEditedItems(validateOrderEdit({revision:1,items:intent}).items,menus);
}
module.exports={validateOrderEdit,priceEditedItems,priceCheckoutItems,editFailure};
