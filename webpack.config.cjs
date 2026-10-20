const path = require('node:path');
module.exports = {
    entry: './lib/esm/bundle-index.js',
    mode: 'production',
    output: {
        filename: 'hyperion-stream-client.js',
        library: { name: 'HyperionStreamClient', type: 'umd', export: 'default' },
        globalObject: 'this',
        path: path.resolve(__dirname, 'dist')
    }
};
