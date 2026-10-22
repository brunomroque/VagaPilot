import { functions, inngest } from "@vagapilot/jobs"
import { serve } from "inngest/next"

/** POST /api/inngest (spec 8.5): Inngest invokes the job functions here (`cv/uploaded`). */
export const { GET, POST, PUT } = serve({ client: inngest, functions })

/** CV extraction may take longer than the default on serverless platforms. */
export const maxDuration = 60
