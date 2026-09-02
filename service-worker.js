import "./libs/zip.js";
import {rezipper, HeadersToOptions, progressTracker} from "./rezip.js";
import { parseJsonStream, streamToIterable } from "./libs/json-stream-es.mjs";
import mime from './libs/mime.min.js';
import { ReplaceStream } from "./replace-stream.js";

const CACHE_BASE = 'webapp-installer-';
const CACHE = CACHE_BASE + '2026-09-01';
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
  'libs/json-stream-es.mjs',
  'libs/fonts/bootstrap-icons.woff',
  'libs/fonts/bootstrap-icons.woff2',
  '404.html',
  '500.html',
  'folder.html',
  'rezip.js',
  'base64-stream.js',
  'replace-stream.js'
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

    var options;
    // Avoid problem where newly created request objects cannot have mode navigate
    var navigate = r.mode == "navigate";
    if (navigate) {
      options ??= {}
      options.mode = "same-origin";
    }
    // Put the right referrer if it is not there yet
    if (referrer != r.referrer) {
      options ??= {}
      options.referrer = referrer
    }
    // Fix problem where newly created requests cannot have auth info
    var auth = url.split("/")[2]?.split("@").slice(0,-1).join("@");
    if (auth) {
      options ??= {}
      options.headers ??= new Headers(r.headers);
      headers.set("Authorization", `Basic ${btoa(auth)}`)
      url = url.split("/");
      url[2] = url[2].split("@").slice(-1)[0];
      url = url.join("/");
    }
    // Fix problem where the signal added to a request is not passed on to the serviceworker
    var signal// = r.signal  // Doesn't work yet, not implemented that way in broswers, workaround needed
    if (r.headers.has("X-Abort-Controller")) {
      options ??= {}
      options.headers ??= new Headers(r.headers);
      var id = event.clientId + "#" + options.headers.get("X-Abort-Controller");
      var controller;
      if (uploadControllers.has(id)) {
        controller = uploadControllers.get(id);
      } else {
        controller = new AbortController();
        uploadControllers.set(id,controller);
      }
      signal = controller.signal;
      options.signal = signal;
      options.headers.delete("X-Abort-Controller")
    }
    try {
      if (options) r = new Request(r,options);
      if (url != r.url) r = new Request(url,r);
    } catch(e) {
      var body = r.body || await r.ArrayBuffer();
      const init = new Proxy(r, {
        get(target, prop) {
          if (prop == "body") return body
          return prop in options ? options[prop] : target[prop];
        },
      });
      if (url != r.url || options) r = new Request(url, init);
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
    let protocol = shared.slice(-2);
    if (protocol[0]?.endsWith(":") && !protocol[1]) {
      url.unshift(...protocol)
      base.unshift(...protocol)
      shared = shared.slice(0,-2)
    }
    var prefix = "";
    if (url[0]?.endsWith(":") && !url[1]) {
      if (url[0] == "https:") url[0] = "http:"
      prefix = "";
    } else if (base[0]?.endsWith(":") && !base[1]) {
      prefix = "http://localhost/"
    } else if (base.length > 1 && shared.length > 3) {
      prefix = "../".repeat(base.length - 1);
    } else if (base.length == 1 && shared.length > 3) {
      prefix = "./";
    } else if (shared.length > 3) {
      prefix = "";
    } else if (shared.length == 3) {
      prefix = "/"
    } else if (shared.length == 2) {
      prefix = "//"
    }
    url = prefix + url.join("/") + search + hash;

    base = shared.concat(base);
    if (auth) base[2] = auth + "@" + base[2]
    base = base.join('/')
  }
  if (typeof base === "string") base = new URL(base);
  let apppath = base.pathname.slice(BASE.pathname.length).split(AppExtRegEx)
  var last = apppath.pop();
  last = new URL(last,"http://localhost/");
  try {last = new URL(url,last);} catch(e) {last = new URL("http://localhost/")}
  if (last.username || last.password) {
    [base.username , base.password] = [last.username , last.password];
    last.username = last.password = "";
  }
  function validPath(path) {
      if (!/^[^\/]+:/.test(path)) return path;
      let p
      try {
        p = new URL(path.replace(/^https:/,"http:"),"http://localhost/");
      } catch(e) {
        return ""
      }
      if (p.username || p.password) {
          [base.username , base.password] = [p.username , p.password];
          p.username = p.password = ""
      }
      if (p.hostname == "localhost") return p.pathname.slice(1)
      if (p.pathname.endsWith("/") && !path.endsWith("/")) return p.origin + p.pathname.slice(0,-1) //
      return p
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
      url = input
    } else if (input instanceof Request) {
      url = new URL(input.url)
    } else {
      url = new URL(input)
    }
    if (options) {
      if (options.url == input && options instanceof Request) {
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
      input = new Request(url,input);
    }

    app = url.pathname.slice(BASE.pathname.length).split(AppExtRegEx).slice(0,-1);
    var cache = await caches.has(app.join("/") || CACHE);
    if (cache) cache = await caches.open(app.join("/") || CACHE);
    if (!cache) return errorpage(404,navigate ? app : null);

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
          } else if (responses.length > 0) {
            break; // Continue as if it's a normal file
          } else if (await caches.has(zippath.slice(0,-4))) {
            zippath = zippath.slice(0,-4);
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
          var filenames = new Set();
          var promises = files.map(f => {
            // Skip files and folders whose name starts with .
            if (("/" + f.url.slice((BASE + zippath).length)).split("#")[0].split("?")[0].indexOf("/.") != -1) return
            return cache.match(f)
            .then(response => HeadersToOptions(response))
            .then(([body, options, headers]) => {
              if (!options.uncompressedSize) {
                options.uncompressedSize = Number(headers.get("Content-Length")) || 0;
                options.compressionMethod = 0;
              }
              var encoding = headers.get("Content-Encoding")?.split(" ") || [];
              contentLength += Number(headers.get("Content-Length")) || 0;
              uncompressedSize += options.uncompressedSize;
              for (var i = 0; i < encoding.length; ++i) {
                if (encoding[i] == "zipjs") break;
                body = body.pipeThrough(new DecompressionStream(encoding[i]))
                encoding.splice(i,1);
                i--;
              }
              if (encoding.indexOf("zipjs") == -1) {
                options.compressionMethod = 0;
              } else {
                options.passThrough = true;
              }
              var filename = f.url.slice((BASE + zippath).length).split("#")[0].split("?")[0];
              if (filename.endsWith("/")) {
                filename += "index"
                if (headers.has("Content-Type")) filename += "." + mime.getExtension(headers.get("Content-Type"))
              }
              while (filenames.has(filename)) {
                // Add and increment enumerator for duplicate filenames
                filename = filename.split("/");
                let f = filename.pop();
                f = f.match(/^(.+?)(?: \((\d+)\))?(\.[^.]+)$/).slice(1);
                f[1] = Number(f[1] || 1) + 1;
                f = `${f[0]} (${f[1]})${f[2]}`
                filename.push(f);
                filename = filename.join("/");
              }
              filenames.add(filename);
              body.pipeTo(zipper.writable(filename,options));
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
              let path = url.pathname.slice((BASE.pathname + app.join("/")).length);
              if (navigate) {
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
                  if (path.length <= 1 && uri[0].endsWith(":")) uri[0] = uri.slice(0,3).join("/");
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
        if (response && response.headers.has("Content-Encoding") && app.length > 0) response = await rezipper(response,{password,signal}).catch(e => {
          if (e.message == zip.ERR_ENCRYPTED || e.message == zip.ERR_INVALID_PASSWORD) return errorpage(401,navigate ? app : null);
          console.error(e)
          return errorpage(500,navigate ? app : null);
        });
        if (response && navigate && response.body && response.headers.get("content-type")?.split(";")[0].toLowerCase() == "text/html") {
          // Make urls relative for navigations
          var matchfunc = (url => (match) => wURL(match,url))(url.toString());
          //replace absolute urls starting with http(s):// or //
          var abs_urls = /(?<="|')(?:http[s]?:)?\/\/(?:www\.)?[-a-zA-Z0-9@%._\+~#=]{2,256}\.[a-z]{2,6}\b(?:[-a-zA-Z0-9@:%_\+.~#?&\/\/=]*)(?="|')/gi
          var body = response.body.pipeThrough(new ReplaceStream(abs_urls,matchfunc))
          //replace relative urls in href or src positions
          var rel_urls = /(?<=\s(href|src)=("|'))\/(?:[-a-zA-Z0-9@:%_\+.~#?&\/\/=]*)?(?="|')/gi
          body = body.pipeThrough(new ReplaceStream(rel_urls,matchfunc))
          response = new Response(body,response);
        }
        if (response && navigate && response.body) {
          response?.headers.set("Content-Security-Policy", "child-src 'self'; connect-src 'self' http: https: blob:") // Prevent loading of external resources
          response?.headers.set("Referrer-Policy", "origin-when-cross-origin") // Prevent sharing the referrer externally
        }
        return response || errorpage(404,navigate ? app : null);
        break;
      case "HEAD":
        var response = await cache.match(input,{ignoreSearch: true, ignoreMethod: true, ignoreVary: true})
        if (!response) response = request(input,{method: "GET"});
        response.body.cancel(); // Cancel the whole readable stream
        return new Response(null,{status: response.status, statusText: response.statusText, headers: response.headers});
      case "PUT":
        var stream = input.body || (await input.blob()).stream();
        if (url.pathname.toLowerCase().endsWith(".zip") || url.pathname.toLowerCase().endsWith(".app")) {
          var progress = 0;
          var onprogress = async p => (await client).postMessage({received: p.received, progress: progress += p.received, url: input.url});
          cache.put(new Request(url,{method:"GET"}),new Response(null,{status:200,headers:input.headers}));
          var new_app = url.pathname.slice(BASE.pathname.length);
          var exists = await caches.delete(new_app);
          var new_cache = await caches.open(new_app);
          if (!Number(input.headers.get("X-Zipjs-Pass-Through") || "0")) {
            const zipReader = new zip.ZipReaderStream({passThrough: true});
            var promises = [];
            var limit = 100; // Limit the amount of promises that are processed simultaniously
            function addPromise(promise) {
                promises.push(promise);
                const cleanup = () => promises.splice(promises.indexOf(promise),1);
                promise.then(cleanup, cleanup)
            }
            for await (const entry of (stream.pipeThrough(zipReader))) {
              if (entry.directory) continue;
              if (entry.filename.startsWith(".") || entry.filename.indexOf("/.") != -1) continue
              if (promises.length >= limit) await Promise.any(promises)
              addPromise((entry => rezipper(entry,{onprogress,signal})
                .then(response => new_cache.put(BASE + new_app + "/" + entry.filename, response))
                .catch(e => console.warn(entry.filename,e))
              )(entry))
            }
            await Promise.all(promises)
          }
          if (exists) return new Response(null,{status:200,statusText:"OK",headers:{Location:url.href}})
          return new Response(null,{status:201,statusText:"Created",headers:{Location:url.href}})
        } else if (url.pathname.toLowerCase().endsWith(".har")) {
          var progress = 0;
          var onprogress = async p => (await client).postMessage({received: p.received, progress: progress += p.received, url: input.url});
          stream = stream.pipeThrough(progressTracker(onprogress,signal))
          cache.put(new Request(url,{method:"GET"}),new Response(null,{status:200,headers:input.headers}));
          var new_app = url.pathname.slice(BASE.pathname.length);
          var exists = await caches.delete(new_app);
          var new_cache = await caches.open(new_app);
          stream = stream.pipeThrough(new TextDecoderStream()).pipeThrough(parseJsonStream(["log","entries"]));
          for await (const entry of streamToIterable(stream)) {
            if (entry.request.url.toLowerCase().startsWith("data:")) continue;
            if (!entry.response.status) continue;
            if (entry.request.method != "GET") continue;
            try {
              entry.request.headers = entry.request.headers.reduce((a,b) => {if (b.name.startsWith(":")) return a; a[b.name.toLowerCase()] = b.value;return a},{})
              if (entry._priority) entry.request.priority = ({high:"high",highest:"high",low:"low"})[entry._priority.toLowerCase()] || "auto";
              if (entry.request.bodySize > 0) entry.request.headers["content-length"] = entry.request.bodySize;
              delete entry.request.bodySize;
              if (entry.request.postData?.text) {
                entry.request.body = new Blob([entry.request.postData.text],{type: entry.request.postData.mimeType})
                delete entry.request.postData
              }
              entry.request.url = wURL(entry.request.url,url.origin + url.pathname + "/");
              entry.request = new Request(entry.request.url,entry.request);
              entry.response.headers = entry.response.headers.reduce((a,b) => {if (b.name.startsWith(":")) return a; a[b.name.toLowerCase()] = b.value;return a},{})
              if (entry.response.content?.text) {
                entry.response.body = entry.response.content.text;
                var decode = (entry.response.content.encoding || "").toLowerCase().split(" ").filter(a => a); // This is how the text is currently encoded
                var encode = (entry.response.headers["content-encoding"] || "").toLowerCase().split(" ").filter(a => a); // This is how we want it to be encoded when saved
                while (decode[0] && encode[0] && encode[0] == decode[0]) { // Everything that is the same doesn't have to be redone
                  decode.shift();
                  encode.shift();
                }
                if (decode.length > 0) entry.response.body = (await rezipper(new Response(entry.response.body),new Headers({"content-encoding":decode.join(" ")}),true)).body;
                if (encode.length > 0) entry.response.body = (await rezipper(new Response(entry.response.body),new Headers({"content-encoding":encode.join(" ")}),false)).body;
                delete entry.response.content;
              }
              if (entry.response.status == 304) entry.response.status = 200; // This just means we got the response from cache for the HAR
              if (entry.response.status >= 300 && entry.response.status < 400 && entry.response.redirectURL) {
                entry.response.redirectURL = wURL(entry.response.redirectURL,entry.request.url);
                entry.response = Response.redirect(entry.response.redirectURL,entry.response.status);
              } else {
                entry.response = new Response(entry.response.body,entry.response);
              }
              await new_cache.put(entry.request,entry.response);
            } catch(e) {
              console.warn(entry.request.url,e)
            }
          }
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
            if (input.headers.has("Content-Encoding") && app.length > 0) {
              input.body = stream;
              res = await rezipper(input,{onprogress,signal});
            } else {
              stream = stream.pipeThrough(progressTracker(onprogress));
              res = new Response(stream,{headers:input.headers})
            }
            if (res.headers.has("X-Content-Length")) {
              res.headers.set("Content-Length",res.headers.get("X-Content-Length"))
              res.headers.delete("X-Content-Length")
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
        } else if (url.pathname.endsWith("/")) {
          var keys = (await cache.keys()).filter(k => k.url.startsWith(url.origin + url.pathname))
          exists = exists || keys.length > 0;
          Promise.all(keys.map(k => cache.delete(k)));
          var apps = (await caches.keys()).filter(k => APP_EXTS.indexOf(k.toLowerCase().split(".").slice(-1)[0]) != -1 && k.startsWith(url.pathname.slice(BASE.pathname.length)))
          exists = exists || apps.length > 0;
          Promise.all(apps.map(k => caches.delete(k)));
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
  if (response?.body) {
    body = response.body
    body = body.pipeThrough(new ReplaceStream(/<head( [^>]*)?>/i, `$&<base href="${encodeURI(url)}"/>`));
    if (status == 401) body = body.pipeThrough(/<\/body>/i,authscript + '$&');
  }
  if (status == 401 && !body) body = `<!DOCTYPE html><html><head>${authscript}</head><body></body></html>`;
  var headers = new Headers(response?.headers);
  headers.set("Content-Type","text/html");
  headers.set("Content-Security-Policy", "child-src 'self'; connect-src 'self' http: https: blob:") // Prevent loading of external resources
  headers.set("Referrer-Policy", "origin-when-cross-origin") // Prevent sharing the referrer externally
  return new Response(body,{status, statusText, headers})
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
