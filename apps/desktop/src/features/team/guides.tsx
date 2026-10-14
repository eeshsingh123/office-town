import { CheckCheck, FileText, MessageSquare } from "lucide-react";
import { Avatar } from "../../ui/Avatar.tsx";
import { type GuideStep, guideParts } from "../../ui/Guide.tsx";

const BLUE = "#3A6EA5";
const GREEN = "#5E8C61";
const SAND = "#B08850";

export const CHIEF_STEPS: GuideStep[] = [
  {
    title: "You give one goal",
    text: "A goal that needs more than one department, such as a new page and the email that announces it.",
    picture: (
      <span className={guideParts.chip}>
        <MessageSquare size={12} aria-hidden />
        Launch the spring sale
      </span>
    ),
  },
  {
    title: "The chief splits it",
    text: "It plans one part per department and says which part waits on which. You approve the plan first.",
    picture: (
      <span className={guideParts.column}>
        <span className={guideParts.chip}>1 · Sale page</span>
        <span className={guideParts.chip}>2 · Email, after 1</span>
      </span>
    ),
  },
  {
    title: "Departments do their parts",
    text: "Each department's lead shares its part among its members. A part starts once what it waits on is done.",
    picture: (
      <span className={guideParts.row}>
        <Avatar name="Website" colour={BLUE} size={30} />
        <Avatar name="Email" colour={GREEN} size={30} />
      </span>
    ),
  },
  {
    title: "You review the result",
    text: "The goal comes back to you with every part's result, ready to review.",
    picture: (
      <span className={guideParts.chip}>
        <CheckCheck size={12} aria-hidden />
        To review
      </span>
    ),
  },
];

export const DEPARTMENT_STEPS: GuideStep[] = [
  {
    title: "You give a task",
    text: "Give it to the department from New task, Home, or the chief's plan.",
    picture: (
      <span className={guideParts.chip}>
        <MessageSquare size={12} aria-hidden />
        Build the pricing page
      </span>
    ),
  },
  {
    title: "The lead splits it",
    text: "The lead reads its instructions and hands each member a piece that fits their role.",
    picture: <Avatar name="Lead" colour={BLUE} size={34} />,
  },
  {
    title: "Members do their pieces",
    text: "Each member follows their own instructions and the team rules, on their own model.",
    picture: (
      <span className={guideParts.row}>
        <Avatar name="Writer" colour={SAND} size={28} />
        <Avatar name="Developer" colour={GREEN} size={28} />
        <Avatar name="Reviewer" colour={BLUE} size={28} />
      </span>
    ),
  },
  {
    title: "The lead hands it back",
    text: "The lead checks and joins the pieces, then the task comes back to you to review.",
    picture: (
      <span className={guideParts.chip}>
        <FileText size={12} aria-hidden />
        Result ready
      </span>
    ),
  },
];
