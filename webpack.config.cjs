const path = require('path');
module.exports = {
    entry: './src/bundle-index.ts',
    mode: 'production',
    module: {
        rules: [
            {
                test: /\.ts?$/,
                use: 'ts-loader',
                exclude: /node_modules/,
            },
        ],
    },
    resolve: {
        extensions: ['.ts', '.js', '...'],
        alias: {
            './hyperion-stream-client.js': path.resolve(__dirname, 'src/hyperion-stream-client.ts'),
            './interfaces.js': path.resolve(__dirname, 'src/interfaces.ts'),
            './functions.js': path.resolve(__dirname, 'src/functions.ts'),
            './hyperion-stream.js': path.resolve(__dirname, 'src/hyperion-stream.ts')
        }
    },
    output: {
        filename: 'hyperion-stream-client.js',
        library: {
            name: 'HyperionStreamClient',
            type: 'umd',
            export: 'default'
        },
        globalObject: 'this',
        path: path.resolve(__dirname, 'dist'),
    },
};
