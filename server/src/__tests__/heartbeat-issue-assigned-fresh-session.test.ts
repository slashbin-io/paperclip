import { describe, expect, it } from "vitest";
import {
  describeSessionResetReason,
  shouldResetTaskSessionForWake,
} from "../services/heartbeat.ts";

// Pins the guarantee behind slashbin-io/slashbin-product-owner#184: a task
// assignment always starts a fresh agent session, so a long-lived session
// never carries one task's retained tool output into the next task.

describe("issue_assigned wakes start a fresh task session", () => {
  it("resets for a task-scoped issue_assigned wake, even with a resumable task session", () => {
    const context = {
      wakeReason: "issue_assigned",
      issueId: "issue-1",
      taskId: "issue-1",
      taskKey: "issue-1",
    };
    expect(shouldResetTaskSessionForWake(context)).toBe(true);
    expect(describeSessionResetReason(context)).toBe("wake reason is issue_assigned");
  });

  it("resets for a re-wake of the same task assigned a second time", () => {
    for (let assignment = 0; assignment < 2; assignment += 1) {
      expect(
        shouldResetTaskSessionForWake({ wakeReason: "issue_assigned", issueId: "issue-1" }),
      ).toBe(true);
    }
  });

  it("does not reset a plain comment wake, so only assignment is the fresh boundary", () => {
    expect(
      shouldResetTaskSessionForWake({ wakeReason: "issue_commented", issueId: "issue-1" }),
    ).toBe(false);
  });
});
