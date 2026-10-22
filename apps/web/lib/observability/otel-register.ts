/**
 * Optional OpenTelemetry export (spec P7.2). Active when OTEL_EXPORTER_OTLP_ENDPOINT is set.
 */
export async function registerOpenTelemetry() {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  if (!endpoint) return

  const { NodeSDK } = await import("@opentelemetry/sdk-node")
  const { OTLPTraceExporter } =
    await import("@opentelemetry/exporter-trace-otlp-http")
  const { resourceFromAttributes } = await import("@opentelemetry/resources")
  const { ATTR_SERVICE_NAME } =
    await import("@opentelemetry/semantic-conventions")

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? "vagapilot-web",
    }),
    traceExporter: new OTLPTraceExporter({ url: endpoint }),
  })
  sdk.start()
}
