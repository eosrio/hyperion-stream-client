import { HyperionStreamClient } from "./hyperion-stream-client.js";
// @ts-ignore
if (typeof window !== 'undefined') {
    // @ts-ignore
    window['HyperionStreamClient'] = HyperionStreamClient;
}
export * from './interfaces.js';
export * from './hyperion-stream-client.js';
//# sourceMappingURL=bundle-index.js.map