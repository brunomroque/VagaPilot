import { defineConfig } from "wxt"

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "VagaPilot",
    description: "Assisted job application extension",
    permissions: ["activeTab", "scripting", "storage", "sidePanel", "tabs"],
    host_permissions: [
      "*://*.gupy.io/*",
      "*://*.inhire.app/*",
      "*://*.greenhouse.io/*",
      "*://*.lever.co/*",
      "*://*.myworkdayjobs.com/*",
      "*://*.linkedin.com/*",
      "http://127.0.0.1/*",
      "http://localhost/*",
    ],
    side_panel: {
      default_path: "sidepanel.html",
    },
  },
})
