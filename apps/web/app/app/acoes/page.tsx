import { TasksView } from "@/components/app/tasks-view"
import { ReviewQueue } from "@/components/gmail/review-queue"
import { listReviewItems } from "@/lib/gmail/queries"
import { getUserContext } from "@/lib/server/context"

/** Tarefas (J5): the Gmail "Revise" queue first, then "Suas ações" ordered by deadline. */
export default async function TasksPage() {
  const session = await getUserContext()
  const reviewItems = session.ok
    ? await listReviewItems(session.ctx.supabase)
    : []
  return (
    <div className="flex flex-col gap-8">
      <ReviewQueue items={reviewItems} />
      <TasksView />
    </div>
  )
}
