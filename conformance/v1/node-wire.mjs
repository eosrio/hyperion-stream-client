// Independent platform JSON/BigInt validation for the shared wire vectors.
// This is a conformance peer, not the published JavaScript streaming client.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const decimal = value => typeof value === 'string' && value.length <= 20 && /^(0|[1-9][0-9]*)$/.test(value) && BigInt(value) <= 18446744073709551615n;
const positive = value => decimal(value) && value !== '0';
const block = value => Number.isInteger(value) && value > 0 && value <= 4294967295;
const hash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const envelopeKeys = new Set(['type', 'connection_id', 'request_id', 'stream_id', 'generation', 'subscription_id', 'sequence', 'mode', 'records', 'id', 'version', 'chain_id', 'heartbeat_interval_ms', 'start_from', 'code', 'message', 'retryable', 'block_num', 'block_id', 'starting_block', 'ending_block', 'new_block_id']);

function uniqueEnvelope(text) {
  // JSON.parse validates grammar first. Tokenize strings/punctuation to detect
  // duplicate routing keys before native JSON's last-value behavior can hide one.
  const stack = [];
  for (const token of text.matchAll(/"(?:\\.|[^"\\])*"|[{}\[\]:,]/g)) {
    const value = token[0];
    if (value === '{' || value === '[') stack.push({ object: value === '{', key: true, seen: new Set() });
    else if (value === '}' || value === ']') stack.pop();
    else if (value === ':') { if (stack.at(-1)) stack.at(-1).key = false; }
    else if (value === ',') { if (stack.at(-1)?.object) stack.at(-1).key = true; }
    else if (stack.length === 1 && stack[0].object && stack[0].key) {
      const key = JSON.parse(value);
      if (envelopeKeys.has(key)) { assert(!stack[0].seen.has(key), `duplicate ${key}`); stack[0].seen.add(key); }
    }
  }
}

function metadata(payload) {
  assert(object(payload));
  if (Object.hasOwn(payload, 'global_sequence')) assert(decimal(payload.global_sequence));
  const receipt = value => {
    assert(object(value));
    for (const key of ['global_sequence', 'recv_sequence']) if (Object.hasOwn(value, key)) assert(decimal(value[key]));
    if (Object.hasOwn(value, 'auth_sequence')) {
      assert(Array.isArray(value.auth_sequence));
      for (const auth of value.auth_sequence) { assert(object(auth)); if (Object.hasOwn(auth, 'sequence')) assert(decimal(auth.sequence)); }
    }
  };
  if (payload.receipt != null) {
    if (Array.isArray(payload.receipt)) {
      assert.equal(payload.receipt.length, 2); assert.equal(typeof payload.receipt[0], 'string'); receipt(payload.receipt[1]);
    } else receipt(payload.receipt);
  }
  if (Object.hasOwn(payload, 'receipts')) {
    assert(Array.isArray(payload.receipts));
    for (const value of payload.receipts) receipt(value);
  }
}

export function validateServerFrame(text) {
  const packet = JSON.parse(text, (key, value) => {
    assert(key.isWellFormed());
    if (typeof value === 'string') assert(value.isWellFormed());
    return value;
  });
  assert(object(packet)); uniqueEnvelope(text);
  const scope = () => { for (const key of ['connection_id', 'stream_id', 'generation', 'subscription_id']) assert(positive(packet[key]), key); };
  switch (packet.type) {
    case 'hello': assert(Number.isInteger(packet.version) && packet.version >= 0 && packet.version <= 65535); assert(hash(packet.chain_id)); assert(positive(packet.connection_id)); assert(Number.isSafeInteger(packet.heartbeat_interval_ms)); break;
    case 'accepted': scope(); assert(positive(packet.request_id)); assert(block(packet.start_from)); break;
    case 'data':
      scope(); assert(positive(packet.sequence)); assert(['history', 'live'].includes(packet.mode)); assert(Array.isArray(packet.records) && packet.records.length);
      for (const record of packet.records) { assert(block(record.block_num)); assert(hash(record.block_id)); if (record.cursor != null) assert(decimal(record.cursor)); metadata(record.payload); }
      break;
    case 'history_end': case 'end': case 'cancelled': scope(); break;
    case 'ping': case 'pong': assert(decimal(packet.id)); break;
    case 'error':
      assert(positive(packet.connection_id)); assert((packet.stream_id != null) === (packet.generation != null));
      if (packet.stream_id != null) { assert(positive(packet.stream_id)); assert(positive(packet.generation)); }
      if (packet.request_id != null) assert(decimal(packet.request_id));
      assert(typeof packet.code === 'string' && packet.code.length > 0 && Buffer.byteLength(packet.code) <= 128);
      assert(typeof packet.message === 'string' && Buffer.byteLength(packet.message) <= 4096); assert(typeof packet.retryable === 'boolean'); break;
    case 'lib': assert(positive(packet.connection_id)); assert(hash(packet.chain_id)); assert(block(packet.block_num)); assert(hash(packet.block_id)); break;
    case 'fork': assert(positive(packet.connection_id)); assert(hash(packet.chain_id)); assert(block(packet.starting_block)); assert(block(packet.ending_block)); assert(hash(packet.new_block_id)); break;
    default: assert.fail(`unknown type ${packet.type}`);
  }
  return packet;
}

export function runWireVectors() {
  const corpus = JSON.parse(readFileSync(new URL('./wire-vectors.json', import.meta.url), 'utf8'));
  for (const test of corpus.cases) {
    let valid = true;
    try { validateServerFrame(test.text); } catch { valid = false; }
    assert.equal(valid, test.valid, test.name);
  }
  return corpus.cases.length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(`${runWireVectors()} native JSON/BigInt wire vectors passed`);
