import { beforeEach, describe, expect, it } from "vitest";
import { goBack, goForward, navigate, select, useApp } from "../src/store/app-store.ts";

beforeEach(() => {
  useApp.setState({ view: { name: "home" }, selection: [], back: [], forward: [] });
});

describe("history", () => {
  it("goes back to each screen with the selection it had, and drops what was ahead on a new one", () => {
    navigate({ name: "office" });
    select(["mira"]);
    navigate({ name: "task", taskId: "t1" });
    navigate({ name: "task", taskId: "t1" });

    goBack();
    expect(useApp.getState()).toMatchObject({ view: { name: "office" }, selection: ["mira"] });
    goBack();
    expect(useApp.getState().view).toEqual({ name: "home" });
    goForward();
    expect(useApp.getState().view).toEqual({ name: "office" });

    navigate({ name: "tasks" });
    expect(useApp.getState().forward).toEqual([]);
    expect(useApp.getState().back.map((visit) => visit.view.name)).toEqual(["home", "office"]);
  });
});
