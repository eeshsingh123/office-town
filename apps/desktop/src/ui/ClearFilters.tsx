import { RotateCcw } from "lucide-react";
import { Button } from "./Button.tsx";

// Every list with filters drops them all in one press, beside the filters while any is on.
export function ClearFilters({ shown, onClear }: { shown: boolean; onClear: () => void }) {
  if (!shown) return null;
  return (
    <Button variant="ghost" onClick={onClear}>
      <RotateCcw size={14} aria-hidden />
      Clear filters
    </Button>
  );
}
