import { HyperionStreamClient } from "./client/hyperion-stream-client";
if (typeof window !== 'undefined') {
    // @ts-ignore
    window['HyperionStreamClient'] = HyperionStreamClient;
}
export * from './interfaces';
export * from './client/hyperion-stream-client';
export default HyperionStreamClient;
//# sourceMappingURL=index.js.map