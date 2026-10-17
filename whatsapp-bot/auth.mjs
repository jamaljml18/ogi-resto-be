// State kredensial dan Signal keys disimpan bersama dalam satu snapshot terenkripsi.
export async function authState(store, { initAuthCreds, proto }) {
  if (!store.data.auth.creds) {
    store.data.auth.creds = initAuthCreds();
    await store.persist();
  }
  return {
    state: {
      creds: store.data.auth.creds,
      keys: {
        async get(type, ids) {
          const result = {};
          for (const id of ids) {
            let value = store.data.auth.keys[type + ':' + id];
            if (type === 'app-state-sync-key' && value) value = proto.Message.AppStateSyncKeyData.fromObject(value);
            if (value) result[id] = value;
          }
          return result;
        },
        async set(values) {
          for (const [type, entries] of Object.entries(values)) {
            for (const [id, value] of Object.entries(entries)) {
              const key = type + ':' + id;
              if (value == null) delete store.data.auth.keys[key];
              else store.data.auth.keys[key] = value;
            }
          }
          await store.persist();
        }
      }
    },
    saveCreds: () => store.persist()
  };
}
