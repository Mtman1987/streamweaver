
import { CommandForm } from "../command-form";

export default function NewCommandPage() {
  return (
    <div>
      <div className="mb-4">
        <h1 className="text-3xl font-bold tracking-tight">Create New Command</h1>
        <p className="text-muted-foreground">Set up a new command and its trigger.</p>
      </div>
      <CommandForm />
    </div>
  );
}
