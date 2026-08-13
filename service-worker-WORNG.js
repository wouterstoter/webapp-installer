importScripts("./libs/zip.js")
if (typeof TransformStream == "undefined") {
  script.src = "./libs/web-streams-polyfill.min.js";
}

const CACHE_BASE = 'webapp-installer-';
const CACHE = CACHE_BASE + '2026-08-09-6';
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
  'libs/web-streams-polyfill.min.js',
  'libs/fonts/bootstrap-icons.woff',
  'libs/fonts/bootstrap-icons.woff2',
  '404.html',
  '500.html'
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
  console.log(event);
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

      navigate = r.mode == "navigate";
      if (referrer != r.referrer) {
        r = new Request(r, {referrer: client.url})
      }
      if (url != r.url) r = new Request(url, r)

      return request(r, null, navigate)
    })
  );
});

self.addEventListener('message', (event) => {
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
    shared = [];
    // store auth seperately
    if (base[2].split("@").length == 2) [ auth, base[2] ] = base[2].split("@");
    if (url[2].split("@").length == 2) [ auth, url[2] ] = url[2].split("@");
    while (url.length > 0 && url[0] == base[0]) {
      shared.push(url[0])
      url = url.slice(1)
      base = base.slice(1)
    }
    var prefix;
    if (base.length > 1 && shared.length > 3) {
      prefix = "../".repeat(base.length - 1);
    } else if (base.length == 1 && shared.length > 3) {
      prefix = "./";
    } else if (shared.length > 3) {
      prefix = "";
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
    var cache = await caches.open(app.join("/") || CACHE);
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
        if (responses.length == 0 && url.pathname.endsWith("/")) {
          // Folder
          var index_url = new URL(url)
          index_url.pathname += "index.html";
          responses = await cache.matchAll(new Request(index_url,input),{ignoreSearch: true, ignoreMethod: true, ignoreVary: true});
        } else if (responses.length == 0 && !url.pathname.endsWith(".html")) {
          var index_url = new URL(url)
          index_url.pathname += ".html";
          responses = await cache.matchAll(new Request(index_url,input),{ignoreSearch: true, ignoreMethod: true, ignoreVary: true});
        }
        var response = responses[0];
        if (response) {
          var decompression = response.headers.get("Content-Encoding")
          if (decompression) {
            var body = response.body;
            decompression = decompression.split(" ");
            var headers = new Headers(response.headers);
            for (i = 0; i < decompression.length; ++i) {
              try {
                if (decompression[i] == "zip0" || decompression[i] == "zip8") {
                  var writeOptions = {passThrough: true};
                  if(response.headers.has("X-Content-Encryption")) writeOptions.encrypted = true;
                  switch (response.headers.get("X-Content-Encryption")) {
                    case "zipCrypto":
                      writeOptions.zipCrypto = true;
                      break;
                    case "AES1":
                    case "AES2":
                    case "AES3":
                      writeOptions.encryptionStrength = Number(response.headers.get("X-Content-Encryption").slice(-1))
                      break;
                  }
                  if (writeOptions.encrypted && !password) return errorpage(401,app);
                  writeOptions.uncompressedSize = Number(response.headers.get("Content-Length"));

                  headers.delete("X-Content-Encryption");
                  body = await jszipStream(body,writeOptions,{password: password}).catch(e => {
                    //if (e.message == zip.ERR_INVALID_PASSWORD) 
                    console.error(e);
                    return errorpage(401,app);
                  });

                  /*
                  var config = zip.getConfiguration();
                  console.log(zip.InflateStream)
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
                      console.log(e);
                    }
                  }
                  body = body.pipeThrough(new zip.InflateStream(inflateOptions, config));
                  while (decompression.indexOf("zip") != -1) decompression.splice(decompression.indexOf("zip"),1);
                  while (decompression.indexOf("zip64") != -1) decompression.splice(decompression.indexOf("zip64"),1);
                  while (decompression.indexOf("decrypt") != -1) decompression.splice(decompression.indexOf("decrypt"),1);*/
                } else {
                  body = body.pipeThrough(new DecompressionStream(decompression[i]))
                }
                decompression.splice(i,1);
                i--;
              } catch(e) {
                console.warn(`Failed ${decompression[i]} decompression on ${url}. Serving compressed file.`,e)
              }
            }
            if (decompression.length === 0) {
              headers.delete("Content-Encoding")
            } else {
              headers.set("Content-Encoding",decompression.join(" "))
            }
            response = new Response(body,{headers: headers, status: response.status, statusText: response.statusText})
          }
        }
        return response || errorpage(404,app);
        break;
      case "HEAD":
        var response = request(input,{method: "GET"});
        return new Response(null,{status: response.status, statusText: response.statusText, headers: response.headers});
      case "PUT":
        if (url.pathname.endsWith(".zip") || url.pathname.endsWith(".app")) {
          cache.put(new Request(url.href),new Response(null,{status:200,headers:input.headers}))
          var new_app = url.pathname.slice(BASE.pathname.length);
          var exists = await caches.delete(new_app);
          var new_cache = await caches.open(new_app);
          const zipFileReader  = new zip.BlobReader(await input.blob());
          const zipReader = new zip.ZipReader(zipFileReader);
          const entries = await zipReader.getEntries();
          var promises = entries.map(entry => {
            if (entry.directory) return;
            var headers = new Headers();
            if (entry.lastModDate) headers.set("Last-Modified",entry.lastModDate.toUTCString());
            if (entry.creationDate) headers.set("Date",entry.creationDate.toUTCString());
            if (entry.uncompressedSize) headers.set("Content-Length",entry.uncompressedSize);
            //headers.set("Content-Type",zip.getMimeType(entry.filename.split(".").slice(-1)[0]));
            if (entry.compressed || entry.encrypted) {
              headers.set("Content-Encoding","zip" + entry.compressionMethod);
              if (entry.encrypted) headers.set("X-Content-Encryption",entry.zipCrypto ? "zipCrypto" : "AES" + entry.extraFieldAES.strength);
            }
            var dataStream = new TransformStream();
            var response = new Response(dataStream.readable,{headers: headers});
            return Promise.all([
              entry.getData(dataStream.writable,{passThrough: true}),
              new_cache.put(BASE + new_app + "/" + entry.filename, response)
            ]);
          });
          await Promise.all(promises);
          await zipReader.close();
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
    body = new Uint8Array(await response.arrayBuffer());
    try {
      var decoder = new TextDecoder('utf-8', { fatal: true }); // Throws an error if not UTF-8 encoded, so the regular response can be used
      var text = decoder.decode(body);
      var html = (new DOMParser()).parseFromString(text, 'text/html');
      html.head.innerHTML += `<base href="${encodeURI(url)}"/></head>`;
      if (status = 401) html.body.innerHTML += authscript
      body = '<!DOCTYPE html>' + html.documentElement.outerHTML;
    } catch(e) {}
  }
  if (status == 401 && !body) body = `<!DOCTYPE html><html><head>${authscript}</head><body></body></html>`;
  var headers = new Headers(response?.headers);
  headers.set("Content-Type","text/html");
  headers.set("Content-Security-Policy", "child-src 'self'; connect-src 'self' http: https: blob:") // Prevent loading of external resources
  headers.set("Referrer-Policy", "origin-when-cross-origin") // Prevent sharing the referrer externally
  return new Response(body,{status: status, statusText: statusText, headers: headers})
}
/**
 * Get the error page of the app
 * @param {ReadableStream} inputStream - The stream you start with
 * @param {ZipWriterAddDataOptions} [writeOptions] - https://gildas-lormeau.github.io/zip.js/api/interfaces/ZipWriterAddDataOptions.html
 * @param {ZipReaderConstructorOptions} [readOptions] - https://gildas-lormeau.github.io/zip.js/api/classes/ZipReaderStream.html
 * @returns {ReadableStream} outputStream - The stream you end with
 * @returns {ZipWriterAddDataOptions} writeOptions - The write options to start the next one
 */
async function jszipStream(inputStream,writeOptions,readOptions) {
  const writerStream = new zip.ZipWriterStream();
  const readerStream = new zip.ZipReaderStream(readOptions);

  writerStream.readable.pipeTo(readerStream.writable);

  writerStream.zipWriter.add("file", inputStream, writeOptions)
    .then(() => writerStream.close())
    .catch(err => console.error("Failed to write:", err));

  const reader = readerStream.readable.getReader();
  const { value: entry } = await reader.read();

  var outputStream = entry.readable;
  if (entry.encrypted && readOptions.password) {
    // Check password
    var probe;
    [probe,outputStream] = outputStream.tee();
    const probeReader = probe.getReader();
    try {
      await probeReader.read();
    } finally {
      await probeReader.cancel().catch(() => {});
    }
  }
  return outputStream;
  return entry.readable
  return [ entry.readable , {
    passThrough: true,
    uncompressedSize: entry.uncompressedSize,
    encrypted: entry.encrypted,
    zipCrypto: entry.zipCrypto,
    encryptionStrength: entry.extraFieldAES.strength,
    compressionMethod: entry.compressionMethod,
    signature: entry.signature
  } ]
}/*
var inputStream = new Blob(["Hello world!"]).stream()
var [ middleStream, writerOptions ] = await jszipStream(inputStream,{password:"test",compressionMethod:0},{passThrough: true})
var [ outputStream, writerOptions2 ] = await jszipStream(middleStream, writerOptions,{password:"test"})
await new Response(outputStream).text()*/