/**
 * Smoke test of the compiled endpoint, run with plain Node (no tsx), the way Vercel runs it.
 *
 *   npm run smoke      # builds to dist/ first
 *
 * Unit tests run through tsx, which papers over module-format differences. This
 * script catches what they can't: a build that compiles but fails to load or
 * run in a given Node version (e.g. ERR_REQUIRE_ESM). Run it in CI for every
 * Node version the project supports. It needs no secrets and no network.
 */
import assert from "node:assert/strict";

// Without credentials the endpoint must still load every module and serve a valid "no data" card.
delete process.env.LASTFM_USER;
delete process.env.LASTFM_API_KEY;

const { default: handler } = await import("../dist/api/vinyl.js");

const headers = {};
let status;
let body;
const res = {
  setHeader: (key, value) => (headers[key.toLowerCase()] = value),
  status(code) {
    status = code;
    return this;
  },
  send(payload) {
    body = payload;
  },
};

const errors = console.error;
console.error = () => {}; // the handler logs the missing credentials, which is expected here
try {
  await handler({}, res);
} finally {
  console.error = errors;
}

assert.equal(status, 200, "responds 200");
assert.match(headers["content-type"], /^image\/svg\+xml/, "serves SVG");
assert.match(body, /^<svg [^>]*xmlns="http:\/\/www.w3.org\/2000\/svg"/, "body is an SVG document");
assert.match(body, /no data from last\.fm/, "renders the no-data card");

// The decoder is loaded lazily in production, so load it explicitly to prove it works in this runtime.
const { MPEGDecoder } = await import("mpg123-decoder");
const decoder = new MPEGDecoder();
await decoder.ready;
decoder.free();

console.log(`✔ smoke test passed on Node ${process.version}`);
