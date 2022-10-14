"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.trimTrailingSlash = void 0;
function trimTrailingSlash(input) {
    if (input.endsWith('/')) {
        return input.slice(0, input.length - 1);
    }
    else {
        return input;
    }
}
exports.trimTrailingSlash = trimTrailingSlash;
//# sourceMappingURL=functions.js.map