// Simple HTTP server to serve the test files
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3001;
const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
};

const server = http.createServer((req, res) => {
    console.log(`Request: ${req.url}`);

    // Handle root path
    let filePath = req.url === '/'
        ? path.join(__dirname, 'index.html')
        : path.join(process.cwd(), req.url);

    // Create a simple index page if it doesn't exist
    if (req.url === '/' && !fs.existsSync(filePath)) {
        res.writeHead(200, {'Content-Type': 'text/html'});
        res.end(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Hyperion Stream Client Tests</title>
                <style>
                    body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
                    h1 { color: #333; }
                    ul { list-style-type: none; padding: 0; }
                    li { margin-bottom: 10px; }
                    a { color: #0066cc; text-decoration: none; }
                    a:hover { text-decoration: underline; }
                    .description { color: #666; font-size: 0.9em; margin-left: 20px; }
                </style>
            </head>
            <body>
                <h1>Hyperion Stream Client Tests</h1>
                <p>Select a test file to run:</p>
                <ul>
                    <li>
                        <a href="test/browser/umd-global-test.html">UMD Bundle with Global Access</a>
                        <div class="description">Tests loading the UMD bundle directly via a script tag and accessing the HyperionStreamClient globally</div>
                    </li>
                    <li>
                        <a href="test/browser/import-map-esm-test.html">ESM Module with Import Map</a>
                        <div class="description">Tests using the ESM module directly with import maps, including mapping all dependencies</div>
                    </li>
                </ul>
                <p>Check the browser console to see the test results.</p>
                <p><a href="test/README.md">View Test Documentation</a></p>
            </body>
            </html>
        `);
        return;
    }

    // Check if the file exists
    fs.access(filePath, fs.constants.F_OK, (err) => {
        if (err) {
            res.writeHead(404);
            res.end(`File not found: ${filePath}`);
            return;
        }

        // Get the file extension
        const ext = path.extname(filePath);
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        // Read and serve the file
        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end(`Error reading file: ${err.message}`);
                return;
            }

            res.writeHead(200, {'Content-Type': contentType});
            res.end(data);
        });
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://localhost:${PORT}/`);
    console.log(`Test pages:`);
    console.log(`- UMD Global: http://localhost:${PORT}/test/umd-global-test.html`);
    console.log(`- ESM Import Map: http://localhost:${PORT}/test/import-map-esm-test.html`);
    console.log(`- Documentation: http://localhost:${PORT}/test/README.md`);
});
