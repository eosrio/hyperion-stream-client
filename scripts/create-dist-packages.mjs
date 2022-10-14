import {writeFileSync} from "node:fs";

writeFileSync('./lib/cjs/package.json', JSON.stringify({
    type: 'commonjs'
}, null, 2));

writeFileSync('./lib/esm/package.json', JSON.stringify({
    type: 'module'
}, null, 2));
