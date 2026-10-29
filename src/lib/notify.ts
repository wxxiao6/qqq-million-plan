import { toast } from "sonner";

export function notifySaved(message = "已保存") {
  toast.success(message);
}
