import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

test('raid aliases save, replay, preserve old messages and isolate tenants', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'raid-message-test-'));
  process.env.PERSIST_ROOT = root;
  try {
    const { handleRaidMessageCommand: handle, parseRaidMessageCommand: parse, isRaidMessageOwner: owner } = await import('../src/services/raid-message');
    const legacy = path.join(root, 'tenants/owner/tokens/raid-message.json');
    await mkdir(path.dirname(legacy), { recursive: true });
    await writeFile(legacy, JSON.stringify({message:'Existing saved raid message'}));
    assert.equal(await handle({message:'!raidmessage',tenantId:'owner'}), 'Existing saved raid message');
    assert.equal(await handle({message:'!raid',tenantId:'owner'}), 'Existing saved raid message');
    assert.match((await handle({message:'!RAID New clan message',tenantId:'owner',canSet:true}))!, /saved/);
    for (const message of ['!raid','!raidmessage','!raidmessage   ']) {
      assert.equal(await handle({message,tenantId:'owner'}), 'New clan message');
    }
    assert.equal(JSON.parse(await readFile(path.join(root,'tenants/owner/data/raid-message.json'),'utf8')).message,'New clan message');
    assert.match((await handle({message:'!raid viewer overwrite',tenantId:'owner'}))!, /Only the broadcaster/);
    assert.equal(await handle({message:'!raid',tenantId:'owner'}), 'New clan message');
    assert.equal(owner({tenantId:'123',senderId:'123',channel:'owner'}),true);
    assert.equal(owner({tenantId:'123',senderId:'456',senderName:'owner',channel:'owner',broadcasterBadge:true}),false);
    assert.equal(owner({tenantId:'123',senderName:'owner',channel:'owner',broadcasterBadge:true}),true);
    assert.equal(owner({tenantId:'123',senderName:'mod',channel:'owner'}),false);
    assert.equal(owner({tenantId:'123',senderId:'123',channel:'owner',mirrored:true}),false);
    assert.match((await handle({message:'!raid '+ 'a'.repeat(451),tenantId:'owner',canSet:true}))!, /too long/);
    assert.equal(await handle({message:'!raid',tenantId:'owner'}), 'New clan message');
    assert.match((await handle({message:'!raid',tenantId:'other'}))!, /No raid message saved/);
    assert.equal(parse('!raider secret'),null);
    assert.equal(parse('/raid otherstream'),null);
    assert.equal(await handle({message:'!raid'}), 'Raid messages need a connected streamer account.');
  } finally { await rm(root,{recursive:true,force:true}); }
});
