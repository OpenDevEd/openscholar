export const SIDEBAR_WIDTH_EXPANDED = 280;
export const SIDEBAR_WIDTH_COLLAPSED = 72;
export const SIDEBAR_STORAGE_KEY = "openalex-sidebar";

/**
 * Runs before first paint and sets --app-sidebar-width from the saved sidebar
 * state, so the space the sidebar takes is reserved before it mounts. Matches
 * the store: collapsed unless saved open, and collapsed from 1024 to 1279px.
 */
export const sidebarWidthScript = `try{var s=JSON.parse(localStorage.getItem(${JSON.stringify(SIDEBAR_STORAGE_KEY)})||"{}").state,w=innerWidth;document.documentElement.style.setProperty("--app-sidebar-width",(!s||s.isCollapsed!==false||(w>=1024&&w<1280)?${SIDEBAR_WIDTH_COLLAPSED}:${SIDEBAR_WIDTH_EXPANDED})+"px")}catch(e){}`;
