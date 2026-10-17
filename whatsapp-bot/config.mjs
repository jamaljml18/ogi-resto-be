export function botConfig(env, { listGroups = false, backendDir } = {}) {
  const key = env.WA_GROUP_BOT_SESSION_KEY || '';
  if (!/^[a-f0-9]{64}$/i.test(key)) throw new Error('WA_GROUP_BOT_SESSION_KEY harus berisi 64 karakter hex acak.');
  const groups = new Set((env.WA_GROUP_BOT_ALLOWED_GROUPS || '').split(',').map(value => value.trim()).filter(Boolean));
  for (const id of groups) {
    if (!/^\d+(?:-\d+)?@g\.us$/.test(id)) throw new Error('ID grup tidak valid. Salin ID dari npm.cmd run bot:groups.');
  }
  if (!listGroups && env.WA_GROUP_BOT_ENABLED !== 'true') throw new Error('Bot belum aktif. Isi WA_GROUP_BOT_ENABLED=true setelah memilih grup.');
  if (!listGroups && !groups.size) throw new Error('Isi WA_GROUP_BOT_ALLOWED_GROUPS. Bot tidak akan membaca semua grup secara otomatis.');
  if (!listGroups && (!env.SUPABASE_URL || !env.SUPABASE_KEY)) throw new Error('Konfigurasi Supabase backend wajib diisi untuk bot grup.');
  return { key, groups, backendDir };
}
