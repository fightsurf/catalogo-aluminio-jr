/* AVN: animação compatível com as três imagens PNG do Workout Guide v1.0.0. */
(()=>{'use strict';
 const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
 const style=document.createElement('style');
 style.textContent='img.avn-png-animated{background:transparent!important;filter:brightness(0) saturate(100%)}';
 document.head.append(style);
 let frame=1;
 function animar(){
  if(document.hidden||reduced.matches)return;
  frame=frame===3?1:frame+1;
  document.querySelectorAll('img[data-base$="/frame-1.png"]').forEach(img=>{
   if(img.classList.contains('media-missing'))return;
   img.classList.add('avn-png-animated');
   const rect=img.getBoundingClientRect();
   if(rect.bottom<0||rect.top>window.innerHeight)return;
   const url=img.dataset.base;
   if(/^\/avn\/sistema\/midias\/[a-z0-9-]+\/frame-1\.png$/.test(url)){
    const next=url.replace('/frame-1.png',`/frame-${frame}.png`);
    if(img.getAttribute('src')!==next)img.setAttribute('src',next);
   }
  });
 }
 setInterval(animar,1050);
 // Também assegura contraste antes do primeiro ciclo, inclusive com movimento reduzido.
 function ativarContraste(){
  document.querySelectorAll('img[data-base$="/frame-1.png"]').forEach(img=>img.classList.add('avn-png-animated'));
 }
 new MutationObserver(ativarContraste).observe(document.body,{subtree:true,childList:true});
 ativarContraste();
})();
