import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = process.cwd();
const temporary = mkdtempSync(join(tmpdir(), 'hyperion-client-package-'));
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run through npm run test:package');
const runNpm = (args, cwd) =>
    execFileSync(process.execPath, [npm, ...args], { cwd, encoding: 'utf8' });
try {
    const result = JSON.parse(
        runNpm(['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], root)
    );
    const [packed] = Array.isArray(result) ? result : Object.values(result);
    const paths = packed.files.map((file) => file.path);
    for (const path of [
        'lib/esm/index.js',
        'lib/esm/index.d.ts',
        'lib/cjs/index.js',
        'lib/cjs/index.d.ts',
        'dist/hyperion-stream-client.js'
    ])
        assert.ok(paths.includes(path), path);
    assert.ok(
        paths.every((path) => /^(lib\/|dist\/|README\.md$|LICENSE$|package\.json$)/.test(path)),
        'Unexpected package contents'
    );
    writeFileSync(
        join(temporary, 'package.json'),
        JSON.stringify({ private: true, type: 'module' })
    );
    runNpm(
        [
            'install',
            '--ignore-scripts',
            '--no-package-lock',
            '--no-audit',
            '--no-fund',
            join(temporary, packed.filename),
            '@types/node@22.20.5'
        ],
        temporary
    );
    const consumer = `import {HyperionStreamClient, StreamClientEvents} from '@eosrio/hyperion-stream-client';
const client = new HyperionStreamClient({endpoint: 'https://example.com'});
client.on('libUpdate', info => { const block: number = info.block_num; void block; });
client.on(StreamClientEvents.DATA, message => { const block: number = message.content.block_num; void block; });
void client.streamActions({contract: 'eosio.token', action: 'transfer'}).then(stream => {
    stream.on('message', message => {
        const sequence: string = message.content.global_sequence;
        const actors: string[] = message.content.act.authorization.map(auth => auth.actor);
        const changes: number[] = message.content.account_ram_deltas.map(change => change.delta);
        const receivers: (string | undefined)[] = message.content.receipts.map(receipt => receipt.recv_sequence);
        void actors; void changes; void sequence; void receivers;
    });
});\n`;
    for (const extension of ['mts', 'cts'])
        writeFileSync(join(temporary, `consumer.${extension}`), consumer);
    execFileSync(
        process.execPath,
        [
            resolve('node_modules/typescript/bin/tsc'),
            '--strict',
            '--noEmit',
            '--skipLibCheck',
            '--module',
            'nodenext',
            '--target',
            'es2022',
            'consumer.mts',
            'consumer.cts'
        ],
        { cwd: temporary, stdio: 'pipe' }
    );
    const runtime = `const client = new HyperionStreamClient({endpoint:'https://example.com'}); if (client.online !== false) throw new Error('Invalid client');`;
    writeFileSync(
        join(temporary, 'esm.mjs'),
        `import {HyperionStreamClient} from '@eosrio/hyperion-stream-client'; ${runtime}`
    );
    writeFileSync(
        join(temporary, 'cjs.cjs'),
        `const {HyperionStreamClient} = require('@eosrio/hyperion-stream-client'); ${runtime}`
    );
    for (const entry of ['esm.mjs', 'cjs.cjs'])
        execFileSync(process.execPath, [entry], { cwd: temporary, stdio: 'pipe' });
    const installed = JSON.parse(
        readFileSync(join(temporary, 'node_modules/@eosrio/hyperion-stream-client/package.json'))
    );
    assert.equal(installed.dependencies.async, undefined);
    console.log(
        `Packed ${paths.length} files; external ESM, CommonJS and both TypeScript consumers passed on ${process.version}.`
    );
} finally {
    // Only remove the exact directory created above, never a caller-supplied path.
    rmSync(temporary, { recursive: true, force: true });
}
