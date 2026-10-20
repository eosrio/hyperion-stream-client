import webpack from 'webpack';
import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

mkdirSync('lib/cjs', { recursive: true });
// Bundle TypeScript's emitted JS; copy the authoritative declarations for CJS consumers.
await new Promise((done, reject) => {
    const compiler = webpack({
        mode: 'none',
        target: 'node22',
        entry: resolve('lib/esm/index.js'),
        externals: { 'socket.io-client': 'commonjs socket.io-client' },
        devtool: 'source-map',
        output: { path: resolve('lib/cjs'), filename: 'index.js', library: { type: 'commonjs2' } }
    });
    compiler.run((error, stats) =>
        compiler.close((closeError) => {
            if (error || closeError || stats?.hasErrors())
                reject(
                    error || closeError || new Error(stats.toString({ all: false, errors: true }))
                );
            else done();
        })
    );
});
for (const file of readdirSync('lib/esm').filter((file) => file.endsWith('.d.ts')))
    copyFileSync(`lib/esm/${file}`, `lib/cjs/${file}`);
writeFileSync('lib/cjs/package.json', JSON.stringify({ type: 'commonjs' }) + '\n');
