// Runnable check for swatchUrlFor (print_background backfill). `node portal.test.js`.
// Needs JWT_SECRET set — portal.js refuses to load without it (see line ~60).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-not-for-prod';
process.env.GOOGLE_SERVICE_ACCOUNT = process.env.GOOGLE_SERVICE_ACCOUNT || '{}';

const assert = require('assert');
const { swatchUrlFor } = require('./portal');

// Real committed swatch file: swatches/Fox Hopyard Country Club I.png
assert.strictEqual(swatchUrlFor('Fox Hopyard Country Club I'), '/swatches/Fox Hopyard Country Club I');
// No matching file => blank, not an error
assert.strictEqual(swatchUrlFor('No Such Order 999'), '');
assert.strictEqual(swatchUrlFor(''), '');
assert.strictEqual(swatchUrlFor(undefined), '');
// Path traversal attempt => basename strips it, no throw, no match
assert.strictEqual(swatchUrlFor('../../../etc/passwd'), '');

console.log('portal.test.js: all assertions passed');
