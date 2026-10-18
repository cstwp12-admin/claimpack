"use strict";
/* ================================================================
   ClaimPack receipt scanner (same method as the timesheet app's scanner)
   1. live camera finds the receipt (bright paper on a darker surface)
   2. drag the four corners to the receipt's edges
   3. straighten (perspective), then B&W / Grey / Colour / Original, rotate
   Receipts of any length keep their own proportions.  Developed by WPN.
   ================================================================ */
const SCAN_MODE_KEY="claimpack-scanmode";
let camStream=null,camLoop=0;
const canLiveCam=()=>!!(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia&&window.isSecureContext);
async function startCam(video){
  camStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"},width:{ideal:1920},height:{ideal:1080}},audio:false});
  video.srcObject=camStream;video.setAttribute("playsinline","");video.muted=true;await video.play();
}
function stopCam(){clearTimeout(camLoop);if(camStream)camStream.getTracks().forEach(t=>t.stop());camStream=null;}
function closeCam(){stopCam();$("#cam").hidden=true;$("#cam-view").innerHTML=`<span class="cam-hint" id="cam-hint"></span>`;$("#cam-bar").innerHTML="";document.body.style.overflow="";}
function pickPhoto(capture){
  return new Promise(res=>{
    const inp=$("#f-scan");if(capture)inp.setAttribute("capture","environment");else inp.removeAttribute("capture");
    inp.onchange=()=>{const f=inp.files[0];inp.value="";res(f||null);};inp.click();
  });
}
async function loadImage(blob){
  if(window.createImageBitmap){try{return await createImageBitmap(blob,{imageOrientation:"from-image"});}catch(e){}}
  return new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>rej(new Error("This image cannot be opened here (HEIC? use JPEG)."));i.src=URL.createObjectURL(blob);});
}
async function busyRun(msg,fn){busy(true,msg);try{return await fn();}catch(e){console.error(e);toast(`Something went wrong: ${e.message||e}`);}finally{busy(false);}}

