import { isPublicPath } from "./public-routes";

export function shouldProtectPath(pathname: string): boolean {
  return !isPublicPath(pathname);
}
