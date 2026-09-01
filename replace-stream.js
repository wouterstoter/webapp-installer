export class ReplaceStream extends TransformStream {
  constructor(search, replace, { encoding = 'utf-8', replaceAll = false } = {}) {
    let buffer = '';
    const decoder = new TextDecoder(encoding, {fatal: true});
    const encoder = new TextEncoder();

    // For regex, regulate replaceAll behaviour with flag instead of variable
    const isRegex = search instanceof RegExp;
    if (isRegex) replaceAll = search.flags.includes("g");

    // How much "tail" of the buffer we need to hold back in case a match
    // straddles the chunk boundary. For strings this is length-1 of the
    // search term; for regex we use a heuristic safe margin.
    const holdBack = isRegex ? 64 : search.length - 1;

    let replaced = false;
    let string = false;

    super({
      start() {
        buffer = '';
      },
      transform(chunk, controller) {
        // Do nothing if replacement has happened already
        if (replaced && !replaceAll) return controller.enqueue(chunk)
        // Accept either Uint8Array (byte stream) or string (text stream)
        string = typeof chunk === 'string'
        let text;
        try {
            text = string ? chunk : decoder.decode(chunk, { stream: true });
        } catch(e) {
            // If it cannot be text encoded, pass on directly
            if (buffer) controller.enqueue(encoder.encode(buffer));
            buffer = '';
            controller.enqueue(chunk);
            return;
        }
        buffer += text;
        if (!replaceAll && buffer.search(search)) replaced = true;
        buffer = buffer[replaceAll ? "replaceAll" : "replace"](search,replace);

        let result;
        if ((replaceAll || !replaced) && holdBack > 0) {
            result = buffer.slice(0,-holdBack);
            buffer = buffer.slice(-holdBack);
        } else {
            // No need to hold a buffer if our one and only replacement has already happened
            result = buffer;
            buffer = '';
        }
        controller.enqueue(string ? result : encoder.encode(result));
      },
      flush(controller) {
        // Flush any remaining decoder bytes + buffered text
        buffer += decoder.decode();
        if (buffer.length > 0) {
            if (replaceAll || !replaced) buffer = buffer[replaceAll ? "replaceAll" : "replace"](search,replace);
            controller.enqueue(string ? buffer : encoder.encode(buffer));
        }
      },
    });
  }
}