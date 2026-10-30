/* Exact move-count hints, adapted from the separate main game solver. */
(function(root){'use strict';
const P=typeof module!=="undefined"&&module.exports?require('./engine.js'):root.SimplePuzzle;
// This function is self-contained so the exact same search can run in a Blob
// worker on file://, and in a yielding main-thread fallback if workers fail.
const exactSearch=function* (input,n,upperPath=null){
 const board=input.slice(),size=board.length,at=(p,t)=>Math.abs(Math.floor(p/n)-Math.floor((t-1)/n))+Math.abs(p%n-(t-1)%n);
 if(!Number.isInteger(n)||n<2||n>9||size!==n*n||new Set(board).size!==size||board.some(t=>!Number.isInteger(t)||t<0||t>=size))throw Error('Invalid board');
 let inversions=0;for(let i=0;i<size;i++)if(board[i])for(let j=i+1;j<size;j++)if(board[j]&&board[i]>board[j])inversions++;
 if(n%2?inversions%2:(inversions+n-Math.floor(board.indexOf(0)/n))%2!==1)throw Error('No solution');
 const adj=z=>[z>=n?z-n:-1,z%n?z-1:-1,z<size-n?z+n:-1,z%n<n-1?z+1:-1].filter(i=>i>=0);
 let h=board.reduce((sum,t,p)=>sum+(t?at(p,t):0),0),nodes=0,bound=h;const path=[],seenPath=new Set([board.join(',')]);
 if(h===0)return {path:[],distance:0,nodes};
 let validUpper=null;
 if(Array.isArray(upperPath)){
  const check=board.slice();let z=check.indexOf(0),valid=true;
  for(const i of upperPath){if(!adj(z).includes(i)){valid=false;break;}[check[i],check[z]]=[check[z],check[i]];z=i;}
  if(valid&&check.every((v,i)=>v===(i+1)%size))validUpper=upperPath;
 }
 function* visit(blank,previous,depth,heuristic){
  const f=depth+heuristic;if(f>bound)return f;if(heuristic===0)return true;
  if(++nodes%256===0)yield {nodes,lowerBound:bound};
  let minimum=Infinity;
  const options=adj(blank).filter(i=>i!==previous).map(i=>({i,h:heuristic-at(i,board[i])+at(blank,board[i])})).sort((a,b)=>a.h-b.h);
  for(const next of options){
   [board[blank],board[next.i]]=[board[next.i],board[blank]];const key=board.join(',');
   if(!seenPath.has(key)){
    seenPath.add(key);path.push(next.i);const result=yield* visit(next.i,blank,depth+1,next.h);
    if(result===true)return true;minimum=Math.min(minimum,result);path.pop();seenPath.delete(key);
   }
   [board[blank],board[next.i]]=[board[next.i],board[blank]];
  }
  return minimum;
 }
 for(;;){
  if(validUpper&&bound>=validUpper.length)return {path:validUpper.slice(),distance:validUpper.length,nodes};
  const result=yield* visit(board.indexOf(0),-1,0,h);
  if(result===true)return {path:path.slice(),distance:path.length,nodes};
  if(!Number.isFinite(result))throw Error('No solution');bound=result;yield {nodes,lowerBound:bound};
 }
};
function solveExact(board,n,{signal,upperPath,onProgress=()=>{},worker=true}={}){
 const fallback=()=>new Promise((resolve,reject)=>{
  const search=exactSearch(board,n,upperPath);
  function step(){
   if(signal?.aborted){reject(new DOMException('Cancelled','AbortError'));return;}
   try{const until=performance.now()+5;let result;
    do{result=search.next();if(result.done){resolve(result.value);return;}}while(performance.now()<until);
    onProgress(result.value);setTimeout(step,0);
   }catch(e){reject(e);}
  }step();
 });
 if(!worker||typeof Worker==='undefined')return fallback();
 return new Promise((resolve,reject)=>{
  let thread,url,done=false;
  const clean=()=>{thread?.terminate();if(url)URL.revokeObjectURL(url);signal?.removeEventListener('abort',cancel);};
  const finish=(error,value)=>{if(done)return;done=true;clean();error?reject(error):resolve(value);};
  const cancel=()=>finish(new DOMException('Cancelled','AbortError'));
  if(signal?.aborted){cancel();return;}
  try{
   const source=`const exactSearch=${exactSearch.toString()};onmessage=({data})=>{try{const it=exactSearch(data.board,data.n,data.upperPath);let out,last=0;do{out=it.next();if(!out.done&&performance.now()-last>250){postMessage({progress:out.value});last=performance.now();}}while(!out.done);postMessage({result:out.value});}catch(e){postMessage({error:e.message});}};`;
   url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));thread=new Worker(url);signal?.addEventListener('abort',cancel,{once:true});
   thread.onmessage=({data})=>{if(data.error)finish(Error(data.error));else if(data.result)finish(null,data.result);else onProgress(data.progress);};
   thread.onerror=()=>{if(done)return;done=true;clean();fallback().then(resolve,reject);};
   thread.postMessage({board,n,upperPath});
  }catch{clean();fallback().then(resolve,reject);}
 });
}

// Remove detours from the known solution without claiming they were optimal.
function shortenPath(input,n,path){
 if(!Array.isArray(path))return null;
 let board=input.slice(),route=[],states=[P.key(board)],seen=new Map([[states[0],0]]);
 for(const index of path){
  if(!P.neighbors(board,n).includes(index))return null;
  board=P.move(board,index,n);const key=P.key(board),earlier=seen.get(key);
  if(earlier!==undefined){
   for(let i=states.length-1;i>earlier;i--)seen.delete(states[i]);
   states.length=earlier+1;route.length=earlier;
  }else{route.push(index);states.push(key);seen.set(key,route.length);}
 }
 return P.isSolved(board)?route:null;
}
function solve(board,n,options={}){
 if(options.signal?.aborted)return Promise.reject(new DOMException('Cancelled','AbortError'));
 if(!Number.isInteger(n)||n<2||n>9||!P.isSolvable(board,n))return Promise.reject(Error('Invalid or unsolvable board'));
 if(n===3)return Promise.resolve({distance:P.threeDistance(board),nodes:0});
 const upperPath=shortenPath(board,n,options.upperPath);
 return solveExact(board,n,{...options,upperPath});
}
const api={solve,exactSearch,shortenPath};if(typeof module!=="undefined"&&module.exports)module.exports=api;else root.SimpleHint=api;
})(globalThis);
