import { expect, it } from "vitest";
import {
  beginCourseCommit,
  endCourseCommit,
  getCommittingJobId,
  subscribeCourseCommit,
} from "./courseCommitStore.js";

it("keeps the committing job id across listeners and settles idempotently", () => {
  endCourseCommit("reset");
  const seen: (string | null)[] = [];
  const unsubscribe = subscribeCourseCommit(() =>
    seen.push(getCommittingJobId()),
  );

  beginCourseCommit("job-1");
  expect(getCommittingJobId()).toBe("job-1");

  // A stale end for another job must not clear the current one — and it
  // does not even notify: listeners only see real state transitions.
  endCourseCommit("job-other");
  expect(getCommittingJobId()).toBe("job-1");

  endCourseCommit("job-1");
  endCourseCommit("job-1"); // double settle is harmless
  expect(getCommittingJobId()).toBeNull();

  expect(seen).toEqual(["job-1", null]);
  unsubscribe();
});
