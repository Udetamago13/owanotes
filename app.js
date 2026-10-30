/* Independent simple game. Never reads or writes the main game's save data. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const P = window.SimplePuzzle, I = window.SimpleImages, H=window.SimpleHint;
  const NAMES = ['ダンゴムシ','熊本出身のリッキーの姉','初音ミク','肩幅広子','夭折の天才'];
  const SAVE_KEY = 'owaa-simple-puzzle.preferences.v1';
  const PROGRAM_TITLE='~BanG Dream! Our Notes~ だんらんTV！';
  const AFTERWORD_FADE_MS=3000;
  let prefs = {music:65,sound:45,voice:45,brightness:100,background:'#fff9fc',name:0,voiceFx:true,musicMuted:false,soundMuted:false,voiceMuted:false,lightsOff:false,passwordPassed:false,nameChosen:false,grid:3,hours:0,minutes:3,seconds:0,unlimited:false};
  try {
    const saved=JSON.parse(localStorage.getItem(SAVE_KEY));
    for(const k of ['music','sound','voice','brightness']) if(Number.isFinite(saved?.[k])) prefs[k]=Math.max(k==='brightness'?15:0,Math.min(100,saved[k]));
    if(Number.isInteger(saved?.name)&&saved.name>=0&&saved.name<5) prefs.name=saved.name;
    if(/^#[0-9a-f]{6}$/i.test(saved?.background||''))prefs.background=saved.background.toLowerCase();
    for(const k of ['voiceFx','musicMuted','soundMuted','voiceMuted','lightsOff','passwordPassed','nameChosen','unlimited'])if(typeof saved?.[k]==='boolean')prefs[k]=saved[k];
    if(Number.isInteger(saved?.grid)&&saved.grid>=2&&saved.grid<=9)prefs.grid=saved.grid;
    for(const k of ['hours','minutes','seconds'])if(Number.isInteger(saved?.[k])&&saved[k]>=0&&saved[k]<=(k==='hours'?23:59))prefs[k]=saved[k];
  } catch {}
  const fullCrop=()=>({x:0,y:0,w:1,h:1});
  const state={scene:'password',selected:prefs.name,player:prefs.name,choosingFrom:'password',n:prefs.grid,image:null,imageBusy:false,crop:fullCrop(),cropping:false,playImage:null,run:null,musicWanted:false,reference:false,creditsFrom:null,edFinished:false,afterwordFinished:false,afterwordReady:false,afterwordReveal:null};
  let audioContext=null,titleTimer=null,titleRevealAt=0,imageRevision=0,lastTick=performance.now(),lastTimerText='',lastCountdown=-1,carouselIndex=prefs.name,hintAbort=null;
  const bgm=$('bgm'),creditVideo=$('credits-video'),afterwordVoice=$('afterword-voice'),afterwordFx=$('afterword-fx');
  let afterwordStarting=false,creditsStarting=false,mediaEpoch=0,sceneEpoch=0,nameMaskTimer=null,nameMaskSelection=null,cropDrag=null,creditTitleMaskAt=null,creditTitleMasked=false;
  const save=()=>{try{localStorage.setItem(SAVE_KEY,JSON.stringify(prefs));}catch{}};
  const volume=key=>prefs[key+'Muted']?0:prefs[key]/100;

  function sound(kind='click') {
    if(volume('sound')<=0)return;
    try {
      if(!audioContext)audioContext=new (window.AudioContext||window.webkitAudioContext)();
      if(audioContext.state==='suspended')void audioContext.resume().catch(()=>{});
      const now=audioContext.currentTime;
      const notes=kind==='win'?[[660,.09,0],[880,.1,.10],[1320,.24,.21]]:
        kind==='lose'?[[180,.12,0],[140,.22,.16]]:
        kind==='move'?[[380,.045,0]]:kind==='tick'?[[950,.065,0]]:
        kind==='choose'?[[520,.06,0],[720,.08,.065]]:[[590,.045,0]];
      for(const [frequency,duration,delay] of notes){
        const osc=audioContext.createOscillator(),gain=audioContext.createGain(),at=now+delay;
        osc.type=kind==='lose'?'triangle':'square';osc.frequency.setValueAtTime(frequency,at);
        if(kind==='move')osc.frequency.exponentialRampToValueAtTime(190,at+duration);
        gain.gain.setValueAtTime(.0001,at);gain.gain.linearRampToValueAtTime(.055*volume('sound'),at+.006);gain.gain.exponentialRampToValueAtTime(.0001,at+duration);
        osc.connect(gain);gain.connect(audioContext.destination);osc.start(at);osc.stop(at+duration+.02);
        osc.onended=()=>{osc.disconnect();gain.disconnect();};
      }
    } catch {}
  }
  function playMusic(){
    if(state.scene==='afterword'){
      bgm.pause();creditVideo.pause();playAfterwordVoice();return;
    }
    if(state.scene==='credits'){
      bgm.pause();playCreditsVideo();return;
    }
    if(!state.musicWanted)return;bgm.volume=volume('music');if(bgm.paused)void bgm.play().catch(()=>{});
  }
  document.addEventListener('pointerdown',()=>{if(audioContext?.state==='suspended')void audioContext.resume().catch(()=>{});playMusic();},{passive:true});
  document.addEventListener('keydown',playMusic);
  bgm.addEventListener('canplay',playMusic);
  function creditsActive(){return state.scene==='credits'||state.scene==='afterword';}
  function mediaBlocked(){return $('settings-dialog').open||document.hidden;}
  function pauseCreditsMedia(){
    mediaEpoch++;creditsStarting=false;afterwordStarting=false;
    creditVideo.pause();afterwordVoice.pause();afterwordFx.pause();
  }
  function playCreditsVideo(){
    creditVideo.volume=volume('music');
    if(state.scene!=='credits'||state.edFinished||mediaBlocked()||creditsStarting||!creditVideo.paused)return;
    const epoch=mediaEpoch;creditsStarting=true;
    void creditVideo.play().then(()=>{
      if(epoch!==mediaEpoch){if(state.scene!=='credits'||mediaBlocked())creditVideo.pause();return;}
      if(state.scene!=='credits'||mediaBlocked()){creditVideo.pause();return;}
      $('ed-status').textContent='';$('credits-retry').hidden=true;
    }).catch(()=>{
      if(epoch===mediaEpoch&&state.scene==='credits'){$('ed-status').textContent='動画を再生するには、下のボタンを押してください。';$('credits-retry').hidden=false;}
    }).finally(()=>{if(epoch===mediaEpoch)creditsStarting=false;});
  }
  creditVideo.addEventListener('canplay',()=>{if(state.scene==='credits')playCreditsVideo();});
  creditVideo.addEventListener('loadedmetadata',fitCreditsVideo);
  creditVideo.addEventListener('ended',()=>{state.edFinished=true;if(state.scene==='credits')showAfterword();});
  $('credits-retry').addEventListener('click',playCreditsVideo);
  function applyVoiceFx(){
    afterwordVoice.volume=prefs.voiceFx?0:volume('voice');
    afterwordFx.volume=prefs.voiceFx?volume('voice'):0;
    $('voice-fx-on').setAttribute('aria-pressed',String(prefs.voiceFx));
    $('voice-fx-off').setAttribute('aria-pressed',String(!prefs.voiceFx));
  }
  function playAfterwordVoice(){
    applyVoiceFx();
    if(state.scene!=='afterword'||!state.afterwordReady||state.afterwordFinished||mediaBlocked()||afterwordStarting||(!afterwordVoice.paused&&!afterwordFx.paused))return;
    const epoch=mediaEpoch;afterwordStarting=true;
    // Both equal-length variants share one cursor; switching never restarts speech.
    afterwordFx.currentTime=afterwordVoice.currentTime;
    void Promise.all([afterwordVoice.play(),afterwordFx.play()]).then(()=>{
      if(epoch!==mediaEpoch){if(state.scene!=='afterword'||mediaBlocked()){afterwordVoice.pause();afterwordFx.pause();}return;}
      if(state.scene!=='afterword'||state.afterwordFinished||mediaBlocked()){afterwordVoice.pause();afterwordFx.pause();return;}
      $('afterword-status').textContent='';$('afterword-retry').hidden=true;
    }).catch(()=>{
      if(epoch===mediaEpoch&&state.scene==='afterword'){
        afterwordVoice.pause();afterwordFx.pause();$('afterword-status').textContent='音声を再生するには、下のボタンを押してください。';$('afterword-retry').hidden=false;
      }
    }).finally(()=>{if(epoch===mediaEpoch)afterwordStarting=false;});
  }
  function showAfterword(){
    pauseCreditsMedia();bgm.pause();afterwordVoice.currentTime=0;afterwordFx.currentTime=0;
    state.afterwordFinished=false;state.afterwordReady=false;state.afterwordReveal={elapsed:0,lastTick:performance.now(),fontReady:false,masked:false};$('afterword-status').textContent='';$('afterword-retry').hidden=true;
    $('afterword-secret').textContent=PROGRAM_TITLE;
    $('afterword-screen').style.opacity='0';show('afterword');
    // Keep the final video frame behind the white page while it fades in.
    $('credits-screen').hidden=false;$('credits-screen').setAttribute('aria-hidden','true');
    const epoch=sceneEpoch;
    fontsReady.then(()=>{
      if(state.scene!=='afterword'||epoch!==sceneEpoch)return;
      state.afterwordReveal.fontReady=true;state.afterwordReveal.lastTick=performance.now();
    });
  }
  function advanceAfterword(now){
    const reveal=state.afterwordReveal;if(state.scene!=='afterword'||!reveal)return;
    const delta=Math.max(0,now-reveal.lastTick);reveal.lastTick=now;
    if(mediaBlocked()||!reveal.fontReady)return;
    reveal.elapsed+=delta;const t=Math.min(1,reveal.elapsed/AFTERWORD_FADE_MS);
    $('afterword-screen').style.opacity=String(t*t*(3-2*t));
    if(!state.afterwordReady&&t===1){
      state.afterwordReady=true;$('credits-screen').hidden=true;$('credits-screen').removeAttribute('aria-hidden');playAfterwordVoice();
    }
    if(!reveal.masked&&reveal.elapsed>=AFTERWORD_FADE_MS+2000){reveal.masked=true;maskProgrammeTitle();}
  }
  for(const media of [afterwordVoice,afterwordFx])media.addEventListener('canplay',()=>{if(state.scene==='afterword')playAfterwordVoice();});
  afterwordVoice.addEventListener('ended',()=>{if(state.scene==='afterword'){state.afterwordFinished=true;afterwordFx.pause();}});
  $('afterword-retry').addEventListener('click',playAfterwordVoice);
  for(const [id,enabled] of [['voice-fx-on',true],['voice-fx-off',false]])$(id).addEventListener('click',()=>{prefs.voiceFx=enabled;applyVoiceFx();save();});

  function maskProgrammeTitle(){
    const target=$('afterword-secret');target.replaceChildren();
    for(const word of PROGRAM_TITLE.split(/(\s+)/)){
      if(/^\s+$/.test(word)){target.append(word);continue;}
      const canvas=maskedCanvas(word);target.append(canvas);drawMosaic(canvas,word);
    }
  }
  function renderCredits(){
    const person='𠷡杉 謙信',track=$('credits-track');track.replaceChildren();
    creditTitleMaskAt=null;creditTitleMasked=false;
    const rows=[['','おわーのーつの面白い部分だけで構成されてる神ゲーム。'],['監督',person],['ゲームデザイン',person],['パズル設計',person],['プログラム',person],['エンディングテーマ','「形骸輪廻」','作曲・編曲　'+person],['美術・画面設計',person],['音楽・効果音',person],['品質管理・テスト',person],['スペシャルサンクス',null]];
    for(const [role,name,detail] of rows){
      const article=document.createElement('article');article.className='credit-item';
      if(!role)article.classList.add('credit-game-title');
      if(role){const label=document.createElement('h2');label.textContent=role;article.append(label);}
      const text=document.createElement('p');
      if(!role){
        const first=document.createElement('span'),secret=document.createElement('span'),second=document.createElement('span');
        first.className=second.className='credit-title-line';secret.id='credits-game-secret';secret.textContent='おわーのーつ';
        first.append(secret,'の面白い部分だけで');second.textContent='構成されてる神ゲーム。';text.append(first,second);
      }else if(name===null)nameInto(text);else text.textContent=name;
      article.append(text);
      if(detail){const small=document.createElement('small');small.textContent=detail;article.append(small);}
      track.append(article);
    }
  }
  function fitCreditsVideo(){
    if(state.scene!=='credits')return;
    const screen=$('credits-screen'),wrap=creditVideo.parentElement,height=window.visualViewport?.height||innerHeight;
    screen.style.height=height+'px';
    const margin=screen.classList.contains('video-fullscreen')?0:12;
    const width=Math.max(1,wrap.clientWidth-margin*2),availableHeight=Math.max(1,wrap.clientHeight-margin*2);
    const sourceWidth=creditVideo.videoWidth||1920,sourceHeight=creditVideo.videoHeight||1080,scale=Math.min(width/sourceWidth,availableHeight/sourceHeight);
    creditVideo.style.width=sourceWidth*scale+'px';creditVideo.style.height=sourceHeight*scale+'px';
  }
  function creditsFrame(){
    if(state.scene==='credits'){
      const seconds=creditVideo.currentTime||0,band=$('credits-band'),track=$('credits-track');
      const progress=Math.max(0,Math.min(1,seconds/60));
      track.style.transform=`translateX(${band.clientWidth-(band.clientWidth+track.scrollWidth)*progress}px)`;
      band.classList.toggle('roll-finished',seconds>=60);
      const fullscreen=seconds>=61;
      if($('credits-screen').classList.contains('video-fullscreen')!==fullscreen){$('credits-screen').classList.toggle('video-fullscreen',fullscreen);fitCreditsVideo();}
      const secret=$('credits-game-secret');
      if(secret&&!creditTitleMasked){
        const bounds=secret.getBoundingClientRect(),bandBounds=band.getBoundingClientRect();
        if(creditTitleMaskAt===null&&bounds.left>=bandBounds.left&&bounds.right<=bandBounds.right)creditTitleMaskAt=seconds+2;
        if(creditTitleMaskAt!==null&&seconds>=creditTitleMaskAt){const canvas=maskedCanvas('おわーのーつ');secret.replaceChildren(canvas);drawMosaic(canvas,'おわーのーつ');creditTitleMasked=true;}
      }
    }else if(state.scene==='afterword'&&!state.afterwordFinished&&!afterwordVoice.paused&&!afterwordFx.paused&&!afterwordStarting){
      if(Math.abs(afterwordVoice.currentTime-afterwordFx.currentTime)>.08)afterwordFx.currentTime=afterwordVoice.currentTime;
    }
  }

  function drawMosaic(canvas,word,fontSize=null){
    const px=fontSize||parseFloat(getComputedStyle(canvas.parentElement).fontSize)||24;
    const source=document.createElement('canvas'),ctx=source.getContext('2d');
    ctx.font=`${px}px BestTen`;
    const w=Math.ceil(ctx.measureText(word).width),h=Math.ceil(px*1.17),ratio=2;
    source.width=w*ratio;source.height=h*ratio;ctx.scale(ratio,ratio);ctx.font=`${px}px BestTen`;ctx.textBaseline='top';ctx.fillStyle=getComputedStyle(canvas.parentElement).color;ctx.fillText(word,0,0);
    // Average real glyph pixels into coarse cells, then enlarge without smoothing.
    // This is pixelation of the rendered word, not a blur or decorative overlay.
    const small=document.createElement('canvas'),block=Math.max(6,Math.round(px*.28));
    small.width=Math.max(2,Math.ceil(w/block));small.height=Math.max(2,Math.ceil(h/block));
    small.getContext('2d').drawImage(source,0,0,small.width,small.height);
    canvas.width=w*ratio;canvas.height=h*ratio;canvas.style.width=w+'px';canvas.style.height=h+'px';
    const target=canvas.getContext('2d');target.imageSmoothingEnabled=false;target.drawImage(small,0,0,canvas.width,canvas.height);
    canvas.dataset.mosaic=word;
  }
  function maskedCanvas(word){const canvas=document.createElement('canvas');canvas.className='mosaic';canvas.setAttribute('role','img');canvas.setAttribute('aria-label',word);canvas.dataset.mosaic=word;return canvas;}
  function nameInto(element,index=state.player,{maskMiku=true,multiline=false}={}){
    element.replaceChildren();
    if(index===2&&maskMiku){element.append('初音',maskedCanvas('ミ'),'ク');}
    else if(index===1&&multiline){for(const line of ['熊本出身の','リッキーの姉']){const span=document.createElement('span');span.className='name-line';span.textContent=line;element.append(span);}}
    else element.textContent=NAMES[index];
  }
  function syncNameMask(){
    const selected=state.scene==='name'?state.selected:null;
    if(nameMaskSelection===selected)return;
    nameMaskSelection=selected;clearTimeout(nameMaskTimer);nameMaskTimer=null;
    const label=$('name-carousel').querySelector('[data-name-index="2"] .card-name');
    if(!label)return;nameInto(label,2,{maskMiku:false});
    if(selected!==2)return;
    nameMaskTimer=setTimeout(()=>{
      if(state.scene==='name'&&state.selected===2){nameInto(label,2);redrawMosaics();}
      nameMaskTimer=null;
    },2000);
  }
  function redrawMosaics(){document.querySelectorAll('canvas[data-mosaic]').forEach(c=>{if(c.getClientRects().length)drawMosaic(c,c.dataset.mosaic);});}
  const fontsReady=document.fonts.load('24px BestTen').then(()=>document.fonts.ready).catch(()=>{});
  fontsReady.then(redrawMosaics);

  function show(scene){
    clearTimeout(titleTimer);titleTimer=null;state.scene=scene;sceneEpoch++;
    if(scene!=='afterword'){state.afterwordReveal=null;state.afterwordReady=false;$('credits-screen').removeAttribute('aria-hidden');}
    if(scene!=='play')closeHint();
    document.body.classList.toggle('afterword-active',scene==='afterword');
    document.body.classList.toggle('credits-active',scene==='credits');
    $('voice-fx-row').hidden=!creditsActive();$('voice-volume-row').hidden=!creditsActive();$('open-credits').disabled=creditsActive();
    $('screen-exit').setAttribute('aria-label',creditsActive()?'クレジットを閉じて元の画面へ戻る':scene==='play'||scene==='setup'?'タイトルへ戻る':'前の画面へ戻る');
    for(const el of document.querySelectorAll('.screen'))el.hidden=el.id!==scene+'-screen';
    setReference(false);
    lastTick=performance.now();window.scrollTo({top:0,behavior:'instant'});
    syncPasswordMask();syncNameMask();fitImagePreview();fitCreditsVideo();redrawMosaics();
  }
  function refreshNames(){for(const id of ['title-player','setup-player','play-player','result-player'])nameInto($(id));redrawMosaics();}
  function title(){
    $('title-secret').textContent='おわーのーつ';show('title');refreshNames();
    state.musicWanted=true;playMusic();
    fontsReady.then(()=>{
      if(state.scene!=='title')return;
      scheduleTitleMosaic();
    });
  }
  function scheduleTitleMosaic(delay=2000){
    clearTimeout(titleTimer);titleRevealAt=performance.now()+delay;
    titleTimer=setTimeout(()=>{
      titleTimer=null;if(state.scene!=='title')return;
      const c=maskedCanvas('おわーのーつ');$('title-secret').replaceChildren(c);drawMosaic(c,'おわーのーつ');
    },delay);
  }

  function syncPasswordMask(){
    const mask=$('password-mask');mask.hidden=$('password').type!=='password';mask.textContent='*'.repeat($('password').value.length);mask.scrollLeft=mask.scrollWidth;
  }
  $('password').addEventListener('input',syncPasswordMask);
  $('password-eye').addEventListener('click',()=>{
    const visible=$('password').type==='password';$('password').type=visible?'text':'password';
    $('password-eye').textContent=visible?'隠す':'表示';$('password-eye').setAttribute('aria-pressed',String(visible));$('password-eye').setAttribute('aria-label',visible?'パスワードを隠す':'パスワードを表示');
    syncPasswordMask();
  });
  $('password-form').addEventListener('submit',event=>{
    event.preventDefault();
    if($('password').value.normalize('NFKC').trim().toLowerCase()!=='qanon'){
      $('password-error').textContent='パスワードが違います。';sound('lose');$('password').focus();return;
    }
    prefs.passwordPassed=true;save();$('password-error').textContent='';$('password').value='';sound('choose');
    if(prefs.nameChosen)title();else chooseName('password');
  });

  for(let i=0;i<NAMES.length;i++){
    const b=document.createElement('button');b.type='button';b.className='name-card';b.dataset.nameIndex=i;b.setAttribute('aria-label',NAMES[i]);
    const number=document.createElement('span');number.className='card-index';number.textContent=String(i+1).padStart(2,'0');
    const label=document.createElement('span');label.className='card-name';nameInto(label,i,{maskMiku:false,multiline:true});b.append(number,label);
    b.addEventListener('click',()=>{let delta=(i-state.selected+5)%5;if(delta>2)delta-=5;carouselIndex+=delta;state.selected=i;updateCarousel();sound('click');});
    $('name-carousel').append(b);
  }
  function updateCarousel(){
    const width=$('name-carousel').clientWidth;
    for(const b of $('name-carousel').children){
      const i=Number(b.dataset.nameIndex),angle=(i-carouselIndex)*Math.PI*2/5,c=Math.cos(angle),s=Math.sin(angle);
      const x=s*width*.37,y=-(1-c)*78,scale=.66+.34*(c+1)/2;
      b.style.transform=`translate(calc(-50% + ${x}px),calc(-50% + ${y}px)) scale(${scale})`;
      b.style.zIndex=String(Math.round(100+c*50));b.style.opacity=String(.5+.5*(c+1)/2);
      b.setAttribute('aria-pressed',String(i===state.selected));
    }
    $('name-page').textContent=String(state.selected+1).padStart(2,'0')+' / 05';syncNameMask();redrawMosaics();
  }
  function chooseName(from){state.choosingFrom=from;state.selected=state.player;carouselIndex=state.player;$('name-cancel').hidden=from==='password';show('name');updateCarousel();}
  function rotateName(delta){carouselIndex+=delta;state.selected=(state.selected+delta+5)%5;updateCarousel();sound();}
  $('name-prev').addEventListener('click',()=>rotateName(-1));$('name-next').addEventListener('click',()=>rotateName(1));
  $('name-confirm').addEventListener('click',()=>{state.player=state.selected;prefs.name=state.player;prefs.nameChosen=true;save();sound('choose');refreshNames();if(state.choosingFrom==='setup')show('setup');else title();});
  $('name-cancel').addEventListener('click',()=>{if(state.choosingFrom==='setup')show('setup');else title();});

  function clearImage(){
    imageRevision++;zoneBinding.invalidate();state.image?.dispose();state.image=null;state.imageBusy=false;state.playImage=null;state.crop=fullCrop();state.cropping=false;cropDrag=null;
    $('image-stage').hidden=true;$('image-preview').removeAttribute('src');$('empty-image').hidden=false;$('clear-image').hidden=true;$('crop-toggle').hidden=true;$('crop-clear').hidden=true;$('image-status').textContent='';$('image-file').value='';$('play-start').disabled=false;
  }
  function commitImage(image){
    state.image?.dispose();state.image=image;state.imageBusy=false;state.crop=fullCrop();state.cropping=false;cropDrag=null;state.playImage=null;
    $('image-preview').src=image.url;$('image-stage').hidden=false;$('empty-image').hidden=true;$('clear-image').hidden=false;$('crop-toggle').hidden=false;$('setup-error').textContent='';$('play-start').disabled=false;fitImagePreview();
  }
  function cropped(){const c=state.crop;return c.x>0||c.y>0||c.w<1||c.h<1;}
  function renderCrop(){
    const c=state.crop,box=$('crop-box');
    box.hidden=!state.cropping&&!cropped();box.style.left=c.x*100+'%';box.style.top=c.y*100+'%';box.style.width=c.w*100+'%';box.style.height=c.h*100+'%';
    $('image-stage').classList.toggle('cropping',state.cropping);
    $('crop-toggle').textContent=state.cropping?'この範囲を使う':'切り取る';$('crop-toggle').setAttribute('aria-pressed',String(state.cropping));$('crop-clear').hidden=!state.image||!cropped();
  }
  function fitImagePreview(){
    if(state.scene!=='setup'||!state.image)return;
    const zone=$('image-zone'),scale=Math.min((zone.clientWidth-4)/state.image.width,(zone.clientHeight-4)/state.image.height);
    $('image-stage').style.width=state.image.width*scale+'px';$('image-stage').style.height=state.image.height*scale+'px';renderCrop();
  }
  function cropPoint(event){const r=$('image-stage').getBoundingClientRect();return {x:Math.max(0,Math.min(1,(event.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(event.clientY-r.top)/r.height))};}
  function cropDescription(){const c=state.crop;return cropped()?`選んだ範囲：${Math.round(state.image.width*c.w)} × ${Math.round(state.image.height*c.h)}`:'画像全体を使います。';}
  $('crop-toggle').addEventListener('click',()=>{
    if(!state.image)return;state.cropping=!state.cropping;renderCrop();$('image-status').textContent=state.cropping?'画像の上をドラッグして、使う範囲を選んでください。':cropDescription();sound();
  });
  $('crop-clear').addEventListener('click',()=>{state.crop=fullCrop();state.cropping=false;cropDrag=null;renderCrop();$('image-status').textContent='画像全体に戻しました。';sound();});
  $('image-stage').addEventListener('pointerdown',event=>{
    if(!state.cropping||event.button!==0||!state.image||cropDrag)return;
    event.preventDefault();cropDrag={pointer:event.pointerId,start:cropPoint(event),before:{...state.crop}};$('image-stage').setPointerCapture(event.pointerId);
  });
  $('image-stage').addEventListener('pointermove',event=>{
    if(!cropDrag||cropDrag.pointer!==event.pointerId)return;event.preventDefault();
    const end=cropPoint(event),start=cropDrag.start;state.crop={x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),w:Math.abs(start.x-end.x),h:Math.abs(start.y-end.y)};renderCrop();
  });
  function endCrop(event){
    if(!cropDrag||cropDrag.pointer!==event.pointerId)return;
    if(event.type==='pointercancel'||state.crop.w<.025||state.crop.h<.025)state.crop=cropDrag.before;
    cropDrag=null;if($('image-stage').hasPointerCapture(event.pointerId))$('image-stage').releasePointerCapture(event.pointerId);renderCrop();$('image-status').textContent=cropDescription();
  }
  $('image-stage').addEventListener('pointerup',endCrop);$('image-stage').addEventListener('pointercancel',endCrop);
  function imageRequest(){imageRevision++;state.imageBusy=true;$('play-start').disabled=true;$('image-status').textContent='画像を読み込んでいます…';}
  const zoneBinding=I.bindImageDropZone($('image-zone'),{
    pasteButton:$('paste-image'),onRequest:imageRequest,onImage:commitImage,
    onStatus:message=>{state.imageBusy=false;$('play-start').disabled=false;$('image-status').textContent=message;}
  });
  async function loadImage(promise){
    zoneBinding.invalidate();imageRequest();const revision=imageRevision;
    try{const image=await promise;if(revision!==imageRevision){image.dispose();return;}commitImage(image);$('image-status').textContent='';}
    catch(error){if(revision===imageRevision){state.imageBusy=false;$('play-start').disabled=false;$('image-status').textContent=error.message||'画像を読み込めませんでした。';}}
  }
  $('choose-image').addEventListener('click',()=>$('image-file').click());
  $('image-file').addEventListener('change',()=>{const f=$('image-file').files[0];if(f)void loadImage(I.loadImageBlob(f));$('image-file').value='';});
  $('clear-image').addEventListener('click',()=>{clearImage();sound();});
  $('image-zone').addEventListener('dragenter',()=>$('image-zone').classList.add('dragging'));
  for(const event of ['dragleave','drop'])$('image-zone').addEventListener(event,()=>$('image-zone').classList.remove('dragging'));
  document.addEventListener('dragover',e=>e.preventDefault());document.addEventListener('drop',e=>e.preventDefault());
  document.addEventListener('paste',event=>{
    if(state.scene!=='setup'||$('image-zone').contains(event.target)||event.target.matches('input,textarea'))return;
    const captured=I.snapshotDrop(event.clipboardData),candidates=I.extractImageCandidates(captured);
    if(!candidates.files.length&&!candidates.urls.length)return;event.preventDefault();void loadImage(I.loadImageCandidates(candidates));
  });

  for(let n=2;n<=9;n++){
    const b=document.createElement('button');b.type='button';b.className='grid-choice';b.textContent=`${n}×${n}`;b.setAttribute('role','radio');b.dataset.grid=n;
    b.addEventListener('click',()=>{if(state.n===n)return;state.n=n;prefs.grid=n;save();updateGrid();sound();});$('grid-choices').append(b);
  }
  function updateGrid(){for(const b of $('grid-choices').children){const active=Number(b.dataset.grid)===state.n;b.setAttribute('aria-checked',String(active));b.tabIndex=active?0:-1;}}
  $('grid-choices').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();const d=e.key==='ArrowLeft'?-1:e.key==='ArrowRight'?1:e.key==='ArrowUp'?-4:4;state.n=Math.max(2,Math.min(9,state.n+d));prefs.grid=state.n;save();updateGrid();$('grid-choices').querySelector('[aria-checked=true]').focus();sound();});
  updateGrid();
  for(const id of ['hours','minutes','seconds']){
    $(id).value=prefs[id];$(id).disabled=prefs.unlimited;
    $(id).addEventListener('change',()=>{const value=Number($(id).value);if(Number.isInteger(value)&&value>=0&&value<=(id==='hours'?23:59)){prefs[id]=value;save();}});
  }
  $('unlimited').checked=prefs.unlimited;
  $('unlimited').addEventListener('change',()=>{prefs.unlimited=$('unlimited').checked;for(const id of ['hours','minutes','seconds'])$(id).disabled=prefs.unlimited;save();sound();});
  function setup(fresh=false){
    if($('result-dialog').open)$('result-dialog').close();state.run=null;show('setup');refreshNames();$('setup-error').textContent='';
    if(fresh)clearImage();
  }
  $('title-start').addEventListener('click',()=>{sound('choose');setup(true);});
  $('setup-name').addEventListener('click',()=>{sound();chooseName('setup');});
  $('setup-form').addEventListener('submit',event=>{
    event.preventDefault();if(state.imageBusy)return;
    if(!state.image){$('setup-error').textContent='画像がありません';sound('lose');$('image-zone').focus();return;}
    let limit;
    try{limit=P.parseTime($('hours').value,$('minutes').value,$('seconds').value,$('unlimited').checked);}
    catch(error){$('setup-error').textContent=error.message;return;}
    startRun(limit);sound('choose');
  });

  const tileElements=new Map();
  function startRun(limit,initial=null){
    const generated=initial||P.makeNormalBoard(state.n);
    const crop={...state.crop};state.cropping=false;renderCrop();
    state.playImage={url:state.image.url,width:state.image.width*crop.w,height:state.image.height*crop.h,crop};
    closeHint();state.run={n:state.n,limit,initial:generated.board.slice(),initialSolution:generated.solution?.slice()||null,history:[],board:generated.board.slice(),moves:0,elapsed:0,status:'playing',hintCache:null};
    $('result-dialog').close();show('play');refreshNames();$('play-size').textContent=`${state.n}×${state.n}`;
    $('timer-label').textContent=Number.isFinite(limit)?'のこり時間':'経過時間';lastTimerText='';lastCountdown=-1;
    $('goal-image').src=state.image.url;fitReference();buildBoard();updateStats();resizeBoard();syncHintActions();
  }
  function buildBoard(){
    const r=state.run;$('board').replaceChildren();tileElements.clear();
    for(let value=1;value<r.n*r.n;value++){
      const b=document.createElement('button');b.className='tile';b.type='button';b.dataset.tile=value;b.setAttribute('aria-label',`ピース ${value}`);
      b.style.width=100/r.n+'%';b.style.height=100/r.n+'%';I.setTileImage(b,state.playImage,value-1,r.n,r.n);
      b.addEventListener('click',()=>slide(state.run?.board.indexOf(value)));$('board').append(b);tileElements.set(value,b);
    }
    placeTiles();
  }
  function placeTiles(){
    const r=state.run;if(!r)return;
    for(let i=0;i<r.board.length;i++){
      const b=tileElements.get(r.board[i]);if(!b)continue;
      b.style.transform=`translate(${i%r.n*100}%,${Math.floor(i/r.n)*100}%)`;
      b.setAttribute('aria-disabled',String(!P.neighbors(r.board,r.n).includes(i)||r.status!=='playing'||$('hint-dialog').open));
    }
  }
  function resizeBoard(){
    if(state.scene!=='play'||!state.playImage)return;
    const workspace=$('play-workspace'),reserve=state.reference&&innerWidth>760?$('reference-image').offsetWidth+24:0;
    const maxW=Math.min(760,workspace.clientWidth-reserve-4),maxH=Math.max(180,innerHeight-360);
    const g=I.puzzleGeometry(state.playImage.width,state.playImage.height,state.n,state.n,maxW,maxH);
    $('board-shell').style.width=g.width+'px';$('board-shell').style.height=g.height+'px';
    fitReference();
  }
  function fitReference(){
    if(!state.playImage)return;const image=state.playImage,c=image.crop,clip=$('goal-clip'),preview=$('goal-image');
    const width=Math.max(1,$('reference-image').clientWidth-28||178),maxHeight=innerWidth<=760?190:320;
    clip.style.width=Math.min(width,maxHeight*image.width/image.height)+'px';clip.style.aspectRatio=String(image.width/image.height);
    preview.style.width=100/c.w+'%';preview.style.height=100/c.h+'%';preview.style.left=-c.x/c.w*100+'%';preview.style.top=-c.y/c.h*100+'%';
  }
  function setReference(visible){
    state.reference=visible;$('reference-image').hidden=!visible;$('show-goal').setAttribute('aria-pressed',String(visible));$('reference-state').textContent=visible?'ON':'OFF';resizeBoard();
  }
  function paused(){return $('settings-dialog').open||$('hint-dialog').open||document.hidden;}
  function updateStats(){
    const r=state.run;if(!r)return;const remaining=Number.isFinite(r.limit)?Math.max(0,r.limit-r.elapsed):r.elapsed;
    // Round remaining time upward so the display never says zero while time remains.
    const display=Number.isFinite(r.limit)?Math.ceil(remaining/1000)*1000:remaining;
    const text=P.clockText(display,{centiseconds:false});if(text!==lastTimerText){$('timer').textContent=text;lastTimerText=text;}
    $('timer').classList.toggle('time-warning',Number.isFinite(r.limit)&&remaining<=10000);$('moves').textContent=r.moves;
  }
  function advance(now=performance.now()){
    const delta=Math.max(0,now-lastTick);lastTick=now;const r=state.run;
    if(state.scene!=='play'||!r||r.status!=='playing'||paused())return;
    r.elapsed=Math.min(r.limit,r.elapsed+delta);updateStats();
    if(r.elapsed>=r.limit){finish(false);return;}
    const sec=Math.ceil((r.limit-r.elapsed)/1000);if(sec<=5&&sec>0&&sec!==lastCountdown){lastCountdown=sec;sound('tick');}
  }
  function frame(now){advance(now);creditsFrame();advanceAfterword(now);requestAnimationFrame(frame);}requestAnimationFrame(frame);
  function slide(index){
    advance();const r=state.run;
    if(!r||r.status!=='playing'||paused()||!P.neighbors(r.board,r.n).includes(index))return;
    r.history.push(r.board.indexOf(0));r.board=P.move(r.board,index,r.n);r.moves++;sound('move');placeTiles();updateStats();
    if(P.isSolved(r.board))finish(true);
  }
  function finish(won){
    const r=state.run;if(!r||r.status!=='playing')return;r.status=won?'solved':'timeout';placeTiles();syncHintActions();
    if(won){const last=document.createElement('div');last.className='tile';last.style.width=100/r.n+'%';last.style.height=100/r.n+'%';I.setTileImage(last,state.playImage,r.n*r.n-1,r.n,r.n);last.style.transform=`translate(${(r.n-1)*100}%,${(r.n-1)*100}%)`;$('board').append(last);}
    $('result-symbol').textContent=won?'○':'×';$('result-heading').textContent=won?'クリア！':'時間切れ';
    nameInto($('result-player'));$('result-time').textContent=P.clockText(r.elapsed,{centiseconds:true});$('result-moves').textContent=r.moves+' 手';
    sound(won?'win':'lose');
    setTimeout(()=>{if(state.run===r&&state.scene==='play'&&r.status!=='playing'&&!$('result-dialog').open){$('result-dialog').show();redrawMosaics();}},won?650:200);
  }
  function resetRun(shuffle=false){
    const r=state.run;if(!r)return;advance();
    const initial=shuffle?P.makeNormalBoard(r.n,Math.random,r.initial):{board:r.initial.slice(),solution:r.initialSolution?.slice()};
    startRun(r.limit,initial);sound('choose');
  }
  $('show-goal').addEventListener('click',()=>{advance();setReference(!state.reference);sound();});
  $('reset-board').addEventListener('click',()=>resetRun());$('shuffle-board').addEventListener('click',()=>resetRun(true));
  $('quit-play').addEventListener('click',()=>{sound();setup();});
  $('result-retry').addEventListener('click',()=>resetRun(true));$('result-setup').addEventListener('click',()=>{sound();setup();});
  $('result-dialog').addEventListener('cancel',e=>{e.preventDefault();setup();});
  function syncHintActions(){
    $('show-hint').disabled=!state.run||state.run.status!=='playing'||$('hint-dialog').open;
    for(const id of ['reset-board','shuffle-board'])$(id).disabled=$('hint-dialog').open;
  }
  function closeHint(){hintAbort?.abort();hintAbort=null;if($('hint-dialog').open)$('hint-dialog').close();}
  function showHint(advanceClock=true){
    if(state.scene!=='play'||!state.run||state.run.status!=='playing'||$('settings-dialog').open||$('hint-dialog').open)return;
    if(advanceClock)advance();const run=state.run;if(run.status!=='playing')return;
    const board=run.board.slice(),key=P.key(board),abort=new AbortController();hintAbort=abort;
    $('hint-answer').textContent='計算中…';$('hint-progress').textContent='';$('hint-dialog').show();syncHintActions();placeTiles();$('hint-close').focus();sound();
    const current=()=>hintAbort===abort&&!abort.signal.aborted&&state.run===run&&$('hint-dialog').open;
    const result=run.hintCache?.key===key?Promise.resolve(run.hintCache):H.solve(board,run.n,{
      signal:abort.signal,upperPath:run.initialSolution?[...run.history].reverse().concat(run.initialSolution):null,
      onProgress:()=>{if(current())$('hint-progress').textContent='計算を続けています。閉じて中断できます。';}
    });
    void result.then(answer=>{
      if(!current())return;run.hintCache={key,distance:answer.distance};$('hint-answer').textContent=`最短 ${answer.distance} 手`;$('hint-progress').textContent='';
    }).catch(error=>{if(current()&&error.name!=='AbortError'){$('hint-answer').textContent='計算できませんでした。';$('hint-progress').textContent='閉じて、もう一度お試しください。';}});
  }
  $('show-hint').addEventListener('click',()=>showHint());$('hint-close').addEventListener('click',closeHint);
  $('hint-dialog').addEventListener('close',()=>{hintAbort?.abort();hintAbort=null;lastTick=performance.now();syncHintActions();placeTiles();});
  $('hint-dialog').addEventListener('cancel',event=>{event.preventDefault();closeHint();});
  document.addEventListener('keydown',event=>{
    if($('settings-dialog').open)return;
    if($('hint-dialog').open){if(event.key==='Escape'){event.preventDefault();closeHint();}return;}
    if($('result-dialog').open){if(event.key==='Escape'){event.preventDefault();setup();}return;}
    if(event.target.matches('input,textarea'))return;
    if(state.scene==='name'&&['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();rotateName(event.key==='ArrowLeft'?-1:1);}
    if(state.scene!=='play'||!state.run||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
    event.preventDefault();const r=state.run,z=r.board.indexOf(0),n=r.n;
    // Arrow keys indicate the direction of movement of the tile into the gap.
    const index=event.key==='ArrowLeft'?z+1:event.key==='ArrowRight'?z-1:event.key==='ArrowUp'?z+n:z-n;
    if((event.key==='ArrowLeft'&&z%n===n-1)||(event.key==='ArrowRight'&&z%n===0))return;
    slide(index);
  });

  function applyOptions(){
    bgm.volume=volume('music');creditVideo.volume=volume('music');applyVoiceFx();$('brightness').style.opacity=String(prefs.lightsOff?1:1-prefs.brightness/100);
    for(const [key,id,out] of [['music','music-volume','music-output'],['sound','sound-volume','sound-output'],['voice','voice-volume','voice-output'],['brightness','brightness-level','brightness-output']]){
      const muted=key==='brightness'?prefs.lightsOff:prefs[key+'Muted'];
      $(id).value=prefs[key];$(id).style.setProperty('--value',((prefs[key]-Number($(id).min))/(Number($(id).max)-Number($(id).min))*100)+'%');$(out).value=String(muted?0:prefs[key]);
      $(key+'-label').setAttribute('aria-pressed',String(muted));$(id).classList.toggle('is-muted',muted);
    }
  }
  function applyBackground(){
    const rgb=prefs.background.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
    const luminance=.2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2],dark=luminance<.22,root=document.documentElement;
    root.style.setProperty('--paper',prefs.background);root.style.setProperty('--ink',dark?'#fff9fc':'#24212b');
    root.style.setProperty('--muted',dark?'#d9ced8':'#655b68');root.style.setProperty('--line',dark?'#655a6b':'#bcaeb9');
    $('background-color').value=prefs.background;
    for(const b of $('background-swatches').children)b.setAttribute('aria-pressed',String(b.dataset.color===prefs.background));
    redrawMosaics();
  }
  $('background-color').addEventListener('input',()=>{prefs.background=$('background-color').value;applyBackground();save();});
  for(const b of $('background-swatches').children)b.addEventListener('click',()=>{prefs.background=b.dataset.color;applyBackground();save();sound();});
  for(const [key,id] of [['music','music-volume'],['sound','sound-volume'],['voice','voice-volume'],['brightness','brightness-level']]){
    const muteKey=key==='brightness'?'lightsOff':key+'Muted';
    $(key+'-label').addEventListener('click',()=>{prefs[muteKey]=!prefs[muteKey];applyOptions();save();sound();});
    $(id).addEventListener('input',()=>{prefs[key]=Number($(id).value);prefs[muteKey]=false;applyOptions();save();});
    $(id).addEventListener('change',()=>sound());
  }
  $('settings-open').addEventListener('click',()=>{advance();$('settings-dialog').showModal();if(creditsActive())pauseCreditsMedia();sound();});
  $('settings-close').addEventListener('click',()=>$('settings-dialog').close());
  $('settings-dialog').addEventListener('close',()=>{lastTick=performance.now();if(state.afterwordReveal)state.afterwordReveal.lastTick=lastTick;if(creditsActive())playMusic();});
  $('settings-dialog').addEventListener('click',event=>{if(event.target!==$('settings-dialog'))return;const r=$('settings-dialog').getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)$('settings-dialog').close();});
  $('open-credits').addEventListener('click',()=>{
    if(creditsActive())return;
    advance();state.creditsFrom={scene:state.scene,reference:state.reference,hint:$('hint-dialog').open,result:$('result-dialog').open||(state.scene==='play'&&state.run?.status!=='playing'),scrollX:window.scrollX,scrollY:window.scrollY,titleDelay:titleTimer===null?null:Math.max(0,titleRevealAt-performance.now())};
    $('result-dialog').close();$('settings-dialog').close();pauseCreditsMedia();
    bgm.pause();creditVideo.currentTime=0;state.edFinished=false;$('ed-status').textContent='';$('credits-retry').hidden=true;
    $('credits-screen').classList.remove('video-fullscreen');$('credits-band').classList.remove('roll-finished');renderCredits();
    show('credits');creditsFrame();playMusic();sound('choose');
  });
  function leaveCredits(){
    const previous=state.creditsFrom||{scene:'password',reference:false};pauseCreditsMedia();state.edFinished=true;state.afterwordFinished=true;state.creditsFrom=null;
    show(previous.scene);if(previous.scene==='name')updateCarousel();if(previous.scene==='play')setReference(previous.reference);
    if(previous.scene==='title'&&previous.titleDelay!==null)scheduleTitleMosaic(previous.titleDelay);
    if(previous.result)$('result-dialog').show();
    if(previous.hint&&previous.scene==='play')showHint(false);
    requestAnimationFrame(()=>window.scrollTo({left:previous.scrollX||0,top:previous.scrollY||0,behavior:'instant'}));playMusic();
    sound();
  }
  $('screen-exit').addEventListener('click',()=>{
    if(creditsActive()){leaveCredits();return;}
    $('result-dialog').close();
    if(state.scene==='play'||state.scene==='setup'){state.run=null;title();}
    else if(state.scene==='title')chooseName('title');
    else if(state.scene==='name'&&state.choosingFrom==='setup')show('setup');
    else if(state.scene==='name'&&prefs.nameChosen)title();
    else{
      state.musicWanted=false;bgm.pause();$('password').value='';$('password-error').textContent='';show('password');$('password').focus();
    }
    sound();
  });
  document.addEventListener('visibilitychange',()=>{lastTick=performance.now();if(state.afterwordReveal)state.afterwordReveal.lastTick=lastTick;if(creditsActive()){if(document.hidden)pauseCreditsMedia();else playMusic();}});
  function resize(){if(state.scene==='name')updateCarousel();fitImagePreview();fitCreditsVideo();resizeBoard();redrawMosaics();creditsFrame();}
  addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);
  applyOptions();applyBackground();refreshNames();syncPasswordMask();
  if(prefs.passwordPassed){if(prefs.nameChosen)title();else chooseName('password');}else $('password').focus();
})();
