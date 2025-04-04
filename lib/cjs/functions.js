"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.trimTrailingSlash = trimTrailingSlash;
function trimTrailingSlash(input) {
    if (input.endsWith('/')) {
        return input.slice(0, input.length - 1);
    }
    else {
        return input;
    }
}
//# sourceMappingURL=functions.js.map