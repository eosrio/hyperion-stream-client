import { HyperionStreamClient } from "./hyperion-stream-client";
// @ts-ignore
if (typeof window !== 'undefined') {
    // @ts-ignore
    window['HyperionStreamClient'] = HyperionStreamClient;
}
export * from './interfaces';
export * from './hyperion-stream-client';
//# sourceMappingURL=bundle-index.js.map