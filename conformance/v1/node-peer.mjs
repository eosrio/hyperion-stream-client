// Minimal native WebSocket protocol peer for cross-language network conformance.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateServerFrame } from './node-wire.mjs';

const fixture = JSON.parse(readFileSync(new URL('./network-sessions.json', import.meta.url), 'utf8')).cases[Number(process.argv[3] ?? 0)];
const ws = new WebSocket(process.argv[2], 'hyperion-stream.v1.json');
const records = [];
let historyEnd = false;
const deadline = setTimeout(() => { console.error('Native peer deadline elapsed'); ws.close(); process.exitCode = 1; }, 5000);
const send = value => ws.send(JSON.stringify(value));
ws.addEventListener('error', event => { console.error(event.message ?? 'WebSocket error'); clearTimeout(deadline); process.exitCode = 1; });
ws.addEventListener('message', event => {
  try {
    const packet = validateServerFrame(event.data);
    switch (packet.type) {
      case 'hello':
        assert.equal(ws.protocol, 'hyperion-stream.v1.json');
        send({ type: 'ready', connection_id: packet.connection_id, window: { records: 4096, bytes: 8388608 } });
        send({ type: 'subscribe', connection_id: packet.connection_id, request_id: '1', stream_id: '1', generation: '1', request: fixture.request, resume_from: null, window: { records: 1024, bytes: 2097152 } }); break;
      case 'accepted': assert.equal(packet.request_id, '1'); break;
      case 'data':
        assert.equal(packet.mode === 'live', historyEnd);
        records.push(...packet.records);
        send({ type: 'ack', connection_id: packet.connection_id, stream_id: packet.stream_id, generation: packet.generation, subscription_id: packet.subscription_id, sequence: packet.sequence }); break;
      case 'ping': send({ type: 'pong', id: packet.id }); break;
      case 'history_end': assert(!historyEnd); historyEnd = true; break;
      case 'end':
        assert(historyEnd); assert.deepEqual(records, fixture.expected_records);
        clearTimeout(deadline); console.log(JSON.stringify({ records })); ws.close(); break;
      default: assert.fail(`unexpected ${packet.type}`);
    }
  } catch (error) { clearTimeout(deadline); console.error(error); process.exitCode = 1; ws.close(); }
});
