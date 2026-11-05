/**
 * The server streams the page's frame before the question stage in front of it, so the browser could paint the light
 * page in between. On an address the stage will open on, this holds the page back until the sky opens (question-stage.tsx
 * lets it go), and Chromium is told not to paint at all until the stage has arrived and, coming from the hero, the planet
 * has drawn its first frame, so the page it came from stays on screen until then. It lets go by itself too, so nothing can leave a page hidden for good.
 */
export const QUESTION_STAGE_SCRIPT = `(function(){var s=new URLSearchParams(location.search),q=s.get("question"),k=s.get("q"),d=document.documentElement;if(!/^\\/results\\/?$/.test(location.pathname)||!q||!q.trim()||(k&&k.trim()))return;d.dataset.questionStage="";var l=document.createElement("link");l.rel="expect";l.href="#question-stage";l.setAttribute("blocking","render");document.head.append(l);if(s.get("hero")){var e=l.cloneNode();e.href="#question-stage-earth";document.head.append(e)}setTimeout(function(){delete d.dataset.questionStage},15000)})()`;
