"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
const hyperion_stream_client_1 = require("./hyperion-stream-client");
// @ts-ignore
if (typeof window !== 'undefined') {
    // @ts-ignore
    window['HyperionStreamClient'] = hyperion_stream_client_1.HyperionStreamClient;
}
__exportStar(require("./interfaces"), exports);
__exportStar(require("./hyperion-stream-client"), exports);
//# sourceMappingURL=bundle-index.js.map