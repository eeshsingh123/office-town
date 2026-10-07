import type { UserRequestEvent } from "@office-town/contract";

export function requestSummary(event: UserRequestEvent): string {
  switch (event.type) {
    case "permission.requested":
      return event.payload.title;
    case "question.requested":
      return event.payload.questions[0]?.text ?? "A question";
    case "proposal.requested":
      return event.payload.departmentId === undefined
        ? `Proposes a team: ${event.payload.team.name}`
        : "Wants to change the team";
    case "plan.requested":
      return event.payload.replan ? "Wants to change the plan" : "Proposes a plan";
  }
}
