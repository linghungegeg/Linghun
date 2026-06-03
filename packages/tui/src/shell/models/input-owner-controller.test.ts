import { describe, expect, it } from "vitest";
import {
  OWNER_PASTE_THRESHOLD,
  OWNER_PRIORITY,
  type OwnerContext,
  type OwnerKeyShape,
  isNavigationKey,
  selectInputOwner,
  shouldOwnerBePaste,
} from "./input-owner-controller.js";

const noKey: OwnerKeyShape & Record<string, unknown> = {
  ctrl: false,
  meta: false,
  escape: false,
  tab: false,
  return: false,
  shift: false,
};

const idleCtx: OwnerContext = {
  permissionActive: false,
  pastePending: false,
  slashVisible: false,
};

describe("OWNER_PRIORITY", () => {
  it("is fixed permission > panel > paste > slash > composer", () => {
    expect(OWNER_PRIORITY).toEqual(["permission", "panel", "paste", "slash", "composer"]);
  });
});

describe("shouldOwnerBePaste", () => {
  it("returns true when input length exceeds threshold", () => {
    const big = "x".repeat(OWNER_PASTE_THRESHOLD + 1);
    expect(shouldOwnerBePaste(big, noKey, false)).toBe(true);
  });

  it("returns false for small input outside paste pending", () => {
    expect(shouldOwnerBePaste("a", noKey, false)).toBe(false);
  });

  it("aggregates small chunks while pastePending", () => {
    expect(shouldOwnerBePaste("a", noKey, true)).toBe(true);
  });

  it("does not aggregate ctrl/meta/escape/tab/return events", () => {
    expect(shouldOwnerBePaste("a", { ...noKey, ctrl: true }, true)).toBe(false);
    expect(shouldOwnerBePaste("a", { ...noKey, meta: true }, true)).toBe(false);
    expect(shouldOwnerBePaste("a", { ...noKey, escape: true }, true)).toBe(false);
    expect(shouldOwnerBePaste("a", { ...noKey, tab: true }, true)).toBe(false);
    expect(shouldOwnerBePaste("a", { ...noKey, return: true }, true)).toBe(false);
  });

  it("does not aggregate empty input even when pending", () => {
    expect(shouldOwnerBePaste("", noKey, true)).toBe(false);
  });
});

describe("isNavigationKey", () => {
  it("returns true for arrow keys", () => {
    expect(isNavigationKey({ ...noKey, upArrow: true } as OwnerKeyShape)).toBe(true);
    expect(isNavigationKey({ ...noKey, downArrow: true } as OwnerKeyShape)).toBe(true);
    expect(isNavigationKey({ ...noKey, leftArrow: true } as OwnerKeyShape)).toBe(true);
    expect(isNavigationKey({ ...noKey, rightArrow: true } as OwnerKeyShape)).toBe(true);
  });

  it("returns false otherwise", () => {
    expect(isNavigationKey(noKey)).toBe(false);
    expect(isNavigationKey({ ...noKey, return: true })).toBe(false);
  });
});

describe("selectInputOwner — permission has highest priority", () => {
  it("permission wins over everything else", () => {
    const ctx: OwnerContext = { permissionActive: true, pastePending: true, slashVisible: true };
    expect(selectInputOwner("a", noKey, ctx)).toBe("permission");
    expect(selectInputOwner("x".repeat(50), noKey, ctx)).toBe("permission");
    expect(selectInputOwner("", { ...noKey, return: true }, ctx)).toBe("permission");
  });
});

describe("selectInputOwner — paste second", () => {
  it("paste owner on big chunk even with slash visible", () => {
    const ctx: OwnerContext = { ...idleCtx, slashVisible: true };
    const big = "x".repeat(OWNER_PASTE_THRESHOLD + 1);
    expect(selectInputOwner(big, noKey, ctx)).toBe("paste");
  });

  it("paste owner on Enter while pastePending (so Composer can swallow)", () => {
    const ctx: OwnerContext = { ...idleCtx, pastePending: true };
    expect(selectInputOwner("", { ...noKey, return: true }, ctx)).toBe("paste");
  });

  it("paste owner on Escape while pastePending (so Composer can cancel)", () => {
    const ctx: OwnerContext = { ...idleCtx, pastePending: true };
    expect(selectInputOwner("", { ...noKey, escape: true }, ctx)).toBe("paste");
  });

  it("paste owner on aggregated single char while pastePending", () => {
    const ctx: OwnerContext = { ...idleCtx, pastePending: true };
    expect(selectInputOwner("a", noKey, ctx)).toBe("paste");
  });
});

describe("selectInputOwner — panel second", () => {
  it("panel owns Escape before paste/slash/composer", () => {
    const ctx: OwnerContext = {
      ...idleCtx,
      panelActive: true,
      pastePending: true,
      slashVisible: true,
    };
    expect(selectInputOwner("", { ...noKey, escape: true }, ctx)).toBe("panel");
  });

  it("panel owns Ctrl+O for details without blocking ordinary typing", () => {
    const ctx: OwnerContext = { ...idleCtx, panelActive: true };
    expect(selectInputOwner("o", { ...noKey, ctrl: true }, ctx)).toBe("panel");
    expect(selectInputOwner("a", noKey, ctx)).toBe("composer");
  });
});

describe("selectInputOwner — slash third", () => {
  it("slash owner on Enter when slash candidates visible", () => {
    const ctx: OwnerContext = { ...idleCtx, slashVisible: true };
    expect(selectInputOwner("", { ...noKey, return: true }, ctx)).toBe("slash");
  });

  it("slash owner on Tab when visible", () => {
    const ctx: OwnerContext = { ...idleCtx, slashVisible: true };
    expect(selectInputOwner("", { ...noKey, tab: true }, ctx)).toBe("slash");
  });

  it("slash owner on Escape when visible", () => {
    const ctx: OwnerContext = { ...idleCtx, slashVisible: true };
    expect(selectInputOwner("", { ...noKey, escape: true }, ctx)).toBe("slash");
  });

  it("slash owner on arrow keys when visible", () => {
    const ctx: OwnerContext = { ...idleCtx, slashVisible: true };
    expect(selectInputOwner("", { ...noKey, upArrow: true } as OwnerKeyShape, ctx)).toBe("slash");
    expect(selectInputOwner("", { ...noKey, downArrow: true } as OwnerKeyShape, ctx)).toBe("slash");
  });

  it("slash visible but ordinary char → falls through to composer", () => {
    const ctx: OwnerContext = { ...idleCtx, slashVisible: true };
    expect(selectInputOwner("h", noKey, ctx)).toBe("composer");
  });
});

describe("selectInputOwner — composer default", () => {
  it("composer wins on plain typing with no other owners", () => {
    expect(selectInputOwner("a", noKey, idleCtx)).toBe("composer");
    expect(selectInputOwner("", { ...noKey, return: true }, idleCtx)).toBe("composer");
  });
});
