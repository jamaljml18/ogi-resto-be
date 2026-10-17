export function pairingPhone(value) {
  let phone = value.trim().replace(/[\s()+-]/g, '');
  if (phone.startsWith('08')) phone = '62' + phone.slice(1);
  if (!/^[1-9]\d{7,14}$/.test(phone)) {
    throw new Error('Nomor bot harus berupa nomor WhatsApp aktif, misalnya 6281234567890.');
  }
  return phone;
}

// One request per socket; QR updates must not generate a flood of linking codes.
export function codeRequester({ socket, phone, registered, onCode, onError }) {
  let requested = false;
  return async update => {
    if (!update.qr || requested || registered()) return;
    requested = true;
    try { onCode(await socket.requestPairingCode(phone)); }
    catch (error) { onError(error?.output?.statusCode); }
  };
}
