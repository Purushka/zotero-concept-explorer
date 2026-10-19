import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const manifest=JSON.parse(await readFile(new URL('../addon/manifest.json',import.meta.url),'utf8'));
const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
test('packaged manifest and source package share the exact release version',()=>{
  assert.equal(manifest.version,pkg.version);
  assert.equal(manifest.applications.zotero.id,'concept-explorer@local.research');
});
test('manifest includes the verified Zotero 10 host without allowing untested future majors',()=>{
  assert.equal(manifest.applications.zotero.strict_min_version,'8.0');
  assert.equal(manifest.applications.zotero.strict_max_version,'10.*');
  assert.notEqual(manifest.applications.zotero.strict_max_version,'*');
});
