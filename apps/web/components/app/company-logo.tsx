import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar"
import { cn } from "@workspace/ui/lib/utils"

export function CompanyLogo({
  initials,
  size = "default",
}: {
  initials: string
  size?: "default" | "lg"
}) {
  return (
    <Avatar
      size={size}
      className={cn(size === "lg" && "size-14")}
      aria-hidden="true"
    >
      <AvatarFallback className="font-heading font-extrabold">
        {initials}
      </AvatarFallback>
    </Avatar>
  )
}
