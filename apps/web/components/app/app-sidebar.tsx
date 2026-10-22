"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  BrainIcon,
  BriefcaseBusinessIcon,
  FileTextIcon,
  LayoutDashboardIcon,
  ListTodoIcon,
  LogOutIcon,
  MessageSquareTextIcon,
  MoreHorizontalIcon,
  SettingsIcon,
  TargetIcon,
  UserRoundIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react"
import { useTranslations } from "next-intl"

import { signOut } from "@/app/(auth)/actions"
import { Brand } from "@/components/brand"
import { useWorkspace } from "@/components/app/workspace-context"
import { demoProfile } from "@/lib/demo-data"
import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@workspace/ui/components/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Progress } from "@workspace/ui/components/progress"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@workspace/ui/components/sidebar"

type NavKey =
  | "overview"
  | "applications"
  | "tasks"
  | "resumes"
  | "chat"
  | "searches"
  | "memory"

type NavItem = { key: NavKey; href: string; icon: LucideIcon }

const workspaceItems: NavItem[] = [
  { key: "overview", href: "/app", icon: LayoutDashboardIcon },
  {
    key: "applications",
    href: "/app/candidaturas",
    icon: BriefcaseBusinessIcon,
  },
  { key: "tasks", href: "/app/acoes", icon: ListTodoIcon },
  { key: "resumes", href: "/app/cvs", icon: FileTextIcon },
]

const assistantItems: NavItem[] = [
  { key: "chat", href: "/app/chat", icon: MessageSquareTextIcon },
  { key: "searches", href: "/app/buscas", icon: TargetIcon },
  { key: "memory", href: "/app/memoria", icon: BrainIcon },
]

export const navItems = [...workspaceItems, ...assistantItems]

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]?.[0] ?? ""
  const last = parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : ""
  return `${first}${last}`.toUpperCase()
}

function isActive(pathname: string, href: string) {
  return href === "/app" ? pathname === "/app" : pathname.startsWith(href)
}

function NavGroup({ label, items }: { label: string; items: NavItem[] }) {
  const t = useTranslations("Nav")
  const pathname = usePathname()
  const { openTaskCount } = useWorkspace()
  const { setOpenMobile } = useSidebar()

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.key}>
              <SidebarMenuButton
                isActive={isActive(pathname, item.href)}
                tooltip={t(item.key)}
                render={
                  <Link href={item.href} onClick={() => setOpenMobile(false)} />
                }
              >
                <item.icon />
                <span>{t(item.key)}</span>
              </SidebarMenuButton>
              {item.key === "tasks" && openTaskCount > 0 ? (
                <SidebarMenuBadge>{openTaskCount}</SidebarMenuBadge>
              ) : null}
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

export function AppSidebar({ displayName }: { displayName: string }) {
  const t = useTranslations()
  const { setOpenMobile } = useSidebar()
  const usage = Math.round(
    (demoProfile.plan.used / demoProfile.plan.limit) * 100
  )

  return (
    <Sidebar
      mobileTitle={t("Nav.label")}
      mobileDescription={t("Nav.mobileDescription")}
    >
      <SidebarHeader className="px-4 pt-6 pb-4">
        <Link
          href="/app"
          className="rounded-lg"
          onClick={() => setOpenMobile(false)}
        >
          <Brand />
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <NavGroup label={t("Nav.workspace")} items={workspaceItems} />
        <NavGroup label={t("Nav.assistant")} items={assistantItems} />
      </SidebarContent>
      <SidebarFooter className="gap-3 p-3">
        <Card size="sm">
          <CardHeader className="grid-cols-[auto_1fr] items-center gap-x-2.5">
            <span className="row-span-2 flex size-8 items-center justify-center rounded-lg bg-accent text-accent-foreground">
              <ZapIcon className="size-4 fill-current" />
            </span>
            <CardTitle>{t("Plan.name")}</CardTitle>
            <CardDescription>
              {t("Plan.usage", {
                used: demoProfile.plan.used,
                limit: demoProfile.plan.limit,
              })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Progress
              value={usage}
              aria-label={t("Plan.usage", {
                used: demoProfile.plan.used,
                limit: demoProfile.plan.limit,
              })}
            />
          </CardContent>
        </Card>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuButton
                    size="lg"
                    aria-label={t("Nav.accountMenu")}
                  />
                }
              >
                <Avatar>
                  <AvatarFallback>{initialsOf(displayName)}</AvatarFallback>
                </Avatar>
                <span className="flex min-w-0 flex-1 flex-col text-left">
                  <span className="truncate font-semibold">{displayName}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {t("Profile.completion", {
                      percent: demoProfile.completion,
                    })}
                  </span>
                </span>
                <MoreHorizontalIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="start"
                className="min-w-56"
              >
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    render={
                      <Link
                        href="/app/perfil"
                        onClick={() => setOpenMobile(false)}
                      />
                    }
                  >
                    <UserRoundIcon />
                    {t("Nav.profile")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    render={
                      <Link
                        href="/app/configuracoes"
                        onClick={() => setOpenMobile(false)}
                      />
                    }
                  >
                    <SettingsIcon />
                    {t("Nav.settings")}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={() => void signOut()}>
                    <LogOutIcon />
                    {t("Nav.signOut")}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
