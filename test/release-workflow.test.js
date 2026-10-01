import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const releaseWorkflow = fs.readFileSync(path.resolve('.github/workflows/release.yml'), 'utf8');
const verify = fs.readFileSync(path.resolve('scripts/release-verify.mjs'), 'utf8');
const verifyRemote = fs.readFileSync(path.resolve('scripts/release-verify-remote.mjs'), 'utf8');

test('release workflow uses an immutable tag, npm OIDC and an isolated registry verification', () => {
    assert.match(releaseWorkflow, /tags: \['v\*'\]/);
    assert.match(releaseWorkflow, /id-token: write/);
    assert.match(releaseWorkflow, /npm publish --provenance --access public/);
    assert.match(releaseWorkflow, /release-verify\.mjs/);
    assert.match(releaseWorkflow, /release-verify-remote\.mjs/);
    assert.doesNotMatch(releaseWorkflow, /NPM_TOKEN|NODE_AUTH_TOKEN/);
    assert.match(verify, /tag, `v\$\{version\}`/);
    assert.match(verify, /CHANGELOG\.md/);
    assert.match(verify, /artifact\.integrity/);
    assert.match(verifyRemote, /dist\.integrity/);
    assert.match(verifyRemote, /dist-tags\.latest/);
    assert.match(verifyRemote, /node_modules.*\.bin/);
});
