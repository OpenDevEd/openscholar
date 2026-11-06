/**
 * The server streams the page's frame before the question stage in front of it, so the browser could paint the light
 * page in between. On an address the stage will open on, this holds the page back until the sky opens (question-stage.tsx
 * lets it go), and the browser is told not to paint until the stage has arrived. Coming from the hero it also waits for a
 * slow stylesheet (app/question-stage/hold) that the planet's script removes once its first frame is drawn, so the hero
 * stays on screen until the planet is there. A browser waits only for elements its parser meets and for files still
 * loading, and only for ones added before the body starts, which is why this runs in the head. It lets go by itself too, so nothing can leave a page hidden for good.
 */
/** The question stage's planet (marketing/src/planet/earth.js), at an address that changes whenever the file does. */
export const EARTH_SCRIPT = `/question-stage/earth.js?v=${process.env.QUESTION_STAGE_EARTH_VERSION}`;

export const QUESTION_STAGE_SCRIPT = `(function(){var s=new URLSearchParams(location.search),q=s.get("question"),k=s.get("q"),d=document.documentElement;if(!/^\\/results\\/?$/.test(location.pathname)||!q||!q.trim()||(k&&k.trim()))return;d.dataset.questionStage="";var l=document.createElement("link");l.rel="expect";l.href="#question-stage";l.setAttribute("blocking","render");document.head.append(l);if(s.get("hero")){var h=document.createElement("link");h.rel="stylesheet";h.id="question-stage-hold";h.href="/question-stage/hold";h.setAttribute("blocking","render");document.head.append(h);var w=+s.get("hero").split(",")[0],z=w>0?innerWidth/w:1;if(z>0&&Math.abs(z-1)>.004)d.style.setProperty("--hero-scale",String(z));var j=document.createElement("script");j.src="${EARTH_SCRIPT}";j.setAttribute("blocking","render");document.head.append(j)}setTimeout(function(){delete d.dataset.questionStage},15000)})()`;
