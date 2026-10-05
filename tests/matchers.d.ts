import "vitest";

declare module "vitest" {
  interface Matchers<R = unknown> {
    toHaveNoViolations(): R;
  }
}
