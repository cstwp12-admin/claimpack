/* docs theme: mobile menu, contents list for long pages, heading links, app version */
(function(){
  var btn=document.getElementById("menu-btn"),nav=document.getElementById("nav");
  if(btn)btn.addEventListener("click",function(){var o=nav.classList.toggle("open");btn.setAttribute("aria-expanded",String(o));});
  var doc=document.getElementById("main"),hs=doc?doc.querySelectorAll("h2[id],h3[id]"):[];
  hs.forEach(function(h){var a=document.createElement("a");a.className="anchor";a.href="#"+h.id;a.textContent="#";a.setAttribute("aria-label","Link to this section");h.appendChild(a);});
  var toc=document.getElementById("toc");
  if(toc){
    var ol=toc.querySelector("ol"),h2=doc.querySelectorAll("h2[id]"),links=[];
    h2.forEach(function(h){var li=document.createElement("li"),a=document.createElement("a");a.href="#"+h.id;a.textContent=h.textContent.replace(/#$/,"");li.appendChild(a);ol.appendChild(li);links.push([h,a]);});
    // the guide's own "Contents:" line is not needed when the sidebar is there
    doc.querySelectorAll("p > strong:first-child").forEach(function(st){if(/^Contents:?$/.test(st.textContent.trim()))st.parentNode.style.display="none";});
    if(matchMedia("(max-width:980px)").matches)toc.removeAttribute("open");   // folded on phones
    if("IntersectionObserver" in window){var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){links.forEach(function(l){l[1].classList.toggle("on",l[0]===e.target);});}});},{rootMargin:"-80px 0px -70% 0px"});links.forEach(function(l){io.observe(l[0]);});}
  }
  fetch("version.json",{cache:"no-store"}).then(function(r){return r.ok?r.json():null;}).then(function(v){if(v&&v.version)document.getElementById("ver").textContent="v"+v.version;}).catch(function(){});
})();
