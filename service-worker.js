import * as fflate from './fflate.mjs';

const CACHE = 'webapp-installer';
const base = new URL(".",self.location.href);
const app_exts = ["zip","har","app"]

const CACHE_URLS = [
	'index.html',
  'favicon.svg',
  'favicon-16x16.png',
  'favicon-32x32.png',
  'favicon-512x512.png',
  'fflate.mjs',
  'service-worker.js'
];
const mimes = {
  "html": "text/html",
  "js": "text/javascript",
  "css": "text/css",
  "svg": "image/svg+xml"
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(CACHE_URLS))
      .then(self.skipWaiting())
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(self.clients.claim()); // Become available to all pages
});

self.addEventListener('fetch', event => {  
  event.respondWith(new Promise(resolve => {(
    event.clientId ? self.clients.get(event.clientId) : new Promise(resolve => resolve())) // Get client if there is one, otherwise, empty promise
    .then((client) => {
      var r = event.request;
      // Make sure the referrer is always the full url
      if (r.referrer.length < client?.url.length && client.url.startsWith(r.referrer)) {
        r = new Request(r, {
          referrer: client.url,
          mode: r.mode == "navigate" ? "same-origin" : r.mode
        })
      }
      resolve(request(r));
    })
  }));
});

function relativeURL(url,referrer) {
  if (!referrer) referrer = base.href;
  var app_base = appFromURL(referrer)
  if (app_base) app_base += "/";
  var url = (function recursive(url,referrer) {
    url = new URL(url,referrer);
    if (!url.href.startsWith(base.href)) {
       // Resolve case differences in base
      if (url.href.toLowerCase().startsWith(base.href.toLowerCase())) return recursive(base.href + url.href.slice(base.href.length),referrer);
      // Resolve external urls
      if (!url.href.startsWith(base.origin + "/")) return recursive(base.href + app_base + url.href,referrer);
      // Resolve relative urls
      var target;
      try {
        target = (new URL(url.href.slice(url.origin.length),referrer.slice((base.href + app_base).length))).href
      } catch(e) {
        target = url.pathname.slice(1);
      }
      return recursive(base.href + app_base + target,referrer);
    }
    // Replace all instances of https in the pathname with http
    if (url.pathname.toLowerCase().indexOf("/https:/") != -1) {
      url.pathname = url.pathname.replaceAll("/https:/","/http:/")
      return recursive(url.href,referrer);
    }
    return url;
  })(url,referrer)
  return url;
}
function appFromURL(url) {
  if (!url.toLowerCase().startsWith(base.href.toLowerCase())) return "";
  var app_base = url.slice(base.href.length);
  var first = true;
  while (app_base.length > 0 && (first || !app_exts.some(ext => app_base.toLowerCase().endsWith("." + ext)))) {
    app_base = app_base.split("/").slice(0,-1).join("/");
    first = false;
  }
  return app_base
}

