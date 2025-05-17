import {HyperionStreamClient} from "./hyperion-stream-client.js";

// Declare global window interface to avoid TypeScript errors
declare global {
    interface Window {
        HyperionStreamClient: typeof HyperionStreamClient;
    }
}

if (typeof window !== 'undefined') {
    // Ensure backward compatibility with direct global access
    window.HyperionStreamClient = HyperionStreamClient;
}

// Export as both default and named export for maximum compatibility
export default HyperionStreamClient;
export {HyperionStreamClient};
