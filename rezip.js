import mime from './libs/mime.min.js';

/* This file aims to help unzip and zip individual files through streams of a request/response using zip.js */
/**
 * Zip/Unzip a file
 * @param {Request|Response|zip.ZipFileEntry|ReadableStream} input - The file to be zipped/unzipped
 * @param {Headers|zip.ZipWriterAddDataOptions|zip.EntryGetDataOptions} [options] - The options to zip/unzip with (can also be part of headers of Request/Response)
 * @returns {Response} The zipped/unzipped response with the right headers
 */
export async function rezipper(input,options = {}) {
    let headers;
    let onprogress = options.onprogress;
    delete options.onprogress;
    let unzip = true;
    if (input instanceof Request) unzip = false;
    [input, options, headers] = await HeadersToOptions(input,options);
    let signal = options.signal;
    delete options.signal;
    if (!options.passThrough) {
        if (unzip && options.encrypted && !options.password) throw new Error(zip.ERR_ENCRYPTED);
        var encodings = headers.get("Content-Encoding")?.toLowerCase().split(" ");
        if (!encodings || !encodings[0]) encodings = ["zipjs"] // Add zip.js if no encodings, otherwise why are we here
        if (unzip) encodings = encodings.reverse(); // Encodings are in the order they're applied, to unzip you need to work backwards
        if (!("uncompressedSize" in options) && encodings.indexOf("zipjs") != -1) unzip = false; // If there is no uncompressed size mentioned, we cannot unzip anyway for zipjs
        for (var i = 0; i < encodings.length; ++i) {
            if (encodings[i] == "zipjs") {
                if (input instanceof ReadableStream) {
                    const zipReader = new zip.ZipReaderStream();
                    const zipStream = input.pipeThrough(new zip.ZipWriterStream().transform('file',unzip ? {...options, passThrough: true} : options));
                    const iterator = zipStream.pipeThrough(zipReader).values();
                    const { value: entry } = await iterator.next();
                    await iterator.return(); // Clean up the stream so the end of directory doesn't have to be written
                    input = entry;
                }
                if (!unzip && input.compressionMethod == 0  && !input.encrypted) {
                    // If we're zipping, but it's not compressed nor encrypted, we can remove mentions of encoding
                    encodings.splice(i,1);
                    i--;
                }
                [input, options, headers] = [await EntryToStream(unzip,input,options), ...EntryToOptions(unzip,input,headers)];
            } else {
                // See if the browser can (de)compress the format natively
                try {
                    var stream = new (unzip ? DecompressionStream : CompressionStream)(encodings[i]);
                    input = input.pipeThrough(stream);
                } catch(e) {
                    if (unzip) {
                        // No use in trying to decompress further if one fails, so we're abandoning the loop
                        break;
                    } else {
                        // Simply skip this one
                        encodings.splice(i,1);
                        i--;
                    }
                }
            }
            if (unzip) {
                //Formats that are succesfully unzipped can be removed from the header
                encodings.splice(i,1);
                i--;
            }
        }
        if (unzip) encodings = encodings.reverse(); // reverse it back;
        // Update the headers
        if (encodings.length === 0) {
            headers.delete("Content-Encoding")
        } else {
            headers.set("Content-Encoding",encodings.join(" "))
        }
    } else {
        delete options.passThrough;
    }
    for (const key in options) {
        let newKey = "x-zipjs-" + key.replace(/\W+/g, " ").split(/ |\B(?=[A-Z])/).map(word => word.toLowerCase()).join("-")
        headers.set(newKey, Number(options[key]) || options[key])
    }
    if (onprogress || signal) {
        input = input.pipeThrough(progressTracker(p => onprogress({...p, total: Number(headers.get("Content-Length"))}),signal));
    }
    return new Response(input,{headers});
}
/**
 * @param {Request|Response} input
 * @param {Headers|zip.ZipWriterAddDataOptions|zip.EntryGetDataOptions} [options]
 * @returns {ReadableStream} input
 * @returns {zip.ZipWriterAddDataOptions|zip.EntryGetDataOptions} options
 * @returns {Headers} headers
 */
