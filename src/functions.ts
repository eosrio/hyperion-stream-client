export function trimTrailingSlash(input: string) {
    if (input.endsWith('/')) {
        return input.slice(0, input.length - 1);
    } else {
        return input;
    }
}
