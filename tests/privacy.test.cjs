const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadPrivacy(storage) {
  const wx = {
    getStorageSync(key) { return storage.has(key) ? storage.get(key) : ''; },
    setStorageSync(key, value) { storage.set(key, value); },
    removeStorageSync(key) { storage.delete(key); },
  };
  const module = { exports: {} };
  const file = path.resolve(__dirname, '..', 'utils', 'privacy.js');
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module, exports: module.exports, wx }, { filename: file });
  return module.exports;
}

test('a privacy-guideline version change requires renewed agreement without clearing user data', () => {
  const storage = new Map([
    ['gg_privacy_agreed', '1.2'],
    ['gg_records', [{ item_code: 'read' }]],
  ]);
  const privacy = loadPrivacy(storage);

  assert.equal(privacy.hasAgreed(), false);
  assert.equal(privacy.setAgreed(), true);
  assert.equal(privacy.hasAgreed(), true);
  assert.equal(privacy.revoke(), true);
  assert.equal(privacy.hasAgreed(), false);
  assert.equal(storage.has('gg_records'), true);
});
