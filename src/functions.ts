import {ActionContent, DeltaContent} from "./interfaces.js";

export function trimTrailingSlash(input: string) {
    if (input.endsWith('/')) {
        return input.slice(0, input.length - 1);
    } else {
        return input;
    }
}

export function replaceMetaFields(content: ActionContent | DeltaContent) {

    // Determine if the content is a delta or action
    if (content.table) {
        let metaKey = '@' + content.table;
        if (content[metaKey + '.data']) {
            metaKey = metaKey + '.data'
        }
        if (content[metaKey]) {
            const parsedData = content[metaKey];
            Object.keys(parsedData).forEach((key) => {
                if (!content.data) {
                    content.data = {};
                }
                content.data[key] = parsedData[key];
            });
            delete content[metaKey];
        }
    } else if (content.act) {
        const metaKey = '@' + content.act.name;
        if (content[metaKey]) {
            const parsedData = content[metaKey];
            Object.keys(parsedData).forEach((key) => {
                if (!content.act.data) {
                    content.act.data = {};
                }
                content.act.data[key] = parsedData[key];
            });
            delete content[metaKey];
        }
    }
}
