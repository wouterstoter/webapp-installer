/**
 * Base64 TransformStreams for ReadableStreams.
 *
 * - Base64EncodeStream: Uint8Array chunks in  -> base64 string chunks out
 * - Base64DecodeStream: string|Uint8Array chunks in -> Uint8Array chunks out
 *
 * Both correctly handle chunk boundaries that don't align to 3-byte /
 * 4-character groups by buffering the remainder between transform() calls.
 *
 * Works anywhere the Web Streams API (TransformStream) is available:
 * browsers, Deno, and Node 18+ (globally, or via `import { TransformStream }
 * from 'node:stream/web'`).
 */

// Chunk size for binary-string conversion, to avoid blowing the call stack
// on String.fromCharCode(...bytes) for large inputs.
const CHUNK_SIZE = 0x8000; // 32K

function encodeBytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK_SIZE));
  }
  return btoa(binary);
}

function decodeBase64ToBytes(str) {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encodes a stream of bytes into a stream of base64 string chunks.
 * Input chunks must be Uint8Array (or anything BufferSource-like).
 */
export class Base64EncodeStream extends TransformStream {
  constructor() {
    let remainder = new Uint8Array(0);

    super({
      transform(chunk, controller) {
        const input = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
        const combined = new Uint8Array(remainder.length + input.length);
        combined.set(remainder);
        combined.set(input, remainder.length);

        const encodableLength = combined.length - (combined.length % 3);
        if (encodableLength > 0) {
          controller.enqueue(encodeBytesToBase64(combined.subarray(0, encodableLength)));
        }
        remainder = combined.subarray(encodableLength);
      },
      flush(controller) {
        if (remainder.length > 0) {
          controller.enqueue(encodeBytesToBase64(remainder));
        }
      },
    });
  }
}

/**
 * Decodes a stream of base64 string (or byte) chunks back into raw bytes.
 * Whitespace/newlines in the input are ignored, so it's safe to feed it
 * base64 that's been split across lines.
 */
export class Base64DecodeStream extends TransformStream {
  constructor() {
    let remainder = '';
    const decoder = new TextDecoder();

    super({
      transform(chunk, controller) {
        const text = typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
        remainder += text.replace(/\s/g, '');

        const decodableLength = remainder.length - (remainder.length % 4);
        if (decodableLength > 0) {
          const group = remainder.slice(0, decodableLength);
          remainder = remainder.slice(decodableLength);
          const bytes = decodeBase64ToBytes(group);
          if (bytes.length > 0) controller.enqueue(bytes);
        }
      },
      flush(controller) {
        if (remainder.length > 0) {
          const bytes = decodeBase64ToBytes(remainder);
          if (bytes.length > 0) controller.enqueue(bytes);
        }
      },
    });
  }
}

/* ------------------------- Example usage -------------------------

// Encoding a file/blob to base64 text:
const response = await fetch('/some-binary-file');
const base64Stream = response.body.pipeThrough(new Base64EncodeStream());
for await (const chunk of base64Stream) {
  console.log(chunk); // base64 string pieces
}

// Round-tripping: bytes -> base64 -> bytes
const original = new TextEncoder().encode('Hello, streaming world!');
const readable = new ReadableStream({
  start(controller) {
    controller.enqueue(original.subarray(0, 5));
    controller.enqueue(original.subarray(5));
    controller.close();
  },
});

const decodedStream = readable
  .pipeThrough(new Base64EncodeStream())
  .pipeThrough(new TextEncoderStream())   // string -> bytes, so it can feed the decoder
  .pipeThrough(new Base64DecodeStream());

const reader = decodedStream.getReader();
const parts = [];
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  parts.push(value);
}
console.log(new TextDecoder().decode(concatUint8Arrays(parts)));
// -> "Hello, streaming world!"

--------------------------------------------------------------------- */