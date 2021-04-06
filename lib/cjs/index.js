"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
const hyperion_stream_client_1 = require("./client/hyperion-stream-client");
if (typeof window !== 'undefined') {
    // @ts-ignore
    window['HyperionStreamClient'] = hyperion_stream_client_1.HyperionStreamClient;
}
__exportStar(require("./interfaces"), exports);
__exportStar(require("./client/hyperion-stream-client"), exports);
exports.default = hyperion_stream_client_1.HyperionStreamClient;
//# sourceMappingURL=index.js.map