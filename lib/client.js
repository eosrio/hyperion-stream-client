"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault");

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.HyperionSocketClient = void 0;

var _toConsumableArray2 = _interopRequireDefault(require("@babel/runtime/helpers/toConsumableArray"));

var _classCallCheck2 = _interopRequireDefault(require("@babel/runtime/helpers/classCallCheck"));

var _createClass2 = _interopRequireDefault(require("@babel/runtime/helpers/createClass"));

var _defineProperty2 = _interopRequireDefault(require("@babel/runtime/helpers/defineProperty"));

var _classPrivateFieldGet2 = _interopRequireDefault(require("@babel/runtime/helpers/classPrivateFieldGet"));

var _classPrivateFieldSet2 = _interopRequireDefault(require("@babel/runtime/helpers/classPrivateFieldSet"));

var _queue = _interopRequireDefault(require("async/queue"));

var _socket2 = _interopRequireDefault(require("socket.io-client"));

var HyperionSocketClient =
/*#__PURE__*/
function () {
  /**
   * @typedef {object} BaseOptions
   * @property {boolean} async - Enable Asynchronous Mode
   */

  /**
   * Construct a new streaming client
   *
   * @param {string} endpoint - Hyperion API Endpoint (ex. https://api.eosrio.io)
   * @param {BaseOptions} opts - Client Options
   */
  function HyperionSocketClient(endpoint, opts) {
    (0, _classCallCheck2["default"])(this, HyperionSocketClient);

    _socket.set(this, {
      writable: true,
      value: void 0
    });

    _socketURL.set(this, {
      writable: true,
      value: void 0
    });

    _lastReceivedBlock.set(this, {
      writable: true,
      value: void 0
    });

    _dataQueue.set(this, {
      writable: true,
      value: void 0
    });

    _options.set(this, {
      writable: true,
      value: void 0
    });

    (0, _defineProperty2["default"])(this, "onConnect", void 0);
    (0, _defineProperty2["default"])(this, "onData", void 0);
    (0, _defineProperty2["default"])(this, "onEmpty", void 0);
    (0, _defineProperty2["default"])(this, "online", false);

    _savedRequests.set(this, {
      writable: true,
      value: []
    });

    if (endpoint) {
      (0, _classPrivateFieldSet2["default"])(this, _socketURL, endpoint);
    }

    if (opts) {
      (0, _classPrivateFieldSet2["default"])(this, _options, opts);
    }
  }
  /**
   * Disconnects from the API
   * @example
   *
   *     disconnect()
   */


  (0, _createClass2["default"])(HyperionSocketClient, [{
    key: "disconnect",
    value: function disconnect() {
      (0, _classPrivateFieldSet2["default"])(this, _lastReceivedBlock, null);
      (0, _classPrivateFieldGet2["default"])(this, _socket).disconnect();
    }
    /**
     *
     * @param endpoint - Hyperion API Endpoint
     */

  }, {
    key: "setEndpoint",
    value: function setEndpoint(endpoint) {
      if (endpoint) {
        (0, _classPrivateFieldSet2["default"])(this, _socketURL, endpoint);
      } else {
        console.error('URL not informed');
      }
    }
    /**
     *
     * @returns {number|*} - Current queue size
     */

  }, {
    key: "connect",

    /**
     * Start session. Action handlers should be defined before this method is called
     * @param {function} [callback] - function to execute on a successful connection
     *
     * @example
     * connect(()=>{
     *     console.log('Connection was successful!');
     * });
     */
    value: function connect(callback) {
      var _this = this;

      // setup incoming queue
      if (this.onData) {
        (0, _classPrivateFieldSet2["default"])(this, _dataQueue, (0, _queue["default"])(function (task, callback) {
          if ((0, _classPrivateFieldGet2["default"])(_this, _options).async) {
            _this.onData(task, function () {
              callback();
            });
          } else {
            _this.onData(task);

            callback();
          }
        }, 1)); // assign an error callback

        (0, _classPrivateFieldGet2["default"])(this, _dataQueue).error(function (err, task) {// console.error('task experienced an error');
        });
        (0, _classPrivateFieldGet2["default"])(this, _dataQueue).drain(function () {// console.log('all items have been processed');
        });
        (0, _classPrivateFieldGet2["default"])(this, _dataQueue).empty(this.onEmpty);
      }

      if (!(0, _classPrivateFieldGet2["default"])(this, _socketURL)) {
        throw new Error('endpoint was not defined!');
      }

      (0, _classPrivateFieldSet2["default"])(this, _socket, (0, _socket2["default"])((0, _classPrivateFieldGet2["default"])(this, _socketURL), {
        transports: ['websocket', 'polling']
      }));
      (0, _classPrivateFieldGet2["default"])(this, _socket).on('connect', function () {
        if (_this.onConnect) {
          _this.online = true;

          _this.onConnect();
        }

        if (callback) {
          callback();
        }
      });
      (0, _classPrivateFieldGet2["default"])(this, _socket).on('error', function (msg) {
        console.log(msg);
      });
      (0, _classPrivateFieldGet2["default"])(this, _socket).on('message', function (msg) {
        if (_this.onData && (msg.message || msg['messages'])) {
          switch (msg.type) {
            case 'delta_trace':
              {
                if (msg['messages']) {
                  msg['messages'].forEach(function (message) {
                    _this.processDeltaTrace(message, msg.mode);
                  });
                } else {
                  _this.processDeltaTrace(JSON.parse(msg.message), msg.mode);
                }

                break;
              }

            case 'action_trace':
              {
                if (msg['messages']) {
                  msg['messages'].forEach(function (message) {
                    _this.processActionTrace(message, msg.mode);
                  });
                } else {
                  _this.processActionTrace(JSON.parse(msg.message), msg.mode);
                }

                break;
              }
          }
        }
      });
      (0, _classPrivateFieldGet2["default"])(this, _socket).on('status', function (status) {
        switch (status) {
          case 'relay_restored':
            {
              if (!_this.online) {
                _this.online = true;

                _this.resendRequests();
              }

              break;
            }

          case 'relay_down':
            {
              _this.online = false;
              break;
            }

          default:
            {
              console.log(status);
            }
        }
      });
      (0, _classPrivateFieldGet2["default"])(this, _socket).on('disconnect', function () {
        console.log('disconnected!');
      });
    }
  }, {
    key: "processActionTrace",
    value: function processActionTrace(action, mode) {
      var metakey = '@' + action['act'].name;

      if (action[metakey]) {
        var parsedData = action[metakey];
        Object.keys(parsedData).forEach(function (key) {
          if (!action['act']['data']) {
            action['act']['data'] = {};
          }

          action['act']['data'][key] = parsedData[key];
        });
        delete action[metakey];
      }

      (0, _classPrivateFieldGet2["default"])(this, _dataQueue).push({
        type: 'action',
        mode: mode,
        content: action
      });
      (0, _classPrivateFieldSet2["default"])(this, _lastReceivedBlock, action['block_num']);
    }
  }, {
    key: "processDeltaTrace",
    value: function processDeltaTrace(delta, mode) {
      var metakey = '@' + delta['table'];

      if (delta[metakey + '.data']) {
        metakey = metakey + '.data';
      }

      if (delta[metakey]) {
        var parsedData = delta[metakey];
        Object.keys(parsedData).forEach(function (key) {
          if (!delta['data']) {
            delta['data'] = {};
          }

          delta['data'][key] = parsedData[key];
        });
        delete delta[metakey];
      }

      (0, _classPrivateFieldGet2["default"])(this, _dataQueue).push({
        type: 'delta',
        mode: mode,
        content: delta
      });
      (0, _classPrivateFieldSet2["default"])(this, _lastReceivedBlock, delta['block_num']);
    }
  }, {
    key: "resendRequests",
    value: function resendRequests() {
      var _this2 = this;

      console.log('RESENDING SAVED REQUESTS');
      var savedReqs = (0, _toConsumableArray2["default"])((0, _classPrivateFieldGet2["default"])(this, _savedRequests));
      (0, _classPrivateFieldSet2["default"])(this, _savedRequests, []);
      savedReqs.forEach(function (r) {
        switch (r.type) {
          case 'action':
            {
              _this2.streamActions(r.req);

              break;
            }

          case 'delta':
            {
              _this2.streamDeltas(r.req);

              break;
            }
        }
      });
    }
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
     * @property {[requestFilter]} filters - Array of filters
     * @property {number} [start_from=0] - Starting block number
     * @property {number} [read_until=0] - Read until this block number
     */

    /**
     * Send a request for a filtered action traces stream
     * @param {StreamActionsRequest} request - Action Request Options
     */

  }, {
    key: "streamActions",
    value: function streamActions(request) {
      if ((0, _classPrivateFieldGet2["default"])(this, _socket).connected) {
        this.checkLastBlock(request);
        (0, _classPrivateFieldGet2["default"])(this, _socket).emit('action_stream_request', request, function (response) {
          console.log('action stream response:', response);
        });
        (0, _classPrivateFieldGet2["default"])(this, _savedRequests).push({
          type: 'action',
          req: request
        });
      }
    }
  }, {
    key: "checkLastBlock",
    value: function checkLastBlock(request) {
      if (request.start_from !== 0 && (0, _classPrivateFieldGet2["default"])(this, _lastReceivedBlock)) {
        if (request.start_from < (0, _classPrivateFieldGet2["default"])(this, _lastReceivedBlock)) {
          request.start_from = (0, _classPrivateFieldGet2["default"])(this, _lastReceivedBlock);
        }
      }
    }
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

  }, {
    key: "streamDeltas",
    value: function streamDeltas(request) {
      if ((0, _classPrivateFieldGet2["default"])(this, _socket).connected) {
        this.checkLastBlock(request);
        (0, _classPrivateFieldGet2["default"])(this, _socket).emit('delta_stream_request', request, function (response) {
          console.log('delta stream response:', response);
        });
        (0, _classPrivateFieldGet2["default"])(this, _savedRequests).push({
          type: 'delta',
          req: request
        });
      }
    }
  }, {
    key: "getQueueSize",
    get: function get() {
      if ((0, _classPrivateFieldGet2["default"])(this, _dataQueue)) {
        return (0, _classPrivateFieldGet2["default"])(this, _dataQueue).length();
      } else {
        return 0;
      }
    }
  }]);
  return HyperionSocketClient;
}();

exports.HyperionSocketClient = HyperionSocketClient;

var _socket = new WeakMap();

var _socketURL = new WeakMap();

var _lastReceivedBlock = new WeakMap();

var _dataQueue = new WeakMap();

var _options = new WeakMap();

var _savedRequests = new WeakMap();