// Console Logger Helper
// This script creates a visual console in the HTML page to display console output
// Useful for testing on mobile devices where dev tools are not easily accessible

function initConsoleLogger() {
    // Create log container if it doesn't exist
    if (!document.getElementById('console-log-container')) {
        const container = document.createElement('div');
        container.id = 'console-log-container';
        container.style.cssText = `
            margin-top: 20px;
            padding: 10px;
            border: 1px solid #ccc;
            border-radius: 5px;
            background-color: #f5f5f5;
            font-family: monospace;
            max-height: 300px;
            overflow-y: auto;
            white-space: pre-wrap;
            word-break: break-word;
        `;

        // Add a header
        const header = document.createElement('div');
        header.textContent = 'Console Output:';
        header.style.cssText = `
            font-weight: bold;
            margin-bottom: 5px;
            padding-bottom: 5px;
            border-bottom: 1px solid #ccc;
        `;
        container.appendChild(header);

        // Add the container to the body
        document.body.appendChild(container);
    }

    // Get the container
    const logContainer = document.getElementById('console-log-container');

    // Store original console methods
    const originalConsole = {
        log: console.log,
        error: console.error,
        warn: console.warn,
        info: console.info
    };

    // Helper function to create log entry
    function createLogEntry(type, args) {
        const entry = document.createElement('div');
        entry.style.cssText = `
            margin: 2px 0;
            padding: 3px;
            border-radius: 3px;
        `;

        // Set style based on log type
        switch (type) {
            case 'error':
                entry.style.backgroundColor = '#ffebee';
                entry.style.color = '#d32f2f';
                break;
            case 'warn':
                entry.style.backgroundColor = '#fff8e1';
                entry.style.color = '#ff8f00';
                break;
            case 'info':
                entry.style.backgroundColor = '#e3f2fd';
                entry.style.color = '#1976d2';
                break;
            default:
                entry.style.backgroundColor = 'transparent';
        }

        // Format the arguments
        const formattedArgs = Array.from(args).map(arg => {
            if (typeof arg === 'object') {
                try {
                    return JSON.stringify(arg, null, 2);
                } catch (e) {
                    return String(arg);
                }
            }
            return String(arg);
        }).join(' ');

        entry.textContent = `[${type.toUpperCase()}] ${formattedArgs}`;
        return entry;
    }

    // Override console methods
    console.log = function() {
        originalConsole.log.apply(console, arguments);
        logContainer.appendChild(createLogEntry('log', arguments));
        logContainer.scrollTop = logContainer.scrollHeight;
    };

    console.error = function() {
        originalConsole.error.apply(console, arguments);
        logContainer.appendChild(createLogEntry('error', arguments));
        logContainer.scrollTop = logContainer.scrollHeight;
    };

    console.warn = function() {
        originalConsole.warn.apply(console, arguments);
        logContainer.appendChild(createLogEntry('warn', arguments));
        logContainer.scrollTop = logContainer.scrollHeight;
    };

    console.info = function() {
        originalConsole.info.apply(console, arguments);
        logContainer.appendChild(createLogEntry('info', arguments));
        logContainer.scrollTop = logContainer.scrollHeight;
    };

    // Log initialization
    console.info('Console logger initialized');

    return {
        clear: function() {
            // Clear the log container (except the header)
            while (logContainer.childNodes.length > 1) {
                logContainer.removeChild(logContainer.lastChild);
            }
            console.info('Console log cleared');
        }
    };
}

// Helper function to mark test as completed
function markTestCompleted() {
    const statusElement = document.getElementById('test-status');
    if (statusElement) {
        statusElement.textContent = 'COMPLETED';
        statusElement.style.backgroundColor = '#4caf50';
    }
}

// Export the functions
window.initConsoleLogger = initConsoleLogger;
window.markTestCompleted = markTestCompleted;
