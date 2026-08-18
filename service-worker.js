import "./libs/zip.js";
import {rezipper, HeadersToOptions, progressTracker} from "./rezip.js";

const CACHE_BASE = 'webapp-installer-';
const CACHE = CACHE_BASE + '2026-08-17';
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
  'rezip.js',
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
        var [auth, host] = url[2].split("@");
        if (!host) [auth, host] = [host, auth];

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

const uploadControllers = new Map();
self.addEventListener('fetch', event => {
  var r = event.request;

  var referrer = r.referrer ? new URL(r.referrer) : "";
  event.respondWith((async () => {
    var client;
    if (event.clientId) client = self.clients.get(event.clientId) // still a promise;
    // Get client if the referrer is just the host, otherwise, empty promise
    // Don't get a referrer if there is none, we assume that is user navigation
    var r = event.request;
    if (referrer.pathname == "/") {
      referrer = (await client).url
    }
    var url = wURL(r.url,referrer);
    if (url != r.url && (r.method == "GET" || r.method == "HEAD")) return Response.redirect(url,302);

    var navigate = r.mode == "navigate";
    if (referrer != r.referrer) {
      r = new Request(r, {referrer})
    }
    if (url != r.url) r = new Request(url, r)

    var signal = r.signal  // Doesn't work yet, not implemented that way in broswers, workaround needed
    if (r.headers.has("X-Abort-Controller")) {
      var id = event.clientId + "#" + r.headers.get("X-Abort-Controller");
      var controller;
      if (uploadControllers.has(id)) {
        controller = uploadControllers.get(id);
      } else {
        controller = new AbortController();
        uploadControllers.set(id,controller);
      }
      signal = controller.signal;
    }
    return request(r, null, navigate, client, signal);
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.action?.toUpperCase() == "ABORT") {
    uploadControllers.get(event.source?.id + "#" + event.data.controller)?.abort();
    return
  } else if (event.data?.action?.toUpperCase() == "FINISH") {
    uploadControllers.delete(event.source?.id + "#" + event.data.controller);
  }
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
 * @param {Promise} [client] - The page that made the request, which can be reported back to
 * @param {AbortSignal} [signal] - The page that made the request, which can be reported back to
 * @returns {Response} The response to the request
 */
async function request(input, options, navigate=false, client, signal) {
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
          var contentLength = 0;
          var uncompressedSize = 0;
          var promises = files.map(f => {
            // Skip files and folders whose name starts with .
            if (("/" + f.url.slice((BASE + zippath).length)).split("#")[0].split("?")[0].indexOf("/.") != -1) return
            return cache.match(f)
            .then(response => HeadersToOptions(response))
            .then(([body, options, headers]) => {
              var encoding = headers.get("Content-Encoding")?.split(" ") || [];
              contentLength += Number(headers.get("Content-Length")) || 0;
              uncompressedSize += Number(headers.get("X-Zipjs-Uncompressed-Size")) || Number(headers.get("Content-Length")) || 0;
              for (var i = 0; i < encoding.length; ++i) {
                if (encoding[i] == "zipjs") break;
                body = body.pipeThrough(new DecompressionStream(encoding[i]))
                encoding.splice(i,1);
                i--;
              }
              options.passThrough = true;
              body.pipeTo(zipper.writable(f.url.slice((BASE + zippath).length),options));
            });
          });
          await Promise.all(promises);
          zipper.close();
          headers.set("Content-Length",contentLength);
          headers.set("uncompressedSize",uncompressedSize);
          var response = new Response(zipper.readable,{headers})
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
        } else if (responses.length == 0 && !url.pathname.toLowerCase().endsWith(".html" && url.pathname.split("/").slice(-1)[0].indexOf(".") == -1)) {
          var index_url = new URL(url)
          index_url.pathname += ".html";
          responses = await cache.matchAll(new Request(index_url,input),{ignoreSearch: true, ignoreMethod: true, ignoreVary: true});
        }
        var response = responses[0];
        if (response && response.headers.has("Content-Encoding")) response = await rezipper(response,{password,signal}).catch(e => {
          if (e.message == zip.ERR_ENCRYPTED || e.message == zip.ERR_INVALID_PASSWORD) return errorpage(401,navigate ? app : null);
          console.error(e)
          return errorpage(500,navigate ? app : null);
        });
        return response || errorpage(404,navigate ? app : null);
        break;
      case "HEAD":
        var response = await cache.match(input,{ignoreSearch: true, ignoreMethod: true, ignoreVary: true})
        if (!response) response = request(input,{method: "GET"});
        response.body.cancel(); // Cancel the whole readable stream
        return new Response(null,{status: response.status, statusText: response.statusText, headers: response.headers});
      case "PUT":
        var stream = input.body || (await input.blob()).stream();
        if (url.pathname.endsWith(".zip") || url.pathname.endsWith(".app")) {
          var progress = 0;
          var onprogress = async p => (await client).postMessage({received: p.received, progress: progress += p.received, url: input.url});
          cache.put(new Request(url,{method:"GET"}),new Response(null,{status:200,headers:input.headers}));
          var new_app = url.pathname.slice(BASE.pathname.length);
          var exists = await caches.delete(new_app);
          var new_cache = await caches.open(new_app);
          const zipReader = new zip.ZipReaderStream({passThrough: true});
          var promises = [];
          for await (const entry of (stream.pipeThrough(zipReader))) {
            if (entry.directory) continue;
            if (entry.filename.startsWith(".") || entry.filename.indexOf("/.") != -1) continue
            promises.push(((entry) => rezipper(entry,{onprogress,signal})
              .then(response => new_cache.put(BASE + new_app + "/" + entry.filename, response))
            )(entry))
          }
          await Promise.all(promises);
          if (exists) return new Response(null,{status:200,statusText:"OK",headers:{Location:url.href}})
          return new Response(null,{status:201,statusText:"Created",headers:{Location:url.href}})
        } else {
          var exists = await cache.delete(new Request(url,{method:"GET"})); // Delete the file if it already exists
          // Handle redirects
          var res;
          var redirectURL = input.headers.get("Location");
          if (redirectURL) {
            redirectURL = wURL(redirectURL,url);
            if (url != redirectURL) res = Response.redirect(redirectURL)
          }
          // Handle regular puts
          if (!res) {
            var onprogress = async p => (await client).postMessage({...p, url: input.url});
            if (input.headers.has("Content-Encoding")) {
              res = await rezipper(input,{onprogress,signal});
            } else {
              stream = stream.pipeThrough(progressTracker(onprogress));
              res = new Response(stream,{headers:headers || input.headers})
            }
          }
          await cache.put(new Request(url,{method:"GET"}), res)
          // Send responses
          if (exists) return new Response(null,{status:200,statusText:"OK",headers:{Location:url.href}})
          return new Response(null,{status:201,statusText:"Created",headers:{Location:url.href}})
        }
        return errorpage(501,navigate ? app : null); 
        break;
      case "DELETE":
        var exists = await cache.delete(new Request(url,{method:"GET"})); // Delete the file if it already exists
        if (url.pathname.endsWith(".zip") || url.pathname.endsWith(".app") || url.pathname.endsWith(".har")) {
          var zippath = url.pathname.slice(BASE.pathname.length);
          exists = (await caches.delete(zippath)) || exists;
        }
        if (exists) return new Response(null,{status:204,statusText:"No content"});
        return errorpage(404,navigate ? app : null);
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
    if (response.headers.has("Content-Encoding") && (status != 501 || !response.headers.has("X-ZipJS-Encrypted"))) {
      response = await rezipper(response).catch(e => {}); // If we cannot read it, just show no error page. 
      // We're not gonna give an error for the error page
    }
  }
  if (response) {
    body = new Uint8Array(await response.arrayBuffer());
    try {
      var decoder = new TextDecoder('utf-8', { fatal: true }); // Throws an error if not UTF-8 encoded, so the regular response can be used
      var text = decoder.decode(body);
      text = text.replace(/<head[^>]*>/i,`$&<base href="${encodeURI(url)}"/>`);
      if (status == 401) text = text.replace(/<\/body>/i,authscript + '$&');
      body = text;
    } catch(e) {console.warn(e)}
  }
  if (status == 401 && !body) body = `<!DOCTYPE html><html><head>${authscript}</head><body></body></html>`;
  var headers = new Headers(response?.headers);
  headers.set("Content-Type","text/html");
  headers.set("Content-Security-Policy", "child-src 'self'; connect-src 'self' http: https: blob:") // Prevent loading of external resources
  headers.set("Referrer-Policy", "origin-when-cross-origin") // Prevent sharing the referrer externally
  return new Response(body,{status: status, statusText: statusText, headers: headers})
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