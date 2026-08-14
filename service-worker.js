import mime from './libs/mime.min.js';
import "./libs/zip.js";

const CACHE_BASE = 'webapp-installer-';
const CACHE = CACHE_BASE + '2026-08-13';
const BASE = new URL(".",self.location.href);
const APP_EXTS = ["zip","har","app"]

const CACHE_URLS = [
  'favicon.ico',
  'favicon.svg',
  'favicon-16x16.png',
  'favicon-32x32.png',
  'favicon-48x48.png',
  'favicon-64x64.png',
  'favicon-128x128.png',
  'favicon-180x180.png',
  'favicon-192x192.png',
  'favicon-512x512.png',
	'index.html',
	'service-worker.js',
  'libs/bootstrap.bundle.min.js',
  'libs/bootstrap.min.css',
  'libs/bootstrap-icons.min.css',
  'libs/zip.js',
  'libs/mime.min.js',
  'libs/fonts/bootstrap-icons.woff',
  'libs/fonts/bootstrap-icons.woff2',
  '404.html',
  '500.html',
  'folder.html'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
    .then(cache => cache.addAll(CACHE_URLS))
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys()
    .then(keys => Promise.all(
      keys
      .filter(key => key.startsWith(CACHE_BASE) && key != CACHE)
      .map(key => caches.delete(key))
    ))
  );
  self.clients.claim()
});


// Intercept constructor to be less annoying
(() => {
  const OriginalRequest = globalThis.Request;

  globalThis.Request = new Proxy(OriginalRequest, {
    construct(target, args, newTarget) {
      let [a, b] = args;

      b ??= {};

      if (b.mode === "navigate") {
        b = new OriginalRequest(b, { mode: "same-origin" });
      } else if (a?.mode === "navigate" && !b.mode) {
        a = new OriginalRequest(a, { mode: "same-origin" });
      }

      let headers;

      if (a instanceof URL && (a.username || a.password)) {
        headers = new Headers(b.headers);
        headers.set(
          "Authorization",
          `Basic ${btoa(a.username + ":" + a.password)}`
        );

        a.username = "";
        a.password = "";
      } else if (
        a instanceof OriginalRequest ||
        (typeof a === "string" && URL.canParse(a))
      ) {
        const url = (a.url || a).split("/");
        const [auth, host] = url[2].split("@");

        url[2] = host;
        a = url.join("/");

        if (auth) {
          headers = new Headers(b.headers);
          headers.set("Authorization", `Basic ${btoa(auth)}`);
        }
      }

      if (headers) {
        if (b instanceof OriginalRequest) {
          b = new OriginalRequest(b, { headers });
        } else {
          b = { ...b, headers };
        }
      }

      return Reflect.construct(target, [a, b], newTarget);
    }
  });
})();


self.addEventListener('fetch', event => {
  var r = event.request;
  var referrer = r.referrer ? new URL(r.referrer) : ""
  event.respondWith(
    // Get client if the referrer is just the host, otherwise, empty promise
    // Don't get a referrer if there is none, we assume that is user navigation
    (event.clientId && (referrer.pathname == "/") ? self.clients.get(event.clientId) : new Promise(resolve => resolve()))
    .then((client) => {
      var r = event.request;
      var referrer = client?.url || r.referrer;
      var url = wURL(r.url,referrer);
      if (url != r.url && (r.method == "GET" || r.method == "HEAD")) return Response.redirect(url,302);

      var navigate = r.mode == "navigate";
      if (referrer != r.referrer) {
        r = new Request(r, {referrer: client.url})
      }
      if (url != r.url) r = new Request(url, r)

      return request(r, null, navigate)
    })
  );
});

