import type { WaitingRequest } from "../../store/records.ts";

export function requestLabel(request: WaitingRequest): string {
  switch (request.event.type) {
    case "permission.requested":
      return "Needs your approval";
    case "question.requested":
      return "Has a question";
    case "proposal.requested":
      return "Proposes a team";
    case "plan.requested":
      return "Proposes a plan";
  }
}
