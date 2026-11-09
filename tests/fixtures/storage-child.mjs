import { openStore } from '../../.artifacts/storage-test/repository.mjs';
const dbPath = process.argv[2];
const now = Number(process.argv[3]);
const store = await openStore(dbPath, () => ({ wallMs: now, monoMs: 0, continuityId: 'child' }));
process.send({ ready: true });
process.on('message', async (message) => {
  try {
    if (message.operation === 'begin') {
      const handle = await store.begin(message.input, message.source);
      process.send({ ok: true, handle });
    } else if (message.operation === 'commit-without-ack') {
      await store.commit(message.batch, message.source);
      process.send({ committed: true });
    }
  } catch (error) { process.send({ ok: false, error: error.message }); }
});
