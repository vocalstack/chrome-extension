import { test } from 'node:test';
import assert from 'node:assert/strict';
import { iconVersion, movedWorkspace, readWorkspace, sameWorkspace, withWorkspace, workspaceName, type Workspace } from './workspace.ts';

const ws = (over: Partial<Workspace> = {}): Workspace => ({ id: '0190a0c2-7d1e-7c55-9a41-5f3d2b6e8c10', name: 'Northside Radio', personal: false, iconUrl: null, ...over });

test('the API’s workspace is read as it is sent', () => {
  assert.deepEqual(readWorkspace({ id: 'a', name: 'Acme', personal: false, iconUrl: '/workspace-icons/a?v=3&exp=1&sig=x' }), { id: 'a', name: 'Acme', personal: false, iconUrl: '/workspace-icons/a?v=3&exp=1&sig=x' });
  assert.deepEqual(readWorkspace({ id: 'a', name: 'Personal workspace', personal: true, iconUrl: null }), { id: 'a', name: 'Personal workspace', personal: true, iconUrl: null });
  assert.deepEqual(readWorkspace({ id: 'a', name: 'Acme' }), { id: 'a', name: 'Acme', personal: false, iconUrl: null });
});

test('an older API, which sends no workspace, reads as none', () => {
  assert.equal(readWorkspace(undefined), undefined);
  assert.equal(readWorkspace(null), undefined);
  assert.equal(readWorkspace('Acme'), undefined);
  assert.equal(readWorkspace({}), undefined);
  assert.equal(readWorkspace({ id: 7, name: 'Acme' }), undefined);
  assert.equal(readWorkspace({ id: 'a' }), undefined);
});

test('an empty name still reads as something', () => {
  assert.equal(readWorkspace({ id: 'a', name: ' ', personal: true })?.name, 'Personal workspace');
  assert.equal(readWorkspace({ id: 'a', name: '' })?.name, 'Workspace');
});

test('an icon is the same one by its path and v, whatever exp and sig say', () => {
  assert.equal(iconVersion('/workspace-icons/a?v=3&exp=100&sig=aa'), iconVersion('/workspace-icons/a?v=3&exp=200&sig=bb'));
  assert.notEqual(iconVersion('/workspace-icons/a?v=3&exp=100&sig=aa'), iconVersion('/workspace-icons/a?v=4&exp=100&sig=aa'));
  assert.notEqual(iconVersion('/workspace-icons/a?v=3'), iconVersion('/workspace-icons/b?v=3'));
  assert.equal(iconVersion('https://api.vocalstack.com/workspace-icons/a?v=3&sig=x'), '/workspace-icons/a?v=3');
  assert.equal(iconVersion(null), null);
  assert.equal(iconVersion(''), null);
});

test('a rename, a new icon or another workspace is a change; a link signed again is not', () => {
  const a = ws({ iconUrl: '/workspace-icons/a?v=3&exp=100&sig=aa' });
  assert.ok(sameWorkspace(a, { ...a, iconUrl: '/workspace-icons/a?v=3&exp=200&sig=bb' }));
  assert.ok(!sameWorkspace(a, { ...a, name: 'Northside' }));
  assert.ok(!sameWorkspace(a, { ...a, iconUrl: null }));
  assert.ok(!sameWorkspace(a, { ...a, iconUrl: '/workspace-icons/a?v=4&exp=100&sig=aa' }));
  assert.ok(!sameWorkspace(a, { ...a, id: 'other' }));
  assert.ok(!sameWorkspace(undefined, a));
  assert.ok(sameWorkspace(undefined, undefined));
});

test('the stored account takes the workspace the API names now', () => {
  const account: { name: string; keyId: string; via: 'connect'; scopes: string[]; workspace?: Workspace } = { name: 'Alex', keyId: 'k1', via: 'connect', scopes: ['read'] };
  const first = withWorkspace(account, ws());
  assert.deepEqual(first, { ...account, workspace: ws() });
  assert.equal(withWorkspace(first!, ws()), null);
  assert.deepEqual(withWorkspace(first!, ws({ name: 'Northside' }))?.workspace, ws({ name: 'Northside' }));
  assert.equal('workspace' in account, false);
});

test('an answer without a workspace keeps the stored one', () => {
  const account = { name: 'Alex', keyId: 'k1', workspace: ws() };
  assert.equal(withWorkspace(account, undefined), null);
  assert.equal(withWorkspace<{ name: string; workspace?: Workspace }>({ name: 'Alex' }, undefined), null);
});

test('Settings shows the workspace’s name, else what sign-in gave', () => {
  assert.equal(workspaceName({ name: 'Alex', workspace: ws() }), 'Northside Radio');
  assert.equal(workspaceName({ name: 'Alex' }), 'Alex');
});

test('another key or another workspace means the old one’s data must go', () => {
  assert.ok(movedWorkspace({ keyId: 'k1', workspace: ws() }, { keyId: 'k2', workspace: ws({ id: 'b' }) }));
  assert.ok(movedWorkspace({ keyId: 'k1' }, { keyId: 'k2' }));
  assert.ok(movedWorkspace({ keyId: '', workspace: ws() }, { keyId: '', workspace: ws({ id: 'b' }) }));
  assert.ok(!movedWorkspace({ keyId: 'k1' }, { keyId: 'k1', workspace: ws() }));
  assert.ok(!movedWorkspace({ keyId: 'k1', workspace: ws() }, { keyId: 'k1', workspace: ws({ name: 'Renamed' }) }));
  assert.ok(!movedWorkspace(null, { keyId: 'k1' }));
  assert.ok(!movedWorkspace({ keyId: 'k1' }, null));
});
