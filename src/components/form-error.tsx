import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function FormError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <Alert variant="destructive">
      <AlertTitle>未保存</AlertTitle>
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  );
}
