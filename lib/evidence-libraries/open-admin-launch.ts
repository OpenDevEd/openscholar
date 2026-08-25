import "client-only";

export function openAdminLaunchUrl(launchUrl: string) {
  window.location.assign(launchUrl);
}
