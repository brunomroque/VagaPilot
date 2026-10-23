"use client"

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { usePathname } from "next/navigation"

import { screenFromPathname, type ChatScreenContext } from "@/lib/chat/screens"
import { useWorkspace } from "@/components/app/workspace-context"

type ChatSheetState = {
  open: boolean
  setOpen: (open: boolean) => void
  openChat: () => void
  screenContext: ChatScreenContext
}

const ChatSheetContext = createContext<ChatSheetState | null>(null)

export function ChatSheetProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const { selectedApplication } = useWorkspace()
  const [open, setOpen] = useState(false)

  const screenContext = useMemo((): ChatScreenContext => {
    const screen = screenFromPathname(pathname)
    return {
      screen,
      pathname,
      applicationId: selectedApplication?.id ?? null,
    }
  }, [pathname, selectedApplication?.id])

  const openChat = useCallback(() => setOpen(true), [])

  const value = useMemo(
    () => ({ open, setOpen, openChat, screenContext }),
    [open, openChat, screenContext]
  )

  return (
    <ChatSheetContext.Provider value={value}>
      {children}
    </ChatSheetContext.Provider>
  )
}

export function useChatSheet() {
  const ctx = useContext(ChatSheetContext)
  if (!ctx)
    throw new Error("useChatSheet must be used within ChatSheetProvider")
  return ctx
}
