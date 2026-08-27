/**
 * Minimal type declarations for `jest-axe` (#822).
 *
 * `jest-axe` ships without bundled types. Declare the two members used in the
 * accessibility regression tests so `tsc --noEmit` stays clean:
 *  - `axe(html)`   → runs the automated a11y engine on a rendered container.
 *  - `toHaveNoViolations` → the Jest matcher, extended onto Jest's matchers.
 */

declare module "jest-axe" {
  import type { AxeResults } from "axe-core";

  export const axe: (html: Element | undefined | null) => Promise<AxeResults>;
  // Acceptable for `expect.extend(toHaveNoViolations)`; its exact runtime shape
  // is not part of the public contract we rely on here.
  export const toHaveNoViolations: any;
}

declare namespace jest {
  interface Matchers<R> {
    toHaveNoViolations(): R;
  }
}