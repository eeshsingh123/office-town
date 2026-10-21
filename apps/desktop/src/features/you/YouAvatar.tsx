import { Avatar } from "../../ui/Avatar.tsx";
import { useYou } from "./you.ts";

// The user's own face, from their profile, wherever they speak.
export function YouAvatar({ size }: { size: number }) {
  const you = useYou();
  return <Avatar name={you.name.trim() || "You"} colour={you.colour} size={size} />;
}

export function useYourName(): string {
  return useYou().name.trim() || "You";
}
