/* global self, caches, URL, location, fetch, Response, Headers, Request */
const SHELL_CACHE='litera-shell-v2'
const CONTROL_CACHE='litera-control-v1'
const SHELL=['/','/manifest.webmanifest','/icons/litera.svg']
let activeUserId=null

const bookCache=(userId,bookId)=>`litera-books-u${userId}-b${bookId}-v1`
const dataCache=userId=>`litera-data-u${userId}-v1`
const marker=bookId=>`/_litera/offline/books/${bookId}`
const activeUserMarker='/_litera/offline/active-user'
const bookIdFrom=url=>url.pathname.match(/^\/api\/v1\/books\/(\d+)(?:\/|$)/)?.[1]
const generalApi=url=>url.pathname==='/api/v1/home'||url.pathname==='/api/v1/settings'||url.pathname==='/api/v1/books'||url.pathname.startsWith('/api/v1/catalog/')

self.addEventListener('install',event=>event.waitUntil(caches.open(SHELL_CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())))
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('litera-shell-')&&key!==SHELL_CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())))
self.addEventListener('message',event=>{
  const data=event.data||{}
  if(data.type==='LITERA_ACTIVE_USER'){
    activeUserId=Number.isInteger(data.userId)&&data.userId>0?data.userId:null
    event.waitUntil(caches.open(CONTROL_CACHE).then(cache=>activeUserId?cache.put(activeUserMarker,new Response(String(activeUserId))):cache.delete(activeUserMarker)))
  }
  if(data.type==='LITERA_CLEAR_USER'&&Number.isInteger(data.userId))event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith(`litera-books-u${data.userId}-`)||key===dataCache(data.userId)).map(key=>caches.delete(key)))))
})

async function currentUser(){
  if(activeUserId)return activeUserId
  const saved=await caches.open(CONTROL_CACHE).then(cache=>cache.match(activeUserMarker))
  const value=saved?Number(await saved.text()):0
  activeUserId=Number.isInteger(value)&&value>0?value:null
  return activeUserId
}

async function partialResponse(request,response){
  const match=request.headers.get('range')?.match(/^bytes=(\d+)-(\d*)$/)
  if(!match)return response
  const bytes=await response.arrayBuffer(),start=Number(match[1]),end=match[2]?Math.min(Number(match[2]),bytes.byteLength-1):bytes.byteLength-1
  if(start>end||start>=bytes.byteLength)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${bytes.byteLength}`}})
  const headers=new Headers(response.headers);headers.set('Content-Range',`bytes ${start}-${end}/${bytes.byteLength}`);headers.set('Content-Length',String(end-start+1));headers.set('Accept-Ranges','bytes')
  return new Response(bytes.slice(start,end+1),{status:206,statusText:'Partial Content',headers})
}

async function authenticatedBook(request,url,bookId,userId){
  const cache=await caches.open(bookCache(userId,bookId)),saved=await cache.match(marker(bookId))
  if(!saved)return fetch(request)
  try{
    const response=await fetch(request)
    if([401,403,404].includes(response.status)){await caches.delete(bookCache(userId,bookId));return response}
    if(response.ok&&!request.headers.has('range'))await cache.put(request,response.clone())
    return response
  }catch{
    const cached=await cache.match(new Request(url.href,{credentials:'same-origin'}))
    if(!cached)throw new Error('Offline book resource is unavailable')
    return partialResponse(request,cached)
  }
}

async function authenticatedData(request,userId){
  const cache=await caches.open(dataCache(userId))
  try{const response=await fetch(request);if(response.ok)await cache.put(request,response.clone());return response}
  catch{const cached=await cache.match(request);if(cached)return cached;throw new Error('Offline application data is unavailable')}
}

async function authenticatedApi(request,url){
  const userId=await currentUser()
  if(!userId)return fetch(request)
  const bookId=bookIdFrom(url)
  if(bookId)return authenticatedBook(request,url,bookId,userId)
  if(generalApi(url))return authenticatedData(request,userId)
  return fetch(request)
}

self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url)
  if(request.method!=='GET'||url.origin!==location.origin)return
  if(url.pathname.startsWith('/api/')){
    event.respondWith(authenticatedApi(request,url));return
  }
  event.respondWith(fetch(request).then(response=>{const copy=response.clone();if(response.ok)caches.open(SHELL_CACHE).then(cache=>cache.put(request,copy));return response}).catch(()=>caches.match(request).then(cached=>cached||(request.mode==='navigate'?caches.match('/'):undefined))))
})
