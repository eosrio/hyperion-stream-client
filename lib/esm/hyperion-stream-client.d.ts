/// <reference types="node" />
import EventEmitter from "node:events";
import { ForkData, HyperionClientOptions, IncomingData, LIBData, SavedRequest, StreamActionsRequest, StreamDeltasRequest } from "./interfaces";
export declare class HyperionStreamClient extends EventEmitter {
    private socket?;
    private socketURL?;
    private lastReceivedBlock;
    private dataQueue;
    private options;
    private libDataQueue;
    private reversibleBuffer;
    onConnect?: () => void;
    onData?: (data: IncomingData, ack?: () => void) => void;
    onLibData?: (data: IncomingData, ack?: () => void) => void;
    onLIB: (data: LIBData) => void;
    onFork?: (data: ForkData) => void;
    onEmpty?: () => void;
    online: boolean;
    savedRequests: SavedRequest[];
    /**
     * @typedef {object} BaseOptions
     * @property {string} endpoint - Hyperion API Endpoint
     * @property {boolean} async - Enable Asynchronous Mode
     * @property {boolean} lib_stream - Enable onLibData handler
     */
    /**
     * Construct a new streaming client
     * @param {HyperionClientOptions} options - Client Options
     */
    constructor(options: HyperionClientOptions & Record<string, any>);
    /**
     * Disconnects from the API
     * @example
     *
     *     disconnect()
     */
    disconnect(): void;
    /**
     * Get the last block number received
     */
    get lastBlockNum(): number;
    /**
     *
     * @param endpoint - Hyperion API Endpoint
     */
    setEndpoint(endpoint: string): void;
    private pushToBuffer;
    private setupIncomingQueue;
    private setupIrreversibleQueue;
    private handleLibUpdate;
    private setupSocket;
    /**
     * Start session. Action handlers should be defined before this method is called
     * @param {function} [callback] - function to execute on a successful connection
     *
     * @example
     * connect(()=>{
     *     console.log('Connection was successful!');
     * });
     */
    connect(callback?: () => void): Promise<void>;
    /**
     * Internal method to parse an action streaming trace
     * @param action
     * @param mode
     * @private
     */
    private processActionTrace;
    /**
     * Internal method to parse a delta streaming trace
     * @param delta
     * @param mode
     * @private
     */
    private processDeltaTrace;
    /**
     * Replay cached requests
     */
    resendRequests(): Promise<void>;
    /**
     * Request filter definition
     * @typedef {Object} requestFilter
     * @property {string} field - Filter Field (ex. "act.data.from")
     * @property {string} value - Filter value
     */
    /**
     * Action request definition
     * @typedef {Object} StreamActionsRequest
     * @property {string} contract - Contract name
     * @property {string} account - Account to filter for
     * @property {string} action - Action name to filter
     * @property {[RequestFilter]} filters - Array of filters
     * @property {number} [start_from=0] - Starting block number
     * @property {number} [read_until=0] - Read until this block number
     */
    /**
     * Send a request for a filtered action traces stream
     * @param {StreamActionsRequest} request - Action Request Options
     */
    streamActions(request: StreamActionsRequest): Promise<any>;
    /**
     * Delta request definition
     * @typedef {Object} StreamDeltasRequest
     * @property {string} code - Contract name
     * @property {string} table - Table
     * @property {string} scope - Scope
     * @property {string} payer - Payer account
     * @property {number} [start_from=0] - Starting block number
     * @property {number} [read_until=0] - Read until this block number
     */
    /**
     * Send a request for a filtered delta traces stream
     * @param {StreamDeltasRequest} request - Delta Request Options
     */
    streamDeltas(request: StreamDeltasRequest): Promise<any>;
    /**
     * Check if the start_from value should be updated or not
     * @param request - Request object to verify
     */
    private checkLastBlock;
    private debugLog;
}
