// Master List Menu Awal & 4 Kategori (Karbohidrat, Sayur, Lauk, Alat Makan)
const INITIAL_MENUS = [
  // 1. KARBOHIDRAT
  { id: 'm-1', name: 'Nasi 1 Porsi', price: 5000, category: 'Karbohidrat' },
  { id: 'm-2', name: 'Nasi 1/2 Porsi', price: 3000, category: 'Karbohidrat' },
  { id: 'm-14', name: 'Mie goreng', price: 3000, category: 'Karbohidrat' },
  { id: 'm-36', name: 'Kwetiau goreng', price: 3000, category: 'Karbohidrat' },
  { id: 'm-37', name: 'Bihun goreng', price: 3000, category: 'Karbohidrat' },
  { id: 'm-30', name: 'Sambal goreng kentang', price: 3000, category: 'Karbohidrat' },
  { id: 'm-31', name: 'Kentang mustopa', price: 3000, category: 'Karbohidrat' },

  // 2. SAYUR
  { id: 'm-3', name: 'Oseng tahu', price: 3000, category: 'Sayur' },
  { id: 'm-4', name: 'Oseng kangkung', price: 3000, category: 'Sayur' },
  { id: 'm-5', name: 'Lodeh nangka', price: 3000, category: 'Sayur' },
  { id: 'm-6', name: 'Capcay', price: 3000, category: 'Sayur' },
  { id: 'm-7', name: 'Oseng tahu sawi ijo', price: 3000, category: 'Sayur' },
  { id: 'm-8', name: 'Oseng kacang', price: 3000, category: 'Sayur' },
  { id: 'm-9', name: 'Oseng labu siam', price: 3000, category: 'Sayur' },
  { id: 'm-10', name: 'Oseng tahu toge', price: 3000, category: 'Sayur' },
  { id: 'm-11', name: 'Oseng pare', price: 3000, category: 'Sayur' },
  { id: 'm-12', name: 'Bening bayam', price: 3000, category: 'Sayur' },
  { id: 'm-13', name: 'Sayur sop', price: 3000, category: 'Sayur' },
  { id: 'm-28', name: 'Terong balado', price: 3000, category: 'Sayur' },
  { id: 'm-29', name: 'Semur jengkol', price: 4000, category: 'Sayur' },

  // 3. LAUK
  { id: 'm-15', name: 'Orek tempe', price: 3000, category: 'Lauk' },
  { id: 'm-16', name: 'Kikil', price: 3000, category: 'Lauk' },
  { id: 'm-17', name: 'Usus', price: 3000, category: 'Lauk' },
  { id: 'm-18', name: 'Telur balado', price: 4000, category: 'Lauk' },
  { id: 'm-19', name: 'Telur ceplok', price: 4000, category: 'Lauk' },
  { id: 'm-20', name: 'Telur dadar', price: 4000, category: 'Lauk' },
  { id: 'm-21', name: 'Ayam balado', price: 8000, category: 'Lauk' },
  { id: 'm-22', name: 'Ati balado', price: 5000, category: 'Lauk' },
  { id: 'm-23', name: 'Cue tongkol', price: 4000, category: 'Lauk' },
  { id: 'm-24', name: 'Lele goreng', price: 6000, category: 'Lauk' },
  { id: 'm-25', name: 'Bawal goreng', price: 6000, category: 'Lauk' },
  { id: 'm-26', name: 'Bandeng goreng', price: 6000, category: 'Lauk' },
  { id: 'm-27', name: 'Cumi balado', price: 5000, category: 'Lauk' },
  { id: 'm-32', name: 'Teri kering balado', price: 3000, category: 'Lauk' },
  { id: 'm-33', name: 'Tahu bacem', price: 2000, category: 'Lauk' },
  { id: 'm-34', name: 'Tempe bacem', price: 2000, category: 'Lauk' },
  { id: 'm-35', name: 'Ayam kecap', price: 8000, category: 'Lauk' },
  { id: 'm-38', name: 'Lele balado', price: 6000, category: 'Lauk' },
  { id: 'm-39', name: 'Bawal balado', price: 6000, category: 'Lauk' },
  { id: 'm-40', name: 'Tumis asin japu', price: 4000, category: 'Lauk' },
  { id: 'm-41', name: 'Rica-rica ayam', price: 5000, category: 'Lauk' },
  { id: 'm-42', name: 'Tahu goreng', price: 2000, category: 'Lauk' },
  { id: 'm-43', name: 'Tempe goreng', price: 2000, category: 'Lauk' },
  { id: 'm-44', name: 'Gorengan', price: 2000, category: 'Lauk' },
  { id: 'm-46', name: 'Opor Ayam', price: 8000, category: 'Lauk' },
  { id: 'm-47', name: 'Ayam Goreng', price: 8000, category: 'Lauk' },

  // 4. ALAT MAKAN
  { id: 'm-45', name: 'Sendok', price: 0, category: 'Alat Makan' }
];

// 4 Kategori Resmi
const CATEGORIES = ['Karbohidrat', 'Sayur', 'Lauk', 'Alat Makan'];

// Hari dalam seminggu
const DAYS_OF_WEEK = [
  'Senin',
  'Selasa',
  'Rabu',
  'Kamis',
  'Jumat',
  'Sabtu',
  'Minggu'
];

module.exports = {
  INITIAL_MENUS,
  CATEGORIES,
  DAYS_OF_WEEK
};