function detectQuad(src,sw,sh){
  const MAXS=360,sc=Math.min(1,MAXS/Math.max(sw,sh)),w=Math.max(8,Math.round(sw*sc)),h=Math.max(8,Math.round(sh*sc));
  const cv=document.createElement("canvas");cv.width=w;cv.height=h;
  const ctx=cv.getContext("2d",{willReadFrequently:true});ctx.drawImage(src,0,0,w,h);
  const d=ctx.getImageData(0,0,w,h).data,g=new Float32Array(w*h);
  for(let i=0;i<w*h;i++)g[i]=d[i*4]*.299+d[i*4+1]*.587+d[i*4+2]*.114;
  const b=new Float32Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){let s=0,n=0;for(let dy=-2;dy<=2;dy++){const yy=y+dy;if(yy<0||yy>=h)continue;for(let dx=-2;dx<=2;dx++){const xx=x+dx;if(xx<0||xx>=w)continue;s+=g[yy*w+xx];n++;}}b[y*w+x]=s/n;}
  const hist=new Array(256).fill(0);for(let i=0;i<w*h;i++)hist[Math.min(255,b[i]|0)]++;
  let sum=0;for(let i=0;i<256;i++)sum+=i*hist[i];
  let sB=0,wB=0,best=0,th=128;const tot=w*h;
  for(let t=0;t<256;t++){wB+=hist[t];if(!wB)continue;const wF=tot-wB;if(!wF)break;sB+=t*hist[t];const mB=sB/wB,mF=(sum-sB)/wF,v=wB*wF*(mB-mF)*(mB-mF);if(v>best){best=v;th=t;}}
  const mask=new Uint8Array(w*h);for(let i=0;i<w*h;i++)mask[i]=b[i]>th?1:0;
  const lab=new Int32Array(w*h),stack=new Int32Array(w*h);let bestN=0,bestL=0,L=0;
  for(let i=0;i<w*h;i++){
    if(!mask[i]||lab[i])continue;L++;let sp=0,n=0;stack[sp++]=i;lab[i]=L;
    while(sp){const p=stack[--sp];n++;const x=p%w,y=(p/w)|0;
      if(x>0&&mask[p-1]&&!lab[p-1]){lab[p-1]=L;stack[sp++]=p-1;}
      if(x<w-1&&mask[p+1]&&!lab[p+1]){lab[p+1]=L;stack[sp++]=p+1;}
      if(y>0&&mask[p-w]&&!lab[p-w]){lab[p-w]=L;stack[sp++]=p-w;}
      if(y<h-1&&mask[p+w]&&!lab[p+w]){lab[p+w]=L;stack[sp++]=p+w;}}
    if(n>bestN){bestN=n;bestL=L;}
  }
  if(bestN<w*h*.05)return null;   // receipts can be narrow: accept a smaller region than a full sheet
  let tl=[0,0,1e9],tr=[0,0,-1e9],br=[0,0,-1e9],bl=[0,0,1e9];
  for(let i=0;i<w*h;i++){if(lab[i]!==bestL)continue;const x=i%w,y=(i/w)|0;
    if(x+y<tl[2])tl=[x,y,x+y];if(x+y>br[2])br=[x,y,x+y];if(x-y>tr[2])tr=[x,y,x-y];if(x-y<bl[2])bl=[x,y,x-y];}
  const q=[tl,tr,br,bl].map(([x,y])=>[x/(w-1),y/(h-1)]);
  if(Math.abs(polyArea(q))<.04)return null;
  return q;
}
function polyArea(q){let a=0;for(let i=0;i<4;i++){const [x1,y1]=q[i],[x2,y2]=q[(i+1)%4];a+=x1*y2-x2*y1;}return a/2;}
function homography(src,dst){
  const A=[],B=[];
  for(let i=0;i<4;i++){const [x,y]=dst[i],[u,v]=src[i];A.push([x,y,1,0,0,0,-u*x,-u*y]);B.push(u);A.push([0,0,0,x,y,1,-v*x,-v*y]);B.push(v);}
  for(let c=0;c<8;c++){let p=c;for(let r=c+1;r<8;r++)if(Math.abs(A[r][c])>Math.abs(A[p][c]))p=r;
    [A[c],A[p]]=[A[p],A[c]];[B[c],B[p]]=[B[p],B[c]];
    for(let r=0;r<8;r++){if(r===c)continue;const f=A[r][c]/A[c][c];for(let k=c;k<8;k++)A[r][k]-=f*A[c][k];B[r]-=f*B[c];}}
  const hm=B.map((b,i)=>b/A[i][i]);hm.push(1);return hm;
}
function warpQuad(img,quad,maxOut=2400){
  const sc=Math.min(1,3000/Math.max(img.width,img.height)),iw=Math.round(img.width*sc),ih=Math.round(img.height*sc);
  const sc0=document.createElement("canvas");sc0.width=iw;sc0.height=ih;const sx=sc0.getContext("2d",{willReadFrequently:true});sx.drawImage(img,0,0,iw,ih);
  const sd=sx.getImageData(0,0,iw,ih).data,P=quad.map(([x,y])=>[x*(iw-1),y*(ih-1)]),dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
  let W=Math.max(dist(P[0],P[1]),dist(P[3],P[2])),H=Math.max(dist(P[0],P[3]),dist(P[1],P[2]));
  const k=Math.min(1,maxOut/Math.max(W,H));W=Math.round(W*k);H=Math.round(H*k);
  if(Math.min(W,H)<500){const up=Math.min(3,500/Math.min(W,H));W=Math.round(W*up);H=Math.round(H*up);}
  const hm=homography(P,[[0,0],[W-1,0],[W-1,H-1],[0,H-1]]);
  const out=document.createElement("canvas");out.width=W;out.height=H;const ox=out.getContext("2d"),od=ox.createImageData(W,H),o=od.data;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const den=hm[6]*x+hm[7]*y+1,u=(hm[0]*x+hm[1]*y+hm[2])/den,v=(hm[3]*x+hm[4]*y+hm[5])/den;
    const x0=Math.max(0,Math.min(iw-2,u|0)),y0=Math.max(0,Math.min(ih-2,v|0)),fx=Math.min(1,Math.max(0,u-x0)),fy=Math.min(1,Math.max(0,v-y0));
    const i00=(y0*iw+x0)*4,i10=i00+4,i01=i00+iw*4,i11=i01+4,oi=(y*W+x)*4;
    for(let c=0;c<3;c++)o[oi+c]=(sd[i00+c]*(1-fx)+sd[i10+c]*fx)*(1-fy)+(sd[i01+c]*(1-fx)+sd[i11+c]*fx)*fy;
    o[oi+3]=255;
  }
  ox.putImageData(od,0,0);return out;
}
function cleanUp(cv,mode){
  if(mode==="original")return cv;
  const W=cv.width,H=cv.height,ctx=cv.getContext("2d",{willReadFrequently:true}),id=ctx.getImageData(0,0,W,H),d=id.data;
  const g=new Float32Array(W*H);for(let i=0;i<W*H;i++)g[i]=d[i*4]*.299+d[i*4+1]*.587+d[i*4+2]*.114;
  const r=Math.max(8,Math.round(Math.max(W,H)/40)),I=new Float64Array((W+1)*(H+1));
  for(let y=0;y<H;y++){let row=0;for(let x=0;x<W;x++){row+=g[y*W+x];I[(y+1)*(W+1)+x+1]=I[y*(W+1)+x+1]+row;}}
  const bg=new Float32Array(W*H);
  for(let y=0;y<H;y++){const y0=Math.max(0,y-r),y1=Math.min(H,y+r+1);
    for(let x=0;x<W;x++){const x0=Math.max(0,x-r),x1=Math.min(W,x+r+1);
      const s=I[y1*(W+1)+x1]-I[y0*(W+1)+x1]-I[y1*(W+1)+x0]+I[y0*(W+1)+x0];bg[y*W+x]=s/((y1-y0)*(x1-x0));}}
  for(let i=0;i<W*H;i++){
    const paper=Math.max(40,bg[i]*1.08);let v=Math.min(1,g[i]/paper);
    if(mode==="bw"){v=v>.86?1:Math.pow(Math.max(0,(v-.25)/.61),1.8);const c=Math.round(v*255);d[i*4]=d[i*4+1]=d[i*4+2]=c;}
    else if(mode==="grey"){v=Math.pow(Math.min(1,v*1.04),1.5);const c=Math.round(v*255);d[i*4]=d[i*4+1]=d[i*4+2]=c;}
    else{const f=255/paper;for(let c=0;c<3;c++){let x=Math.min(1,d[i*4+c]*f/255);x=x>.92?1:Math.pow(x,1.25);d[i*4+c]=Math.round(x*255);}}
  }
  ctx.putImageData(id,0,0);return cv;
}
function rotateCanvas(cv,deg){
  if(!deg)return cv;const o=document.createElement("canvas"),s=deg%180!==0;
  o.width=s?cv.height:cv.width;o.height=s?cv.width:cv.height;const x=o.getContext("2d");
  x.translate(o.width/2,o.height/2);x.rotate(deg*Math.PI/180);x.drawImage(cv,-cv.width/2,-cv.height/2);return o;
}
/* openScanner({title, image}) -> Promise<File|null>.  With image: skip the camera and crop that picture. */
function openScanner({title="Scan receipt",image=null,name="receipt"}={}){
  return new Promise(resolve=>{
    let done=false;
    const finish=f=>{if(done)return;done=true;closeCam();resolve(f||null);};
    $("#cam").hidden=false;document.body.style.overflow="hidden";$("#cam-title").textContent=title;
    $("#cam-close").onclick=()=>finish(null);
    async function live(){
      if(!canLiveCam()){const f=await pickPhoto(true);if(!f)return finish(null);return adjust(await loadImage(f));}
      const view=$("#cam-view");
      view.innerHTML=`<video></video><canvas class="ovl"></canvas><span class="cam-hint" id="cam-hint">Lay the receipt flat on a darker surface</span>`;
      $("#cam-bar").innerHTML=`<button class="cbtn" id="sc-gal" type="button">Gallery</button><button class="shutter" id="sc-shot" type="button" aria-label="Take the photo"></button><span style="width:80px"></span>`;
      const video=view.querySelector("video"),ovl=view.querySelector("canvas.ovl");
      try{await startCam(video);}catch(e){toast("Live camera not available — using the camera app.");const f=await pickPhoto(true);if(!f)return finish(null);return adjust(await loadImage(f));}
      let quad=null;
      const loop=()=>{
        if(!camStream)return;
        if(video.videoWidth){
          quad=detectQuad(video,video.videoWidth,video.videoHeight);
          const r=video.getBoundingClientRect(),vr=view.getBoundingClientRect();
          ovl.width=r.width;ovl.height=r.height;ovl.style.left=(r.left-vr.left)+"px";ovl.style.top=(r.top-vr.top)+"px";
          const c=ovl.getContext("2d");c.clearRect(0,0,ovl.width,ovl.height);
          if(quad){c.beginPath();quad.forEach(([x,y],i)=>c[i?"lineTo":"moveTo"](x*r.width,y*r.height));c.closePath();c.fillStyle="rgba(217,72,15,.18)";c.fill();c.lineWidth=3;c.strokeStyle="#FF7A33";c.stroke();}
          const h=$("#cam-hint");if(h)h.textContent=quad?"Receipt found · hold steady and tap the button":"Lay the receipt flat on a darker surface";
        }
        camLoop=setTimeout(loop,220);
      };
      loop();
      $("#sc-shot").onclick=()=>{const cv=document.createElement("canvas");cv.width=video.videoWidth;cv.height=video.videoHeight;cv.getContext("2d").drawImage(video,0,0);stopCam();adjust(cv,quad);};
      $("#sc-gal").onclick=async()=>{stopCam();const f=await pickPhoto(false);if(!f)return live();adjust(await loadImage(f));};
    }
    function adjust(img,quad0){
      const quad=(quad0||detectQuad(img,img.width,img.height)||[[.03,.03],[.97,.03],[.97,.97],[.03,.97]]).map(p=>p.slice());
      const view=$("#cam-view");
      view.innerHTML=`<canvas class="base"></canvas><span class="cam-hint" id="cam-hint">Drag the corners to the edges of the receipt</span>`;
      const base=view.querySelector("canvas.base"),sc=Math.min(1,1400/Math.max(img.width,img.height));
      base.width=Math.round(img.width*sc);base.height=Math.round(img.height*sc);
      const bx=base.getContext("2d");
      const handles=quad.map(()=>{const hdl=document.createElement("div");hdl.className="handle";view.appendChild(hdl);return hdl;});
      function draw(){
        bx.drawImage(img,0,0,base.width,base.height);
        bx.fillStyle="rgba(0,0,0,.4)";bx.beginPath();bx.rect(0,0,base.width,base.height);
        quad.forEach(([x,y],i)=>bx[i?"lineTo":"moveTo"](x*base.width,y*base.height));bx.closePath();bx.fill("evenodd");
        bx.strokeStyle="#FF7A33";bx.lineWidth=Math.max(2,base.width/300);bx.beginPath();quad.forEach(([x,y],i)=>bx[i?"lineTo":"moveTo"](x*base.width,y*base.height));bx.closePath();bx.stroke();
        const r=base.getBoundingClientRect(),vr=view.getBoundingClientRect();
        handles.forEach((hdl,i)=>{hdl.style.left=(r.left-vr.left+quad[i][0]*r.width)+"px";hdl.style.top=(r.top-vr.top+quad[i][1]*r.height)+"px";});
      }
      handles.forEach((hdl,i)=>{
        hdl.addEventListener("pointerdown",e=>{e.preventDefault();hdl.setPointerCapture(e.pointerId);
          const move=ev=>{const r=base.getBoundingClientRect();quad[i]=[Math.min(1,Math.max(0,(ev.clientX-r.left)/r.width)),Math.min(1,Math.max(0,(ev.clientY-r.top)/r.height))];draw();};
          const up=()=>{hdl.removeEventListener("pointermove",move);hdl.removeEventListener("pointerup",up);};
          hdl.addEventListener("pointermove",move);hdl.addEventListener("pointerup",up);});
      });
      requestAnimationFrame(draw);window.addEventListener("resize",draw,{once:true});
      $("#cam-bar").innerHTML=`<button class="cbtn" id="sc-retake" type="button">${image?"Cancel":"Retake"}</button><button class="cbtn" id="sc-full" type="button">Whole photo</button><button class="cbtn acc" id="sc-next" type="button">Next ›</button>`;
      $("#sc-retake").onclick=()=>image?finish(null):live();
      $("#sc-full").onclick=()=>{quad.splice(0,4,[0,0],[1,0],[1,1],[0,1]);draw();};
      $("#sc-next").onclick=()=>busyRun("Straightening…",async()=>{await new Promise(r=>setTimeout(r,30));review(warpQuad(img,quad),img,quad);});
    }
    function review(flat,img,quad){
      let mode="bw",rot=0,out=null;try{mode=localStorage.getItem(SCAN_MODE_KEY)||"bw";}catch(e){}
      const view=$("#cam-view");
      view.innerHTML=`<canvas class="base" style="background:#fff"></canvas><span class="cam-hint" id="cam-hint">Check the date, amounts and numbers are clear</span>`;
      const base=view.querySelector("canvas.base");
      const redo=()=>busyRun("Cleaning up…",async()=>{
        await new Promise(r=>setTimeout(r,20));
        const c=document.createElement("canvas");c.width=flat.width;c.height=flat.height;c.getContext("2d").drawImage(flat,0,0);
        out=rotateCanvas(cleanUp(c,mode),rot);base.width=out.width;base.height=out.height;base.getContext("2d").drawImage(out,0,0);
      });
      $("#cam-bar").innerHTML=`<div class="seg" id="sc-mode"><button type="button" data-m="bw">B&amp;W</button><button type="button" data-m="grey">Grey</button><button type="button" data-m="colour">Colour</button><button type="button" data-m="original">Original</button></div>
        <button class="cbtn" id="sc-rot" type="button" aria-label="Rotate">⟳</button><button class="cbtn" id="sc-back" type="button">Corners</button><button class="cbtn acc" id="sc-keep" type="button">Use photo</button>`;
      const setSeg=()=>$$("#sc-mode button").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.m===mode)));
      setSeg();
      $("#sc-mode").onclick=e=>{const b=e.target.closest("[data-m]");if(!b)return;mode=b.dataset.m;try{localStorage.setItem(SCAN_MODE_KEY,mode);}catch(err){}setSeg();redo();};
      $("#sc-rot").onclick=()=>{rot=(rot+90)%360;redo();};
      $("#sc-back").onclick=()=>adjust(img,quad);
      $("#sc-keep").onclick=async()=>{const blob=await new Promise(r=>out.toBlob(r,"image/jpeg",.88));finish(new File([blob],`${name}_${Date.now()}.jpg`,{type:"image/jpeg"}));};
      redo();
    }
    if(image)loadImage(image).then(img=>adjust(img)).catch(e=>{toast(e.message);finish(null);});else live();
  });
}