export async function HeadersToOptions(input,options = {}) {
    let headers = [];
    if (options instanceof Headers) {
        headers.push(options);
        options = {};
    }
    if (input instanceof Request || input instanceof Response) {
        headers.push(input.headers);
        options["password"] = options["password"] || input.url?.split("/")[2]?.split("@").slice(0,-1)[0]?.split(":")[1];
        input = input.body || (await input.blob()).stream();
    }
    let outputHeaders = new Headers();
    if (headers.length > 0) {
        for (let h = 0; h < headers.length; ++h) {
            for (const [key,value] of headers[h].entries()) {
                if (key.toLowerCase().startsWith("x-zipjs-")) {
                    let newKey = key.slice("x-zipjs-".length)
                    newKey = newKey.split("-").map((word,n) => n == 0 ? word : word[0].toUpperCase() + word.slice(1)).join("");
                    options[newKey] = options[newKey] || isNaN(value) ? value : Number(value);
                } else if (key.toLowerCase() == "Authorization" && value.toLowerCase().startsWith("basic ")) {
                    options[password] = options[password] || atob(value.slice("Basic ".length)).split(":")[1];
                } else if (!outputHeaders.has(key)) {
                    outputHeaders.set(key,value)
                }
            }
        }
    }
    headers = outputHeaders;
    return [input, options, headers]
}
/**
 * @param {Boolean} unzip - If the file is being zipped or unzipped
 * @param {zip.ZipFileEntry} input
 * @param {Headers} headers
 * @returns {ReadableStream} input
 * @returns {Headers} headers
 */
export function EntryToOptions(unzip,input,headers = new Headers()) {
    // Now input is an ZipFileEntry
    if (!headers.has("Date") && input.creationDate) headers.set("Date",input.creationDate.toUTCString());
    if (!headers.has("Last-Modified") && input.lastModDate) headers.set("Last-Modified",input.lastModDate.toUTCString());
    if (!headers.has("Content-Type") && input.filename != "file") headers.set("Content-Type",mime.getType(input.filename));
    headers.set("Content-Length",unzip ? input.uncompressedSize : input.compressedSize);
    var options = {};
    if (!unzip && (input.compressionMethod != 0 || input.encrypted)) {
        // Leave behind the headers if the result will not be compressed nor encrypted
        if (input.crc32) options.crc32 = input.crc32;
        options.uncompressedSize = input.uncompressedSize;
        if (input.encrypted) options.encrypted = input.encrypted;
        if (input.encrypted || !input.compressionMethod) options.compressionMethod = input.compressionMethod;
        if (input.encrypted && input.zipCrypto) options.zipCrypto = input.zipCrypto;
        if (input.encrypted && !input.zipCrypto) options.encryptionStrength = input.extraFieldAES.strength;
    }
    return [options, headers]
}
/**
 * @param {Boolean} unzip - If the file is being zipped or unzipped
 * @param {zip.ZipFileEntry} input
 * @param {zip.EntryGetDataOptions} options
 * @returns {ReadableStream} input
 */
export async function EntryToStream(unzip,input,options) {
    if (unzip && input.encrypted) {
        input = input.readable(unzip ? options : {passThrough: true});
        // Check for errors for encrypted files
        var probe;
        [input,probe] = input.tee(); // split stream in 2
        try {
            const reader = probe.getReader();
            await reader.read(); // throws here if the password is wrong
            reader.cancel(); // don't bother reading the rest
        } catch(e) {
            throw e;
        }
    } else {
        input = input.readable(unzip ? options : {passThrough: true});
    }
    return input
}

export function progressTracker(onProgress,signal) {
  let progress = 0;
  let abort = (controller) => {controller.error(signal.reason ?? new DOMException('Aborted', 'AbortError'));}
  return new TransformStream({
    start(controller) {
      if (signal.aborted) return abort(controller);
      signal.addEventListener('abort', () => abort(controller), { once: true });
    },
    transform(chunk, controller) {
      if (signal.aborted) return abort(controller);
      progress += chunk.byteLength;
      if (onProgress) onProgress({ received: chunk.byteLength, progress });
      controller.enqueue(chunk);
    },
  });
}