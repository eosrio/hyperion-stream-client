const mylib = require('./index.js');
if (typeof global.window.define == 'function' && global.window.define.amd) {
    global.window.define('Hyperion', function () { return mylib; });
} else {
    global.window.Hyperion = mylib;
}
