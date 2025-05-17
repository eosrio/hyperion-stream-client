export type MessageHandler<T = any> = (data: T) => void;


export interface HyperionStreamEvent<T extends StreamResponseTypes> {
    type: string;
    reqUUID: string;
    mode: "live" | "history";
    message?: string;
    messages?: (T)[];
    error: Error;
}

export interface SavedRequest<K extends keyof StreamTypeMap> {
    started: boolean;
    live: boolean;
    liveQueueStartTimer?: number;
    reqUUID?: string;
    type: K;
    error?: string;
    req: StreamTypeMap[K]['request'];
    firstReceivedBlock?: number;
    historyResults?: number;
    deliveryCounter: number;
    pendingMessages: any[];
    filtered: number;
}

export enum StreamClientEvents {
    DATA = 'data',
    LIBUPDATE = 'libUpdate',
    FORK = 'fork',
    EMPTY = 'empty',
    CONNECT = 'connect',
    DRAIN = 'drain',
    LIBDATA = 'libData',
    ERROR = 'error',
}

/**
 * Options used to configure the streaming client
 */
export interface HyperionClientOptions {
    /** Hyperion HTTP API w/ streaming enabled */
    endpoint: string;
    chainApi?: string;
    debug?: boolean;
    libStream?: boolean;
    libMonitor?: boolean;
    /** Connection timeout in milliseconds (default: 5000) */
    connectionTimeout?: number;
}

export interface StreamDeltasRequest {
    code: string;
    table: string;
    scope: string;
    payer: string;
    start_from: number | string;
    read_until?: number | string;
    ignore_live?: boolean;
    filter_op?: 'and' | 'or';
    filters?: RequestFilter[];
    // Request a history replay from the last received block
    replayOnReconnect?: boolean;
}

export interface RequestFilter {
    field: string;
    value: string | number | boolean;
    operator?: 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'starts_with' | 'ends_with';
}

export interface StreamActionsRequest {
    contract: string;
    account: string;
    action: string;
    start_from: number | string;
    read_until?: number | string;
    ignore_live?: boolean;
    filter_op?: 'and' | 'or';
    filters?: RequestFilter[];
    // Request a history replay from the last received block
    replayOnReconnect?: boolean;
}

export interface ActionContent {
    "@timestamp": string;
    global_sequence: number;
    account_ram_deltas: {
        delta: number;
        account: string;
    }
    act: {
        authorization: {
            permission: string;
            actor: string;
        }
        account: string;
        name: string;
        data: any;
    }
    block_num: number;
    action_ordinal: number;
    creator_action_ordinal: number;
    cpu_usage_us: number;
    net_usage_words: number;
    code_sequence: number;
    abi_sequence: number;
    trx_id: string;
    producer: string;
    notified: string;

    // @ prefixed keys
    [key: string]: any;
}

export interface DeltaContent {
    code: string;
    scope: string;
    table: string;
    primary_key: string;
    payer: string;
    "@timestamp": string;
    present: number;
    block_num: number;
    block_id: string;
    data: Record<string, any>;

    // @ prefixed keys
    [key: string]: any;
}

export interface IncomingData<T> {
    uuid: string,
    type: "action" | "delta";
    mode: "live" | "history";
    content: T
    irreversible: boolean;
}

export interface LIBData {
    chain_id: string;
    block_num: number;
    block_id: string;
}

export interface ForkData {
    chain_id: string;
    starting_block: number;
    ending_block: number;
    new_id: string;
}

export interface HyperionStreamEventMap<T> {
    [StreamClientEvents.CONNECT]: void;
    [StreamClientEvents.DRAIN]: void;
    [StreamClientEvents.EMPTY]: void;
    [StreamClientEvents.DATA]: IncomingData<T>;
    [StreamClientEvents.LIBDATA]: IncomingData<T>;
    [StreamClientEvents.LIBUPDATE]: LIBData;
    [StreamClientEvents.FORK]: ForkData;
    [StreamClientEvents.ERROR]: Error;
    // String versions for convenience
    'connect': void;
    'drain': void;
    'empty': void;
    'data': IncomingData<T>;
    'libData': IncomingData<T>;
    'libUpdate': LIBData;
    'fork': ForkData;
    'error': Error;
}

export interface EventMap<T> {
    'start': { status: string, reqUUID: string, startingBlock: number };
    'message': IncomingData<T>;
    'error': any;
    // Add other events as needed
}

// Generic typed event listener
export type TypedEventListener<T, K extends keyof HyperionStreamEventMap<T>> = (data: HyperionStreamEventMap<T>[K]) => void;
export type EventData<T> = IncomingData<T> | LIBData | ForkData | Error | void | undefined;
export type EventListener<T> = (data?: EventData<T>) => void;

export type StreamTypeMap = {
    action: {
        request: StreamActionsRequest;
        response: ActionContent;
    };
    delta: {
        request: StreamDeltasRequest;
        response: DeltaContent;
    };
};

export type StreamTypes = keyof StreamTypeMap;
export type StreamResponseTypes = StreamTypeMap[StreamTypes]['response'];
export type StreamRequestTypes = StreamTypeMap[StreamTypes]['request'];
