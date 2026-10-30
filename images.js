(function(root){'use strict';
function puzzleGeometry(imageWidth, imageHeight, rows, columns, maxWidth, maxHeight) {
  if (![imageWidth, imageHeight, maxWidth, maxHeight].every(n => Number.isFinite(n) && n > 0)
      || ![rows, columns].every(n => Number.isInteger(n) && n >= 2)) throw new Error('Invalid geometry');
  const scale = Math.min(maxWidth / imageWidth, maxHeight / imageHeight);
  return { width: imageWidth * scale, height: imageHeight * scale, scale,
    sourceTileWidth: imageWidth / columns, sourceTileHeight: imageHeight / rows,
    tileWidth: imageWidth * scale / columns, tileHeight: imageHeight * scale / rows,
    tileAspect: imageWidth * rows / (imageHeight * columns) };
}
function safeImageURL(raw) {
  try {
    const url = new URL(String(raw).trim());
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
    if (url.protocol === 'data:' && /^data:image\/(png|jpeg|webp|gif|avif|bmp)[;,]/i.test(url.href)) return url.href;
  } catch {}
  return null;
}
// Snapshot the data in the actual drop event, before the first await.
function snapshotDrop(dataTransfer) {
  return { files: [...(dataTransfer.files || [])].filter(f => f.type.startsWith('image/')),
    html: dataTransfer.getData('text/html'), uriList: dataTransfer.getData('text/uri-list'),
    plain: dataTransfer.getData('text/plain'), mozImageURL: dataTransfer.getData('text/x-moz-url-data') };
}
function extractImageCandidates(snapshot, doc = document) {
  const urls = [];
  const add = raw => { const url = safeImageURL(raw); if (url && !urls.includes(url)) urls.push(url); };
  if (snapshot.html) {
    // Template content stays inert: no HTML is appended to the live game page.
    const template = doc.createElement('template'); template.innerHTML = snapshot.html;
    for (const img of template.content.querySelectorAll('img')) {
      add(img.getAttribute('src')); add(img.getAttribute('data-src'));
      const srcset = img.getAttribute('srcset');
      if (srcset && !srcset.trim().startsWith('data:')) {
        for (const entry of srcset.split(',').reverse()) add(entry.trim().split(/\s+/)[0]);
      }
    }
  }
  add(snapshot.mozImageURL);
  for (const line of (snapshot.uriList || '').split(/\r?\n/)) if (!line.startsWith('#')) add(line);
  if (/^(https?:|data:image\/)/i.test((snapshot.plain || '').trim())) add(snapshot.plain);
  return { files: snapshot.files || [], urls: urls.slice(0, 16) };
}
function decodeImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image(); image.decoding = 'async'; image.referrerPolicy = 'no-referrer';
    const finish = error => { clearTimeout(timer);image.onload=null;image.onerror=null;if(error)reject(error);else resolve(image); };
    const timer = setTimeout(()=>{image.removeAttribute('src');finish(new Error('画像の読み込みが時間内に完了しませんでした。'));},12000);
    image.onload = () => finish(image.naturalWidth && image.naturalHeight ? null : new Error('画像サイズを読み取れません。'));
    image.onerror = () => finish(new Error('このURLから画像を取得できません。'));
    image.src = src;
  });
}
async function loadImageBlob(blob) {
  if (!blob.type.startsWith('image/')) throw new Error('画像データではありません。');
  const url = URL.createObjectURL(blob);
  try {
    const image = await decodeImage(url);
    return { kind: 'image-blob', blob, url, image, width: image.naturalWidth, height: image.naturalHeight,
      canReadPixels: true, dispose: () => URL.revokeObjectURL(url) };
  } catch (error) { URL.revokeObjectURL(url); throw error; }
}
async function loadImageURL(raw) {
  const url = safeImageURL(raw); if (!url) throw new Error('画像として使用できないURLです。');
  try {
    const response = await fetch(url, { mode: 'cors', credentials: 'omit', signal: AbortSignal.timeout(12000) });
    if (response.ok && (response.headers.get('content-type') || '').startsWith('image/')) return await loadImageBlob(await response.blob());
  } catch {}
  // Cross-origin <img>/CSS display can work even if pixels cannot be read by a canvas.
  // This does not bypass a site's authentication or image access restrictions.
  const image = await decodeImage(url);
  return { kind: 'display-url', url, image, width: image.naturalWidth, height: image.naturalHeight,
    canReadPixels: false, dispose() {} };
}
async function loadImageCandidates(candidates) {
  for (const file of candidates.files) { try { return await loadImageBlob(file); } catch {} }
  for (const url of candidates.urls) { try { return await loadImageURL(url); } catch {} }
  throw new Error('画像本体を取得できませんでした。元の画像を「画像をコピー」して、この枠へ貼り付けてください。');
}
function bindImageDropZone(zone, { onImage, onStatus = () => {}, onRequest = () => {}, pasteButton } = {}) {
  let revision = 0, disposed = false;
  zone.tabIndex = 0;
  async function commit(load, request) {
    try { const image = await load; if (!disposed && request === revision) { onImage(image); onStatus('画像を読み込みました。'); } else image.dispose(); }
    catch (error) { if (!disposed && request === revision) onStatus(error.message); }
  }
  async function clipboardRead() {
    const request = ++revision;onRequest();
    if (!navigator.clipboard?.read) { onStatus('このブラウザでは右クリック貼り付けを使えません。Ctrl+Vまたは画像ファイルのドロップを使ってください。'); return; }
    const load = (async () => {
      let items;
      try { items = await navigator.clipboard.read(); }
      catch { throw new Error('貼り付けの許可が必要です。「貼り付け」ボタン、または枠を選んでCtrl+Vを使ってください。'); }
      for (const item of items) for (const type of item.types) if (type.startsWith('image/')) return loadImageBlob(await item.getType(type));
      throw new Error('クリップボードに画像がありません。スクリーンショットか画像をコピーしてください。');
    })();
    await commit(load, request);
  }
  function context(event) { event.preventDefault(); event.stopPropagation(); zone.focus({ preventScroll: true }); void clipboardRead(); }
  function dragover(event) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }
  function drop(event) {
    event.preventDefault(); event.stopPropagation(); const captured = snapshotDrop(event.dataTransfer);
    const request = ++revision;onRequest();void commit(loadImageCandidates(extractImageCandidates(captured, zone.ownerDocument)), request);
  }
  function paste(event) {
    const captured = snapshotDrop(event.clipboardData);
    if (!captured.files.length && !captured.html && !captured.uriList && !/^(https?:|data:image\/)/i.test(captured.plain.trim())) return;
    event.preventDefault(); const request = ++revision;onRequest();
    void commit(loadImageCandidates(extractImageCandidates(captured, zone.ownerDocument)), request);
  }
  zone.addEventListener('contextmenu', context); zone.addEventListener('dragover', dragover); zone.addEventListener('drop', drop); zone.addEventListener('paste', paste);
  pasteButton?.addEventListener('click', clipboardRead);
  return { readClipboard: clipboardRead, invalidate(){revision++;}, dispose() {
    disposed = true; revision++;
    zone.removeEventListener('contextmenu', context); zone.removeEventListener('dragover', dragover); zone.removeEventListener('drop', drop); zone.removeEventListener('paste', paste);
    pasteButton?.removeEventListener('click', clipboardRead);
  }};
}
// Keep image crops as CSS backgrounds for display-url images; do not call canvas.toBlob/getImageData on them.
function setTileImage(element, image, sourceIndex, rows, columns) {
  const row = Math.floor(sourceIndex / columns), col = sourceIndex % columns;
  const crop=image.crop||{x:0,y:0,w:1,h:1},sx=columns/crop.w,sy=rows/crop.h;
  element.style.backgroundImage = `url(${JSON.stringify(image.url)})`;
  element.style.backgroundSize = `${sx * 100}% ${sy * 100}%`;
  element.style.backgroundPosition = `${(crop.x+col*crop.w/columns)*sx/(sx-1)*100}% ${(crop.y+row*crop.h/rows)*sy/(sy-1)*100}%`;
  element.style.backgroundRepeat = 'no-repeat';
  element.style.aspectRatio = String(image.width * rows / (image.height * columns));
}


root.SimpleImages={puzzleGeometry,snapshotDrop,extractImageCandidates,loadImageBlob,loadImageURL,loadImageCandidates,bindImageDropZone,setTileImage};
})(globalThis);
