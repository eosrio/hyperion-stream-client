const fs = require("fs");
const browserify = require("browserify");
browserify(["./src/standalone.js"])
    .transform("babelify", {
        "presets": [
            ["@babel/preset-env", {
                "useBuiltIns": false,
            }],
        ],
        "plugins": [
            "@babel/plugin-proposal-class-properties",
            "@babel/plugin-transform-modules-commonjs",
            "@babel/plugin-transform-runtime"
        ]
    })
    .bundle()
    .pipe(fs.createWriteStream("dist/bundle.js"));
