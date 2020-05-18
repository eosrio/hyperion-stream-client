"use strict";
var __spreadArrays = (this && this.__spreadArrays) || function () {
    for (var s = 0, i = 0, il = arguments.length; i < il; i++) s += arguments[i].length;
    for (var r = Array(s), k = 0, i = 0; i < il; i++)
        for (var a = arguments[i], j = 0, jl = a.length; j < jl; j++, k++)
            r[k] = a[j];
    return r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HyperionSocketClient = void 0;
var async_1 = require("async");
var io = require("socket.io-client");
var HyperionSocketClient = /** @class */ (function () {
    /**
     * @typedef {object} BaseOptions
     * @property {boolean} async - Enable Asynchronous Mode
     */
    /**
     * Construct a new streaming client
     *
     * @param {string} endpoint - Hyperion API Endpoint (ex. https://api.eosrio.io)
     * @param {HyperionClientOptions} opts - Client Options
     */
    function HyperionSocketClient(endpoint, opts) {
        this.online = false;
        this.savedRequests = [];
        if (endpoint) {
            this.socketURL = endpoint;
        }
        if (opts) {
            this.options = opts;
        }
    }
    /**
     * Disconnects from the API
     * @example
     *
     *     disconnect()
     */
    HyperionSocketClient.prototype.disconnect = function () {
        this.lastReceivedBlock = null;
        this.socket.disconnect();
    };
    /**
     *
     * @param endpoint - Hyperion API Endpoint
     */
    HyperionSocketClient.prototype.setEndpoint = function (endpoint) {
        if (endpoint) {
            this.socketURL = endpoint;
        }
        else {
            console.error('URL not informed');
        }
    };
    /**
     * Start session. Action handlers should be defined before this method is called
     * @param {function} [callback] - function to execute on a successful connection
     *
     * @example
     * connect(()=>{
     *     console.log('Connection was successful!');
     * });
     */
    HyperionSocketClient.prototype.connect = function (callback) {
        var _this = this;
        // setup incoming queue
        if (this.onData) {
            this.dataQueue = async_1.queue(function (task, callback) {
                if (_this.options.async) {
                    _this.onData(task, function () {
                        callback();
                    });
                }
                else {
                    _this.onData(task);
                    callback();
                }
            }, 1);
            // assign an error callback
            this.dataQueue.error(function (err) {
                if (err) {
                    console.error('task experienced an error');
                }
            });
            this.dataQueue.drain(function () {
                // console.log('all items have been processed');
            });
            this.dataQueue.empty(this.onEmpty);
        }
        if (!this.socketURL) {
            throw new Error('endpoint was not defined!');
        }
        this.socket = io(this.socketURL, {
            transports: ['websocket', 'polling']
        });
        this.socket.on('connect', function () {
            _this.online = true;
            if (_this.onConnect) {
                _this.onConnect();
            }
            if (callback) {
                callback();
            }
        });
        this.socket.on('error', function (msg) {
            console.log(msg);
        });
        this.socket.on('lib_update', function (msg) {
            if (_this.onLIB) {
                _this.onLIB(msg);
            }
        });
        this.socket.on('fork_event', function (msg) {
            if (_this.onFork) {
                _this.onFork(msg);
            }
        });
        this.socket.on('message', function (msg) {
            if (_this.onData && (msg.message || msg['messages'])) {
                switch (msg.type) {
                    case 'delta_trace': {
                        if (msg['messages']) {
                            msg['messages'].forEach(function (message) {
                                _this.processDeltaTrace(message, msg.mode);
                            });
                        }
                        else {
                            _this.processDeltaTrace(JSON.parse(msg.message), msg.mode);
                        }
                        break;
                    }
                    case 'action_trace': {
                        if (msg['messages']) {
                            msg['messages'].forEach(function (message) {
                                _this.processActionTrace(message, msg.mode);
                            });
                        }
                        else {
                            _this.processActionTrace(JSON.parse(msg.message), msg.mode);
                        }
                        break;
                    }
                }
            }
        });
        this.socket.on('status', function (status) {
            switch (status) {
                case 'relay_restored': {
                    if (!_this.online) {
                        _this.online = true;
                        _this.resendRequests();
                    }
                    break;
                }
                case 'relay_down': {
                    _this.online = false;
                    break;
                }
                default: {
                    console.log(status);
                }
            }
        });
        this.socket.on('disconnect', function () {
            _this.online = false;
            console.log('disconnected!');
        });
    };
    HyperionSocketClient.prototype.processActionTrace = function (action, mode) {
        var metakey = '@' + action['act'].name;
        if (action[metakey]) {
            var parsedData_1 = action[metakey];
            Object.keys(parsedData_1).forEach(function (key) {
                if (!action['act']['data']) {
                    action['act']['data'] = {};
                }
                action['act']['data'][key] = parsedData_1[key];
            });
            delete action[metakey];
        }
        this.dataQueue.push({
            type: 'action',
            mode: mode,
            content: action
        });
        this.lastReceivedBlock = action['block_num'];
    };
    HyperionSocketClient.prototype.processDeltaTrace = function (delta, mode) {
        var metakey = '@' + delta['table'];
        if (delta[metakey + '.data']) {
            metakey = metakey + '.data';
        }
        if (delta[metakey]) {
            var parsedData_2 = delta[metakey];
            Object.keys(parsedData_2).forEach(function (key) {
                if (!delta['data']) {
                    delta['data'] = {};
                }
                delta['data'][key] = parsedData_2[key];
            });
            delete delta[metakey];
        }
        this.dataQueue.push({
            type: 'delta',
            mode: mode,
            content: delta
        });
        this.lastReceivedBlock = delta['block_num'];
    };
    HyperionSocketClient.prototype.resendRequests = function () {
        var _this = this;
        console.log('RESENDING SAVED REQUESTS');
        var savedReqs = __spreadArrays(this.savedRequests);
        this.savedRequests = [];
        savedReqs.forEach(function (r) {
            switch (r.type) {
                case 'action': {
                    _this.streamActions(r.req);
                    break;
                }
                case 'delta': {
                    _this.streamDeltas(r.req);
                    break;
                }
            }
        });
    };
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
    HyperionSocketClient.prototype.streamActions = function (request) {
        if (this.socket.connected) {
            this.checkLastBlock(request);
            this.socket.emit('action_stream_request', request, function (response) {
                console.log('action stream response:', response);
            });
            this.savedRequests.push({
                type: 'action',
                req: request
            });
        }
    };
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
    HyperionSocketClient.prototype.streamDeltas = function (request) {
        if (this.socket.connected) {
            this.checkLastBlock(request);
            this.socket.emit('delta_stream_request', request, function (response) {
                console.log('delta stream response:', response);
            });
            this.savedRequests.push({
                type: 'delta',
                req: request
            });
        }
    };
    HyperionSocketClient.prototype.checkLastBlock = function (request) {
        if (request.start_from !== 0 && this.lastReceivedBlock) {
            if (request.start_from < this.lastReceivedBlock) {
                request.start_from = this.lastReceivedBlock;
            }
        }
    };
    return HyperionSocketClient;
}());
exports.HyperionSocketClient = HyperionSocketClient;
//# sourceMappingURL=hyperion-socket-client.js.map