self.addEventListener('message', (event) => {
  var url = event.source.url.split('#')[0].split("?")[0];
  var app = url.slice(BASE.href.length).split(AppExtRegEx)
  if (app.length > 1) return;
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

let AppExtRegEx = new RegExp("(?<=\\.(?:" + APP_EXTS.map(RegExp.escape).join("|") + "))\/","gi")
function wURL(url,base) {
  base = base || BASE;
  if (!(base instanceof URL || URL.canParse(base))) base = wURL(base, BASE);

  // Convert absolute URL to relative URL
  var auth = "";
  var search = "";
  var hash = "";
  if (url instanceof URL || URL.canParse(url)) {
    url = url.toString();
    base = base.toString();

    // store hash and search seperately
    let h = url.indexOf("#");
    if (h != -1) {
      hash = url.slice(h);
      url = url.slice(0,h);
    }
    let s = url.indexOf("#");
    if (s != -1) {
      search = url.slice(s);
      url = url.slice(0,s);
    }
    url = url.split("/");
    base = base.split("/");
    var shared = [];
    // store auth seperately
    if (base[2].split("@").length == 2) [ auth, base[2] ] = base[2].split("@");
    if (url[2].split("@").length == 2) [ auth, url[2] ] = url[2].split("@");
    while (url.length > 0 && url[0] == base[0]) {
      shared.push(url[0])
      url = url.slice(1)
      base = base.slice(1)
    }
    var prefix = "";
    if (base.length > 1 && shared.length > 3) {
      prefix = "../".repeat(base.length - 1);
    } else if (base.length == 1 && shared.length > 3) {
      prefix = "./";
    } else if (shared.length > 3) {
      prefix = "";
    } else if (shared.length == 2) {
      prefix = "/"
    } else if (shared.length == 2) {
      prefix = "//"
    } else if (url[0] == "https:") (
      url[0] = "http:"
    )
    url = prefix + url.join("/") + search + hash;

    base = shared.concat(base);
    if (auth) base[2] = auth + "@" + base[2]
    base = base.join('/')
  }
  if (typeof base === "string") base = new URL(base);
  let apppath = base.pathname.slice(BASE.pathname.length).split(AppExtRegEx)
  var last = apppath.pop();
  last = new URL(last,"http://localhost/");
  last = new URL(url,last);
  if (last.username || last.password) {
    [base.username , base.password] = [last.username , last.password];
    last.username = last.password = "";
  }
  function validPath(path) {
      if (!/^[^\/]+:/.test(path)) return path;
      let p = new URL(path.replace(/^https:/,"http:"),"http://localhost/");
      if (p.username || p.password) {
          [base.username , base.password] = [p.username , p.password];
          p.username = p.password = ""
      }
      return p.hostname == "localhost" ? p.pathname.slice(1) : p
  }
  last.pathname = "/" + last.pathname.slice(1).split(AppExtRegEx).map(validPath).join("/");
  last = last.hostname == "localhost" ? last.href.slice(last.origin.length + 1) : last.href;
  apppath.push(last)
  
  base.search = base.hash = "";
  base.pathname = BASE.pathname
  return base.href + apppath.join("/");
}

/**
 * Resolve an request from cache
 * @param {URL | String | Request} input - The destination of the request
 * @param {RequestInit | Request | null} [options] - Additional options for the request
 * @param {Boolean} [navigate=false] - Indicates that the request is a navigation
 * @returns {Response} The response to the request
 */
async function request(input, options, navigate=false) {
  var app;
  try {
    let url;
    if (input instanceof URL) {
      url = new URL(url)
    } else if (input instanceof Request) {
      url = new URL(input.url)
    } else {
      url = new URL(input)
    }
    if (options) {
      if (options.url == input) {
        input = options
      } else {
        input = new Request(input,options);
      }
    }
    // Get username and password back
    var username, password;
    var auth = input.headers.get("Authorization");
    if (auth && auth.startsWith("Basic ")) {
      [username , password] = atob(auth.slice("Basic ".length)).split(":")
    }
    if (url.username || url.password) {
      [username , password] = [ url.username, url.password ]
      url.username = url.password = ""
      input = new Request(input);
    }

    app = url.pathname.slice(BASE.pathname.length).split(AppExtRegEx).slice(0,-1);
    var cache = await caches.has(app.join("/") || CACHE);
    if (cache) cache = await caches.open(app.join("/") || CACHE);
    if (!cache && !navigate) return errorpage(404);
    while (!cache) {
      // If the whole app cannot be found, give the 404 page of the parent app that can be found
      app = app.slice(0,-1);
      cache = await caches.has(app.join("/") || CACHE);
      if (cache) return errorpage(404,app);
    }

    switch (input.method) {
      case "GET":
        var responses = await cache.matchAll(input,{ignoreSearch: true, ignoreMethod: true, ignoreVary: true})
        if (url.pathname.toLowerCase().endsWith(".zip")) {
          var zippath = url.pathname.slice(BASE.pathname.length);
          var files;
          if (await caches.has(zippath)) {
            cache = await caches.open(zippath);
            files = await cache.keys();
            zippath += "/";
          } else {
            zippath = zippath.slice(0,-4) + "/";
            files = (await cache.keys()).filter(r => r.url.startsWith(BASE + zippath));
            if (files.length == 0) return errorpage(404,navigate ? app : null);
          }
          const zipper = new zip.ZipWriterStream();
          var headers = new Headers(responses[0]?.headers);
          headers.set("Content-Type","application/zip");
          var response = new Response(zipper.readable,{headers})
          var promises = files.map(f => {
            // Skip files and folders whose name starts with .
            if (("/" + f.url.slice((BASE + zippath).length)).split("#")[0].split("?")[0].indexOf("/.") != -1) return
            return cache.match(f)
            .then(response => {
              var body = response.body;
              var encoding = response.headers.get("Content-Encoding")?.split(" ") || [];
              for (var i = 0; i < encoding.length; ++i) {
                if (encoding[i] == "zip" || encoding[0] == "zip64") break;
                body = body.pipeThrough(new DecompressionStream(encoding[i]))
                encoding.splice(i,1);
                i--;
              }
              var options = headersToOptions(response.headers);
              options.passThrough = true;
              console.log(options);
              body.pipeTo(zipper.writable(f.url.slice((BASE + zippath).length),options));
            });
          });
          await Promise.all(promises);
          zipper.close();
          return response;
        }
        if (responses.length == 0 && url.pathname.endsWith("/")) {
          // Folder
          var index_url = new URL(url)
          index_url.pathname += "index.html";
          responses = await cache.matchAll(new Request(index_url,input),{ignoreSearch: true, ignoreMethod: true, ignoreVary: true});
          // Show folder list
          if (responses.length == 0) {
            var files = (await cache.keys()).filter(r => r.url.startsWith(url.origin + url.pathname))
            if (files.length == 0) return errorpage(404,navigate ? app : null);
            var stream = streamFromGenerator((async function* () {
              var encoder = new TextEncoder();
              if (navigate) {
                var text = await caches.match(BASE + "folder.html",{cacheName:CACHE})
                for await (const chunk of text.body) {
                  yield chunk;
                }
              } else {
                yield encoder.encode("200: filename content-length last-modified file-type")
              }
              if (navigate) {
                let path = url.pathname.slice((BASE.pathname + app.join("/")).length);
                yield encoder.encode(`<script>start(${JSON.stringify(app.slice(-1) + path)});</script>`);
                if (path.length > 1) yield encoder.encode(`<script>onHasParentDirectory();</script>`);
              }
              files = files.map(r => {
                let uri = r.url.slice((url.origin + url.pathname).length);
                let hash = uri.indexOf("#");
                if (hash != -1) {[uri, hash] = [uri.slice(0,hash),uri.slice(hash)];} else {hash = ""}
                let search = uri.indexOf("?");
                if (search != -1) {[uri, search] = [uri.slice(0,search),uri.slice(search)];} else {search = ""}
                uri = uri.split("/");
                if (uri.length > 1) {
                  hash = search = "";
                  uri[0] += "/";
                }
                return uri[0] + search + hash;
              }).filter(r => !r[0].startsWith(".")); // Hide dotfiles
              files = [...new Set(files)].sort().sort((a,b) => b.toLowerCase() > a.toLowerCase() ? -1 : 1).sort((a,b) => b.endsWith("/") - a.endsWith("/"));
              for (var f = 0; f < files.length; ++f) {
                let file;
                if (!files[f].endsWith("/")) {
                  file = await cache.match(url.origin + url.pathname + files[f]);
                } else {
                  files[f] = files[f].slice(0,-1);
                }
                var contentLength = Number(file?.headers?.get("Content-Length")) || 0;
                var lastModified = file?.headers?.get("Last-Modified");
                if (lastModified) lastModified = new Date(lastModified);
                if (navigate) {
                  function bytesToString(bytes) {
                    var txt = ["B","kB","MB","GB","TB"]
                    while (bytes / 1024 > 1 && txt.length > 1) {
                      bytes = bytes / 1024;
                      txt.shift();
                    }
                    return (Math.round(bytes*10)/10).toLocaleString() + " " + txt[0]
                  }
                  yield encoder.encode(`<script>addRow(${JSON.stringify(files[f])},${JSON.stringify(files[f])},${Number(!file)},${contentLength},${JSON.stringify(bytesToString(contentLength))},${Number(lastModified)},${JSON.stringify(lastModified?.toLocaleString()||"")});</script>`);
                } else {
                  yield encoder.encode(`\r\n201: ${encodeURI(files[f])} ${contentLength || 0} ${encodeURI((lastModified || new Date()).toUTCString())} ${!file ? "DIRECTORY" : "FILE"}`)
                }
              }
            })());
            return new Response(stream,{headers:{"Content-Type":navigate ? "text/html" : "text/plain"}});
          }
        } else if (responses.length == 0 && !url.pathname.toLowerCase().endsWith(".html")) {
          var index_url = new URL(url)
          index_url.pathname += ".html";
          responses = await cache.matchAll(new Request(index_url,input),{ignoreSearch: true, ignoreMethod: true, ignoreVary: true});
        }
        var response = responses[0];
        if (response) response = await deCrompressResponse(response,password,url,app);
        return response || errorpage(404,navigate ? app : null);
        break;
      case "HEAD":
        var response = await cache.match(input,{ignoreSearch: true, ignoreMethod: true, ignoreVary: true})
        if (!response) response = request(input,{method: "GET"});
        return new Response(null,{status: response.status, statusText: response.statusText, headers: response.headers});
      case "PUT":
        if (url.pathname.endsWith(".zip") || url.pathname.endsWith(".app")) {
          cache.put(new Request(url.href,{headers:input.headers}),new Response(null,{status:200,headers:input.headers}));
          var new_app = url.pathname.slice(BASE.pathname.length);
          var exists = await caches.delete(new_app);
          var new_cache = await caches.open(new_app);
          const zipReader = new zip.ZipReaderStream({passThrough: true});
          const zipStream = input.body || (await input.blob()).stream();
          for await (const entry of (zipStream.pipeThrough(zipReader))) {
            if (entry.directory) continue;
            if (entry.filename.startsWith(".") || entry.filename.indexOf("/.") != -1) continue
            var headers = entryToHeaders(entry);
            var response = new Response(entry.readable,{headers});
            await new_cache.put(BASE + new_app + "/" + entry.filename, response)
          }
          if (exists) return new Response(null,{status:200,statusText:"OK",headers:{Location:url.href}})
          return new Response(null,{status:201,statusText:"Created",headers:{Location:url.href}})
        }
        return errorpage(501,navigate ? app : null); 
        break;
      default:
        return errorpage(405,navigate ? app : null);
    }
  } catch(e) {
    console.error(e, input);
    return errorpage(500,navigate ? app : null);
  }
}

/**
 * Get the error page of the app
 * @param {number} status - The statuscode of the error
 * @param {Array | String} [app] - The app the error occured in
 * @returns {Response} The error page
 */
async function errorpage(status,app) {
  var statusText = ({
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not found",
    405: "Method Not Allowed",
    500: "Internal Server Error",
    501: "Not Implemented"
  })[status];
  if (typeof app == "undefined") return new Response(null,{status: status, statusText: statusText})
  if (app instanceof Array) app = app.join("/");
  var url = BASE + (app ? app + "/" : "") + status + ".html"
  var response = await caches.match(url, {cacheName: app || CACHE})
  var authscript = `<script>
    var password = window.prompt("Password");
    if (password) {
      var url = new URL(document.location.href);
      url.password = password;
      document.location.href = url;
    }
  </script>`
  var body
  if (response) {
    // Only process decompression if not encrypted for 501, since no password is known.
    if (status != 501 || !response.headers.has("X-Content-Encryption")) response = await deCrompressResponse(response,null,url);
    body = new Uint8Array(await response.arrayBuffer());
    try {
      var decoder = new TextDecoder('utf-8', { fatal: true }); // Throws an error if not UTF-8 encoded, so the regular response can be used
      var text = decoder.decode(body);
      text = text.replace(/<head[^>]*>/i,`$&<base href="${encodeURI(url)}"/>`);
      if (status == 401) text = text.replace(/<\/body>/i,authscript + '$&');
      body = text;
    } catch(e) {console.log(e)}
  }
  if (status == 401 && !body) body = `<!DOCTYPE html><html><head>${authscript}</head><body></body></html>`;
  var headers = new Headers(response?.headers);
  headers.set("Content-Type","text/html");
  headers.set("Content-Security-Policy", "child-src 'self'; connect-src 'self' http: https: blob:") // Prevent loading of external resources
  headers.set("Referrer-Policy", "origin-when-cross-origin") // Prevent sharing the referrer externally
  return new Response(body,{status: status, statusText: statusText, headers: headers})
}

/**
 * Decrypt/decompress response
 * @param {Response} response - The response to decrypt/decompress
 * @param {string} [password] - The password to decrypt with
 * @param {Response} [url] - The url, only needed for clear error logging
 * @param {Response} [app] - The app, only needed to serve the right error page
 * @returns {Response} The decrypted/decompressed response
 */
async function deCrompressResponse(response,password,url,app) {
  if (response.headers.has("Content-Encoding") || response.headers.has("X-Content-Encryption")) {
    var body = response.body;
    var decompression = response.headers.get("Content-Encoding").split(" ");
    if (response.headers.has("X-Content-Encryption")) decompression.push("decrypt");
    for (var i = 0; i < decompression.length; ++i) {
      try {
        if (decompression[i] == "zip" || decompression[i] == "zip64" || decompression[i] == "decrypt") {
          var config = zip.getConfiguration();
          var inflateOptions = headersToOptions(response.headers);
          if (inflateOptions.encrypted && !password) return errorpage(401,app);
          if (password) inflateOptions.password = password;
          if (inflateOptions.encrypted) {
            //Check password
            var probe 
            [probe, body] = body.tee();
            try {
              probe = probe.pipeThrough(new zip.InflateStream(inflateOptions, config));
              const reader = probe.getReader();
              await reader.read(); // throws here if the password is wrong
              await reader.cancel(); // don't bother reading the rest
            } catch(e) {
              if (e.message == zip.ERR_INVALID_PASSWORD) return errorpage(401,app);
              console.error(e);
            }
          }
          body = body.pipeThrough(new zip.InflateStream(inflateOptions, config));
          while (decompression.indexOf("zip") != -1) decompression.splice(decompression.indexOf("zip"),1);
          while (decompression.indexOf("zip64") != -1) decompression.splice(decompression.indexOf("zip64"),1);
          while (decompression.indexOf("decrypt") != -1) decompression.splice(decompression.indexOf("decrypt"),1);
          i--;
        } else {
          body = body.pipeThrough(new DecompressionStream(decompression[i]))
          decompression.splice(i,1);
          i--;
        }
      } catch(e) {console.warn(`Failed ${decompression[i]} decompression on ${url}. Serving compressed file.`,e)}
    }
    var headers = new Headers(response.headers)
    if (decompression.length === 0) {
      headers.delete("Content-Encoding")
    } else {
      headers.set("Content-Encoding",decompression.join(" "))
    }
    return new Response(body,{headers: headers, status: response.status, statusText: response.statusText})
  } else {
    return response;
  }
}

/**
 * Create a readable stream from a generator
 * @param {Iterable} gen - The generator
 * @returns {ReadableStream} The stream
 */
function streamFromGenerator(gen) {
  return new ReadableStream({
    async pull(controller) {
      const { value, done } = await gen.next();
      if (done) {
        controller.close();
      } else {
        controller.enqueue(value);
      }
    },
    cancel(reason) {
      return gen.return(reason);
    }
  });
}

/**
 * Create headers with the right metadata fields from a zip entry
 * @param {zip.Entry} entry - The generator
 * @param {Headers} [headers] - Headers to start with
 * @returns {Headers} The headers for the response
 */
function entryToHeaders(entry,headers) {
  headers = new Headers(headers || {});
  headers.set("Last-Modified",(entry.lastModDate || new Date()).toUTCString());
  headers.set("Date",(entry.creationDate || new Date()).toUTCString());
  if (entry.uncompressedSize) headers.set("Content-Length",entry.uncompressedSize);
  headers.set("Content-Type",mime.getType(entry.filename));
  if (entry.compressionMethod === 8) headers.set("Content-Encoding",entry.zip64 ? "zip64" : "zip");
  if (entry.signature) headers.set("X-Content-Signature",entry.signature);
  if (entry.encrypted) headers.set("X-Content-Encryption",entry.zipCrypto ? "zipCrypto" : "AES" + entry.extraFieldAES.strength);
  return headers;
}
/**
 * Create headers with the right metadata fields from a zip entry
 * @param {Headers} [headers] - Headers of the response
 * @returns {zip.ZipWriterAddDataOptions} The options to add this file to a zip
 */
function headersToOptions(headers) {
  // Some options have a different name in the InflateStream options than the ZipWriter options. 
  // In those cases i'll add both for extra compatibility
  var encoding = headers.get("Content-Encoding")?.split(" ") || [];
  return {
    //passThrough:true, // ZipWriter Only
    //passwordVerification: false, // Inflate Only
    useCompressionStream: typeof CompressionStream === "function", // Inflate Only
    uncompressedSize: headers.has("Content-Length") ? Number(headers.get("Content-Length")) : undefined, // ZipWriter Only
    outputSize: headers.has("Content-Length") ? Number(headers.get("Content-Length")) : undefined, // Inflate Only
    encrypted: headers.has("X-Content-Encryption"),
    compressed: encoding.indexOf("zip") != -1 || encoding.indexOf("zip64") != -1, // Inflate Only
    compressionMethod: encoding.indexOf("zip") == -1 && encoding.indexOf("zip64") == -1 ? 0 : 8,
    zip64: encoding.indexOf("zip64") != -1, // ZipWriter Only
    deflate64: encoding.indexOf("zip64") != -1,
    signed: headers.has("X-Content-Signature"), // Inflate Only
    signature: Number(headers.get("X-Content-Signature")) || undefined,
    zipCrypto: headers.get("X-Content-Encryption") == "zipCrypto",
    encryptionStrength: Number(headers.get("X-Content-Encryption")?.replace("AES","")) || undefined,
    lastModDate: new Date(headers.get("Last-Modified") || new Date()), // ZipWriter Only
    creationDate: new Date(headers.get("Date") || new Date()) // ZipWriterOnly
  }
}