async function request(input, options) {
  try {
    var url = typeof input === "string" ? input : input.url;
    if (!(input instanceof Request)) {
      if (input instanceof Request && input.mode == "navigate") input = new Request(input,{mode:"same-origin"}) // avoid the fact that no requests can be created with mode navigate
      if (options instanceof Request && options.mode == "navigate") options = new Request(options,{mode:"same-origin"})
      input = new Request(input,options);
    }
    // Resolve URL issues
    url = relativeURL(url,input.referrer);
    if (url.href != input.url && (input.method == "GET" || input.method == "HEAD")) return Response.redirect(url.href,302);
    
    console.log(url.href,input);

    // Reject any request that tries to access an app other than themselves or their children
    var parentApp = appFromURL(input.referrer);
    var childApp = appFromURL(url.href);
    if (!childApp.startsWith(parentApp)) return new Response(null,{status:403,statusText:"Forbidden"});
    // Open cache
    var cache; // Let's us know if we're in the top level application
    if (input.method == "PUT" || !childApp || await caches.has(childApp)) {
      cache = await caches.open(childApp || CACHE); // Open the cache if it exists or should be created
    }
    
    if (cache) {
      if (url.pathname.toLowerCase().endsWith(".har")) {
        if (input.method == "PUT") {
          var har = await input.json();
          cache.put(new Request(url.href),new Response(null,{status:200}))
          var new_app = url.pathname.slice(base.pathname.length);
          var exists = await caches.delete(new_app);
          function harHeaders(headers) {
            var output = new Headers();
            for (var h in headers) {
              if (headers[h].name.startsWith(":")) continue;
              output.append(headers[h].name,headers[h].value);
            }
            return output
          }
          
          var promises = har.log.entries.map(e => {
            if (!e.response.status) return
            if (e.request.method != "GET" && e.request.method != "POST") return
            if (e.request.url.startsWith("data:")) return
            
            var res_body = e.response.content;
            if (res_body && res_body.text) {
              if (res_body.encoding == "base64") {
                try {
                  var encoded = atob(res_body.text)
                } catch(e) {
                  var encoded = res_body.text
                }
                var n = encoded.length;
                res_body.text = new Uint8Array(n);
                while(n--){
                    res_body.text[n] = encoded.charCodeAt(n);
                }
              }
              res_body = new Blob([res_body.text],{type: res_body.mimeType})
            } else {res_body = null}
            return request(e.request.url,{
              method: "PUT",
              headers: harHeaders(e.response.headers),
              body: res_body,
              referrer: base.href + new_app + "/"
            });
          })
          await Promise.all(promises);
          
          if (exists) return new Response(null,{status:200,statusText:"OK",headers:{Location:url.href}})
          return new Response(null,{status:201,statusText:"Created",headers:{Location:url.href}})
        } else if (input.method == "DELETE") {
          await cache.delete(new Request(input,{method:"GET"}));
          var exists = await caches.delete(url.href.slice(base.href.length));
          if (exists) return new Response(null,{status:204,statusText:"No content"});
        } else if (input.method == "GET") {
          var har = {
            "log": {
              "version": "1.2",
              "creator": {
                "name": "WebApp Installer"
              },
              "browser": navigator.userAgent.split(" ").slice(-1).map(a => {return {"name": a.split("/")[0], "version": a.split("/")[1]}})[0],
              "pages":[],
              "entries":[]
            }
          }
          return new Response(JSON.stringify(har),{headers: {"content-type":"application/json"}})
        } else {
          return new Response(null,{status:405,statusText:"Method Not Allowed"})
        }
      } else if (url.pathname.toLowerCase().endsWith(".zip") || url.pathname.toLowerCase().endsWith(".app")) {
        if (input.method == "PUT") {
          cache.put(new Request(url.href),new Response(null,{status:200}))
          var new_app = url.pathname.slice(base.pathname.length);
          var exists = await caches.delete(new_app);
          var pendingFiles = 0;
          await new Promise(async resolve => {
            var unzipper = new fflate.Unzip(file => {
              if (file.name.endsWith("/")) return //skip folders
              pendingFiles++;
              var chunks = [];
              file.ondata = (err, chunk, final) => {
                if (err) console.error(err);
                if (chunk) chunks.push(chunk)
                if (final) {
                  const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
                  const result = new Uint8Array(size);
                  let offset = 0;
                  for (const chunk of chunks) {
                    result.set(chunk, offset);
                    offset += chunk.length
                  }
                  
                  request(file.name, {
                    method: 'PUT',
                    headers:{
                      "Content-length": size
                    },
                    body: result,
                    referrer: base.href + new_app + "/"
                  }).then(() => {
                    pendingFiles--;
                    if (pendingFiles == 0) resolve();
                  });
                }            
              };
              file.start();
            });
            unzipper.register(fflate.UnzipInflate);
            const reader = (await input.blob()).stream().getReader();
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                unzipper.push(new Uint8Array(0), true);
                if (pendingFiles == 0) resolve();
                break;
              }
              unzipper.push(value);
            }
          })
          if (exists) return new Response(null,{status:200,statusText:"OK",headers:{Location:url.href}})
          return new Response(null,{status:201,statusText:"Created",headers:{Location:url.href}})
        } else if (input.method == "DELETE") {
          await cache.delete(new Request(input,{method:"GET"}));
          var exists = await caches.delete(url.href.slice(base.href.length));
          if (exists) return new Response(null,{status:204,statusText:"No content"});
        } else {
          return new Response(null,{status:405,statusText:"Method Not Allowed"})
        }
      }
      
      if (input.method == "GET" || input.method == "HEAD") {
        var response;
        if (!childApp && navigator.onLine && CACHE_URLS.indexOf(url.href.slice(base.href.length)) != -1) {
          // Always get the most up to date version of the main app if there is internet access, and save it in cache
          response = await fetch(input.clone());
          if (input.method == "GET") {
            await cache.delete(input.clone());
            if (response.status >= 200 && response.status < 400) cache.put(input,response.clone());
          }
        } else {
          // Always get the installed apps fully from chace, 
          var ignoreMethod = true;
          var ignoreSearch = true;
          var ignoreVary = true;
          response = await cache.matchAll(new Request(input,{method:"GET"}), {ignoreSearch: ignoreSearch, ignoreMethod: ignoreMethod, ignoreVary: ignoreVary});
          if (response.length > 1) {
            response = await cache.matchAll(new Request(input,{method:"GET"}), {ignoreSearch: ignoreSearch, ignoreMethod: false, ignoreVary: ignoreVary});
            var ignoreMethod = response.length == 0
          }
          if (response.length > 1) {
            response = await cache.matchAll(new Request(input,{method:"GET"}), {ignoreSearch: false, ignoreMethod: ignoreMethod, ignoreVary: ignoreVary});
            var ignoreSearch = response.length == 0
          }
          if (response.length > 1) {
            response = await cache.matchAll(new Request(input,{method:"GET"}), {ignoreSearch: ignoreSearch, ignoreMethod: ignoreMethod, ignoreVary: false});
            var ignoreVary = response.length == 0
          }
          if (response.length > 1) return new Response(null,{status:500,statusText:"Internal Server Error"}) // throw an error if there are multiple files with the same name
          response = response[0]
        }
        if (input.method == "HEAD") {
          response = new Response(null,{status: response.status, statusText: response.statusText, headers: response.headers});
        }
        var headers;
        if (response) {
          headers = new Headers(response.headers);
          headers.set("Content-Security-Policy", "child-src 'self'; connect-src 'self' http: https: blob:") // Prevent loading of external resources
          headers.set("Referrer-Policy", "origin-when-cross-origin") // Prevent sharing the referrer externally
          if (!headers.get("content-type")) {
            var ext = Object.keys(mimes).find(ext => url.pathname.toLowerCase().endsWith("." + ext));
            if (ext) headers.set("content-type", mimes[ext])
          }
          response = new Response(response.body,{status: response.status, statusText: response.statusText, headers: headers});
        }
        // Replace URLs in document for relative URLs
        if (response && (input.destination == "document" || [".html"].some(a => url.pathname.toLowerCase().endsWith(a)) || ["text/html"].includes(headers.get("content-type")?.split(";")[0].toLowerCase()))) {
          var bytes = bytes = new Uint8Array(await response.arrayBuffer());
          try {
            var decoder = new TextDecoder('utf-8', { fatal: true }); // Throws an error if not UTF-8 encoded, so the regular response can be used
            var text = decoder.decode(bytes);
            var matchfunc = (match) => {
              try {
                return relativeURL(match,url.href)
              } catch (e) {
                console.error(e);
                return match;
              }
            }
            var regex = /(?<="|')(?:http[s]?:)?\/\/(?:www\.)?[-a-zA-Z0-9@%._\+~#=]{2,256}\.[a-z]{2,6}\b(?:[-a-zA-Z0-9@:%_\+.~#?&\/\/=]*)(?="|')/gi // source: https://regex101.com/r/3fYy3x/1
            text = text.replace(regex,matchfunc); //replace absolute urls starting with https:// or //
            var regex2 = /(?<=\s(href|src)=("|'))\/(?:[-a-zA-Z0-9@:%_\+.~#?&\/\/=]*)?(?="|')/gi
            text = text.replace(regex2,matchfunc); // replace relative urls in href or src positions
            var encoder = new TextEncoder(); // always encodes as UTF-8
            bytes = encoder.encode(text); // returns a Uint8Array
          } catch(e) {}
          response = new Response(bytes,{status: response.status, statusText: response.statusText, headers: headers});
        }
        if (response) return response;
      } else if (input.method == "DELETE") {
        var exists = await cache.delete(new Request(input,{method:"GET"}));
        if (exists) return new Response(null,{status:204,statusText:"No content"})
      } else if (input.method == "PUT") {
        var exists = await cache.delete(new Request(url.href,{method:"GET"})); // Delete the file if it already exists
        var res = new Response(await input.blob(), {status: 200, statusText: "OK", headers: input.headers})
        // Handle redirects
        var redirectURL = input.headers.get("Location");
        if (redirectURL) {
          redirectURL = relativeURL(redirectURL,url.href);
          if (url.href != redirectURL.href) res = Response.redirect(redirectURL)
        }
        // Handle regular puts
        await cache.put(new Request(url.href,{method:"GET"}), res)
        // Send responses
        if (exists) return new Response(null,{status:200,statusText:"OK",headers:{Location:url.href}})
        return new Response(null,{status:201,statusText:"Created",headers:{Location:url.href}})
      }
      
      
      if (url.pathname.endsWith("/")) { // If a folder is requested
        // Returns the index.html for folders if it exists
        var url2 = new URL(url.href);
        url2.pathname += "index.html"
        var response = await request(url2.href,input);
        if (response.status >= 200 && response.status < 400) return response;
        // TODO: Folder view
      }
    }
    
    // Return 404 error
    return new Response(null,{status:404,statusText:"Not found"})
  } catch(e) {
    console.log(input);
    console.error(e);
    return new Response(null,{status:500,statusText:"Internal Server Error"})
  }
}
/*
function request(input, options) {
  if (!(input instanceof Request)) input = new Request(input,options);
  var url = new URL(input.url);
  
  console.log(input);
  
  return new Promise((resolve, reject) => {
    if (input.method == "PUT") {
      input.arrayBuffer()
      .then(file => new Uint8Array(file))
      .then(file => {
        if (url.pathname.toLowerCase().endsWith(".zip")) {
          var pendingFiles = 0;
          var unzipper = new fflate.Unzip(file => {
            console.log(file);
            pendingFiles++;
            var chuncks = [];
            file.ondata = (err, chunk, final) => {
              console.log(data);
              if (err) console.error(err);
              if (chunk) chuncks.push(chunk)
              if (final) {
                const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
                const result = new Uint8Array(size);
                let offset = 0;
                for (const chunk of chunks) {
                  result.set(chunk, offset);
                  offset += chunk.length
                }
                request(url.href + "/" + file.name, {
                  method: 'PUT',
                  headers:{
                    "Content-length": size
                  },
                  body: result
                }).then(() => {
                  pendingFiles--;
                  if (pendingFiles == 0) resolve(new Response(null,{status: 204}));
                });
              }            
            };
            file.start();
          });
          unzipper.register(fflate.UnzipInflate);
          unzipper.push(file, true);
        } else {
          resolve(new Response(null,{status: 204}));
        }
      });
    }
    
  })
}
*/
